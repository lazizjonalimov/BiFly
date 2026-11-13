// Server-only: the session cookie, and calls to the API on the signed-in user's behalf.
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Me } from "@/lib/api/types";
import { allowEmbedding } from "@/lib/auth/embedding";

export const API_URL = (process.env.BIFLY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const SESSION_COOKIE = "bifly_session";

type CookieJar = Awaited<ReturnType<typeof cookies>>;

/** True when the browser itself reports that the page is open on this machine over plain http. */
function onLocalHttp(request: Request): boolean {
  try {
    // Origin is sent on writes; same-origin reads carry only Referer.
    const origin = new URL(request.headers.get("origin") ?? request.headers.get("referer") ?? "");
    return origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  } catch {
    return false;
  }
}

/**
 * Session cookie attributes. The token is httpOnly: page scripts can never read it.
 *
 * `Secure` is always set in production, except when the browser reports the page is on localhost over plain
 * http (a production build on your own machine), where some browsers refuse to store Secure cookies. That is
 * decided from the browser's Origin header, not the Host header, so a reverse proxy can't change it.
 */
export function cookieOptions(request: Request) {
  const base = { httpOnly: true, path: "/", maxAge: 60 * 60 * 12 };
  if (allowEmbedding()) {
    // Inside another site's frame the cookie is third-party: it must be SameSite=None (which requires Secure)
    // and partitioned by the embedding site. Cross-site writes are still refused by `sameOrigin` below.
    return { ...base, sameSite: "none" as const, secure: true, partitioned: true };
  }
  return { ...base, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" && !onLocalHttp(request) };
}

export function setSession(jar: CookieJar, request: Request, token: string): void {
  jar.set(SESSION_COOKIE, token, cookieOptions(request));
}

/** Sign the browser out. A cookie is only removed by a Set-Cookie with the same attributes it was set with. */
export function clearSession(jar: CookieJar, request: Request): void {
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
}

/**
 * Refuse state-changing requests that don't come from this app's own pages (CSRF defence).
 *
 * Browsers label every request with Sec-Fetch-Site, computed from the page's origin and the address as the
 * browser sees it. Page scripts cannot set it, and unlike a Host comparison it stays correct behind a proxy
 * that rewrites headers. Browsers too old to send it fall back to comparing Origin with the host.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return true; // not a browser: there is no ambient session cookie to abuse
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** An error in the API's own shape, for failures that happen before the API is reached. */
export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, field_errors: {}, details: {}, request_id: null } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Call the API. Never cached: every response belongs to one user in one company. */
export function apiFetch(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, headers, ...rest } = init;
  const merged = new Headers(headers);
  if (token) merged.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}/api/v1${path}`, { ...rest, headers: merged, cache: "no-store", redirect: "manual" });
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * Who is signed in, and where: the user, the active company, their role and permissions, and every company
 * they can switch to. Asked of the API on each request (once per render), so a role change or removal shows
 * immediately. Returns null when there is no valid session.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const token = await sessionToken();
  if (!token) return null;
  try {
    const response = await apiFetch("/auth/me", { token });
    return response.ok ? ((await response.json()) as Me) : null;
  } catch {
    return null;
  }
});
