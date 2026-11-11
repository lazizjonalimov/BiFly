import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// One complete, auditable transportation transaction through the real UI:
// company signs up -> master data -> load -> assign -> dispatch -> stops -> POD -> confirm -> invoice -> paid,
// plus the guarantees around it (roles, password change, tenant isolation).
//
// Each run creates its own companies with unique emails, so it can be re-run against the same database.

const run = Date.now().toString(36);
const PASSWORD = "correct-horse-battery";
const owner = `owner-${run}@example.com`;
const dispatcher = `dispatcher-${run}@example.com`;

/** Form control by its label. Routes you navigated away from stay mounted but hidden, so match visible ones only. */
const field = (page: Page, label: string, exact = true) => page.getByLabel(label, { exact }).filter({ visible: true });
const fill = (page: Page, label: string, value: string) => field(page, label).fill(value);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await fill(page, "Email", email);
  await fill(page, "Password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}

test("a load goes from order to paid invoice", async ({ page }) => {
  page.on("dialog", (d) => d.accept("Customer cancelled"));
  let loadUrl = "";

  await test.step("a new company signs up", async () => {
    await page.goto("/");
    await page.waitForURL("**/login"); // signed-out visitors are sent to sign-in
    await page.getByRole("link", { name: "Create an account" }).click();
    await fill(page, "Company name", "Northline Freight");
    await fill(page, "Your name", "Olivia Owner");
    await fill(page, "Work email", owner);
    await fill(page, "Password", PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  await test.step("the API token is not reachable from page scripts", async () => {
    expect(await page.evaluate(() => document.cookie)).not.toContain("tms_session");
    expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
  });

  await test.step("master data: customer, driver, truck, trailer", async () => {
    await page.getByRole("link", { name: "Customers" }).click();
    await page.getByRole("button", { name: "Add customer" }).click();
    await fill(page, "Company name", "Globex Manufacturing");
    await fill(page, "Billing email", "ap@globex.example");
    await fill(page, "Payment terms (days)", "15");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: "Globex Manufacturing" })).toBeVisible();

    await page.getByRole("link", { name: "Drivers" }).click();
    await page.getByRole("button", { name: "Add driver" }).click();
    await fill(page, "First name", "Dana");
    await fill(page, "Last name", "Reyes");
    await fill(page, "CDL number", "D1234567");
    await fill(page, "CDL state (2 letters)", "IL");
    await fill(page, "CDL expiry", "2035-06-30");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: "Dana Reyes" })).toBeVisible();

    await page.getByRole("link", { name: "Fleet" }).click();
    await page.getByRole("button", { name: "Add truck" }).click();
    await fill(page, "Unit number", "T-101");
    await fill(page, "Make", "Freightliner");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: "T-101" })).toBeVisible();
    await page.getByRole("tab", { name: "Trailers" }).click();
    await page.getByRole("button", { name: "Add trailer" }).click();
    await fill(page, "Unit number", "TR-53");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: "TR-53" })).toBeVisible();
  });

  await test.step("dispatcher creates a load with pickup and delivery", async () => {
    await page.getByRole("link", { name: "Loads", exact: true }).click();
    await page.getByRole("button", { name: "New load" }).click();
    await field(page, "Customer").selectOption({ label: "Globex Manufacturing" });
    await fill(page, "Rate (USD)", "2850.00");
    await fill(page, "Commodity", "Paper rolls");
    for (const [i, stop] of [
      { name: "Globex Plant 4", city: "Chicago", state: "IL", appt: "2031-03-10T08:00" },
      { name: "Lone Star DC", city: "Dallas", state: "TX", appt: "2031-03-12T10:00" },
    ].entries()) {
      await field(page, "Location name", false).nth(i).fill(stop.name);
      await field(page, "City", false).nth(i).fill(stop.city);
      await field(page, "State", false).nth(i).fill(stop.state);
      await field(page, "Appointment", false).nth(i).fill(stop.appt);
    }
    await page.getByRole("button", { name: "Create load" }).click();
    await expect(page.getByRole("heading", { name: "L-000001" })).toBeVisible();
    loadUrl = page.url();
  });

  await test.step("assign driver, truck and trailer from the dispatch board", async () => {
    await page.getByRole("link", { name: "Dispatch board" }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await field(page, "Driver").selectOption({ label: "Dana Reyes" });
    await field(page, "Truck").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Assign" }).click(); // a dry van load needs a trailer
    await expect(dialog.getByRole("alert")).toContainText("trailer is required");
    await field(page, "Trailer").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText("Dana Reyes · T-101 / TR-53")).toBeVisible();
    await page.getByRole("button", { name: "Dispatch to driver" }).click();
    await expect(page.getByRole("region", { name: "Dispatched" }).getByText("L-000001")).toBeVisible();
  });

  await test.step("stops are worked in order and the load becomes delivered", async () => {
    await page.getByRole("link", { name: "L-000001" }).click();
    for (const event of ["arrived", "departed", "arrived", "departed"]) {
      const button = page.getByRole("button", { name: `Mark ${event}` }).first();
      await button.click();
      await expect(button).toBeHidden(); // replaced by the next step once the event is recorded
    }
    await expect(page.getByText("The driver reported this load delivered")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm delivery" })).toBeDisabled(); // needs a POD first
  });

  await test.step("POD is uploaded, downloadable, and delivery is confirmed", async () => {
    const pod = Buffer.from("%PDF-1.4 signed proof of delivery");
    await field(page, "Choose a file to upload").setInputFiles({ name: "pod-signed.pdf", mimeType: "application/pdf", buffer: pod });
    await expect(page.getByText("pod-signed.pdf")).toBeVisible();
    const href = await page.getByRole("link", { name: "Download" }).getAttribute("href");
    expect(await (await page.request.get(href!)).body()).toEqual(pod);
    await page.getByRole("button", { name: "Confirm delivery" }).click();
    await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible();
  });

  await test.step("the load is invoiced and paid in two payments", async () => {
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByRole("heading", { name: "INV-000001" })).toBeVisible();
    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Record payment" }).click();
    await fill(page, "Amount (USD)", "1000");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("$1,850.00").first()).toBeVisible(); // balance after the part payment
    await page.getByRole("button", { name: "Record payment" }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click(); // defaults to the remaining balance
    await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
    await page.goto(loadUrl);
    await expect(page.getByText("Invoice INV-000001 paid in full")).toBeVisible(); // recorded in the load history
  });

  await test.step("the owner adds a dispatcher", async () => {
    await page.getByRole("link", { name: "Team" }).click();
    await page.getByRole("button", { name: "Add user" }).click();
    await fill(page, "Full name", "Devon Dispatcher");
    await fill(page, "Email", dispatcher);
    await fill(page, "Temporary password", "temp-password-123");
    await page.getByRole("dialog").getByRole("button", { name: "Add user" }).click();
    await expect(page.getByRole("cell", { name: /Devon Dispatcher/ })).toBeVisible();
    await signOut(page);
  });

  await test.step("the dispatcher has a reduced menu, and the API enforces it too", async () => {
    await signIn(page, dispatcher, "temp-password-123");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
    expect((await page.request.get("/api/tms/users")).status()).toBe(403);
  });

  await test.step("the dispatcher replaces the temporary password", async () => {
    await page.getByRole("button", { name: "Password", exact: true }).click();
    await fill(page, "Current password", "not-my-password");
    await fill(page, "New password", PASSWORD);
    await fill(page, "Confirm new password", PASSWORD);
    await page.getByRole("dialog").getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("That isn't your current password")).toBeVisible();
    await fill(page, "Current password", "temp-password-123");
    await page.getByRole("dialog").getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your password has been changed")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await page.reload(); // still signed in: the session cookie was rotated
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await signOut(page);
    await signIn(page, dispatcher, "temp-password-123");
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });

  await test.step("the layout works on a phone without sideways scrolling", async () => {
    await signIn(page, dispatcher, PASSWORD);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    for (const path of ["/", "/loads", "/dispatch", loadUrl]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("/");
    await signOut(page);
  });

  await test.step("a second company cannot see any of it", async () => {
    await page.goto("/signup");
    await fill(page, "Company name", "Rival Haulage");
    await fill(page, "Your name", "Rita Rival");
    await fill(page, "Work email", `rival-${run}@example.com`);
    await fill(page, "Password", PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "Loads", exact: true }).click();
    await expect(page.getByText("No loads yet")).toBeVisible();
    await page.goto(loadUrl); // the first company's load, by direct URL
    await expect(page.getByText("Load not found")).toBeVisible();
  });
});
