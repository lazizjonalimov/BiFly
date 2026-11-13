"""Create a demo account with realistic data, by calling the running API (so every business rule applies).

    python scripts/seed_demo.py                       # API at http://localhost:8000
    python scripts/seed_demo.py --api http://host:8000 --email me@example.com --password 'long passphrase'

The account gets two companies, to show the company switcher: one busy, one freshly opened with the first
company's team, customers and equipment copied across. Prints the sign-in details when it finishes.
Development use only.
"""
import argparse
import secrets
import sys
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

PDF = b"%PDF-1.4\n% demo document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--email", default=f"owner-{secrets.token_hex(3)}@demo.example")
    ap.add_argument("--password", default=None, help="default: a random passphrase, printed at the end")
    ap.add_argument("--company", default="Northline Freight")
    ap.add_argument("--timezone", default="America/Chicago", help="IANA time zone of the demo company")
    args = ap.parse_args()
    password = args.password or secrets.token_urlsafe(12)

    with httpx.Client(base_url=args.api.rstrip("/") + "/api/v1", timeout=30) as http:
        def call(method: str, url: str, **kw):
            r = http.request(method, url, **kw)
            if r.status_code >= 400:
                sys.exit(f"{method} {url} -> {r.status_code}: {r.text}")
            return r.json() if r.content else None

        def post(url: str, body: dict | None = None):
            return call("POST", url, json=body or {})

        try:
            signup = http.post("/auth/signup", json={
                "organization_name": args.company, "full_name": "Olivia Owner", "email": args.email,
                "password": password, "dot_number": "3141592", "mc_number": "MC-271828",
                "timezone": args.timezone})
        except httpx.ConnectError:
            sys.exit(f"Could not reach the API at {args.api}. Is it running?")
        if signup.status_code == 409:
            sys.exit(f"{args.email} already has an account. Pass a different --email.")
        if signup.status_code >= 400:
            sys.exit(f"Sign-up failed: {signup.status_code} {signup.text}")
        http.headers["Authorization"] = "Bearer " + signup.json()["access_token"]
        first_company = signup.json()["organization"]["id"]

        now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        at = lambda days, hours=0: (now + timedelta(days=days, hours=hours)).isoformat()  # noqa: E731
        date = lambda days: (now + timedelta(days=days)).date().isoformat()  # noqa: E731

        call("PATCH", "/organization", json={
            "legal_name": f"{args.company} LLC", "phone": "312-555-0100", "email": "billing@northline.example",
            "address": "1200 W Cermak Rd", "city": "Chicago", "state": "IL", "postal_code": "60608"})

        # --- people and places ------------------------------------------------------------------------
        for name, role in (("Devon Dispatcher", "dispatcher"), ("Ada Accountant", "accountant"),
                           ("Sam Safety", "safety_manager"), ("Fran Fleet", "fleet_manager")):
            post("/members", {"full_name": name, "role": role, "password": secrets.token_urlsafe(12),
                              "email": f"{name.split()[0].lower()}-{secrets.token_hex(3)}@demo.example"})
        driver_email = f"dana-{secrets.token_hex(3)}@demo.example"
        driver_login = post("/members", {"full_name": "Dana Reyes", "role": "driver", "password": password,
                                         "email": driver_email})
        chicago = post("/terminals", {"name": "Chicago yard", "code": "CHI", "city": "Chicago", "state": "IL"})
        dallas = post("/terminals", {"name": "Dallas yard", "code": "DAL", "city": "Dallas", "state": "TX"})

        # --- customers --------------------------------------------------------------------------------
        customers = [post("/customers", c) for c in (
            {"name": "Globex Manufacturing", "code": "GLOBEX", "legal_name": "Globex Manufacturing Inc.",
             "billing_email": "ap@globex.example", "phone": "312-555-0142", "billing_address": "400 W Fulton St",
             "billing_city": "Chicago", "billing_state": "IL", "billing_postal_code": "60661",
             "payment_terms_days": 30, "credit_limit": "75000.00"},
            {"name": "Initech Foods", "code": "INITECH", "billing_email": "payables@initech.example",
             "phone": "214-555-0199", "billing_city": "Indianapolis", "billing_state": "IN",
             "payment_terms_days": 15},
            {"name": "Umbrella Paper Co", "code": "UMBRELLA", "billing_email": "billing@umbrella.example",
             "billing_city": "Milwaukee", "billing_state": "WI", "payment_terms_days": 45},
        )]
        globex, initech, umbrella = customers
        post(f"/customers/{globex['id']}/contacts", {"name": "Grace Hopper", "title": "Logistics manager",
                                                      "email": "grace@globex.example", "phone": "312-555-0143",
                                                      "kind": "operations", "is_primary": True})
        post(f"/customers/{globex['id']}/contacts", {"name": "Bill Payer", "title": "Accounts payable",
                                                      "email": "ap@globex.example", "kind": "billing"})
        post(f"/customers/{globex['id']}/addresses", {"label": "Globex Plant 4", "kind": "facility",
                                                       "address": "4100 S Ashland Ave", "city": "Chicago",
                                                       "state": "IL", "postal_code": "60609",
                                                       "notes": "Dock 12. Check in at the guard shack."})
        post(f"/customers/{initech['id']}/contacts", {"name": "Peter Gibbons", "email": "peter@initech.example",
                                                       "kind": "operations", "is_primary": True})

        # --- drivers ----------------------------------------------------------------------------------
        drivers = [post("/drivers", d) for d in (
            {"first_name": "Dana", "last_name": "Reyes", "phone": "312-555-0101", "employee_number": "E-1001",
             "cdl_number": "D1234567", "cdl_state": "IL", "cdl_class": "A", "cdl_expiry": date(900),
             "medical_cert_expiry": date(400), "hire_date": date(-800), "terminal_id": chicago["id"],
             "pay_type": "per_mile", "pay_rate": "0.62", "user_id": driver_login["user_id"]},
            {"first_name": "Marcus", "last_name": "Hill", "phone": "312-555-0102", "employee_number": "E-1002",
             "cdl_number": "H7654321", "cdl_state": "IL", "cdl_class": "A", "cdl_expiry": date(600),
             "medical_cert_expiry": date(21), "hire_date": date(-420), "terminal_id": chicago["id"],
             "pay_type": "per_mile", "pay_rate": "0.58"},                                   # medical card expiring
            {"first_name": "Priya", "last_name": "Nair", "phone": "469-555-0103", "employee_number": "E-1003",
             "cdl_number": "N2468101", "cdl_state": "TX", "cdl_class": "A", "cdl_expiry": date(1200),
             "medical_cert_expiry": date(300), "hire_date": date(-200), "terminal_id": dallas["id"],
             "driver_type": "owner_operator", "pay_type": "percent", "pay_rate": "78"},
            {"first_name": "Tom", "last_name": "Becker", "phone": "317-555-0104", "employee_number": "E-1004",
             "cdl_number": "B1357911", "cdl_state": "IN", "cdl_class": "A", "cdl_expiry": date(-12),
             "medical_cert_expiry": date(200), "terminal_id": chicago["id"]},                # expired licence
            {"first_name": "Lena", "last_name": "Ortiz", "phone": "214-555-0105", "employee_number": "E-1005",
             "cdl_number": "O9080706", "cdl_state": "TX", "cdl_class": "A", "cdl_expiry": date(700),
             "medical_cert_expiry": date(500), "terminal_id": dallas["id"], "pay_type": "flat", "pay_rate": "350"},
        )]
        post(f"/drivers/{drivers[0]['id']}/qualifications", {"type": "mvr", "issued_on": date(-200),
                                                              "expires_on": date(165), "required": True})
        post(f"/drivers/{drivers[0]['id']}/qualifications", {"type": "hazmat", "issued_on": date(-400),
                                                              "expires_on": date(25), "reference": "HM-22871"})
        post(f"/drivers/{drivers[2]['id']}/qualifications", {"type": "drug_test", "issued_on": date(-190),
                                                              "expires_on": date(175), "required": True})

        # --- equipment --------------------------------------------------------------------------------
        good = {"insurance_expiry": date(200), "registration_expiry": date(150), "inspection_expiry": date(120)}
        trucks = [post("/vehicles", v) for v in (
            {"unit_number": "101", "vin": "1FUJGLDR5CLBP8834", "make": "Freightliner", "model": "Cascadia",
             "year": 2023, "plate": "P123456", "plate_state": "IL", "odometer": 184200,
             "terminal_id": chicago["id"], **good},
            {"unit_number": "102", "make": "Kenworth", "model": "T680", "year": 2022, "plate": "P234567",
             "plate_state": "IL", "odometer": 262900, "terminal_id": chicago["id"],
             **{**good, "registration_expiry": date(18)}},                                   # expiring soon
            {"unit_number": "103", "make": "Volvo", "model": "VNL 760", "year": 2021, "plate": "T345678",
             "plate_state": "TX", "odometer": 341050, "terminal_id": dallas["id"], "ownership": "leased", **good},
            {"unit_number": "104", "make": "Peterbilt", "model": "579", "year": 2020, "plate": "P456789",
             "plate_state": "IL", "odometer": 412300, "terminal_id": chicago["id"], **good},   # in the shop, below
            {"unit_number": "105", "make": "Mack", "model": "Anthem", "year": 2024, "plate": "T567890",
             "plate_state": "TX", "terminal_id": dallas["id"], "ownership": "owner_operator",
             **{**good, "inspection_expiry": date(-5)}},                                     # inspection lapsed
        )]
        trailers = [post("/trailers", t) for t in (
            {"unit_number": "5301", "type": "dry_van", "length_ft": 53, "plate": "TR11122", "plate_state": "IL",
             "terminal_id": chicago["id"], **good},
            {"unit_number": "5302", "type": "dry_van", "length_ft": 53, "plate": "TR22233", "plate_state": "IL",
             "terminal_id": chicago["id"], **good},
            {"unit_number": "5303", "type": "dry_van", "length_ft": 53, "plate": "TR33344", "plate_state": "TX",
             "terminal_id": dallas["id"], **good},
            {"unit_number": "R4801", "type": "reefer", "length_ft": 48, "plate": "TR44455", "plate_state": "IN",
             "terminal_id": chicago["id"], **good},
            {"unit_number": "F4802", "type": "flatbed", "length_ft": 48, "terminal_id": dallas["id"], **good},
        )]

        def upload_doc(entity_type: str, entity_id: str, doc_type: str, filename: str, **extra):
            intent = post("/documents/upload-intents", {
                "filename": filename, "content_type": "application/pdf", "size_bytes": len(PDF), "type": doc_type,
                "entity_type": entity_type, "entity_id": entity_id, **extra})
            call("PUT", intent["upload"]["url"], content=PDF, headers=intent["upload"]["headers"])
            return post(f"/documents/{intent['document']['id']}/complete")

        upload_doc("vehicle", trucks[0]["id"], "insurance", "policy-truck-101.pdf", expires_on=date(200))
        upload_doc("driver", drivers[0]["id"], "license", "cdl-dana-reyes.pdf", expires_on=date(900))
        upload_doc("customer", globex["id"], "other", "globex-carrier-agreement.pdf")

        # --- loads at every stage ---------------------------------------------------------------------
        chi, dal = ("Globex Plant 4", "Chicago", "IL"), ("Lone Star DC", "Dallas", "TX")
        ind, atl = ("Initech Cold Storage", "Indianapolis", "IN"), ("Peachtree Grocers DC", "Atlanta", "GA")
        mke, stl = ("Umbrella Mill", "Milwaukee", "WI"), ("Gateway Print Works", "St. Louis", "MO")
        mem, kc = ("Bluff City Crossdock", "Memphis", "TN"), ("Heartland Distribution", "Kansas City", "MO")

        def load(customer, origin, dest, pickup, rate, commodity, weight, miles, *, equipment="dry_van", ref=None,
                 terminal=chicago, transit_days=1.5, charges=(), status="planned"):
            (o_name, o_city, o_state), (d_name, d_city, d_state) = origin, dest
            return post("/loads", {
                "customer_id": customer["id"], "terminal_id": terminal["id"], "commodity": commodity,
                "weight_lbs": weight, "miles": miles, "customer_rate": rate, "equipment_type": equipment,
                "reference": ref, "status": status, "charges": list(charges),
                "items": [{"description": commodity, "quantity": 22, "unit": "pallets", "weight_lbs": weight}],
                "stops": [
                    {"type": "pickup", "name": o_name, "city": o_city, "state": o_state,
                     "appt_start": at(pickup), "appt_end": at(pickup, 2)},
                    {"type": "delivery", "name": d_name, "city": d_city, "state": d_state,
                     "appt_start": at(pickup + transit_days), "appt_end": at(pickup + transit_days, 3)},
                ]})

        def assign(ld, driver, truck, trailer):
            return post("/dispatch/assignments", {
                "load_id": ld["id"], "driver_id": driver["id"], "vehicle_id": truck["id"],
                "trailer_id": trailer["id"], "version": ld["version"]})

        def act(ld, action, **extra):
            return post(f"/loads/{ld['id']}/transitions", {"action": action, "version": ld["version"], **extra})

        def run(ld, *steps):
            """Each step is (action, hours ago it happened)."""
            for action, hours_ago in steps:
                ld = act(ld, action, **({"occurred_at": at(0, -hours_ago)} if hours_ago is not None else {}))
            return ld

        def delivered(ld, driver, truck, trailer, finished_hours_ago: float):
            ld = assign(ld, driver, truck, trailer)
            h = finished_hours_ago
            return run(ld, ("dispatch", None), ("arrive", h + 30), ("depart", h + 28), ("arrive", h + 2),
                       ("depart", h))

        def completed(ld, driver, truck, trailer, finished_hours_ago: float):
            ld = delivered(ld, driver, truck, trailer, finished_hours_ago)
            upload_doc("load", ld["id"], "pod", f"pod-{ld['load_number']}.pdf")
            upload_doc("load", ld["id"], "bol", f"bol-{ld['load_number']}.pdf")
            return act(call("GET", f"/loads/{ld['id']}"), "approve_pod")

        def invoice(customer, *loads, issue=True):
            inv = post("/invoices", {"customer_id": customer["id"], "load_ids": [x["id"] for x in loads]})
            return post(f"/invoices/{inv['id']}/issue") if issue else inv

        def pay(customer, amount, inv, applied, method="ach", reference=None):
            # "Today" is the company's date, which can be a day behind UTC.
            received = datetime.now(ZoneInfo(args.timezone)).date().isoformat()
            return post("/payments", {"customer_id": customer["id"], "amount": amount, "received_on": received,
                                      "method": method, "reference": reference,
                                      "allocations": [{"invoice_id": inv["id"], "amount": applied}]})

        # Finished work, oldest first (each one frees the driver before the next begins).
        a = completed(load(globex, chi, dal, -9, "2850.00", "Machine parts", 38000, 925, ref="PO-88121"),
                      drivers[0], trucks[0], trailers[0], 170)
        b = completed(load(umbrella, mke, stl, -7, "1450.00", "Paper rolls", 41000, 375, ref="UP-4471",
                           charges=[{"type": "detention", "quantity": "2", "rate": "75.00",
                                     "description": "2 h at receiver"}]),
                      drivers[2], trucks[2], trailers[2], 120)
        c = completed(load(globex, chi, stl, -5, "1100.00", "Steel fasteners", 22000, 300, ref="PO-88140"),
                      drivers[0], trucks[0], trailers[0], 80)
        d = completed(load(initech, ind, atl, -4, "2300.00", "Frozen vegetables", 36000, 535, equipment="reefer",
                           ref="IN-20931", charges=[{"type": "fuel_surcharge", "rate": "140.00"}]),
                      drivers[4], trucks[2], trailers[3], 40)
        # This one stays completed and unbilled, so it shows up as ready to invoice.
        completed(load(globex, chi, kc, -3, "1650.00", "Machine parts", 30000, 510, ref="PO-88163"),
                  drivers[0], trucks[0], trailers[0], 20)

        paid = invoice(globex, a)
        pay(globex, "2850.00", paid, "2850.00", reference="ACH-55021")                      # paid in full
        part = invoice(umbrella, b)
        pay(umbrella, "600.00", part, "600.00", method="check", reference="CHK 10442")       # part paid
        invoice(globex, c)                                                                   # issued, unpaid
        invoice(initech, d, issue=False)                                                     # still a draft

        # Delivered, waiting for paperwork; and delivered with the POD waiting for review.
        delivered(load(umbrella, mke, kc, -2.5, "1900.00", "Paper rolls", 40000, 565, ref="UP-4490"),
                  drivers[2], trucks[2], trailers[2], 6)
        review = delivered(load(initech, ind, mem, -2, "1750.00", "Dry groceries", 34000, 465, ref="IN-20944"),
                           drivers[4], trucks[0], trailers[1], 3)
        upload_doc("load", review["id"], "pod", f"pod-{review['load_number']}.pdf")

        # On the road right now.
        rolling = assign(load(globex, chi, dal, -0.6, "2900.00", "Machine parts", 39000, 925, ref="PO-88170"),
                         drivers[0], trucks[0], trailers[0])
        rolling = run(rolling, ("dispatch", None), ("arrive", 13), ("depart", 11))
        post(f"/loads/{rolling['id']}/tracking", {"city": "Springfield", "state": "MO", "note": "Rolling, on time"})
        post(f"/loads/{rolling['id']}/notes", {"body": "Receiver wants a call 1 hour before arrival."})
        at_dock = assign(load(initech, mem, atl, -0.2, "1500.00", "Dry groceries", 30000, 385, ref="IN-20950",
                              terminal=dallas),
                         drivers[2], trucks[2], trailers[2])
        run(at_dock, ("dispatch", None), ("arrive", 1))

        # Planned work: assigned and waiting, unassigned, late, and one on hold.
        assign(load(umbrella, mke, stl, 2, "1500.00", "Paper rolls", 41000, 375, ref="UP-4502"),
               drivers[1], trucks[1], trailers[1])
        load(globex, chi, kc, 0.3, "1700.00", "Machine parts", 28000, 510, ref="PO-88181")   # picks up today
        load(initech, ind, atl, 3, "2350.00", "Frozen vegetables", 36000, 535, equipment="reefer", ref="IN-20961")
        load(globex, dal, chi, 4, "2600.00", "Returned racks", 18000, 925, ref="PO-88190", terminal=dallas)
        load(umbrella, stl, mke, -0.3, "1300.00", "Empty cores", 12000, 375, ref="UP-4510")  # late, no driver
        held = assign(load(initech, mem, kc, 5, "1250.00", "Dry groceries", 31000, 450, ref="IN-20970",
                           terminal=dallas), drivers[4], trucks[2], trailers[2])
        act(held, "hold", reason="Customer is confirming the delivery date")
        load(globex, chi, atl, 6, "0", "To be confirmed", None, None, status="draft")
        cancelled = load(umbrella, mke, dal, 7, "2400.00", "Paper rolls", 40000, 1010, ref="UP-4515")
        act(cancelled, "cancel", reason="Shipper cancelled the order")

        # --- maintenance ------------------------------------------------------------------------------
        # Truck 104 is in the shop for an urgent repair, which keeps it off the dispatch board.
        shop = post("/maintenance/work-orders", {
            "vehicle_id": trucks[3]["id"], "title": "Turbocharger replacement", "priority": "urgent",
            "out_of_service": True, "vendor": "Midwest Diesel", "odometer": 412300, "scheduled_for": date(1),
            "description": "Loss of power under load. Boost leak traced to the turbo.",
            "lines": [{"kind": "part", "description": "Turbocharger", "unit_cost": "3150.00"},
                      {"kind": "labor", "description": "Labour", "quantity": "6", "unit_cost": "135.00"}]})
        post(f"/maintenance/work-orders/{shop['id']}/transitions", {"action": "start", "version": shop["version"]})
        # Truck 101 had its preventive service; trailer 5303's door seals are overdue.
        service = post("/maintenance/work-orders", {
            "vehicle_id": trucks[0]["id"], "title": "Preventive maintenance A", "odometer": 184200,
            "lines": [{"kind": "part", "description": "Oil and filters", "unit_cost": "286.40"},
                      {"kind": "labor", "description": "Labour", "quantity": "2", "unit_cost": "120.00"}]})
        post(f"/maintenance/work-orders/{service['id']}/transitions", {
            "action": "complete", "version": service["version"], "notes": "Oil, filters and grease. Nothing else found."})
        post("/maintenance/work-orders", {"trailer_id": trailers[2]["id"], "title": "Replace door seals",
                                          "scheduled_for": date(-3)})
        # Inspections: a clean daily check, and a roadside inspection that found a lamp out.
        post("/maintenance/inspections", {"vehicle_id": trucks[0]["id"], "driver_id": drivers[0]["id"],
                                          "kind": "pre_trip", "inspected_on": date(-1), "result": "pass",
                                          "odometer": 184260})
        post("/maintenance/inspections", {
            "trailer_id": trailers[1]["id"], "driver_id": drivers[0]["id"], "kind": "roadside",
            "inspected_on": date(-2), "result": "defects", "location": "I-55 MM 197",
            "inspector": "Illinois State Police", "report_number": "IL-55120",
            "defects": [{"item": "Marker lamp out", "severity": "minor", "description": "Rear left clearance lamp"}]})

        # --- a second company under the same profile --------------------------------------------------
        second = post("/account/companies", {
            "name": "Northline Logistics South", "dot_number": "2718281", "mc_number": "MC-161803",
            "copy_from": first_company, "include": ["team", "terminals", "customers", "drivers", "vehicles",
                                                    "trailers"]})

    print("Demo account created.")
    print(f"  Sign in as owner:   {args.email}")
    print(f"  Sign in as driver:  {driver_email}")
    print(f"  Password (both):    {password}")
    print(f"  Companies:          {args.company} (busy), {second['name']} (new, with setup copied)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
