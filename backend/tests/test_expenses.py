"""Expenses and fuel: what the company spent, what it means for drivers, and fuel by state and truck."""
from datetime import UTC, datetime, timedelta

from tests.conftest import deliver, new_load, seed, upload

TODAY = datetime.now(UTC).date()      # test companies run on UTC


def spend(api, expect=201, **body):
    return api.post("/expenses", {"category": "tolls", "incurred_on": str(TODAY), "amount": "12.50", **body}, expect).json()


def test_fuel_needs_its_gallons_and_state_and_the_price_per_gallon_is_worked_out(org):
    s = seed(org)
    errors = spend(org, 422, category="fuel", amount="389.90", vehicle_id=s["truck"]["id"])["error"]["field_errors"]
    assert errors == {"gallons": "Enter the gallons bought"}
    errors = spend(org, 422, category="fuel", amount="389.90", gallons="100")["error"]["field_errors"]
    assert errors == {"jurisdiction": "Enter the state it was bought in"}
    fuel = spend(org, category="fuel", amount="389.90", gallons="100", jurisdiction="il", vehicle_id=s["truck"]["id"],
                 driver_id=s["driver"]["id"], vendor="Pilot #412", paid_with="fuel_card", odometer=184_500)
    assert (fuel["gallons"], fuel["price_per_gallon"], fuel["jurisdiction"], fuel["fuel_type"]) == ("100.000", "3.899", "IL", "diesel")
    assert fuel["vehicle"] == {"id": s["truck"]["id"], "name": f"Truck {s['truck']['unit_number']}"}
    assert fuel["driver"]["name"] == "Dana Driver" and fuel["settlement"] is None and fuel["editable"] is True
    assert fuel["currency"] == "USD" and fuel["amount"] == "389.90" and fuel["created_by_name"] == "Olive Owner"

    # Gallons belong to fuel only, and a change of category away from fuel drops them.
    assert spend(org, 422, gallons="5")["error"]["field_errors"] == {"gallons": "Only fuel has this"}
    changed = org.patch(f"/expenses/{fuel['id']}", {"category": "repairs"}, 200).json()
    assert (changed["gallons"], changed["jurisdiction"], changed["fuel_type"]) == (None, None, None)


def test_what_an_expense_can_point_at_is_checked(org, make_org):
    s = seed(org)
    theirs = seed(make_org("Other Freight"))
    assert spend(org, 422, vehicle_id=theirs["truck"]["id"])["error"]["field_errors"] == {"vehicle_id": "Truck not found"}
    assert spend(org, 422, driver_treatment="reimburse")["error"]["field_errors"] == {"driver_id": "Choose the driver to reimburse or deduct"}
    future = str(TODAY + timedelta(days=1))
    assert spend(org, 422, incurred_on=future)["error"]["field_errors"] == {"incurred_on": "The date can't be in the future"}
    assert spend(org, 422, amount="0")["error"]["code"] == "VALIDATION_ERROR"
    assert spend(org, 422, category="snacks")["error"]["code"] == "VALIDATION_ERROR"
    expense = spend(org, load_id=new_load(org, s["customer"]["id"])["id"], trailer_id=s["trailer"]["id"])
    assert expense["load"]["name"] == "L-1001" and expense["trailer"]["name"].startswith("Trailer ")
    assert org.patch(f"/expenses/{expense['id']}", {"amount": None}, 422).json()["error"]["field_errors"] == \
        {"amount": "This field can't be empty"}
    org.delete(f"/expenses/{expense['id']}", 204)
    org.error("GET", f"/expenses/{expense['id']}", 404, "NOT_FOUND")


