import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic redirect only: real authorization happens in the API on every request.
const PUBLIC = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has("tms_session");
  const isPublic = PUBLIC.some((p) => pathname === p);
  if (!signedIn && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  if (signedIn && isPublic) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
