import { describe, expect, it } from "vitest";
import { allocationsToApi, checkAllocations } from "@/features/finance/allocation-editor";

const balances = { a: "1000.00", b: "250.50" };

describe("applying a payment to invoices", () => {
  it("accepts amounts within what each invoice owes and what the payment holds", () => {
    expect(checkAllocations({ a: "1000", b: "250.50" }, balances, "1250.50")).toEqual({ rows: {}, total: null });
    expect(checkAllocations({ a: "", b: "  " }, balances, "0")).toEqual({ rows: {}, total: null });
  });

  it("refuses more than an invoice owes, or more than the payment holds, and explains in money", () => {
    const result = checkAllocations({ a: "600", b: "300" }, balances, "800.00");
    expect(result.rows).toEqual({ b: "Only $250.50 is owed" });
    expect(result.total).toBe("That applies $900.00, more than the $800.00 available");
  });

  it("refuses something that isn't an amount", () => {
    expect(checkAllocations({ a: "12,50" }, balances, "100").rows).toEqual({ a: "Enter an amount like 250 or 250.00" });
    expect(checkAllocations({ a: "-5" }, balances, "100").rows).toEqual({ a: "Enter an amount like 250 or 250.00" });
  });

  it("sends only the invoices that get something", () => {
    expect(allocationsToApi({ a: " 100.00 ", b: "", c: "0" })).toEqual([{ invoice_id: "a", amount: "100.00" }]);
  });
});
