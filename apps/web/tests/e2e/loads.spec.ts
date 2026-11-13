import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hour = 14) => `${day(offsetDays)}T${String(hour).padStart(2, "0")}:00`;
const iso = (offsetDays: number, hour = 14) => new Date(`${day(offsetDays)}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString();

type Ids = { customer: string; driver: string; truck: string; trailer: string };

/** A customer, a qualified driver, a truck and a trailer, made through the API. */
async function setup(page: Page, suffix = ""): Promise<Ids> {
  const dates = { insurance_expiry: day(300), registration_expiry: day(300), inspection_expiry: day(300) };
  const customer = await viaApp<{ id: string }>(page, "POST", "/customers", { name: `Globex${suffix}`, payment_terms_days: 30 });
  const driver = await viaApp<{ id: string }>(page, "POST", "/drivers", { first_name: "Dana", last_name: `Reyes${suffix}`, cdl_expiry: day(400), medical_cert_expiry: day(400) });
  const truck = await viaApp<{ id: string }>(page, "POST", "/vehicles", { unit_number: `T${suffix || "101"}`, ...dates });
  const trailer = await viaApp<{ id: string }>(page, "POST", "/trailers", { unit_number: `TR${suffix || "53"}`, type: "dry_van", ...dates });
  return { customer: customer.data.id, driver: driver.data.id, truck: truck.data.id, trailer: trailer.data.id };
}

type Load = { id: string; load_number: string; version: number; stops: { id: string }[]; assignment: { id: string } | null };

async function bookViaApi(page: Page, customer: string, pickupDay = 2, extra: Record<string, unknown> = {}): Promise<Load> {
  const load = await viaApp<Load>(page, "POST", "/loads", {
    customer_id: customer, customer_rate: "2500.00", miles: 920, commodity: "Paper",
    stops: [
      { type: "pickup", name: "Shipper DC", city: "Chicago", state: "IL", appt_start: iso(pickupDay, 14) },
      { type: "delivery", name: "Receiver", city: "Dallas", state: "TX", appt_start: iso(pickupDay + 2, 14) },
    ],
    ...extra,
  });
  expect(load.status, JSON.stringify(load.data)).toBe(201);
  return load.data;
}

async function act(page: Page, load: Load, action: string, extra: Record<string, unknown> = {}): Promise<Load> {
  const r = await viaApp<Load>(page, "POST", `/loads/${load.id}/transitions`, { action, version: load.version, ...extra });
  expect(r.status, JSON.stringify(r.data)).toBe(200);
  return r.data;
}

test("book a load with two stops in the wizard", async ({ page }) => {
  await signUp(page);
  await setup(page);
  await page.getByRole("link", { name: "Loads" }).click();
  await page.getByRole("link", { name: "New load" }).first().click();
  await expect(page.getByRole("heading", { name: "New load" })).toBeVisible();

  // Each step is checked before moving on.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Choose the customer")).toBeVisible();
  await page.getByRole("combobox", { name: /Customer/ }).click();
  await page.getByPlaceholder("Type to search").fill("glob");
  await page.getByRole("option", { name: /Globex/ }).click();
  await page.getByLabel("Commodity").fill("Paper rolls");
  await page.getByLabel("Weight (lb)").fill("38000");
  await page.getByLabel("Miles", { exact: true }).fill("925");
  await page.getByRole("button", { name: "Next" }).click();

  // Route: the second stop's city is missing, then the stops are in the wrong order.
  const city = page.getByRole("textbox", { name: "City" });
  await city.nth(0).fill("Chicago");
  await page.getByRole("textbox", { name: "State" }).nth(0).fill("il");
  await page.getByLabel("Appointment from").nth(0).fill(at(3, 9));
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Enter the city")).toBeVisible();
  await city.nth(1).fill("Dallas");
  await page.getByRole("textbox", { name: "State" }).nth(1).fill("TX");
  await page.getByLabel("Appointment from").nth(1).fill(at(5, 9));
  await page.getByLabel("Until").nth(1).fill(at(5, 8));
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("The appointment can't end before it starts")).toBeVisible();
  await page.getByLabel("Until").nth(1).fill(at(5, 12));
  await page.getByRole("button", { name: "Move stop 2 up" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("A load needs at least one pickup, and must end with a delivery.")).toBeVisible();
  await page.getByRole("button", { name: "Move stop 2 up" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Rate and an extra charge.
  await page.getByLabel(/Line haul/).fill("2500");
  await page.getByRole("button", { name: "Add a charge" }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Rate", { exact: true }).fill("75");
  await expect(page.getByText("$150.00")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Pickup: Chicago, IL")).toBeVisible();
  await expect(page.getByText("Delivery: Dallas, TX")).toBeVisible();
  await expect(page.getByText("$2,650.00")).toBeVisible();
  await page.getByRole("button", { name: "Book load" }).click();

  await expect(page).toHaveURL(/\/loads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /L-1001/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /L-1001/ }).getByText("Planned")).toBeVisible();
  await expect(page.getByText("Pickup: Chicago, IL")).toBeVisible();
  await page.getByRole("tab", { name: /Freight and charges/ }).click();
  await expect(page.getByRole("table", { name: "Rate and charges" }).getByText("$2,650.00")).toBeVisible();
  await page.getByRole("tab", { name: /Activity/ }).click();
  await expect(page.getByText("Load created")).toBeVisible();
});

test("save a draft without a route, finish it later", async ({ page }) => {
  await signUp(page);
  await setup(page);
  await page.goto(page.url().replace(/dashboard$/, "loads/new"));
  await page.getByRole("combobox", { name: /Customer/ }).click();
  await page.getByRole("option", { name: /Globex/ }).click();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByRole("heading", { name: /L-1001/ }).getByText("Draft")).toBeVisible();
  await expect(page.getByText("No stops yet")).toBeVisible();

  // Marking it ready is refused until it has a route.
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText(/at least one pickup followed by one delivery/)).toBeVisible();
  await page.getByRole("button", { name: "Edit route" }).click();
  const sheet = page.getByRole("dialog", { name: /Route of L-1001/ });
  await sheet.getByRole("button", { name: "Add pickup" }).click();
  await sheet.getByRole("button", { name: "Add delivery" }).click();
  await sheet.getByRole("textbox", { name: "City" }).nth(0).fill("Milwaukee");
  await sheet.getByRole("textbox", { name: "City" }).nth(1).fill("St. Louis");
  await sheet.getByRole("button", { name: "Save route" }).click();
  await expect(page.getByText("Pickup: Milwaukee")).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByRole("heading", { name: /L-1001/ }).getByText("Planned")).toBeVisible();
});

test("assign from the board; overlapping work is shown as blocked and refused", async ({ page }) => {
  await signUp(page);
  const ids = await setup(page);
  const first = await bookViaApi(page, ids.customer, 2);
  const second = await bookViaApi(page, ids.customer, 3);       // overlaps the first

  await page.getByRole("link", { name: "Dispatch" }).click();
  await expect(page.getByRole("button", { name: /Needs a driver/ })).toContainText("2");
  const board = page.getByRole("table", { name: "Dispatch board" });
  await board.getByRole("row").filter({ hasText: first.load_number }).getByRole("button", { name: "Assign" }).click();
  const panel = page.getByRole("dialog", { name: `Assign ${first.load_number}` });
  await expect(panel.getByRole("button", { name: "Assign" })).toBeDisabled();
  await panel.getByRole("radio", { name: /Dana Reyes/ }).check();
  await panel.getByRole("radio", { name: /T101/ }).check();
  await panel.getByRole("radio", { name: /TR53/ }).check();
  await panel.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText(`${first.load_number} assigned to Dana Reyes`)).toBeVisible();
  await expect(board.getByRole("row").filter({ hasText: first.load_number })).toContainText("Dana Reyes");

  // The second load is at the same time: the driver, truck and trailer are shown as blocked, with the reason.
  await board.getByRole("row").filter({ hasText: second.load_number }).getByRole("button", { name: "Assign" }).click();
  const panel2 = page.getByRole("dialog", { name: `Assign ${second.load_number}` });
  const driver = panel2.getByRole("radio", { name: /Dana Reyes/ });
  await expect(driver).toBeDisabled();
  await expect(panel2.getByText(`Driver is on load ${first.load_number} at the same time`)).toBeVisible();
  await expect(panel2.getByText(`Truck is on load ${first.load_number} at the same time`)).toBeVisible();
  await page.keyboard.press("Escape");

  // A race: the panel was opened while the driver was free, and someone else booked them first.
  const third = await bookViaApi(page, ids.customer, 10);
  const fourth = await bookViaApi(page, ids.customer, 10);
  await page.reload();
  await board.getByRole("row").filter({ hasText: third.load_number }).getByRole("button", { name: "Assign" }).click();
  const panel3 = page.getByRole("dialog", { name: `Assign ${third.load_number}` });
  await panel3.getByRole("radio", { name: /Dana Reyes/ }).check();
  await panel3.getByRole("radio", { name: /T101/ }).check();
  await panel3.getByRole("radio", { name: /TR53/ }).check();
  const booked = await viaApp(page, "POST", "/dispatch/assignments", { load_id: fourth.id, driver_id: ids.driver, vehicle_id: ids.truck, trailer_id: ids.trailer, version: fourth.version });
  expect(booked.status).toBe(201);
  await panel3.getByRole("button", { name: "Assign" }).click();
  await expect(panel3.getByText(`Driver is on load ${fourth.load_number} at the same time`).first()).toBeVisible();
  await expect(panel3.getByRole("radio", { name: /Dana Reyes/ })).toBeDisabled();     // refreshed: now blocked
  expect((await viaApp<{ status: string }>(page, "GET", `/loads/${third.id}`)).data.status).toBe("planned");
});

test("run a load from dispatch to completed, with the POD uploaded and approved", async ({ page }) => {
  await signUp(page);
  const ids = await setup(page);
  let load = await bookViaApi(page, ids.customer, -1);
  const assigned = await viaApp<Load>(page, "POST", "/dispatch/assignments", { load_id: load.id, driver_id: ids.driver, vehicle_id: ids.truck, trailer_id: ids.trailer, version: load.version });
  load = assigned.data;
  await page.goto(page.url().replace(/dashboard$/, `loads/${load.id}`));
  const status = page.getByRole("heading", { name: new RegExp(load.load_number) });
  await expect(status.getByText("Assigned")).toBeVisible();

  await page.getByRole("button", { name: "Dispatch" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Dispatch" }).click();
  await expect(status.getByText("Dispatched")).toBeVisible();

  await page.getByRole("button", { name: "Arrived at stop 1" }).click();
  await page.getByRole("dialog").getByLabel("Note").fill("At the dock");
  await page.getByRole("dialog").getByRole("button", { name: "Record arrival" }).click();
  await expect(status.getByText("At pickup")).toBeVisible();
  await expect(page.getByText("Truck is here")).toBeVisible();
  await page.getByRole("button", { name: "Departed stop 1" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record departure" }).click();
  await expect(status.getByText("In transit")).toBeVisible();

  // A time in the future is refused, and explained.
  await page.getByRole("button", { name: "Arrived at stop 2" }).click();
  await page.getByRole("dialog").getByLabel(/When/).fill(at(3, 10));
  await page.getByRole("dialog").getByRole("button", { name: "Record arrival" }).click();
  await expect(page.getByRole("dialog").getByText("That time is in the future")).toBeVisible();
  await page.getByRole("dialog").getByLabel(/When/).fill("");
  await page.getByRole("dialog").getByRole("button", { name: "Record arrival" }).click();
  await expect(status.getByText("At delivery")).toBeVisible();
  await page.getByRole("button", { name: "Departed stop 2" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record departure" }).click();
  await expect(status.getByText("Delivered")).toBeVisible();
  await expect(status.getByText("Needs POD")).toBeVisible();

  // The proof of delivery moves the load into review by itself.
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload" }).first().click();
  const upload = page.getByRole("dialog", { name: "Upload a document" });
  await upload.getByLabel("What it is").selectOption("pod");
  await upload.getByLabel("File").setInputFiles({ name: "signed-pod.pdf", mimeType: "application/pdf", buffer: PDF });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "signed-pod.pdf", exact: true })).toBeVisible();
  await expect(status.getByText("POD review")).toBeVisible();
  const download = await page.request.get(await page.getByRole("link", { name: "Download signed-pod.pdf" }).getAttribute("href") as string);
  expect(Buffer.from(await download.body()).equals(PDF)).toBe(true);

  await page.getByRole("button", { name: "Approve POD" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve POD" }).click();
  await expect(status.getByText("Completed")).toBeVisible();

  // The whole story is in the activity, in order.
  await page.getByRole("tab", { name: /Activity/ }).click();
  const activity = page.getByRole("list", { name: "Activity" });
  for (const line of ["Load created", "Assigned", "Dispatched", "Arrived", "Departed", "Proof of delivery received", "Proof of delivery approved"]) {
    await expect(activity.getByText(line, { exact: true }).first()).toBeVisible();
  }
  await expect(activity.getByText("At the dock")).toBeVisible();
});

test("a rejected POD needs a reason and sends the load back", async ({ page }) => {
  await signUp(page);
  const ids = await setup(page);
  let load = await bookViaApi(page, ids.customer, -1);
  load = (await viaApp<Load>(page, "POST", "/dispatch/assignments", { load_id: load.id, driver_id: ids.driver, vehicle_id: ids.truck, trailer_id: ids.trailer, version: load.version })).data;
  for (const action of ["dispatch", "arrive", "depart", "arrive", "depart"]) load = await act(page, load, action);
  await page.goto(page.url().replace(/dashboard$/, `loads/${load.id}`));
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload" }).first().click();
  const upload = page.getByRole("dialog", { name: "Upload a document" });
  await upload.getByLabel("File").setInputFiles({ name: "blurry.pdf", mimeType: "application/pdf", buffer: PDF });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(load.load_number) }).getByText("POD review")).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Reject POD" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reject POD" }).click();
  await expect(dialog.getByText("Give a reason")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Signature missing");
  await dialog.getByRole("button", { name: "Reject POD" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(load.load_number) }).getByText("Delivered")).toBeVisible();
  await expect(page.getByText("Sent back: Signature missing")).toBeVisible();
});

test("someone else's change is never overwritten", async ({ page, browser }) => {
  const account = await signUp(page);
  const ids = await setup(page);
  const load = await bookViaApi(page, ids.customer, 4, { reference: "PO-1" });
  await page.goto(`/${account.slug}/loads/${load.id}`);
  await expect(page.getByText("Ref PO-1")).toBeVisible();

  // A colleague edits the same load while this page is open.
  const colleague = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", colleague);
  const other = await otherPerson(browser);
  await signIn(other, colleague.email);
  await other.waitForURL(/\/dashboard$/);
  await other.goto(`/${account.slug}/loads/${load.id}`);
  await other.getByRole("button", { name: "Edit", exact: true }).click();
  await other.getByLabel("Customer's reference").fill("PO-2-COLLEAGUE");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.getByText("Ref PO-2-COLLEAGUE")).toBeVisible();

  // This page still shows the old version. Saving from it is refused and explained.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Customer's reference").fill("PO-3-MINE");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Someone else changed this load while you were editing, so your change was not saved/)).toBeVisible();
  // The panel now shows the colleague's version, to check before changing anything again.
  await expect(page.getByLabel("Customer's reference")).toHaveValue("PO-2-COLLEAGUE");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Ref PO-2-COLLEAGUE")).toBeVisible();
  expect((await viaApp<{ reference: string }>(page, "GET", `/loads/${load.id}`)).data.reference).toBe("PO-2-COLLEAGUE");
  await other.context().close();
});

test("charges keep the revenue right, and close once invoiced", async ({ page }) => {
  await signUp(page);
  const ids = await setup(page);
  const load = await bookViaApi(page, ids.customer, 4);
  await page.goto(page.url().replace(/dashboard$/, `loads/${load.id}`));
  await page.getByRole("tab", { name: /Freight and charges/ }).click();
  await page.getByRole("button", { name: "Add charge" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a charge" });
  await sheet.getByLabel("Charge").selectOption("lumper");
  await sheet.getByLabel("Rate (USD)").fill("95.50");
  await expect(sheet.getByText("$95.50")).toBeVisible();
  await sheet.getByRole("button", { name: "Add charge" }).click();
  const table = page.getByRole("table", { name: "Rate and charges" });
  await expect(table.getByRole("row").last()).toContainText("$2,595.50");
  await table.getByRole("button", { name: "Edit Lumper" }).click();
  await page.getByRole("dialog", { name: "Edit Lumper" }).getByLabel("Bill the customer").uncheck();
  await page.getByRole("dialog", { name: "Edit Lumper" }).getByRole("button", { name: "Save changes" }).click();
  await expect(table.getByText("Not billed")).toBeVisible();
  await expect(table.getByRole("row").last()).toContainText("$2,500.00");
});

test("search finds a load from anywhere", async ({ page }) => {
  await signUp(page);
  const ids = await setup(page);
  const load = await bookViaApi(page, ids.customer, 4, { reference: "PO-SEARCH-77" });
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Load number/).fill("search-77");
  await page.getByRole("option", { name: new RegExp(load.load_number) }).click();
  await expect(page).toHaveURL(new RegExp(`/loads/${load.id}$`));
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Load number/).fill("glob");
  await expect(page.getByRole("option", { name: /Globex/ })).toBeVisible();
});

test("roles: a viewer sees loads but is offered no actions; a driver has no board", async ({ page, browser }) => {
  const account = await signUp(page);
  const ids = await setup(page);
  const load = await bookViaApi(page, ids.customer, 4);
  const viewer = { email: `${unique("viewer")}@example.com`, full_name: "Vera Viewer", password: PASSWORD, role: "viewer" };
  const driver = { email: `${unique("driver")}@example.com`, full_name: "Dan Driver", password: PASSWORD, role: "driver" };
  await viaApp(page, "POST", "/members", viewer);
  await viaApp(page, "POST", "/members", driver);

  const v = await otherPerson(browser);
  await signIn(v, viewer.email);
  await v.waitForURL(/\/dashboard$/);
  await v.goto(`/${account.slug}/loads/${load.id}`);
  await expect(v.getByRole("heading", { name: new RegExp(load.load_number) })).toBeVisible();
  for (const name of ["Edit", "Assign", "More", "Dispatch"]) await expect(v.getByRole("button", { name, exact: true })).toBeHidden();
  expect((await viaApp(v, "POST", `/loads/${load.id}/transitions`, { action: "cancel", version: load.version, reason: "x" })).status).toBe(403);
  await v.context().close();

  const d = await otherPerson(browser);
  await signIn(d, driver.email);
  await d.waitForURL(/\/dashboard$/);
  await expect(d.getByRole("link", { name: "Dispatch" })).toBeHidden();
  await d.goto(`/${account.slug}/dispatch`);
  await expect(d.getByText("You don't have access to this").first()).toBeVisible();
  await d.context().close();
});
