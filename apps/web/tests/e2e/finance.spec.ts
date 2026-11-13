import { expect, test } from "@playwright/test";
import { PASSWORD, completedLoad, fleet, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

test("completed loads are invoiced, the invoice is issued, and it is paid in two parts", async ({ page }) => {
  await signUp(page);
  const s = await fleet(page);
  const first = await completedLoad(page, s, "2500.00", 0);
  const second = await completedLoad(page, s, "1800.00", 1);

  await page.getByRole("link", { name: "Invoices" }).click();
  const tiles = page.getByRole("group", { name: "Receivables" });
  await expect(tiles.getByRole("link", { name: /Ready to invoice · 2 loads/ })).toContainText("$4,300.00");

  await page.getByRole("button", { name: "New invoice" }).click();
  const dialog = page.getByRole("dialog", { name: "New invoice" });
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: /Globex/ }).click();
  await dialog.getByRole("checkbox", { name: `Invoice ${first.load_number}` }).check();
  await dialog.getByRole("checkbox", { name: `Invoice ${second.load_number}` }).check();
  await expect(dialog.getByText("2 of 2 chosen")).toBeVisible();
  await dialog.getByRole("button", { name: "Create draft" }).click();

  await expect(page).toHaveURL(/\/finance\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Draft invoice/ })).toBeVisible();
  const lines = page.getByRole("table", { name: "Invoice lines" });
  await expect(lines.getByRole("row").filter({ hasText: first.load_number })).toContainText("$2,500.00");
  await expect(lines.getByRole("row").filter({ hasText: "Total" })).toContainText("$4,300.00");

  // A discount, then issue.
  await page.getByRole("button", { name: "Add line" }).click();
  const line = page.getByRole("dialog", { name: "Add a line" });
  await line.getByLabel("Description").fill("Volume discount");
  await line.getByLabel(/Unit price/).fill("-100");
  await line.getByRole("button", { name: "Add line" }).click();
  await expect(lines.getByRole("row").filter({ hasText: "Total" })).toContainText("$4,200.00");
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.getByRole("dialog", { name: /Issue this invoice to Globex/ }).getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("heading", { name: /INV-1001/ })).toContainText("Issued");
  // Issued means fixed.
  await expect(page.getByRole("button", { name: "Add line" })).toBeHidden();
  await expect(page.getByRole("button", { name: `Remove Volume discount` })).toBeHidden();

  // First payment: more applied than received is caught before it is sent.
  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: /Record a payment for INV-1001/ });
  await expect(pay.getByLabel(/Amount/)).toHaveValue("4200.00");
  await pay.getByLabel(/Amount/).fill("2000");
  await pay.getByLabel("Reference").fill("ACH-7781");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(pay.getByText("That applies $4,200.00, more than the $2,000.00 available")).toBeVisible();
  await pay.getByRole("textbox", { name: "Apply to INV-1001" }).fill("2000");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(pay).toBeHidden();
  await expect(lines.getByRole("row").filter({ hasText: "Balance due" })).toContainText("$2,200.00");
  await expect(page.getByRole("heading", { name: /INV-1001/ })).toContainText("Issued");
  // Money has been applied, so voiding is no longer offered.
  await expect(page.getByRole("button", { name: "Void" })).toBeHidden();

  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog", { name: /Record a payment for INV-1001/ }).getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { name: /INV-1001/ })).toContainText("Paid");
  await expect(lines.getByRole("row").filter({ hasText: "Balance due" })).toContainText("$0.00");

  // The loads say where they were billed.
  await lines.getByRole("link", { name: first.load_number }).click();
  await expect(page.getByText(/On invoice\s+INV-1001/)).toBeVisible();
});

