import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const good = { insurance_expiry: day(300), registration_expiry: day(300), inspection_expiry: day(300) };

async function chooseUnit(page: Page, kind: "Truck" | "Trailer", name: string) {
  await page.getByRole("radio", { name: kind }).click();
  await page.getByRole("combobox", { name: /Truck or trailer/ }).click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function addCost(page: Page, cost: { kind?: string; description: string; quantity?: string; unitCost: string }) {
  await page.getByRole("button", { name: "Add cost" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a cost" });
  if (cost.kind) await sheet.getByLabel("Kind").selectOption({ label: cost.kind });
  await sheet.getByLabel("Description").fill(cost.description);
  if (cost.quantity) await sheet.getByLabel("Quantity").fill(cost.quantity);
  await sheet.getByLabel(/Unit cost/).fill(cost.unitCost);
  await sheet.getByRole("button", { name: "Add cost" }).click();
  await expect(sheet).toBeHidden();
}

test("a breakdown: the truck comes off the road, the repair is costed and finished, and the truck goes back to work", async ({ page }) => {
  await signUp(page);
  await viaApp(page, "POST", "/vehicles", { unit_number: "101", ...good });

  await page.getByRole("link", { name: "Maintenance" }).click();
  await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
  await page.getByRole("button", { name: "New work order" }).click();
  const sheet = page.getByRole("dialog", { name: "New work order" });
  // Nothing chosen yet: the form says what is missing instead of sending it.
  await sheet.getByRole("button", { name: "Open work order" }).click();
  await expect(sheet.getByText("Choose the truck or trailer")).toBeVisible();
  await expect(sheet.getByText("Enter what needs doing")).toBeVisible();
  await chooseUnit(page, "Truck", "Truck 101");
  await sheet.getByLabel("What needs doing").fill("Brake service");
  await sheet.getByLabel("Priority").selectOption({ label: "Urgent" });
  await sheet.getByLabel("Keep it off the road until this is done").check();
  await sheet.getByRole("button", { name: "Open work order" }).click();

  await expect(page).toHaveURL(/\/maintenance\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toContainText("Keeps the unit off the road");
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toContainText("Urgent");

  await addCost(page, { description: "Brake pads", quantity: "2", unitCost: "45.50" });
  await addCost(page, { kind: "Labour", description: "Labour", quantity: "1.5", unitCost: "120" });
  const costs = page.getByRole("table", { name: "Costs" });
  await expect(costs.getByRole("row").filter({ hasText: "Brake pads" })).toContainText("$91.00");
  await expect(costs.getByRole("row").filter({ hasText: "Total" })).toContainText("$271.00");

  await page.getByRole("button", { name: "Start work" }).click();
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toContainText("In progress");

  // The truck is in the shop, and can't be signed back on while the work is open.
  await page.getByRole("link", { name: "Truck 101" }).first().click();
  await expect(page.getByRole("heading", { name: /Truck 101/ })).toContainText("In the shop");
  await page.getByRole("button", { name: "Return to service" }).click();
  const confirm = page.getByRole("dialog", { name: /Return Truck 101 to service/ });
  await confirm.getByRole("button", { name: "Return to service" }).click();
  await expect(confirm.getByText("Work order WO-1001 must be completed first")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: "Maintenance" }).click();
  await page.getByRole("link", { name: "WO-1001" }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  const complete = page.getByRole("dialog", { name: /Complete WO-1001/ });
  await complete.getByLabel("What was done (optional)").fill("Pads and rotors replaced");
  await complete.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toContainText("Completed");
  await expect(page.getByText("Pads and rotors replaced")).toBeVisible();
  // A finished work order is a record: its costs are fixed.
  await expect(page.getByRole("button", { name: "Add cost" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit" })).toBeHidden();

  await page.getByRole("button", { name: "Return to service" }).click();
  await page.getByRole("dialog", { name: /Return Truck 101 to service/ }).getByRole("button", { name: "Return to service" }).click();
  await expect(page.getByText("Truck 101 is back in service")).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to service" })).toBeHidden();
  await page.getByRole("link", { name: "Truck 101" }).first().click();
  await expect(page.getByRole("heading", { name: /Truck 101/ })).toContainText("Active");
});

test("a roadside inspection puts a trailer out of service until its defect is repaired", async ({ page }) => {
  await signUp(page);
  await viaApp(page, "POST", "/trailers", { unit_number: "5301", type: "dry_van", ...good });

  await page.getByRole("link", { name: "Maintenance" }).click();
  await page.getByRole("navigation", { name: "Maintenance" }).getByRole("link", { name: "Inspections" }).click();
  await expect(page.getByText("No inspections recorded")).toBeVisible();
  await page.getByRole("button", { name: "Record inspection" }).click();
  const sheet = page.getByRole("dialog", { name: "Record an inspection" });
  await chooseUnit(page, "Trailer", "Trailer 5301");
  await sheet.getByLabel("Inspection type").selectOption({ label: "Roadside" });
  await sheet.getByLabel("Result").selectOption({ label: "Defects found" });
  await sheet.getByLabel("Where").fill("I-80 MM 112");
  // Defects found, but none listed.
  await sheet.getByRole("button", { name: "Record inspection" }).click();
  await expect(sheet.getByText("List what the inspection found")).toBeVisible();
  await sheet.getByRole("button", { name: "Add defect" }).click();
  await sheet.getByRole("textbox", { name: /^Defect 1/ }).fill("Brake chamber");
  await sheet.getByLabel("Severity").selectOption({ label: "Out of service" });
  await sheet.getByRole("button", { name: "Record inspection" }).click();
  await expect(sheet.getByText("An out-of-service defect puts the unit out of service: choose that result")).toBeVisible();
  await sheet.getByLabel("Result").selectOption({ label: "Out of service" });
  await sheet.getByRole("button", { name: "Record inspection" }).click();

  await expect(page).toHaveURL(/\/maintenance\/inspections\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Roadside inspection/ })).toContainText("Out of service");
  await expect(page.getByText("Trailer 5301 is out of service.")).toBeVisible();

  // Not back on the road while the defect is unrepaired.
  await page.getByRole("button", { name: "Return to service" }).click();
  const confirm = page.getByRole("dialog", { name: /Return Trailer 5301 to service/ });
  await confirm.getByRole("button", { name: "Return to service" }).click();
  await expect(confirm.getByText("Out-of-service defects not yet repaired: Brake chamber")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Open a work order for Brake chamber" }).click();
  await expect(page).toHaveURL(/\/maintenance\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toContainText("Urgent");
  await expect(page.getByText("Found by inspection")).toBeVisible();
  await page.getByRole("link", { name: /Roadside inspection/ }).click();
  await expect(page.getByRole("table", { name: "Defects" }).getByRole("row").filter({ hasText: "Brake chamber" })).toContainText("WO-1001");
  await page.getByRole("link", { name: "WO-1001" }).click();

  await addCost(page, { description: "Brake chamber", unitCost: "189.00" });
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("dialog", { name: /Complete WO-1001/ }).getByRole("button", { name: "Complete" }).click();
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toContainText("Completed");
  await page.getByRole("button", { name: "Return to service" }).click();
  await page.getByRole("dialog", { name: /Return Trailer 5301 to service/ }).getByRole("button", { name: "Return to service" }).click();
  await expect(page.getByText("Trailer 5301 is back in service")).toBeVisible();

  await page.getByRole("link", { name: "Trailer 5301" }).first().click();
  await expect(page.getByRole("heading", { name: /Trailer 5301/ })).toContainText("Active");
  await page.getByRole("tab", { name: "Maintenance" }).click();
  await expect(page.getByRole("table", { name: "Inspections" }).getByRole("row").filter({ hasText: "Roadside" })).toContainText("Out of service");
  await expect(page.getByRole("table", { name: "Work orders" }).getByRole("row").filter({ hasText: "WO-1001" })).toContainText("$189.00");
});

test("the dashboard sends the shop to urgent and late work, and only the shop can change it", async ({ page, browser }) => {
  await signUp(page);
  const truck = await viaApp<{ id: string }>(page, "POST", "/vehicles", { unit_number: "202", ...good });
  await viaApp(page, "POST", "/maintenance/work-orders", { vehicle_id: truck.data.id, title: "Coolant leak", priority: "urgent", out_of_service: true });
  await viaApp(page, "POST", "/maintenance/work-orders", { vehicle_id: truck.data.id, title: "Annual service", scheduled_for: day(-2) });
  await viaApp(page, "POST", "/maintenance/work-orders", { vehicle_id: truck.data.id, title: "Wipers", priority: "low" });

  await page.reload();
  await page.getByRole("link", { name: /Work orders past their date/ }).click();
  await expect(page).toHaveURL(/\/maintenance\?overdue=true$/);
  const list = page.getByRole("table", { name: "Work orders" });
  await expect(list.getByRole("row")).toHaveCount(2);
  await expect(list.getByRole("row").nth(1)).toContainText("Annual service");
  await expect(list.getByRole("row").nth(1)).toContainText("(late)");

  const tiles = page.getByRole("group", { name: "Maintenance summary" });
  await tiles.getByRole("button", { name: /Urgent/ }).click();
  await expect(list.getByRole("row")).toHaveCount(2);
  await expect(list.getByRole("row").nth(1)).toContainText("Coolant leak");
  await expect(tiles.getByText("Units off the road")).toBeVisible();
  await tiles.getByRole("button", { name: /Open work orders/ }).click();
  await expect(list.getByRole("row")).toHaveCount(4);

  // Search finds a work order from anywhere.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Load number, reference/).fill("coolant");
  await page.getByRole("option", { name: /Work order WO-1001/ }).click();
  await expect(page.getByRole("heading", { name: /WO-1001/ })).toBeVisible();

  // A dispatcher sees the shop's work but can't change it.
  const dispatcher = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", dispatcher);
  const other = await otherPerson(browser);
  await signIn(other, dispatcher.email);
  await other.waitForURL(/\/dashboard$/);
  await other.getByRole("link", { name: "Maintenance" }).click();
  await expect(other.getByRole("table", { name: "Work orders" }).getByRole("row")).toHaveCount(4);
  await expect(other.getByRole("button", { name: "New work order" })).toBeHidden();
  await expect(other.getByRole("button", { name: "Record inspection" })).toBeHidden();
  await other.getByRole("link", { name: "WO-1001" }).click();
  await expect(other.getByRole("heading", { name: /WO-1001/ })).toBeVisible();
  await expect(other.getByRole("button", { name: "Start work" })).toBeHidden();
  await expect(other.getByRole("button", { name: "Add cost" })).toBeHidden();
  const refused = await viaApp(other, "POST", "/maintenance/work-orders", { vehicle_id: truck.data.id, title: "Sneaky" });
  expect(refused.status).toBe(403);
});
