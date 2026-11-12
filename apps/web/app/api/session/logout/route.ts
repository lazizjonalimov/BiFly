import { cookies } from "next/headers";
import { clearSession, errorResponse, sameOrigin } from "@/lib/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-origin request blocked");
  clearSession(await cookies(), request);
  return new Response(null, { status: 204 });
}
