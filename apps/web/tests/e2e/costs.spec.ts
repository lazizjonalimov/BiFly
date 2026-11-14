import { expect, test } from "@playwright/test";
import { PASSWORD, completedLoad, fleet, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

const today = () => new Date().toISOString().slice(0, 10);

test("fuel and a lumper are recorded, and fuel is reported by state and by truck", async ({ page, browser }) => {
  await signUp(page);
  const s = await fleet(page);
  await completedLoad(page, s);                                              // the truck delivers 920 miles
  const truck = (await viaApp<{ unit_number: string }>(page, "GET", `/vehicles/${s.truck}`)).data;

  await page.getByRole("link", { name: "Expenses" }).click();
  await expect(page.getByText("No expenses recorded")).toBeVisible();
  await page.getByRole("button", { name: "Record expense" }).click();
  const sheet = page.getByRole("dialog", { name: "Record an expense" });
  await sheet.getByLabel(/^Amount/).fill("389.90");
  // Fuel needs its gallons and the state, for the fuel-tax return.
  await sheet.getByRole("button", { name: "Record expense" }).click();
  await expect(sheet.getByText("Enter the gallons bought")).toBeVisible();
  await expect(sheet.getByText("Enter the state it was bought in")).toBeVisible();
  await sheet.getByLabel(/^Gallons/).fill("100");
  await sheet.getByLabel(/^State bought in/).fill("il");
  await sheet.getByLabel("Fuel stop").fill("Pilot #412");
  await sheet.getByRole("radio", { name: "Truck" }).click();
  await sheet.getByRole("combobox", { name: /Truck or trailer/ }).click();
  await page.getByRole("option", { name: new RegExp(`Truck ${truck.unit_number}`) }).click();
  await sheet.getByRole("button", { name: "Record expense" }).click();
  await expect(sheet).toBeHidden();
  const table = page.getByRole("table", { name: "Expenses" });
  await expect(table.getByRole("row").filter({ hasText: "Pilot #412" })).toContainText("100 gal · IL");
  await expect(table.getByRole("row").filter({ hasText: "Pilot #412" })).toContainText("$389.90");

  // A lumper the driver paid, to be paid back on their settlement.
  await page.getByRole("button", { name: "Record expense" }).click();
  await sheet.getByLabel("Category").selectOption({ label: "Lumper" });
  await sheet.getByLabel(/^Amount/).fill("85");
  await sheet.getByLabel("Vendor").fill("Capstone Lumpers");
  await sheet.getByRole("combobox", { name: "Driver", exact: true }).click();
  await page.getByRole("option", { name: /Dana Reyes/ }).click();
  await sheet.getByLabel("Driver pay").selectOption({ label: "Pay it back to the driver" });
  await sheet.getByRole("button", { name: "Record expense" }).click();
  await expect(sheet).toBeHidden();
  const lumper = table.getByRole("row").filter({ hasText: "Capstone Lumpers" });
  await expect(lumper).toContainText("Reimburse");
  await expect(lumper).toContainText("Next settlement");
  await expect(page.getByRole("group", { name: "Spending this month" })).toContainText("$474.90");

  await lumper.click();
  const details = page.getByRole("dialog", { name: /Lumper, \$85.00/ });
  await expect(details.getByText("Dana Reyes")).toBeVisible();
  await details.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: "Edit lumper expense" }).getByLabel(/^Amount/).fill("95");
  await page.getByRole("dialog", { name: "Edit lumper expense" }).getByRole("button", { name: "Save changes" }).click();
  await expect(lumper).toContainText("$95.00");

  await page.getByRole("navigation", { name: "Finance" }).getByRole("link", { name: "Fuel" }).click();
  const totals = page.getByRole("group", { name: "Fuel totals" });
  await expect(totals).toContainText("100 gal");
  await expect(totals).toContainText("$3.899 / gal");
  await expect(page.getByRole("table", { name: "Fuel by state" }).getByRole("row").filter({ has: page.getByRole("cell", { name: "IL", exact: true }) })).toContainText("$389.90");
  const byTruck = page.getByRole("table", { name: "Fuel by truck" }).getByRole("row").filter({ hasText: truck.unit_number });
  await expect(byTruck).toContainText("920");
  await expect(byTruck).toContainText("9.2");

  // A dispatcher sees none of it.
  const dispatcher = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", dispatcher);
  const other = await otherPerson(browser);
  await signIn(other, dispatcher.email);
  await other.waitForURL(/\/dashboard$/);
  await expect(other.getByRole("link", { name: "Expenses" })).toBeHidden();
  await expect(other.getByRole("link", { name: "Driver pay" })).toBeHidden();
  expect((await viaApp(other, "GET", "/expenses")).status).toBe(403);
});

