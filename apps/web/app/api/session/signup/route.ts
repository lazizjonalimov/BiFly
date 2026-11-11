import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE, cookieOptions, errorResponse, sameOrigin } from "@/lib/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-origin request blocked");
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse(400, "bad_request", "Invalid request");

  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    return Response.json(data ?? { error: { code: "upstream", message: "Sign-up service unavailable" } }, {
      status: res.ok ? 502 : res.status,
    });
  }
  (await cookies()).set(SESSION_COOKIE, data.access_token, cookieOptions(request));
  return Response.json({ organization: data.organization }, { status: 201 });
}
