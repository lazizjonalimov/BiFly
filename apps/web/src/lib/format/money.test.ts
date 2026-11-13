import { describe, expect, it } from "vitest";
import { formatMoney, fromCents, multiplyMoney, sumMoney, toCents } from "@/lib/format/money";

describe("money", () => {
  it("reads decimal strings as whole cents", () => {
    expect(toCents("1234.50")).toBe(123450);
    expect(toCents("1234.5")).toBe(123450);
    expect(toCents("7")).toBe(700);
    expect(toCents("-50.00")).toBe(-5000);
    expect(toCents(0)).toBe(0);
  });

  it("refuses anything that is not a plain amount", () => {
    for (const bad of ["", "abc", "1,234.50", "1.234", "1e3", null, undefined]) expect(toCents(bad)).toBeNull();
  });

  it("adds without floating point drift", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["2500.00", "150.00", "-50.00"])).toBe("2600.00");
    expect(sumMoney(["19.99", null, "x", "0.01"])).toBe("20.00");
    expect(sumMoney([])).toBe("0.00");
  });

  it("multiplies quantity by rate, rounding half up to cents like the API", () => {
    expect(multiplyMoney("2.5", "60.00")).toBe("150.00");
    expect(multiplyMoney("3", "33.33")).toBe("99.99");
    expect(multiplyMoney("0.5", "0.01")).toBe("0.01");
    expect(multiplyMoney("1", "-50.00")).toBe("-50.00");
    expect(multiplyMoney("x", "1.00")).toBeNull();
  });

  it("round-trips through cents", () => {
    expect(fromCents(123450)).toBe("1234.50");
    expect(fromCents(-5)).toBe("-0.05");
    expect(fromCents(0)).toBe("0.00");
  });

  it("formats for display and shows a dash when there is no amount", () => {
    expect(formatMoney("1234.5", "USD")).toBe("$1,234.50");
    expect(formatMoney("0.00")).toBe("$0.00");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("not money")).toBe("—");
  });
});
