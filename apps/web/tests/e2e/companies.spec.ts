import { expect, test } from "@playwright/test";
import { otherPerson, signIn, signUp, viaApp } from "./helpers";

test("add a second company with a copy of the first, and switch between them", async ({ page }) => {
  const account = await signUp(page, "Alpha Freight");
  // Something to copy.
  expect((await viaApp(page, "POST", "/customers", { name: "Globex Manufacturing" })).status).toBe(201);
  expect((await viaApp(page, "POST", "/vehicles", { unit_number: "101" })).status).toBe(201);
  expect((await viaApp(page, "POST", "/drivers", { first_name: "Dana", last_name: "Reyes" })).status).toBe(201);

  await page.getByRole("button", { name: /Switch company/ }).click();
  await page.getByRole("menuitem", { name: "Add a company" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a company" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Add company" }).click();
  await expect(dialog.getByText("Enter the company's name")).toBeVisible();

  await dialog.getByLabel("Company name").fill("Bravo Logistics");
  await dialog.getByLabel("USDOT number").fill("7654321");
  await expect(dialog.getByLabel("Start with a copy of")).toHaveValue(/.+/);          // the current company, by default
  await dialog.getByLabel("Trailers").uncheck();
  await dialog.getByRole("button", { name: "Add company" }).click();

  const done = page.getByRole("dialog", { name: "Bravo Logistics is ready" });
  await expect(done).toContainText("1 customer");
  await expect(done).toContainText("1 driver");
  await expect(done).toContainText("1 truck");
  await expect(done).toContainText("Loads and invoices are never copied");
  await done.getByRole("button", { name: "Open Bravo Logistics" }).click();

  await page.waitForURL(/\/bravo-logistics-[a-z0-9]+\/dashboard$/);
  await expect(page.getByRole("button", { name: /Company: Bravo Logistics/ })).toBeVisible();
  // The copy is real data in the new company, and it is the new company's own.
  const copied = await viaApp<{ items: { name: string }[] }>(page, "GET", "/customers");
  expect(copied.data.items.map((c) => c.name)).toEqual(["Globex Manufacturing"]);

  // Switch back from the top bar.
  await page.getByRole("button", { name: /Switch company/ }).click();
  await expect(page.getByRole("menuitem", { name: /Bravo Logistics/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Alpha Freight/ }).click();
  await page.waitForURL(new RegExp(`/${account.slug}/dashboard$`));
  await expect(page.getByRole("button", { name: /Company: Alpha Freight/ })).toBeVisible();

  await page.goto(`/${account.slug}/settings/companies`);
  await expect(page.getByText("2 of 10 active companies")).toBeVisible();
});

test("a link into another of your companies asks before switching", async ({ page }) => {
  const account = await signUp(page, "Alpha Freight");
  const created = await viaApp<{ slug: string }>(page, "POST", "/account/companies", { name: "Bravo Logistics" });
  expect(created.status).toBe(201);

  await page.goto(`/${created.data.slug}/dashboard`);
  await expect(page.getByRole("heading", { name: "This page belongs to Bravo Logistics" })).toBeVisible();
  // Nothing has switched yet: the session is still in the first company.
  expect((await viaApp<{ organization: { name: string } }>(page, "GET", "/auth/me")).data.organization.name).toBe("Alpha Freight");

  await page.getByRole("button", { name: /Switch to Bravo Logistics/ }).click();
  await expect(page.getByRole("button", { name: /Company: Bravo Logistics/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${created.data.slug}/dashboard$`));

  await page.goto(`/${account.slug}/dashboard`);
  await page.getByRole("link", { name: /Stay in Bravo Logistics/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${created.data.slug}/dashboard$`));
});

test("archive makes a company read-only, restore brings it back", async ({ page }) => {
  await signUp(page, "Alpha Freight");
  await viaApp(page, "POST", "/account/companies", { name: "Bravo Logistics" });
  await page.getByRole("link", { name: "Companies" }).click();

  const alpha = page.getByRole("listitem").filter({ hasText: "Alpha Freight" });
  await expect(alpha.getByText("You are here")).toBeVisible();
  await alpha.getByRole("button", { name: "Archive" }).click();
  const confirm = page.getByRole("dialog", { name: "Archive Alpha Freight?" });
  await expect(confirm).toContainText("nothing in it can be changed until it is restored");
  await confirm.getByRole("button", { name: "Archive company" }).click();

  await expect(page.getByText("Alpha Freight is archived.")).toBeVisible();
  await expect(alpha.getByText("Archived · read-only")).toBeVisible();
  await expect(page.getByText("1 of 10 active companies")).toBeVisible();
  // The API refuses changes whatever the screen shows.
  const attempt = await viaApp<{ error: { code: string } }>(page, "POST", "/customers", { name: "Should not save" });
  expect(attempt.status).toBe(409);
  expect(attempt.data.error.code).toBe("ORGANIZATION_ARCHIVED");

  await alpha.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("dialog", { name: "Restore Alpha Freight?" }).getByRole("button", { name: "Restore company" }).click();
  await expect(page.getByText("Alpha Freight is archived.")).toBeHidden();
  expect((await viaApp(page, "POST", "/customers", { name: "Saves again" })).status).toBe(201);
});

test("the last active company can't be archived, and the limit of ten is explained", async ({ page }) => {
  await signUp(page, "Solo Trucking");
  await page.getByRole("link", { name: "Companies" }).click();
  await page.getByRole("listitem").filter({ hasText: "Solo Trucking" }).getByRole("button", { name: "Archive" }).click();
  const confirm = page.getByRole("dialog", { name: "Archive Solo Trucking?" });
  await confirm.getByRole("button", { name: "Archive company" }).click();
  await expect(confirm.getByText("Keep at least one active company")).toBeVisible();   // explained in place
  await confirm.getByRole("button", { name: "Cancel" }).click();

  for (let n = 2; n <= 10; n++) expect((await viaApp(page, "POST", "/account/companies", { name: `Company ${n}` })).status).toBe(201);
  await page.reload();
  await expect(page.getByText("10 of 10 active companies")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add company" })).toBeDisabled();
  const eleventh = await viaApp<{ error: { code: string; message: string } }>(page, "POST", "/account/companies", { name: "One too many" });
  expect(eleventh.status).toBe(409);
  expect(eleventh.data.error.code).toBe("COMPANY_LIMIT_REACHED");
});

test("companies are managed only by the account owner, and never visible to other accounts", async ({ page, browser }) => {
  const account = await signUp(page, "Alpha Freight");
  const admin = { email: `admin-${Date.now()}@example.com`, full_name: "Adam Admin", password: "correct-horse-battery", role: "admin" };
  expect((await viaApp(page, "POST", "/members", admin)).status).toBe(201);

  const adminPage = await otherPerson(browser);
  await signIn(adminPage, admin.email);
  await adminPage.waitForURL(/\/dashboard$/);
  await expect(adminPage.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "Companies" })).toBeHidden();       // not offered...
  await adminPage.goto(`/${account.slug}/settings/companies`);
  await expect(adminPage.getByText("You don't have access to this")).toBeVisible();   // ...and refused if reached
  await adminPage.getByRole("button", { name: /Switch company/ }).click();
  await expect(adminPage.getByRole("menuitem", { name: "Add a company" })).toBeHidden();
  await adminPage.context().close();

  // A different account can't open this company's workspace at all: it does not exist for them.
  const stranger = await otherPerson(browser);
  await signUp(stranger, "Stranger Inc");
  await stranger.goto(`/${account.slug}/dashboard`);
  await expect(stranger.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  await stranger.context().close();
});
