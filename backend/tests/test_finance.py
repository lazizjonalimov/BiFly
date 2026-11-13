"""Invoices and payments: drafts follow their loads, issued invoices are fixed, money is never edited."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import complete, deliver, new_load, seed

TODAY = datetime.now(UTC).date()      # test companies run on UTC


def draft(api, s, *loads, expect=201, **extra):
    return api.post("/invoices", {"customer_id": s["customer"]["id"], "load_ids": [x["id"] for x in loads], **extra}, expect)


def issued(api, s, **load):
    done = complete(api, s, **load)
    invoice = draft(api, s, done).json()
    return api.post(f"/invoices/{invoice['id']}/issue", expect=200).json(), done


def pay(api, s, amount, *allocations, expect=201, headers=None, **extra):
    body = {"customer_id": s["customer"]["id"], "amount": amount, "received_on": str(TODAY), "method": "ach",
            "allocations": [{"invoice_id": i, "amount": a} for i, a in allocations], **extra}
    return api.post("/payments", body, expect, headers=headers)


def test_a_draft_is_built_from_completed_loads_and_follows_them(org):
    s = seed(org)
    first = complete(org, s, reference="PO-1", charges=[{"type": "detention", "quantity": "2", "rate": "75.00"},
                                                         {"type": "lumper", "rate": "60.00", "billable": False}])
    second = complete(org, s, customer_rate="1000.00")
    invoice = draft(org, s, first, second, notes="Thank you").json()

    assert invoice["status"] == "draft" and invoice["invoice_number"] is None and invoice["issue_date"] is None
    assert invoice["total"] == "3650.00" and invoice["balance"] == "3650.00" and invoice["paid"] == "0.00"
    kinds = [(x["load_number"], x["kind"], x["amount"]) for x in invoice["lines"]]
    assert kinds == [("L-1001", "line_haul", "2500.00"), ("L-1001", "accessorial", "150.00"), ("L-1002", "line_haul", "1000.00")]
    assert "PO-1" in invoice["lines"][0]["description"] and "Chicago, IL to Dallas, TX" in invoice["lines"][0]["description"]
    assert invoice["lines"][1]["description"] == "Detention"            # the non-billable lumper is not there
    assert invoice["bill_to"]["name"] == "Globex" and invoice["seller"]["name"] == "Acme Trucking"
    assert set(invoice["allowed_actions"]) == {"edit", "issue", "delete"}
    # A load waits on its draft: still unbilled, but not offered to another invoice.
    assert org.get(f"/loads/{first['id']}").json()["billing_status"] == "unbilled"
    assert org.items("/loads", view="ready_to_invoice") == []
    assert draft(org, s, first, expect=409).json()["error"]["code"] == "LOAD_ALREADY_INVOICED"

    # Changing a load that is on a draft changes the draft.
    load = org.get(f"/loads/{second['id']}").json()
    org.patch(f"/loads/{second['id']}", {"version": load["version"], "customer_rate": "1200.00"}, 200)
    org.post(f"/loads/{second['id']}/charges", {"type": "fuel_surcharge", "rate": "40.00"}, 201)
    assert org.get(f"/invoices/{invoice['id']}").json()["total"] == "3890.00"

    # Adjustments, and choosing which loads the draft covers.
    adjusted = org.post(f"/invoices/{invoice['id']}/lines", {"description": "Volume discount", "unit_price": "-90.00"}, 201).json()
    assert adjusted["total"] == "3800.00" and adjusted["lines"][-1]["kind"] == "adjustment"
    org.error("DELETE", f"/invoices/{invoice['id']}/lines/{adjusted['lines'][0]['id']}", 409, "STATE_CONFLICT")
    only_first = org.put(f"/invoices/{invoice['id']}/loads", {"load_ids": [first["id"]]}, 200).json()
    assert only_first["total"] == "2560.00"
    assert [x["id"] for x in org.items("/loads", view="ready_to_invoice")] == [second["id"]]
    org.error("POST", f"/invoices/{invoice['id']}/lines", 422, "VALIDATION_ERROR", json={"description": "Too generous", "unit_price": "-9999.00"})
    line = only_first["lines"][-1]["id"]
    assert org.delete(f"/invoices/{invoice['id']}/lines/{line}", expect=200).json()["total"] == "2650.00"

    org.delete(f"/invoices/{invoice['id']}", expect=204)
    assert {x["id"] for x in org.items("/loads", view="ready_to_invoice")} == {first["id"], second["id"]}
    org.error("GET", f"/invoices/{invoice['id']}", 404, "NOT_FOUND")


def test_only_completed_unbilled_loads_of_that_customer_can_be_invoiced(org):
    s = seed(org)
    delivered = deliver(org, new_load(org, s["customer"]["id"]), s)
    assert draft(org, s, delivered, expect=409).json()["error"]["code"] == "LOAD_NOT_BILLABLE"
    other_customer = org.post("/customers", {"name": "Initech"}, 201).json()
    done = complete(org, s)
    assert org.post("/invoices", {"customer_id": other_customer["id"], "load_ids": [done["id"]]}, 422).json()["error"][
        "field_errors"].keys() == {"load_ids"}
    org.error("POST", "/invoices", 422, "VALIDATION_ERROR", json={"customer_id": str(uuid.uuid4())})
    empty = draft(org, s).json()
    org.error("POST", f"/invoices/{empty['id']}/issue", 409, "INVOICE_EMPTY")


def test_issuing_numbers_the_invoice_and_freezes_it(org, owner_sql):
    org.patch("/organization", {"invoice_number_prefix": "ACME"}, 200)
    s = seed(org)
    org.patch(f"/customers/{s['customer']['id']}", {"legal_name": "Globex Corporation", "billing_city": "Springfield",
                                                    "billing_email": "ap@globex.example"}, 200)
    done = complete(org, s)
    invoice = draft(org, s, done).json()
    key = {"Idempotency-Key": uuid.uuid4().hex}
    out = org.post(f"/invoices/{invoice['id']}/issue", expect=200, headers=key).json()
    again = org.post(f"/invoices/{invoice['id']}/issue", expect=200, headers=key)
    assert again.headers["Idempotent-Replay"] == "true" and again.json()["invoice_number"] == out["invoice_number"] == "ACME-1001"
    org.error("POST", f"/invoices/{invoice['id']}/issue", 409, "INVOICE_NOT_DRAFT")

    assert out["status"] == "issued" and out["issue_date"] == str(TODAY)
    assert out["due_date"] == str(TODAY + timedelta(days=15)) and out["payment_terms_days"] == 15   # the customer's terms
    assert out["issued_by_name"] == "Olive Owner" and set(out["allowed_actions"]) == {"void", "record_payment"}
    load = org.get(f"/loads/{done['id']}").json()
    assert load["billing_status"] == "invoiced" and load["invoice"]["invoice_number"] == "ACME-1001"

    # The bill-to block is a snapshot: later changes to the customer don't rewrite an issued invoice.
    org.patch(f"/customers/{s['customer']['id']}", {"legal_name": "Globex Renamed LLC", "billing_city": "Shelbyville"}, 200)
    frozen = org.get(f"/invoices/{invoice['id']}").json()["bill_to"]
    assert (frozen["name"], frozen["city"], frozen["email"]) == ("Globex Corporation", "Springfield", "ap@globex.example")

    # Every editing route is closed...
    for method, url, body in (("PATCH", "", {"notes": "x"}), ("PUT", "/loads", {"load_ids": []}),
                              ("POST", "/lines", {"description": "x", "unit_price": "1.00"}), ("DELETE", "", None)):
        org.error(method, f"/invoices/{invoice['id']}{url}", 409, "INVOICE_NOT_DRAFT", json=body)
    # ...and the database refuses too, even for the schema owner.
    for statement in ("UPDATE invoices SET total = 1 WHERE id = :i", "DELETE FROM invoices WHERE id = :i",
                      "UPDATE invoice_lines SET amount = 1 WHERE invoice_id = :i",
                      "DELETE FROM invoice_lines WHERE invoice_id = :i"):
        with pytest.raises(DBAPIError, match="cannot be"), owner_sql.begin() as c:
            c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org.org_id})
            c.execute(text(statement), {"i": invoice["id"]})
    assert org.get(f"/invoices/{invoice['id']}").json()["total"] == "2500.00"


def test_invoice_numbers_have_no_gaps_and_no_duplicates(org):
    s = seed(org)
    discarded = draft(org, s, complete(org, s)).json()
    org.delete(f"/invoices/{discarded['id']}", expect=204)                    # a thrown-away draft uses no number
    drafts = [draft(org, s, complete(org, s, customer_rate="100.00")).json() for _ in range(4)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        numbers = list(pool.map(lambda d: org.post(f"/invoices/{d['id']}/issue", expect=200).json()["invoice_number"], drafts))
    assert sorted(numbers) == ["INV-1001", "INV-1002", "INV-1003", "INV-1004"]


def test_payments_pay_invoices_down_and_off(org):
    s = seed(org)
    invoice, load = issued(org, s)                                             # 2500.00
    part = pay(org, s, "1000.00", (invoice["id"], "1000.00"), reference="CHK-501").json()
    assert part["applied"] == "1000.00" and part["unapplied"] == "0.00" and part["allocations"][0]["invoice_number"] == invoice["invoice_number"]
    seen = org.get(f"/invoices/{invoice['id']}").json()
    assert (seen["status"], seen["paid"], seen["balance"]) == ("issued", "1000.00", "1500.00")
    assert seen["payments"][0]["reference"] == "CHK-501" and seen["allowed_actions"] == ["record_payment"]   # no voiding now

    assert "allocations.0.amount" in pay(org, s, "2000.00", (invoice["id"], "2000.00"), expect=422).json()["error"]["field_errors"]
    assert pay(org, s, "100.00", (invoice["id"], "150.00"), expect=422).json()["error"]["field_errors"].keys() == {"allocations"}
    assert "received_on" in pay(org, s, "10.00", received_on=str(TODAY + timedelta(days=3)), expect=422).json()["error"]["field_errors"]

    pay(org, s, "1500.00", (invoice["id"], "1500.00"))
    paid = org.get(f"/invoices/{invoice['id']}").json()
    assert (paid["status"], paid["balance"], paid["allowed_actions"]) == ("paid", "0.00", [])
    assert org.get(f"/loads/{load['id']}").json()["billing_status"] == "paid"
    assert pay(org, s, "5.00", (invoice["id"], "5.00"), expect=409).json()["error"]["code"] == "INVOICE_NOT_OPEN"


def test_money_received_ahead_is_kept_and_applied_later(org):
    s = seed(org)
    first, _ = issued(org, s, customer_rate="400.00")
    second, _ = issued(org, s, customer_rate="700.00")
    payment = pay(org, s, "1000.00", (first["id"], "400.00")).json()
    assert payment["applied"] == "400.00" and payment["unapplied"] == "600.00"
    assert org.items("/payments")[0]["unapplied"] == "600.00"
    applied = org.post(f"/payments/{payment['id']}/allocations", {"allocations": [{"invoice_id": second["id"], "amount": "600.00"}]}, 200).json()
    assert applied["unapplied"] == "0.00" and len(applied["allocations"]) == 2
    org.error("POST", f"/payments/{payment['id']}/allocations", 422, "VALIDATION_ERROR",
              json={"allocations": [{"invoice_id": second["id"], "amount": "1.00"}]})
    assert org.get(f"/invoices/{second['id']}").json()["balance"] == "100.00"

    stranger = org.post("/customers", {"name": "Initech"}, 201).json()
    body = org.post("/payments", {"customer_id": stranger["id"], "amount": "50.00", "received_on": str(TODAY),
                                  "allocations": [{"invoice_id": second["id"], "amount": "50.00"}]}, 422).json()["error"]
    assert "allocations.0.invoice_id" in body["field_errors"]            # one customer's money can't pay another's invoice


def test_reversing_a_payment_reopens_what_it_paid(org):
    s = seed(org)
    invoice, load = issued(org, s)
    payment = pay(org, s, "2500.00", (invoice["id"], "2500.00")).json()
    assert org.get(f"/invoices/{invoice['id']}").json()["status"] == "paid"
    org.error("POST", f"/invoices/{invoice['id']}/void", 409, "INVOICE_HAS_PAYMENTS", json={"reason": "wrong"})

    reversed_ = org.post(f"/payments/{payment['id']}/reverse", {"reason": "Check bounced"}, 200).json()
    assert reversed_["status"] == "reversed" and reversed_["applied"] == "0.00" and reversed_["reversal_reason"] == "Check bounced"
    assert reversed_["allocations"][0]["amount"] == "2500.00"          # the record of what it was applied to stays
    reopened = org.get(f"/invoices/{invoice['id']}").json()
    assert (reopened["status"], reopened["paid"], reopened["balance"]) == ("issued", "0.00", "2500.00")
    assert reopened["payments"][0]["status"] == "reversed"
    assert org.get(f"/loads/{load['id']}").json()["billing_status"] == "invoiced"
    assert org.post(f"/payments/{payment['id']}/reverse", {"reason": "again"}, 200).json()["reversal_reason"] == "Check bounced"
    org.error("POST", f"/payments/{payment['id']}/allocations", 409, "PAYMENT_REVERSED",
              json={"allocations": [{"invoice_id": invoice["id"], "amount": "1.00"}]})


def test_voiding_frees_the_loads_to_be_invoiced_again(org):
    s = seed(org)
    invoice, load = issued(org, s)
    org.error("POST", f"/invoices/{invoice['id']}/void", 422, "VALIDATION_ERROR", json={"reason": ""})
    voided = org.post(f"/invoices/{invoice['id']}/void", {"reason": "Wrong rate"}, 200).json()
    assert voided["status"] == "void" and voided["void_reason"] == "Wrong rate" and voided["balance"] == "0.00"
    assert voided["invoice_number"] == invoice["invoice_number"] and voided["allowed_actions"] == []
    assert [x["load_number"] for x in voided["lines"]] == [load["load_number"]]      # the history of what it covered stays
    freed = org.get(f"/loads/{load['id']}").json()
    assert freed["billing_status"] == "unbilled" and freed["invoice"] is None and freed["editable"]["rates"] is True
    org.patch(f"/loads/{load['id']}", {"version": freed["version"], "customer_rate": "2600.00"}, 200)
    replacement = org.post(f"/invoices/{draft(org, s, load).json()['id']}/issue", expect=200).json()
    assert replacement["invoice_number"] == "INV-1002" and replacement["total"] == "2600.00"
    # Void is final.
    assert org.post(f"/invoices/{invoice['id']}/void", {"reason": "again"}, 200).json()["void_reason"] == "Wrong rate"
    assert pay(org, s, "5.00", (invoice["id"], "5.00"), expect=409).json()["error"]["code"] == "INVOICE_NOT_OPEN"
    unissued = draft(org, s).json()
    org.error("POST", f"/invoices/{unissued['id']}/void", 409, "INVOICE_NOT_ISSUED", json={"reason": "x"})


def test_a_retried_payment_is_recorded_once(org):
    s = seed(org)
    invoice, _ = issued(org, s)
    key = {"Idempotency-Key": uuid.uuid4().hex}
    first = pay(org, s, "500.00", (invoice["id"], "500.00"), headers=key)
    again = pay(org, s, "500.00", (invoice["id"], "500.00"), headers=key)
    assert again.json()["id"] == first.json()["id"] and again.headers["Idempotent-Replay"] == "true"
    assert len(org.items("/payments")) == 1 and org.get(f"/invoices/{invoice['id']}").json()["paid"] == "500.00"
    assert pay(org, s, "600.00", (invoice["id"], "600.00"), expect=409, headers=key).json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_two_payments_at_once_cannot_overpay_an_invoice(org):
    s = seed(org)
    invoice, _ = issued(org, s, customer_rate="1000.00")
    with ThreadPoolExecutor(max_workers=3) as pool:
        codes = sorted(pool.map(lambda _: pay(org, s, "600.00", (invoice["id"], "600.00"), expect=None).status_code, range(3)))
    assert codes == [201, 422, 422]
    assert org.get(f"/invoices/{invoice['id']}").json()["balance"] == "400.00"


def test_overdue_is_worked_out_from_the_due_date(org, owner_sql):
    s = seed(org)
    late, _ = issued(org, s, customer_rate="300.00")
    current, _ = issued(org, s, customer_rate="200.00")
    with owner_sql.begin() as c:        # age one invoice: the API never backdates, so arrange it underneath
        c.execute(text("SELECT set_config('app.org_id', :o, true)"), {"o": org.org_id})
        c.execute(text("ALTER TABLE invoices DISABLE TRIGGER invoices_guard"))
        c.execute(text("UPDATE invoices SET issue_date = issue_date - 60, due_date = due_date - 60 WHERE id = :i"), {"i": late["id"]})
        c.execute(text("ALTER TABLE invoices ENABLE TRIGGER invoices_guard"))
    rows = {x["id"]: x for x in org.items("/invoices")}
    assert rows[late["id"]]["is_overdue"] is True and rows[late["id"]]["days_overdue"] == 45
    assert rows[current["id"]]["is_overdue"] is False
    assert [x["id"] for x in org.items("/invoices", overdue="true")] == [late["id"]]
    assert [x["id"] for x in org.items("/invoices", sort="due_date")] == [late["id"], current["id"]]
    assert [x["id"] for x in org.items("/invoices", q=late["invoice_number"])] == [late["id"]]

    money = org.get("/finance/receivables").json()
    assert (money["open_balance"], money["overdue_balance"], money["open_invoices"], money["overdue_invoices"]) == ("500.00", "300.00", 2, 1)
    aging = org.get("/reports/ar-aging").json()
    row = aging["rows"][0]
    assert (row["label"], row["current"], row["days_31_60"], row["total"]) == ("Globex", "200.00", "300.00", "500.00")
    assert aging["totals"]["total"] == "500.00"
    assert org.get(f"/customers/{s['customer']['id']}").json()["stats"]["open_balance"] == "500.00"


def test_finance_is_closed_to_roles_without_it(org):
    s = seed(org)
    invoice, load = issued(org, s)
    dispatcher = org.add_user("dispatcher")
    assert dispatcher.get(f"/invoices/{invoice['id']}").json()["payments"] == []      # may see invoices, not payments
    dispatcher.error("POST", "/invoices", 403, "FORBIDDEN", json={"customer_id": s["customer"]["id"]})
    dispatcher.error("POST", f"/invoices/{invoice['id']}/void", 403, "FORBIDDEN", json={"reason": "x"})
    dispatcher.error("POST", "/payments", 403, "FORBIDDEN", json={})
    safety = org.add_user("safety_manager")
    safety.error("GET", f"/invoices/{invoice['id']}", 403, "FORBIDDEN")
    assert safety.get(f"/loads/{load['id']}").json()["invoice"] is None
    assert safety.get(f"/customers/{s['customer']['id']}", expect=403).json()["error"]["code"] == "FORBIDDEN"
