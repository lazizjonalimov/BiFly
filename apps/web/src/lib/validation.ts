import { z } from "zod";

/**
 * Building blocks for form schemas. Inputs hold text, so these validate text and the form converts to the
 * API's types when it submits. They give immediate feedback only: the API validates everything again.
 */

export const requiredText = (label: string, max: number) => z.string().trim().min(1, `Enter ${label}`).max(max, `Keep this under ${max} characters`);

export const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`);

export const optionalEmail = z.union([z.literal(""), z.email("Enter a valid email address")]);

/** "" or a plain amount such as 5000 or 5000.00 */
export const optionalMoney = z.string().trim().regex(/^$|^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 2500 or 2500.00");

export const requiredMoney = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 2500 or 2500.00");

/** A rate that may be negative (a deduction). */
export const signedMoney = z.string().trim().regex(/^-?\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 75.00, or -50.00 for a deduction");

export function wholeNumber({ min = 0, max, optional = true, label = "a whole number" }: { min?: number; max: number; optional?: boolean; label?: string }) {
  return z.string().trim().refine((value) => {
    if (value === "") return optional;
    if (!/^\d+$/.test(value)) return false;
    const n = Number(value);
    return n >= min && n <= max;
  }, `Enter ${label} between ${min} and ${max}`);
}

/** "" or YYYY-MM-DD, which is what <input type="date"> produces. */
export const optionalDate = z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const optionalState = z.string().trim().regex(/^$|^[A-Za-z]{2}$/, "Use the two-letter code, like IL");

/** Empty text becomes null, which is how the API represents "nothing here". Other values pass through. */
export function blankToNull<T extends Record<string, unknown>>(values: T): { [K in keyof T]: T[K] extends string ? string | null : T[K] } {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? value.trim() : value])) as never;
}

/** null and undefined become empty text, which is how an input represents "nothing here". */
export function nullToBlank<T extends Record<string, unknown>>(values: T): { [K in keyof T]: Exclude<T[K], null | undefined> | (null extends T[K] ? string : never) } {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? ""])) as never;
}

export const intOrNull = (value: string): number | null => (value.trim() === "" ? null : Number(value));
