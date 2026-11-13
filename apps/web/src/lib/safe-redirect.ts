/**
 * Where to go after signing in. Only a path inside this app is accepted, so a crafted link can't use the
 * sign-in page to bounce someone to another site.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("://")) return fallback;
  if (next.startsWith("/login") || next.startsWith("/signup") || next.startsWith("/api/")) return fallback;
  return next;
}
