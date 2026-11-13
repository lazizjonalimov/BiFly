import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { ApiError, errorMessage } from "@/lib/api/errors";

/**
 * Put the API's answer where the user can act on it: problems with a field go under that field, everything
 * else (conflicts, rules about the record as a whole) is returned to show at the top of the form.
 *
 * `aliases` maps an API field path to the form field that holds it, where the two differ.
 */
export function applyApiErrors<T extends FieldValues>(form: UseFormReturn<T>, error: unknown, aliases: Record<string, string> = {}): string | null {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const known = new Set(Object.keys(flatten(form.getValues())));
  const unplaced: string[] = [];
  let focused = false;
  for (const [path, message] of Object.entries(error.fieldErrors)) {
    const name = aliases[path] ?? path;
    if (known.has(name) || known.has(name.split(".")[0] ?? "")) {
      form.setError(name as FieldPath<T>, { type: "server", message }, { shouldFocus: !focused });
      focused = true;
    } else {
      unplaced.push(message);
    }
  }
  if (unplaced.length) return [...new Set(unplaced)].join(" ");
  // A pure field problem needs no banner; anything else does.
  return focused ? null : error.message;
}

function flatten(value: unknown, prefix = "", out: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out[path] = true;
      flatten(child, path, out);
    }
  }
  return out;
}
