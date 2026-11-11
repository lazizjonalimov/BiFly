// Server-only helpers for the backend-for-frontend layer.
import "server-only";

export const API_URL = (process.env.TMS_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const SESSION_COOKIE = "tms_session";

/**
 * Session cookie attributes. The token is httpOnly (never readable by page scripts) and always `Secure` in
 * production — except when a production build is opened on localhost over plain http, where some browsers
 * would otherwise refuse to store it.
 */
export function cookieOptions(request: Request) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const local = host === "localhost" || host === "127.0.0.1";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && !local,
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

/** Reject state-changing requests that don't come from our own origin (CSRF defence alongside SameSite). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients; browsers always send Origin on cross-site writes
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
