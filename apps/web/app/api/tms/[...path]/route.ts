import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE, errorResponse, sameOrigin } from "@/lib/server";

// Authenticated pass-through to the TMS API: /api/tms/<path> -> <API_URL>/api/v1/<path>.
// Attaches the bearer token from the httpOnly session cookie; the browser never sees it.
const FORWARD_REQUEST = ["content-type", "idempotency-key", "x-request-id", "accept"];
const FORWARD_RESPONSE = ["content-type", "content-disposition", "x-request-id", "idempotent-replay"];

async function handle(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const write = !["GET", "HEAD"].includes(request.method);
  if (write && !sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-origin request blocked");

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return errorResponse(401, "unauthorized", "Authentication required");

  const { path } = await ctx.params;
  if (path.some((p) => p === ".." || p === "." || p.includes("/"))) {
    return errorResponse(400, "bad_request", "Invalid path");
  }
  const target = `${API_URL}/api/v1/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`;

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const h of FORWARD_REQUEST) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: write ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return errorResponse(502, "upstream_unavailable", "The TMS API is not reachable");
  }

  const out = new Headers({ "Cache-Control": "no-store" });
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (upstream.status === 401) (await cookies()).delete(SESSION_COOKIE);
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
