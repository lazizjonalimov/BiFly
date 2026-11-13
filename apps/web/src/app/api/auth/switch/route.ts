import { exchange } from "@/lib/auth/session-routes";

// Move this browser's session to another company the user belongs to. The API re-verifies membership.
export const POST = (request: Request) => exchange(request, { path: "/auth/switch", authenticated: true });
