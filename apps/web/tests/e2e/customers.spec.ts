import { expect, test } from "@playwright/test";
import { otherPerson, signIn, signUp, viaApp } from "./helpers";

test("create a customer, then add a contact and an address", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Customers" }).click();
  await expect(page.getByText("No customers yet")).toBeVisible();

  await page.getByRole("button", { name: "New customer" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New customer" });
  await sheet.getByRole("button", { name: "Add customer" }).click();
  await expect(sheet.getByText("Enter the customer's name")).toBeVisible();          // checked before anything is sent

  await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Globex Manufacturing");
  await sheet.getByLabel("Short code").fill("GLOBEX");
  await sheet.getByLabel("Billing email").fill("not-an-email");
  await sheet.getByLabel("State").fill("il");
  await sheet.getByLabel("Payment terms (days)").fill("45");
  await sheet.getByRole("button", { name: "Add customer" }).click();
  await expect(sheet.getByText("Enter a valid email address")).toBeVisible();
  await sheet.getByLabel("Billing email").fill("ap@globex.example");
  await sheet.getByRole("button", { name: "Add customer" }).click();

  // Saved, and taken to the new customer.
  await expect(page.getByRole("heading", { name: /Globex Manufacturing/ })).toBeVisible();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Net 45")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Globex Manufacturing");

  await page.getByRole("tab", { name: /Contacts/ }).click();
  await page.getByRole("button", { name: "Add contact" }).click();
  const contact = page.getByRole("dialog", { name: "New contact" });
  await contact.getByRole("textbox", { name: "Name", exact: true }).fill("Grace Hopper");
  await contact.getByLabel("Email").fill("grace@globex.example");
  await contact.getByLabel("Main contact").check();
  await contact.getByRole("button", { name: "Add contact" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Grace Hopper" });
  await expect(row.getByText("Main contact", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "grace@globex.example" })).toBeVisible();

  await page.getByRole("tab", { name: /Addresses/ }).click();
  await page.getByRole("button", { name: "Add address" }).click();
  const address = page.getByRole("dialog", { name: "New address" });
  await address.getByLabel("Name of the place").fill("Plant 4");
  await address.getByRole("button", { name: "Add address" }).click();
  await expect(address.getByText("Enter the city")).toBeVisible();
  await address.getByLabel("City").fill("Chicago");
  await address.getByLabel("State").fill("IL");
  await address.getByRole("button", { name: "Add address" }).click();
  await expect(page.getByText("Plant 4")).toBeVisible();
  await expect(page.getByText("Chicago, IL")).toBeVisible();

  // What the screen shows is what the API holds.
  const id = page.url().split("/").pop();
  const saved = await viaApp<{ billing_state: string; contacts: unknown[]; addresses: unknown[] }>(page, "GET", `/customers/${id}`);
  expect(saved.data.billing_state).toBe("IL");
  expect(saved.data.contacts).toHaveLength(1);
  expect(saved.data.addresses).toHaveLength(1);
});

test("the server's answer lands on the right field, and a double click saves once", async ({ page }) => {
  await signUp(page);
  await viaApp(page, "POST", "/customers", { name: "First", code: "DUP" });
  await page.getByRole("link", { name: "Customers" }).click();
  await page.getByRole("button", { name: "New customer" }).click();
  const sheet = page.getByRole("dialog", { name: "New customer" });
  await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Second");
  await sheet.getByLabel("Short code").fill("DUP");
  await sheet.getByRole("button", { name: "Add customer" }).click();
  await expect(sheet.getByText("A record with these values already exists")).toBeVisible();
  // What was typed is still there to correct.
  await expect(sheet.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Second");

  await sheet.getByLabel("Short code").fill("SECOND");
  await sheet.getByRole("button", { name: "Add customer" }).dblclick();
  await expect(page.getByRole("heading", { name: /Second/ })).toBeVisible();
  const all = await viaApp<{ items: { name: string }[] }>(page, "GET", "/customers");
  expect(all.data.items.filter((c) => c.name === "Second")).toHaveLength(1);
});

test("closing a form with unsaved changes asks first", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Customers" }).click();
  await page.getByRole("button", { name: "New customer" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New customer" });
  await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Half typed");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet.getByText("Discard your changes?")).toBeVisible();
  await sheet.getByRole("button", { name: "Keep editing" }).click();
  await expect(sheet.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Half typed");
  await page.keyboard.press("Escape");
  await sheet.getByRole("button", { name: "Discard" }).click();
  await expect(sheet).toBeHidden();
  // Nothing was saved, and the form starts clean next time.
  await page.getByRole("button", { name: "New customer" }).first().click();
  await expect(page.getByRole("dialog", { name: "New customer" }).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("");
});

test("the list is searched, filtered, sorted and paged by the server, and its state lives in the address", async ({ page }) => {
  await signUp(page);
  const names = Array.from({ length: 30 }, (_, i) => `Customer ${String(i + 1).padStart(2, "0")}`);
  for (const name of names) expect((await viaApp(page, "POST", "/customers", { name })).status).toBe(201);
  const archived = await viaApp<{ id: string }>(page, "POST", "/customers", { name: "Old Account" });
  await viaApp(page, "POST", `/customers/${archived.data.id}/archive`);

  await page.getByRole("link", { name: "Customers" }).click();
  const table = page.getByRole("table", { name: "Customers" });
  const firstCell = () => table.getByRole("row").nth(1).getByRole("cell").first();
  await expect(firstCell()).toHaveText("Customer 01");
  await expect(table.getByRole("row")).toHaveCount(26);                               // a page of 25, not all 30
  await expect(page.getByText("25 of 30")).toBeVisible();                             // archived ones are not counted
  await expect(table.getByRole("columnheader", { name: "Customer" })).toHaveAttribute("aria-sort", "ascending");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(firstCell()).toHaveText("Customer 26");
  await expect(page).toHaveURL(/cursor=/);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(firstCell()).toHaveText("Customer 01");

  // Sorting is done by the database over every row, not just the page on screen.
  await table.getByRole("columnheader", { name: "Customer" }).getByRole("button").click();
  await expect(page).toHaveURL(/sort=-name/);
  await expect(firstCell()).toHaveText("Customer 30");

  await page.getByRole("searchbox", { name: "Search customers" }).fill("customer 07");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(page).toHaveURL(/q=customer\+07/);
  // A reload, or a shared link, shows exactly the same view.
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search customers" })).toHaveValue("customer 07");
  await expect(firstCell()).toHaveText("Customer 07");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await page.getByLabel("Status").selectOption("archived");
  await expect(page).toHaveURL(/status=archived/);
  await expect(firstCell()).toHaveText("Old Account");
  await page.getByRole("searchbox", { name: "Search customers" }).fill("zzz-nothing");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});

test("column choices are remembered for the user", async ({ page }) => {
  await signUp(page);
  await viaApp(page, "POST", "/customers", { name: "Globex", phone: "312-555-0142" });
  await page.getByRole("link", { name: "Customers" }).click();
  const table = page.getByRole("table", { name: "Customers" });
  await expect(table.getByRole("columnheader", { name: "Phone" })).toBeVisible();
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Phone" }).click();
  await page.keyboard.press("Escape");
  await expect(table.getByRole("columnheader", { name: "Phone" })).toBeHidden();
  await page.reload();
  await expect(table.getByRole("columnheader", { name: "Customer" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Phone" })).toBeHidden();       // stored with the account, not the browser
});

test("archive and restore from the customer's page", async ({ page }) => {
  await signUp(page);
  const created = await viaApp<{ id: string }>(page, "POST", "/customers", { name: "Initech" });
  await page.goto(page.url().replace(/dashboard$/, `customers/${created.data.id}`));
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("dialog", { name: "Archive Initech?" }).getByRole("button", { name: "Archive customer" }).click();
  await expect(page.getByRole("heading", { name: /Initech/ }).getByText("Archived")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("heading", { name: /Initech/ }).getByText("Active")).toBeVisible();
});

test("roles: a viewer can read but is offered no changes, and another company's customer does not exist", async ({ page, browser }) => {
  const account = await signUp(page);
  const created = await viaApp<{ id: string }>(page, "POST", "/customers", { name: "Globex" });
  const viewer = { email: `viewer-${Date.now()}@example.com`, full_name: "Vera Viewer", password: "correct-horse-battery", role: "viewer" };
  const fleet = { email: `fleet-${Date.now()}@example.com`, full_name: "Fran Fleet", password: "correct-horse-battery", role: "fleet_manager" };
  await viaApp(page, "POST", "/members", viewer);
  await viaApp(page, "POST", "/members", fleet);

  const viewerPage = await otherPerson(browser);
  await signIn(viewerPage, viewer.email);
  await viewerPage.waitForURL(/\/dashboard$/);
  await viewerPage.getByRole("link", { name: "Customers" }).click();
  await expect(viewerPage.getByRole("link", { name: "Globex" })).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "New customer" })).toBeHidden();
  await viewerPage.getByRole("link", { name: "Globex" }).click();
  await expect(viewerPage.getByRole("button", { name: "Edit" })).toBeHidden();
  expect((await viaApp(viewerPage, "PATCH", `/customers/${created.data.id}`, { name: "Hacked" })).status).toBe(403);
  await viewerPage.context().close();

  // A role with no access to customers isn't offered the screen, and is refused if they go there anyway.
  const fleetPage = await otherPerson(browser);
  await signIn(fleetPage, fleet.email);
  await fleetPage.waitForURL(/\/dashboard$/);
  await expect(fleetPage.getByRole("link", { name: "Customers" })).toBeHidden();
  await fleetPage.goto(`/${account.slug}/customers`);
  await expect(fleetPage.getByText("You don't have access to this")).toBeVisible();
  await fleetPage.context().close();

  const stranger = await otherPerson(browser);
  const other = await signUp(stranger, "Stranger Inc");
  await stranger.goto(`/${other.slug}/customers/${created.data.id}`);
  await expect(stranger.getByText("That record could not be found").or(stranger.getByText("Customer not found"))).toBeVisible();
  await stranger.context().close();
});
