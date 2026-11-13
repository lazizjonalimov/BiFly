import { cookies } from "next/headers";
import { clearSession, errorResponse, sameOrigin } from "@/lib/auth/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin request blocked");
  clearSession(await cookies(), request);
  return new Response(null, { status: 204 });
}
