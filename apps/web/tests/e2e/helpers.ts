import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";
export const API = process.env.E2E_API_URL ?? "http://localhost:8000";

export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type Account = { email: string; company: string; slug: string };

/** Create an account through the sign-up screen, the way a new customer would. */
export async function signUp(page: Page, company = "Acme Trucking"): Promise<Account> {
  const email = `${unique("owner")}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Your name").fill("Olive Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hello, Olive" })).toBeVisible();
  return { email, company, slug: new URL(page.url()).pathname.split("/")[1]! };
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
}

/** A separate browser profile: someone else, with their own cookies. */
export async function otherPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/**
 * Call the API through the page's own session, exactly as the app's scripts do (same origin, same cookie).
 * Used to arrange data quickly; what is being tested is always done through the screen.
 */
export async function viaApp<T = unknown>(page: Page, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(`/api/v1${path}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null };
    },
    { method, path, body },
  );
}

/** Talk to the API directly, as a script outside the browser would. */
export async function apiLogin(request: APIRequestContext, email: string, organizationId?: string): Promise<string> {
  const response = await request.post(`${API}/api/v1/auth/login`, { data: { email, password: PASSWORD, ...(organizationId ? { organization_id: organizationId } : {}) } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}
