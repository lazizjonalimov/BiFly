"""Create a demo company with realistic data, by calling the running API (so every business rule applies).

    python scripts/seed_demo.py                       # API at http://localhost:8000
    python scripts/seed_demo.py --api http://host:8000 --email me@example.com --password 'long passphrase'

Prints the sign-in details when it finishes. Development use only.
"""
import argparse
import secrets
import sys
from datetime import UTC, datetime, timedelta

import httpx

PDF = b"%PDF-1.4\n% demo proof of delivery\n"


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

        def post(url: str, body: dict | None = None):
            return call("POST", url, json=body or {})

        today = datetime.now(UTC).replace(hour=14, minute=0, second=0, microsecond=0)
        day = lambda n: (today + timedelta(days=n)).isoformat()  # noqa: E731
        date = lambda n: (today + timedelta(days=n)).date().isoformat()  # noqa: E731

        # --- people -----------------------------------------------------------------------------------
        for name, role in (("Devon Dispatcher", "dispatcher"), ("Ada Accountant", "accountant"),
                           ("Sam Safety", "safety_manager")):
            post("/users", {"full_name": name, "role": role, "password": secrets.token_urlsafe(12),
                            "email": f"{name.split()[0].lower()}-{secrets.token_hex(3)}@demo.example"})
        driver_login = post("/users", {"full_name": "Dana Reyes", "role": "driver", "password": password,
                                       "email": f"dana-{secrets.token_hex(3)}@demo.example"})

        # --- master data ------------------------------------------------------------------------------
        customers = [post("/customers", c) for c in (
            {"name": "Globex Manufacturing", "billing_email": "ap@globex.example", "phone": "312-555-0142",
             "address": "400 W Fulton St, Chicago, IL", "payment_terms_days": 30},
            {"name": "Initech Foods", "billing_email": "payables@initech.example", "phone": "214-555-0199",
             "payment_terms_days": 15},
            {"name": "Umbrella Paper Co", "billing_email": "billing@umbrella.example", "payment_terms_days": 45},
        )]
        drivers = [post("/drivers", d) for d in (
            {"first_name": "Dana", "last_name": "Reyes", "phone": "312-555-0101", "cdl_number": "D1234567",
             "cdl_state": "IL", "cdl_expiry": date(900), "medical_cert_expiry": date(400),
             "user_id": driver_login["user_id"]},
            {"first_name": "Marcus", "last_name": "Hill", "phone": "312-555-0102", "cdl_number": "H7654321",
             "cdl_state": "IL", "cdl_expiry": date(600), "medical_cert_expiry": date(21)},      # expiring soon
            {"first_name": "Priya", "last_name": "Nair", "phone": "469-555-0103", "cdl_number": "N2468101",
             "cdl_state": "TX", "cdl_expiry": date(1200), "medical_cert_expiry": date(300)},
            {"first_name": "Tom", "last_name": "Becker", "phone": "317-555-0104", "cdl_number": "B1357911",
             "cdl_state": "IN", "cdl_expiry": date(-12), "medical_cert_expiry": date(200)},     # expired CDL
        )]
        trucks = [post("/vehicles", v) for v in (
            {"unit_number": "T-101", "make": "Freightliner", "model": "Cascadia", "year": 2023, "plate": "P123456",
             "insurance_expiry": date(200), "registration_expiry": date(150)},
            {"unit_number": "T-102", "make": "Kenworth", "model": "T680", "year": 2022, "plate": "P234567",
             "insurance_expiry": date(200), "registration_expiry": date(18)},                    # expiring soon
            {"unit_number": "T-103", "make": "Volvo", "model": "VNL 760", "year": 2021, "plate": "P345678",
             "insurance_expiry": date(200), "registration_expiry": date(250)},
            {"unit_number": "T-104", "make": "Peterbilt", "model": "579", "year": 2020, "status": "maintenance"},
        )]
        trailers = [post("/trailers", t) for t in (
            {"unit_number": "TR-53A", "type": "dry_van", "plate": "T111222"},
            {"unit_number": "TR-53B", "type": "dry_van", "plate": "T222333"},
            {"unit_number": "TR-53C", "type": "dry_van", "plate": "T333444"},
            {"unit_number": "RF-48A", "type": "reefer", "plate": "T444555"},
        )]

        # --- loads at every stage ---------------------------------------------------------------------
        def load(customer, origin, dest, pickup_in_days, rate, commodity, weight, equipment="dry_van", ref=None):
            (o_name, o_city, o_state), (d_name, d_city, d_state) = origin, dest
            return post("/loads", {
                "customer_id": customer["id"], "commodity": commodity, "weight_lbs": weight, "customer_rate": rate,
                "equipment_type": equipment, "reference": ref,
                "stops": [
                    {"type": "pickup", "name": o_name, "city": o_city, "state": o_state, "appt_start": day(pickup_in_days)},
                    {"type": "delivery", "name": d_name, "city": d_city, "state": d_state,
                     "appt_start": day(pickup_in_days + 2)},
                ]})

        def assign(ld, driver, truck, trailer):
            return post("/dispatch/assignments", {"load_id": ld["id"], "driver_id": driver["id"],
                                                  "vehicle_id": truck["id"], "trailer_id": trailer["id"]})

        def work_stops(ld, upto: int):
            """Record arrive/depart for the first `upto` stop events (4 = fully delivered)."""
            events = [(s, e) for s in ld["stops"] for e in ("arrived", "departed")][:upto]
            for stop, event in events:
                post(f"/loads/{ld['id']}/stops/{stop['id']}/events", {"event": event})

        def deliver_and_confirm(ld):
            work_stops(ld, 4)
            call("POST", f"/loads/{ld['id']}/documents", data={"type": "pod"},
                 files={"file": ("pod.pdf", PDF, "application/pdf")})
            post(f"/loads/{ld['id']}/confirm-delivery")

        globex, initech, umbrella = customers
        chi, dal = ("Globex Plant 4", "Chicago", "IL"), ("Lone Star DC", "Dallas", "TX")
        ind, atl = ("Initech Cold Storage", "Indianapolis", "IN"), ("Peachtree Grocers DC", "Atlanta", "GA")
        mke, stl = ("Umbrella Mill", "Milwaukee", "WI"), ("Gateway Print Works", "St. Louis", "MO")

        # paid in full
        ld = load(globex, chi, dal, -9, "2850.00", "Machine parts", 38000, ref="PO-88121")
        assign(ld, drivers[0], trucks[0], trailers[0])
        post(f"/dispatch/loads/{ld['id']}/dispatch")
        deliver_and_confirm(ld)
        inv = post("/invoices", {"load_id": ld["id"]})
        post(f"/invoices/{inv['id']}/payments", {"amount": "2850.00", "method": "ach", "reference": "ACH-55021"})

        # invoiced, part paid
        ld = load(umbrella, mke, stl, -6, "1450.00", "Paper rolls", 41000, ref="UP-4471")
        assign(ld, drivers[2], trucks[2], trailers[1])
        post(f"/dispatch/loads/{ld['id']}/dispatch")
        deliver_and_confirm(ld)
        inv = post("/invoices", {"load_id": ld["id"]})
        post(f"/invoices/{inv['id']}/payments", {"amount": "500.00", "method": "check", "reference": "CHK 10442"})

        # completed, ready to invoice
        ld = load(globex, chi, stl, -4, "1100.00", "Steel fasteners", 22000, ref="PO-88140")
        assign(ld, drivers[0], trucks[0], trailers[0])
        post(f"/dispatch/loads/{ld['id']}/dispatch")
        deliver_and_confirm(ld)

        # delivered by the driver, waiting for a POD and dispatcher confirmation
        ld = load(umbrella, mke, chi, -2, "620.00", "Corrugated sheets", 18000)
        assign(ld, drivers[2], trucks[2], trailers[1])
        post(f"/dispatch/loads/{ld['id']}/dispatch")
        work_stops(ld, 4)

        # in transit
        ld = load(globex, chi, dal, -1, "2900.00", "Machine parts", 36500, ref="PO-88163")
        assign(ld, drivers[0], trucks[0], trailers[0])
        post(f"/dispatch/loads/{ld['id']}/dispatch")
        work_stops(ld, 2)

        # dispatched, not yet picked up
        ld = load(initech, ind, atl, 0, "2300.00", "Frozen vegetables", 39000, equipment="reefer", ref="IF-20931")
        assign(ld, drivers[2], trucks[2], trailers[3])
        post(f"/dispatch/loads/{ld['id']}/dispatch")

        # assigned, not yet released to the driver
        ld = load(umbrella, mke, stl, 1, "1480.00", "Paper rolls", 40500, ref="UP-4502")
        assign(ld, drivers[1], trucks[1], trailers[2])

        # still need a driver
        load(globex, chi, atl, 1, "2150.00", "Machine parts", 30000, ref="PO-88170")
        load(initech, ind, dal, 2, "2650.00", "Dairy", 37000, equipment="reefer", ref="IF-20958")
        load(umbrella, mke, chi, 3, "640.00", "Corrugated sheets", 17500)

    print(f"""
Demo company "{args.company}" is ready.

  Sign in at   http://localhost:3000
  Email        {args.email}
  Password     {password}

  10 loads across every stage, 3 customers, 4 drivers, 4 trucks, 4 trailers.
  The driver login for Dana Reyes uses the same password (driver app endpoints: /api/v1/driver/...).
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