def test_lists_summaries_and_receipts(org):
    s = seed(org)
    week_ago = str(TODAY - timedelta(days=7))
    spend(org, category="tolls", amount="12.50", vendor="I-PASS")
    spend(org, category="tolls", amount="7.50", vendor="E-ZPass", incurred_on=week_ago)
    lumper = spend(org, category="lumper", amount="85.00", driver_id=s["driver"]["id"], driver_treatment="reimburse",
                   reference="RCPT-77")
    spend(org, category="advance", amount="200.00", driver_id=s["driver"]["id"], driver_treatment="deduct")

    assert [x["vendor"] for x in org.items("/expenses", category="tolls", sort="amount")] == ["E-ZPass", "I-PASS"]
    assert [x["id"] for x in org.items("/expenses", q="rcpt-77")] == [lumper["id"]]
    assert [x["category"] for x in org.items("/expenses", driver_treatment="deduct")] == ["advance"]
    assert len(org.items("/expenses", incurred_from=str(TODAY))) == 3
    assert len(org.items("/expenses", driver_id=s["driver"]["id"])) == 2

    summary = org.get("/expenses/summary", params={"date_from": week_ago, "date_to": str(TODAY)}).json()
    assert summary["total"] == "305.00" and summary["count"] == 4
    assert [(c["category"], c["amount"], c["count"]) for c in summary["by_category"]] == [
        ("advance", "200.00", 1), ("lumper", "85.00", 1), ("tolls", "20.00", 2)]
    assert (summary["to_reimburse"], summary["to_deduct"]) == ("85.00", "200.00")
    org.error("GET", "/expenses/summary", 422, "VALIDATION_ERROR", params={"date_from": str(TODAY), "date_to": week_ago})

    receipt = upload(org, "expense", lumper["id"], "receipt", filename="lumper.pdf")
    assert receipt["links"][0]["label"] == f"Lumper expense, {TODAY.isoformat()}"


def test_fuel_by_state_and_by_truck_with_miles_per_gallon(org):
    s = seed(org)
    deliver(org, new_load(org, s["customer"]["id"], miles=920), s)            # truck delivered 920 miles today
    for state, gallons, amount in (("IL", "80", "312.00"), ("MO", "70", "266.00"), ("IL", "4.5", "17.55")):
        spend(org, category="fuel", gallons=gallons, amount=amount, jurisdiction=state, vehicle_id=s["truck"]["id"])
    spend(org, category="fuel", gallons="10", amount="40.00", jurisdiction="TX", fuel_type="reefer",
          trailer_id=s["trailer"]["id"], incurred_on=str(TODAY - timedelta(days=40)))   # outside the range

    fuel = org.get("/expenses/fuel-summary", params={"date_from": str(TODAY - timedelta(days=6))}).json()
    assert (fuel["gallons"], fuel["amount"], fuel["purchases"], fuel["price_per_gallon"]) == ("154.500", "595.55", 3, "3.855")
    assert [(j["jurisdiction"], j["gallons"], j["amount"], j["purchases"]) for j in fuel["by_jurisdiction"]] == [
        ("IL", "84.500", "329.55", 2), ("MO", "70.000", "266.00", 1)]
    [truck] = fuel["by_truck"]
    assert (truck["vehicle"]["id"], truck["gallons"], truck["miles"], truck["mpg"]) == (s["truck"]["id"], "154.500", 920, "5.955")


def test_roles_decide_who_sees_and_records_expenses(org):
    s = seed(org)
    spend(org)
    dispatcher = org.add_user("dispatcher")
    dispatcher.error("GET", "/expenses", 403, "FORBIDDEN")
    viewer = org.add_user("viewer")
    assert len(viewer.items("/expenses")) == 1
    viewer.error("POST", "/expenses", 403, "FORBIDDEN", json={"category": "tolls", "incurred_on": str(TODAY), "amount": "1.00"})
    assert viewer.items("/expenses")[0]["editable"] is False
    fleet = org.add_user("fleet_manager")
    spend(fleet, category="fuel", gallons="50", amount="190.00", jurisdiction="IN", vehicle_id=s["truck"]["id"])
    accountant = org.add_user("accountant")
    spend(accountant, category="permits", amount="45.00")
    assert len(org.items("/expenses")) == 3