test("money received ahead of matching is applied later; a reversal reopens the invoice; a void frees the load", async ({ page }) => {
  await signUp(page);
  const s = await fleet(page);
  const load = await completedLoad(page, s, "2500.00");
  const draft = await viaApp<{ id: string }>(page, "POST", "/invoices", { customer_id: s.customer, load_ids: [load.id] });
  const issued = await viaApp<{ id: string; invoice_number: string }>(page, "POST", `/invoices/${draft.data.id}/issue`);
  expect(issued.status).toBe(200);

  await page.getByRole("link", { name: "Payments" }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  const sheet = page.getByRole("dialog", { name: "Record a payment" });
  await sheet.getByRole("combobox", { name: /Customer/ }).click();
  await page.getByRole("option", { name: /Globex/ }).click();
  await sheet.getByLabel(/Amount/).fill("3000");
  await sheet.getByLabel("Method").selectOption({ label: "Check" });
  await sheet.getByLabel("Reference").fill("CHK 1042");
  await sheet.getByRole("button", { name: "Record payment" }).click();

  await expect(page).toHaveURL(/\/finance\/payments\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Not applied to any invoice.")).toBeVisible();
  await page.getByRole("button", { name: "Apply to invoices" }).click();
  const apply = page.getByRole("dialog", { name: "Apply to invoices" });
  await apply.getByRole("button", { name: "Apply oldest first" }).click();
  await expect(apply.getByRole("textbox", { name: `Apply to ${issued.data.invoice_number}` })).toHaveValue("2500.00");
  await apply.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(apply).toBeHidden();
  await expect(page.getByRole("table", { name: "Applied to" })).toContainText(issued.data.invoice_number);
  await expect(page.getByText("Unapplied").locator("..")).toContainText("$500.00");

  // A bounced check: reversing reopens what it paid.
  await page.getByRole("button", { name: "Reverse" }).click();
  const reverse = page.getByRole("dialog", { name: "Reverse this payment?" });
  await reverse.getByRole("button", { name: "Reverse payment" }).click();
  await expect(reverse.getByText("Give a reason")).toBeVisible();
  await reverse.getByLabel("Why").fill("Check returned unpaid");
  await reverse.getByRole("button", { name: "Reverse payment" }).click();
  await expect(page.getByRole("heading", { name: /Payment of \$3,000.00/ })).toContainText("Reversed");
  await page.getByRole("link", { name: issued.data.invoice_number }).click();
  await expect(page.getByRole("heading", { name: new RegExp(issued.data.invoice_number) })).toContainText("Issued");

  // Void it: the load can be billed again.
  await page.getByRole("button", { name: "Void" }).click();
  const voiding = page.getByRole("dialog", { name: new RegExp(`Void ${issued.data.invoice_number}`) });
  await voiding.getByLabel("Why").fill("Wrong rate; reissuing");
  await voiding.getByRole("button", { name: "Void invoice" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(issued.data.invoice_number) })).toContainText("Void");
  await expect(page.getByText(/Its loads can be invoiced again/)).toBeVisible();
  await page.goto(page.url().replace(/finance\/invoices\/.*/, `loads/${load.id}`));
  await page.getByRole("button", { name: "Invoice this load" }).click();
  await expect(page).toHaveURL(/\/finance\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("table", { name: "Invoice lines" })).toContainText(load.load_number);
});

test("a dispatcher can see invoices but not bill or take money", async ({ page, browser }) => {
  await signUp(page);
  const s = await fleet(page);
  const load = await completedLoad(page, s);
  const draft = await viaApp<{ id: string }>(page, "POST", "/invoices", { customer_id: s.customer, load_ids: [load.id] });
  await viaApp(page, "POST", `/invoices/${draft.data.id}/issue`);

  const dispatcher = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", dispatcher);
  const other = await otherPerson(browser);
  await signIn(other, dispatcher.email);
  await other.waitForURL(/\/dashboard$/);
  await expect(other.getByRole("link", { name: "Payments" })).toBeHidden();
  await other.getByRole("link", { name: "Invoices" }).click();
  await expect(other.getByRole("button", { name: "New invoice" })).toBeHidden();
  await other.getByRole("link", { name: "INV-1001" }).click();
  await expect(other.getByRole("heading", { name: /INV-1001/ })).toBeVisible();
  await expect(other.getByRole("button", { name: "Record payment" })).toBeHidden();
  await expect(other.getByRole("button", { name: "Void" })).toBeHidden();
  const refused = await viaApp(other, "POST", "/payments", { customer_id: s.customer, amount: "10.00", received_on: new Date().toISOString().slice(0, 10) });
  expect(refused.status).toBe(403);
});
