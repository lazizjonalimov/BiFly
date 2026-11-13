import { describe, expect, it } from "vitest";
import { blankToNull, intOrNull, nullToBlank, optionalDate, optionalEmail, optionalMoney, optionalState, requiredMoney, signedMoney, wholeNumber } from "@/lib/validation";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe("form validation building blocks", () => {
  it("accepts plain amounts and nothing else", () => {
    for (const good of ["0", "2500", "2500.5", "2500.00"]) expect(ok(requiredMoney, good)).toBe(true);
    for (const bad of ["", "2,500", "$2500", "25.001", "-5", "abc"]) expect(ok(requiredMoney, bad)).toBe(false);
    expect(ok(optionalMoney, "")).toBe(true);
    expect(ok(signedMoney, "-50.00")).toBe(true);
    expect(ok(signedMoney, "--5")).toBe(false);
  });

  it("keeps whole numbers inside their range", () => {
    const days = wholeNumber({ max: 365 });
    expect(ok(days, "30")).toBe(true);
    expect(ok(days, "")).toBe(true);
    for (const bad of ["366", "-1", "3.5", "thirty"]) expect(ok(days, bad)).toBe(false);
    expect(ok(wholeNumber({ max: 10, optional: false }), "")).toBe(false);
  });

  it("validates optional email, date and state code", () => {
    expect(ok(optionalEmail, "")).toBe(true);
    expect(ok(optionalEmail, "ap@globex.example")).toBe(true);
    expect(ok(optionalEmail, "not-an-email")).toBe(false);
    expect(ok(optionalDate, "2026-03-10")).toBe(true);
    expect(ok(optionalDate, "03/10/2026")).toBe(false);
    expect(ok(optionalState, "il")).toBe(true);
    expect(ok(optionalState, "Illinois")).toBe(false);
  });

  it("converts between an input's empty text and the API's null", () => {
    expect(blankToNull({ name: " Globex ", code: "  ", terms: 30, active: true })).toEqual({ name: "Globex", code: null, terms: 30, active: true });
    expect(nullToBlank({ name: "Globex", code: null, phone: undefined, terms: 30 })).toEqual({ name: "Globex", code: "", phone: "", terms: 30 });
    expect(intOrNull("")).toBeNull();
    expect(intOrNull("42")).toBe(42);
  });
});
