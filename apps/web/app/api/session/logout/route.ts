import { cookies } from "next/headers";
import { SESSION_COOKIE, errorResponse, sameOrigin } from "@/lib/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-origin request blocked");
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
