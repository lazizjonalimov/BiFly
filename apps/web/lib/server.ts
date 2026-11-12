// Server-only helpers for the backend-for-frontend layer.
import "server-only";
import type { cookies } from "next/headers";
import { allowEmbedding } from "@/lib/embedding";

export const API_URL = (process.env.TMS_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const SESSION_COOKIE = "tms_session";

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
 * Session cookie attributes. The token is httpOnly (never readable by page scripts).
 *
 * `Secure` is always set in production, except when the browser reports the page is on localhost over plain
 * http (running a production build on your own machine), where some browsers refuse to store Secure cookies.
 * This is decided from the browser's Origin header, not the Host header, so a reverse proxy can't change it.
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

/** Sign the browser out. A cookie is only removed by a Set-Cookie with the same attributes it was set with. */
export function clearSession(jar: CookieJar, request: Request): void {
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
}

/**
 * Refuse state-changing requests that don't come from this app's own pages (CSRF defence).
 *
 * Browsers label every request with Sec-Fetch-Site, computed from the page's origin and the address as the
 * browser sees it. Page scripts cannot set it, and unlike a Host comparison it stays correct behind a proxy or
 * load balancer that rewrites headers. Browsers too old to send it fall back to comparing Origin with the host.
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

export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, details: null } }, { status });
}
