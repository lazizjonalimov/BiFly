import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE, clearSession, errorResponse, sameOrigin } from "@/lib/auth/server";

// The browser-facing side of the API: /api/v1/<path> here forwards to /api/v1/<path> on the API, attaching
// the bearer token from the httpOnly session cookie. It adds no business rules of its own; the API decides
// everything again for itself.
const FORWARD_REQUEST = ["content-type", "idempotency-key", "x-request-id", "accept"];
const FORWARD_RESPONSE = ["content-type", "content-disposition", "content-security-policy", "x-content-type-options", "x-request-id", "idempotent-replay"];

// These API endpoints answer with an access token. They are reachable only through /api/auth/*, which keeps
// the token in the cookie, never through this pass-through, which would hand it to page scripts.
const TOKEN_ENDPOINTS = new Set(["auth/login", "auth/signup", "auth/switch", "auth/password"]);

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const write = !["GET", "HEAD"].includes(request.method);
  if (write && !sameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin request blocked");

  const { path } = await context.params;
  if (path.some((part) => part === ".." || part === "." || part.includes("/") || part.includes("\\"))) {
    return errorResponse(400, "BAD_REQUEST", "Invalid path");
  }
  if (TOKEN_ENDPOINTS.has(path.join("/"))) return errorResponse(404, "NOT_FOUND", "Not found");

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue");

  const target = `${API_URL}/api/v1/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`;
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: request.method, headers, body: write ? await request.arrayBuffer() : undefined, cache: "no-store", redirect: "manual" });
  } catch {
    return errorResponse(502, "UPSTREAM_UNAVAILABLE", "FlyFleet is not reachable right now. Try again in a moment.");
  }

  const out = new Headers({ "Cache-Control": "private, no-store" });
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (upstream.status === 401) clearSession(jar, request);
  return new Response([204, 304].includes(upstream.status) ? null : upstream.body, { status: upstream.status, headers: out });
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
