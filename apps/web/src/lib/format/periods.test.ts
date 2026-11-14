import { describe, expect, it } from "vitest";
import { periodRange } from "@/lib/format/periods";

describe("reporting periods", () => {
  it("runs this month, this quarter and the year to date up to today", () => {
    expect(periodRange("this_month", "2026-11-13")).toEqual({ from: "2026-11-01", to: "2026-11-13" });
    expect(periodRange("year_to_date", "2026-11-13")).toEqual({ from: "2026-01-01", to: "2026-11-13" });
    expect(periodRange("this_quarter", "2026-11-13")).toEqual({ from: "2026-10-01", to: "2026-11-13" });
  });

  it("takes whole previous months and fuel-tax quarters, across the new year", () => {
    expect(periodRange("last_month", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("last_month", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("last_quarter", "2026-11-13")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange("last_quarter", "2026-02-10")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(periodRange("last_quarter", "2028-05-01")).toEqual({ from: "2028-01-01", to: "2028-03-31" });
  });
});
