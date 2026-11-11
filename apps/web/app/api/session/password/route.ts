import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE, cookieOptions, errorResponse, sameOrigin } from "@/lib/server";

// Changing the password revokes every existing token, including the one in this session's cookie.
// The API returns a replacement, which is swapped into the cookie here so the user stays signed in.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-origin request blocked");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return errorResponse(401, "unauthorized", "Authentication required");
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse(400, "bad_request", "Invalid request");

  const res = await fetch(`${API_URL}/api/v1/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) jar.delete(SESSION_COOKIE);
  if (!res.ok || !data?.access_token) {
    return Response.json(data ?? { error: { code: "upstream", message: "Could not change the password" } }, {
      status: res.ok ? 502 : res.status,
    });
  }
  jar.set(SESSION_COOKIE, data.access_token, cookieOptions(request));
  return Response.json({ ok: true });
}
