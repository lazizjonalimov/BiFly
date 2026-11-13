import { expect, test } from "@playwright/test";
import { PASSWORD, otherPerson, signIn, signOut, signUp, viaApp } from "./helpers";

test("sign up, sign out, and sign back in", async ({ page }) => {
  const account = await signUp(page, "Northwind Carriers");
  expect(account.slug).toMatch(/^northwind-carriers-/);
  await expect(page.getByRole("button", { name: /Company: Northwind Carriers/ })).toBeVisible();
  // A brand-new company has nothing wrong with it.
  await expect(page.getByText("Nothing needs you right now")).toBeVisible();

  await signOut(page);
  // Signed out means out: the workspace sends you to sign-in and remembers where you were going.
  await page.goto(`/${account.slug}/settings/companies`);
  await expect(page).toHaveURL(/\/login\?next=/);

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/${account.slug}/settings/companies$`));
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
});

test("sign-up explains what is wrong with each field", async ({ page }) => {
  const account = await signUp(page);
  await signOut(page);

  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your company's name")).toBeVisible();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  // The server's answer lands on the field too.
  await page.getByLabel("Company name").fill("Second Try Inc");
  await page.getByLabel("Your name").fill("Someone Else");
  await page.getByLabel("Work email").fill(account.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("An account with this email already exists")).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveAttribute("aria-invalid", "true");
});

test("the browser never holds the API token", async ({ page }) => {
  await signUp(page);
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "bifly_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("bifly_session");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("eyJ");

  // The endpoints that answer with a token are not reachable through the pass-through.
  for (const path of ["/auth/login", "/auth/switch", "/auth/password", "/auth/signup"]) {
    expect((await viaApp(page, "POST", path, { email: "x@example.com", password: "x" })).status).toBe(404);
  }
  // The session route itself answers without the token.
  const reply = await page.evaluate(async () => (await fetch("/api/auth/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).text());
  expect(reply).not.toContain("access_token");
  expect((await viaApp<{ user: { email: string } }>(page, "GET", "/auth/me")).data.user.email).toContain("@example.com");
});

test("a request from another site cannot act with your session", async ({ page }) => {
  await signUp(page);
  // What a hostile page would send: your cookie rides along, but the browser marks where it came from.
  for (const [url, body] of [["/api/v1/customers", { name: "Injected" }], ["/api/auth/logout", {}], ["/api/auth/switch", { organization_id: "x" }]] as const) {
    const response = await page.request.post(url, { data: body, headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" } });
    expect(response.status(), url).toBe(403);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hello, Olive" })).toBeVisible();   // still signed in
});

test("an ended session is handled, not left broken", async ({ page, browser }) => {
  const account = await signUp(page);

  // The same person changes their password on another device: this device's session ends.
  const elsewhere = await otherPerson(browser);
  await signIn(elsewhere, account.email);
  await elsewhere.waitForURL(/\/dashboard$/);
  await elsewhere.getByRole("button", { name: /Account menu/ }).click();
  await elsewhere.getByRole("menuitem", { name: "Change password" }).click();
  await elsewhere.getByLabel("Current password").fill(PASSWORD);
  await elsewhere.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
  await elsewhere.getByLabel("New password again").fill("a-brand-new-password");
  await elsewhere.getByRole("button", { name: "Change password" }).click();
  await expect(elsewhere.getByText("Password changed")).toBeVisible();
  // The device that changed it carries on.
  await elsewhere.reload();
  await expect(elsewhere.getByRole("heading", { name: "Hello, Olive" })).toBeVisible();

  // Here, the next navigation goes to sign-in rather than looping or showing a broken page.
  await page.goto(`/${account.slug}/settings/companies`);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(page, account.email);
  await expect(page.getByText("Invalid email or password")).toBeVisible();          // the old password is gone
  await signIn(page, account.email, "a-brand-new-password");
  await expect(page).toHaveURL(/\/dashboard$/);
  await elsewhere.context().close();
});

test("wrong current password is explained on the field", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await page.getByLabel("Current password").fill("definitely-wrong");
  await page.getByLabel("New password", { exact: true }).fill("another-long-password");
  await page.getByLabel("New password again").fill("another-long-password-typo");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The two passwords don't match")).toBeVisible();
  await page.getByLabel("New password again").fill("another-long-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("That isn't your current password")).toBeVisible();
});
