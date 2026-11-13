import { expect, test } from "@playwright/test";
import { PASSWORD, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const good = { insurance_expiry: day(300), registration_expiry: day(300), inspection_expiry: day(300) };

test("the safety page shows what blocks dispatch, and what is about to", async ({ page }) => {
  await signUp(page);
  const blocked = await viaApp<{ id: string }>(page, "POST", "/drivers", { first_name: "Ed", last_name: "Expired", cdl_expiry: day(-5), medical_cert_expiry: day(300) });
  await viaApp(page, "POST", "/drivers", { first_name: "Sue", last_name: "Soon", cdl_expiry: day(300), medical_cert_expiry: day(10) });
  await viaApp(page, "POST", "/drivers", { first_name: "Al", last_name: "Fine", cdl_expiry: day(300), medical_cert_expiry: day(300) });
  await viaApp(page, "POST", "/vehicles", { unit_number: "101", ...good, insurance_expiry: day(-1) });
  await viaApp(page, "POST", "/trailers", { unit_number: "5301", ...good });

  await page.getByRole("link", { name: "Safety" }).click();
  const tiles = page.getByRole("group", { name: "Compliance summary" });
  await expect(tiles.getByRole("button", { name: /Can't be dispatched: drivers/ })).toContainText("1");
  await expect(tiles.getByRole("button", { name: /Can't be dispatched: equipment/ })).toContainText("1");
  await expect(tiles.getByRole("button", { name: /Expiring in 30 days/ })).toContainText("1");

  const queue = page.getByRole("table", { name: "Expirations" });
  await expect(queue.getByRole("row")).toHaveCount(4);                                   // header + 3 items, soonest first
  await expect(queue.getByRole("row").nth(1)).toContainText("Ed Expired");
  await expect(queue.getByRole("row").nth(1)).toContainText("Yes, now");
  await expect(queue.getByRole("row").filter({ hasText: "Sue Soon" })).toContainText("Expiring soon");
  await expect(queue.getByRole("row").filter({ hasText: "Al Fine" })).toHaveCount(0);

  await tiles.getByRole("button", { name: /Can't be dispatched: equipment/ }).click();
  await expect(page).toHaveURL(/entity_type=equipment/);
  await expect(queue.getByRole("row")).toHaveCount(2);
  await expect(queue.getByRole("row").nth(1)).toContainText("Truck 101");

  await tiles.getByRole("button", { name: /Can't be dispatched: drivers/ }).click();
  await queue.getByRole("link", { name: "Ed Expired" }).click();
  await expect(page).toHaveURL(new RegExp(`/drivers/${blocked.data.id}$`));
  await expect(page.getByText("Ed can't be dispatched")).toBeVisible();
});

test("a medical card is uploaded, sent back with a reason, then approved", async ({ page }) => {
  await signUp(page);
  const driver = await viaApp<{ id: string }>(page, "POST", "/drivers", { first_name: "Dana", last_name: "Reyes", cdl_expiry: day(300), medical_cert_expiry: day(300) });
  await page.goto(page.url().replace(/dashboard$/, `drivers/${driver.data.id}`));
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload" }).first().click();
  const upload = page.getByRole("dialog", { name: "Upload a document" });
  await upload.getByLabel("What it is").selectOption("medical");
  await upload.getByLabel("File").setInputFiles({ name: "med-card.pdf", mimeType: "application/pdf", buffer: PDF });
  await upload.getByLabel("Expires").fill(day(300));
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "med-card.pdf", exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for review")).toBeVisible();

  // A file that isn't what it claims to be is refused, and nothing is kept.
  await page.getByRole("button", { name: "Upload" }).first().click();
  await upload.getByLabel("File").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(upload.getByText("The file's contents don't match its type")).toBeVisible();
  await upload.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("link", { name: "Safety" }).click();
  const queue = page.getByText("Documents waiting for review").locator("..").locator("..");
  await expect(queue.getByText("Medical card")).toBeVisible();
  await queue.getByRole("button", { name: "Review" }).click();
  const review = page.getByRole("dialog", { name: "Review medical card" });
  await review.getByRole("button", { name: "Send back" }).click();
  await expect(review.getByText("Say what is wrong so it can be fixed")).toBeVisible();
  await review.getByLabel(/Note/).fill("Expiry date is not readable");
  await review.getByRole("button", { name: "Send back" }).click();
  await expect(page.getByText("med-card.pdf sent back")).toBeVisible();
  await expect(page.getByText("Nothing to review")).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).click();
  const table = page.getByRole("table", { name: "Documents" });
  await expect(table.getByRole("row").filter({ hasText: "med-card.pdf" }).getByText("Rejected")).toBeVisible();
  await table.getByRole("button", { name: "Review med-card.pdf" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(table.getByRole("row").filter({ hasText: "med-card.pdf" }).getByText("Approved")).toBeVisible();
  await expect(table.getByRole("link", { name: "Dana Reyes" })).toBeVisible();
});

test("licence and medical scans are hidden from roles that may not see them", async ({ page, browser }) => {
  await signUp(page);
  const driver = await viaApp<{ id: string }>(page, "POST", "/drivers", { first_name: "Dana", last_name: "Reyes" });
  await page.goto(page.url().replace(/dashboard$/, `drivers/${driver.data.id}`));
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload" }).first().click();
  const upload = page.getByRole("dialog", { name: "Upload a document" });
  await upload.getByLabel("What it is").selectOption("license");
  await upload.getByLabel("File").setInputFiles({ name: "cdl-scan.pdf", mimeType: "application/pdf", buffer: PDF });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "cdl-scan.pdf", exact: true })).toBeVisible();

  const dispatcher = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", dispatcher);
  const other = await otherPerson(browser);
  await signIn(other, dispatcher.email);
  await other.waitForURL(/\/dashboard$/);
  await other.getByRole("link", { name: "Documents" }).click();
  await expect(other.getByText("No documents yet")).toBeVisible();
  await other.goto(other.url().replace(/documents$/, `drivers/${driver.data.id}`));
  await other.getByRole("tab", { name: "Documents" }).click();
  await expect(other.getByText("No documents yet")).toBeVisible();
  await other.context().close();
});

test("a truck has its own page with paperwork and the loads it hauled", async ({ page }) => {
  await signUp(page);
  const truck = await viaApp<{ id: string }>(page, "POST", "/vehicles", { unit_number: "101", make: "Volvo", year: 2022, ...good });
  await page.getByRole("link", { name: "Trucks" }).click();
  await page.getByRole("link", { name: "101", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/equipment/trucks/${truck.data.id}$`));
  await expect(page.getByRole("heading", { name: /Truck 101/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Truck 101");
  await expect(page.getByText("Available")).toBeVisible();

  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload" }).first().click();
  const upload = page.getByRole("dialog", { name: "Upload a document" });
  await upload.getByLabel("What it is").selectOption("insurance");
  await upload.getByLabel("File").setInputFiles({ name: "policy.pdf", mimeType: "application/pdf", buffer: PDF });
  await upload.getByLabel("Expires").fill(day(20));
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "policy.pdf", exact: true })).toBeVisible();
  await expect(page.getByText(/expires/)).toBeVisible();

  await page.getByRole("tab", { name: "Loads" }).click();
  await expect(page.getByText("This truck hasn't hauled a load yet.")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit truck 101" });
  await sheet.getByLabel("Status").selectOption("in_maintenance");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: /Truck 101/ }).getByText("In the shop")).toBeVisible();
});
