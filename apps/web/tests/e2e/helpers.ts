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

const DAY = 86_400_000;
const isoDay = (offset: number, hour = 14) => new Date(`${new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString();

/** Upload a small PDF to a record through the page's session: intent, the file itself, complete. */
export async function uploadViaApp(page: Page, entityType: string, entityId: string, type = "pod"): Promise<void> {
  const ok = await page.evaluate(
    async ({ entityType, entityId, type }) => {
      const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
      const json = { "Content-Type": "application/json" };
      const intent = await (await fetch("/api/v1/documents/upload-intents", { method: "POST", headers: json, body: JSON.stringify({ filename: `${type}.pdf`, content_type: "application/pdf", size_bytes: bytes.length, type, entity_type: entityType, entity_id: entityId }) })).json();
      const put = await fetch(`/api/v1${intent.upload.url}`, { method: "PUT", headers: intent.upload.headers, body: bytes });
      const done = await fetch(`/api/v1/documents/${intent.document.id}/complete`, { method: "POST" });
      return put.ok && done.ok;
    },
    { entityType, entityId, type },
  );
  expect(ok).toBeTruthy();
}

export type Setup = { customer: string; driver: string; truck: string; trailer: string };

/** A customer, a qualified driver, a truck and a trailer. */
export async function fleet(page: Page, customerName = "Globex"): Promise<Setup> {
  const dates = { insurance_expiry: isoDay(300).slice(0, 10), registration_expiry: isoDay(300).slice(0, 10), inspection_expiry: isoDay(300).slice(0, 10) };
  const customer = await viaApp<{ id: string }>(page, "POST", "/customers", { name: customerName, payment_terms_days: 30 });
  const driver = await viaApp<{ id: string }>(page, "POST", "/drivers", { first_name: "Dana", last_name: "Reyes", cdl_expiry: isoDay(400).slice(0, 10), medical_cert_expiry: isoDay(400).slice(0, 10) });
  const truck = await viaApp<{ id: string }>(page, "POST", "/vehicles", { unit_number: unique("T"), ...dates });
  const trailer = await viaApp<{ id: string }>(page, "POST", "/trailers", { unit_number: unique("TR"), type: "dry_van", ...dates });
  return { customer: customer.data.id, driver: driver.data.id, truck: truck.data.id, trailer: trailer.data.id };
}

type Load = { id: string; load_number: string; version: number; status: string };

/**
 * A load run all the way to completed (assigned, dispatched, both stops, proof of delivery approved), so it
 * is ready to invoice. Each load is booked a week after the previous one so they never overlap.
 */
export async function completedLoad(page: Page, s: Setup, rate = "2500.00", weekOffset = 0): Promise<Load> {
  const step = async (load: Load, action: string) => {
    const r = await viaApp<Load>(page, "POST", `/loads/${load.id}/transitions`, { action, version: load.version });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    return r.data;
  };
  const booked = await viaApp<Load>(page, "POST", "/loads", {
    customer_id: s.customer, customer_rate: rate, miles: 920, commodity: "Paper",
    stops: [
      { type: "pickup", name: "Shipper DC", city: "Chicago", state: "IL", appt_start: isoDay(-30 + weekOffset * 7) },
      { type: "delivery", name: "Receiver", city: "Dallas", state: "TX", appt_start: isoDay(-28 + weekOffset * 7) },
    ],
  });
  expect(booked.status, JSON.stringify(booked.data)).toBe(201);
  const assigned = await viaApp<Load>(page, "POST", "/dispatch/assignments", { load_id: booked.data.id, driver_id: s.driver, vehicle_id: s.truck, trailer_id: s.trailer, version: booked.data.version });
  expect(assigned.status, JSON.stringify(assigned.data)).toBe(201);
  let load = assigned.data;
  for (const action of ["dispatch", "arrive", "depart", "arrive", "depart"]) load = await step(load, action);
  await uploadViaApp(page, "load", load.id);
  load = (await viaApp<Load>(page, "GET", `/loads/${load.id}`)).data;
  load = await step(load, "approve_pod");
  expect(load.status).toBe("completed");
  return load;
}
