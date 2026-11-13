import { expect, test } from "@playwright/test";
import { PASSWORD, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("add a driver, and an expired licence shows as blocked", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Drivers" }).click();
  await expect(page.getByText("No drivers yet")).toBeVisible();
  await page.getByRole("button", { name: "New driver" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New driver" });
  await sheet.getByRole("button", { name: "Add driver" }).click();
  await expect(sheet.getByText("Enter the first name")).toBeVisible();

  await sheet.getByLabel("First name").fill("Dana");
  await sheet.getByLabel("Last name").fill("Reyes");
  await sheet.getByLabel("CDL number").fill("D1234567");
  await sheet.getByLabel("State").fill("il");
  await sheet.getByLabel("Class").selectOption("A");
  await sheet.getByLabel("CDL expires").fill(day(-3));
  await sheet.getByLabel("Medical card expires").fill(day(400));
  await sheet.getByLabel("Rate").fill("0.62");
  await sheet.getByRole("button", { name: "Add driver" }).click();

  await expect(page.getByRole("heading", { name: /Dana Reyes/ })).toBeVisible();
  await expect(page.getByText("Dana can't be dispatched")).toBeVisible();
  await expect(page.getByText(/CDL expired on/)).toBeVisible();
  await expect(page.getByText("D1234567")).toBeVisible();                              // the owner sees the full number
  await expect(page.getByText("$0.62 per mile")).toBeVisible();

  // Renew the licence: the block lifts, because the API works it out again from the dates.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Dana Reyes" });
  await expect(edit.getByLabel("CDL number")).toHaveValue("D1234567");
  await edit.getByLabel("CDL expires").fill(day(700));
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Dana can't be dispatched")).toBeHidden();
  await expect(page.getByRole("heading", { name: /Dana Reyes/ }).getByText("Compliant")).toBeVisible();

  // A required item in the qualification file blocks too, once it has expired.
  await page.getByRole("tab", { name: /Qualification file/ }).click();
  await page.getByRole("button", { name: "Add an item" }).click();
  const item = page.getByRole("dialog", { name: "Add to the qualification file" });
  await item.getByLabel("What it is").selectOption("drug_test");
  await item.getByLabel("Issued").fill(day(-10));
  await item.getByLabel("Expires").fill(day(-20));
  await item.getByRole("button", { name: "Add", exact: true }).click();
  await expect(item.getByText("The expiry date can't be before the issue date")).toBeVisible();
  await item.getByLabel("Issued").fill(day(-400));
  await item.getByLabel("Required to drive").check();
  await item.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Dana can't be dispatched")).toBeVisible();
  await expect(page.getByText(/Drug and alcohol test expired on/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Drug and alcohol test" }).getByText("Expired")).toBeVisible();

  await page.getByRole("link", { name: "Drivers" }).first().click();
  const row = page.getByRole("row").filter({ hasText: "Dana Reyes" });
  await expect(row.getByText("Blocked")).toBeVisible();                                // never "Available" while blocked
});

test("licence numbers and pay are hidden from roles that may not see them", async ({ page, browser }) => {
  await signUp(page);
  const driver = await viaApp<{ id: string }>(page, "POST", "/drivers", { first_name: "Dana", last_name: "Reyes", cdl_number: "D1234567", cdl_state: "IL", pay_type: "per_mile", pay_rate: "0.62" });
  const dispatcher = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", dispatcher);

  const other = await otherPerson(browser);
  await signIn(other, dispatcher.email);
  await other.waitForURL(/\/dashboard$/);
  await other.getByRole("link", { name: "Drivers" }).click();
  await expect(other.getByRole("row").filter({ hasText: "Dana Reyes" }).getByText("IL ••••4567")).toBeVisible();
  await expect(other.getByRole("button", { name: "New driver" })).toBeHidden();
  await other.getByRole("link", { name: "Dana Reyes" }).click();
  await expect(other.getByText("••••4567")).toBeVisible();
  await expect(other.getByText("Your role sees the last four characters")).toBeVisible();
  await expect(other.getByText("per mile")).toBeHidden();
  // Not merely hidden on screen: the API doesn't send them.
  const seen = await viaApp<{ cdl_number: string | null; pay_rate: string | null }>(other, "GET", `/drivers/${driver.data.id}`);
  expect(seen.data.cdl_number).toBeNull();
  expect(seen.data.pay_rate).toBeNull();
  expect(JSON.stringify(seen.data)).not.toContain("D1234567");
  await other.context().close();
});

test("add a truck and a trailer; a duplicate unit number is explained on the field", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Trucks" }).click();
  await page.getByRole("button", { name: "New truck" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New truck" });
  await sheet.getByLabel("Unit number").fill("101");
  await sheet.getByLabel("Year").fill("1800");
  await sheet.getByRole("button", { name: "Add truck" }).click();
  await expect(sheet.getByText("Enter a year between 1950 and 2100")).toBeVisible();
  await sheet.getByLabel("Year").fill("2023");
  await sheet.getByLabel("Make").fill("Freightliner");
  await sheet.getByLabel("Model").fill("Cascadia");
  await sheet.getByLabel("Odometer (miles)").fill("184200");
  await sheet.getByLabel("Insurance").fill(day(200));
  await sheet.getByLabel("Registration").fill(day(12));
  await sheet.getByLabel("Annual inspection").fill(day(-2));
  await sheet.getByRole("button", { name: "Add truck" }).click();

  const table = page.getByRole("table", { name: "Trucks" });
  const row = table.getByRole("row").filter({ hasText: "2023 Freightliner Cascadia" });
  await expect(row.getByText("184,200")).toBeVisible();
  await expect(row.getByText("Expired", { exact: true })).toBeVisible();              // the inspection has lapsed
  await expect(row.getByText("Blocked")).toBeVisible();

  await page.getByRole("button", { name: "New truck" }).click();
  await sheet.getByLabel("Unit number").fill("101");
  await sheet.getByRole("button", { name: "Add truck" }).click();
  await expect(sheet.getByText("A record with these values already exists")).toBeVisible();
  await sheet.getByLabel("Unit number").fill("102");
  await sheet.getByRole("button", { name: "Add truck" }).click();
  await expect(table.getByRole("row")).toHaveCount(3);

  // Take one out of service from its row, then filter by status.
  await table.getByRole("button", { name: "102", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit truck 102" });
  await edit.getByLabel("Status").selectOption("out_of_service");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(table.getByRole("row").filter({ hasText: "Out of service" })).toBeVisible();
  await page.getByLabel("Status").selectOption("out_of_service");
  await expect(page).toHaveURL(/status=out_of_service/);
  await expect(table.getByRole("row")).toHaveCount(2);

  await page.getByRole("link", { name: "Trailers" }).click();
  await page.getByRole("button", { name: "New trailer" }).first().click();
  const trailer = page.getByRole("dialog", { name: "New trailer" });
  await trailer.getByLabel("Unit number").fill("5301");
  await trailer.getByLabel("Type").selectOption("reefer");
  await trailer.getByLabel("Length (feet)").fill("53");
  await trailer.getByRole("button", { name: "Add trailer" }).click();
  const trailers = page.getByRole("table", { name: "Trailers" });
  await expect(trailers.getByRole("row").filter({ hasText: "5301" }).getByText("Reefer")).toBeVisible();
  await expect(trailers.getByRole("row").filter({ hasText: "5301" }).getByText("53 ft")).toBeVisible();
  await page.getByLabel("Type").selectOption("dry_van");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});

test("terminals: add one, base a driver there, filter by it", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Terminals" }).click();
  await page.getByRole("button", { name: "New terminal" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New terminal" });
  await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Chicago yard");
  await sheet.getByLabel("Short code").fill("CHI");
  await sheet.getByLabel("City").fill("Chicago");
  await sheet.getByLabel("State").fill("IL");
  await sheet.getByRole("button", { name: "Add terminal" }).click();
  await expect(page.getByRole("table", { name: "Terminals" }).getByRole("row").filter({ hasText: "Chicago yard" }).getByText("Chicago, IL")).toBeVisible();

  await viaApp(page, "POST", "/drivers", { first_name: "No", last_name: "Terminal" });
  await page.getByRole("link", { name: "Drivers" }).click();
  await page.getByRole("button", { name: "New driver" }).click();
  const driver = page.getByRole("dialog", { name: "New driver" });
  await driver.getByLabel("First name").fill("Dana");
  await driver.getByLabel("Last name").fill("Reyes");
  await driver.getByLabel("Home terminal").selectOption({ label: "Chicago yard (CHI)" });
  await driver.getByRole("button", { name: "Add driver" }).click();
  await expect(page.getByRole("heading", { name: /Dana Reyes/ })).toBeVisible();
  await expect(page.getByText("Chicago yard", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Drivers" }).first().click();
  const table = page.getByRole("table", { name: "Drivers" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.getByLabel("Terminal").selectOption({ label: "Chicago yard (CHI)" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("link", { name: "Dana Reyes" })).toBeVisible();
});

test("team: add someone, change their role, and deactivating them ends their access at once", async ({ page, browser }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("table", { name: "Team members" }).getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("row").filter({ hasText: "Olive Owner" }).getByText("You")).toBeVisible();

  const email = `${unique("devon")}@example.com`;
  await page.getByRole("button", { name: "Add team member" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a team member" });
  await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Devon Dispatcher");
  await sheet.getByLabel("Email").fill(email);
  await sheet.getByLabel("Role").selectOption("dispatcher");
  await expect(sheet.getByText("Loads, dispatch, customers and load documents")).toBeVisible();   // what the role means
  await sheet.getByRole("button", { name: "Add to team" }).click();
  await expect(sheet.getByText("Set a temporary password for a new sign-in")).toBeVisible();      // the API's rule, on the field
  await sheet.getByLabel("Temporary password").fill(PASSWORD);
  await sheet.getByRole("button", { name: "Add to team" }).click();
  const row = page.getByRole("row").filter({ hasText: "Devon Dispatcher" });
  await expect(row.getByText("Can sign in")).toBeVisible();

  const devon = await otherPerson(browser);
  await signIn(devon, email);
  await devon.waitForURL(/\/dashboard$/);
  await expect(devon.getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(devon.getByRole("link", { name: "Team" })).toBeHidden();

  // A role change applies to their very next request, without signing out.
  await row.getByLabel("Role of Devon Dispatcher").selectOption("safety_manager");
  await expect(page.getByText("Devon Dispatcher is now Safety manager")).toBeVisible();
  await devon.reload();
  await expect(devon.getByRole("link", { name: "Drivers" })).toBeVisible();
  await expect(devon.getByRole("link", { name: "Customers" })).toBeHidden();
  expect((await viaApp(devon, "GET", "/customers")).status).toBe(403);

  // Deactivate: their open session stops working, and they can't sign back in.
  await row.getByRole("button", { name: "Deactivate" }).click();
  await page.getByRole("dialog", { name: "Deactivate Devon Dispatcher?" }).getByRole("button", { name: "Deactivate" }).click();
  await expect(row.getByText("Deactivated")).toBeVisible();
  await devon.getByRole("link", { name: "Drivers" }).click();
  await expect(devon).toHaveURL(/\/login/);
  await signIn(devon, email);
  await expect(devon.getByText("This account no longer has access to any company")).toBeVisible();
  await devon.context().close();

  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByText("Can sign in")).toBeVisible();
});

test("an admin cannot make or unseat an owner", async ({ page, browser }) => {
  await signUp(page);
  const admin = { email: `${unique("admin")}@example.com`, full_name: "Adam Admin", password: PASSWORD, role: "admin" };
  await viaApp(page, "POST", "/members", admin);
  const adminPage = await otherPerson(browser);
  await signIn(adminPage, admin.email);
  await adminPage.waitForURL(/\/dashboard$/);
  await adminPage.getByRole("link", { name: "Team" }).click();
  await adminPage.getByLabel("Role of Olive Owner").selectOption("viewer");
  await expect(adminPage.getByText("Only an owner can change or deactivate an owner")).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.getByLabel("Role of Olive Owner")).toHaveValue("owner");      // nothing changed
  await adminPage.context().close();
});
