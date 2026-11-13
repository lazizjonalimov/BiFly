import { exchange } from "@/lib/auth/session-routes";

export const POST = (request: Request) => exchange(request, { path: "/auth/signup" });
