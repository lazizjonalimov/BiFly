import { renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { applyApiErrors } from "@/components/forms/api-errors";
import { ApiError, errorMessage, toApiError } from "@/lib/api/errors";

function makeForm() {
  return renderHook(() => useForm({ defaultValues: { name: "", email: "", stops: [{ city: "" }] } })).result.current;
}

const apiError = (status: number, code: string, message: string, fieldErrors: Record<string, string> = {}) =>
  new ApiError(status, { code, message, field_errors: fieldErrors, details: {}, request_id: "req-1" });

describe("applyApiErrors", () => {
  it("puts field problems under their fields and needs no banner", () => {
    const form = makeForm();
    const banner = applyApiErrors(form, apiError(422, "VALIDATION_ERROR", "Some fields need attention", { name: "Enter a name", "stops.0.city": "Enter a city" }));
    expect(banner).toBeNull();
    expect(form.getFieldState("name").error?.message).toBe("Enter a name");
    expect(form.getFieldState("stops.0.city").error?.message).toBe("Enter a city");
  });

  it("returns problems that belong to no field, to show at the top of the form", () => {
    const form = makeForm();
    expect(applyApiErrors(form, apiError(422, "VALIDATION_ERROR", "Some fields need attention", { load_ids: "Load L-1002 is on another invoice" }))).toBe("Load L-1002 is on another invoice");
    expect(applyApiErrors(form, apiError(409, "VERSION_CONFLICT", "Someone else changed this load."))).toBe("Someone else changed this load.");
  });

  it("maps an API field to a differently named form field", () => {
    const form = makeForm();
    expect(applyApiErrors(form, apiError(422, "VALIDATION_ERROR", "x", { billing_email: "Not an email" }), { billing_email: "email" })).toBeNull();
    expect(form.getFieldState("email").error?.message).toBe("Not an email");
  });

  it("explains failures that never reached the API", () => {
    expect(applyApiErrors(makeForm(), new TypeError("Failed to fetch"))).toMatch(/Could not reach BiFly/);
  });
});

describe("ApiError", () => {
  it("reads the API's error shape", () => {
    const error = toApiError(409, { error: { code: "ASSIGNMENT_CONFLICT", message: "Driver is on load L-1001", field_errors: {}, details: { reasons: [] }, request_id: "abc" } });
    expect(error).toMatchObject({ status: 409, code: "ASSIGNMENT_CONFLICT", message: "Driver is on load L-1001", requestId: "abc", isConflict: true });
  });

  it("falls back to a plain sentence when the body is not the API's", () => {
    expect(toApiError(502, "<html>Bad gateway</html>").message).toMatch(/went wrong on our side/);
    expect(toApiError(403, null).message).toMatch(/role does not allow/);
    expect(errorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});
