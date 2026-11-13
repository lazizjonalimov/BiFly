import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-redirect";

describe("safeNext", () => {
  const fallback = "/acme/dashboard";

  it("accepts a path inside the app", () => {
    expect(safeNext("/acme/loads/123?tab=stops", fallback)).toBe("/acme/loads/123?tab=stops");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/redirect?to=https://evil.example", "evil.example", "", null, undefined]) {
      expect(safeNext(bad, fallback)).toBe(fallback);
    }
  });

  it("never sends someone back to sign-in or into the API", () => {
    for (const loop of ["/login", "/login?next=/x", "/signup", "/api/v1/customers"]) expect(safeNext(loop, fallback)).toBe(fallback);
  });
});