test("a driver's week is settled: the draft fills itself, a bonus is added, it is approved and paid", async ({ page }) => {
  await signUp(page);
  const s = await fleet(page);
  await viaApp(page, "PATCH", `/drivers/${s.driver}`, { pay_type: "per_mile", pay_rate: "0.62" });
  const load = await completedLoad(page, s);
  await viaApp(page, "POST", "/expenses", { category: "advance", incurred_on: today(), amount: "200.00", driver_id: s.driver, driver_treatment: "deduct" });

  await page.getByRole("link", { name: "Driver pay" }).click();
  await page.getByRole("button", { name: "New settlement" }).click();
  const dialog = page.getByRole("dialog", { name: "New driver settlement" });
  await dialog.getByRole("combobox", { name: "Driver" }).click();
  await page.getByRole("option", { name: /Dana Reyes/ }).click();
  await dialog.getByRole("button", { name: "Create draft" }).click();

  await expect(page).toHaveURL(/\/finance\/settlements\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Draft settlement/ })).toBeVisible();
  await expect(page.getByText("Pay terms: $0.62 per mile")).toBeVisible();
  const earnings = page.getByRole("table", { name: "Earnings" });
  await expect(earnings.getByRole("row").filter({ hasText: load.load_number })).toContainText("920 mi at 0.62 per mile");
  await expect(earnings.getByRole("row").filter({ hasText: load.load_number })).toContainText("$570.40");
  await expect(page.getByRole("table", { name: "Deductions" })).toContainText("Cash advance");
  await expect(page.getByText("Net pay").locator("..")).toContainText("$370.40");

  await page.getByRole("button", { name: "Add line" }).click();
  const line = page.getByRole("dialog", { name: "Add a line" });
  await line.getByLabel("Description").fill("Safety bonus");
  await line.getByLabel(/^Amount/).fill("50");
  await line.getByRole("button", { name: "Add line" }).click();
  await expect(line).toBeHidden();
  await expect(earnings.getByRole("row").filter({ hasText: "Safety bonus" })).toContainText("(entered by hand)");
  await expect(page.getByText("Net pay").locator("..")).toContainText("$420.40");

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog", { name: /Approve this settlement for Dana Reyes/ }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: /ST-1001/ })).toContainText("Approved");
  await expect(page.getByRole("button", { name: "Add line" })).toBeHidden();

  await page.getByRole("button", { name: "Mark paid" }).click();
  const pay = page.getByRole("dialog", { name: "Mark ST-1001 paid" });
  await pay.getByLabel("Reference").fill("DD-5521");
  await pay.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByRole("heading", { name: /ST-1001/ })).toContainText("Paid");
  await expect(page.getByText(/Paid .* by Direct deposit \(DD-5521\)/)).toBeVisible();

  // The driver's page and the advance both know about it.
  await page.getByRole("link", { name: "Dana Reyes" }).first().click();
  await page.getByRole("tab", { name: "Pay" }).click();
  await expect(page.getByRole("table", { name: "Settlements" }).getByRole("row").filter({ hasText: "ST-1001" })).toContainText("$420.40");
  await page.goto(page.url().replace(/drivers\/.*/, "finance/expenses"));
  await expect(page.getByRole("table", { name: "Expenses" }).getByRole("row").filter({ hasText: "Cash advance" })).toContainText("ST-1001");
});
