import { exchange } from "@/lib/auth/session-routes";

// Changing the password ends every other session; this one continues on the fresh token the API returns.
export const POST = (request: Request) => exchange(request, { path: "/auth/password", authenticated: true });
