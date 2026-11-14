"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { Schema } from "@/lib/api/types";

export type Expense = Schema<"ExpenseOut">;

export const CATEGORIES = [
  { value: "fuel", label: "Fuel" },
  { value: "tolls", label: "Tolls" },
  { value: "lumper", label: "Lumper" },
  { value: "scales", label: "Scale ticket" },
  { value: "parking", label: "Parking" },
  { value: "permits", label: "Permit" },
  { value: "repairs", label: "Repair" },
  { value: "tires", label: "Tires" },
  { value: "insurance", label: "Insurance" },
  { value: "lodging", label: "Lodging" },
  { value: "meals", label: "Meals" },
  { value: "advance", label: "Cash advance" },
  { value: "other", label: "Other" },
] as const;

export const PAID_WITH = [
  { value: "company_card", label: "Company card" },
  { value: "fuel_card", label: "Fuel card" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "driver", label: "Driver paid" },
] as const;

export const TREATMENTS = [
  { value: "none", label: "No effect on driver pay" },
  { value: "reimburse", label: "Pay it back to the driver" },
  { value: "deduct", label: "Take it from the driver's pay" },
] as const;

export const FUEL_TYPES = [
  { value: "diesel", label: "Diesel" },
  { value: "def", label: "DEF" },
  { value: "reefer", label: "Reefer fuel" },
  { value: "gasoline", label: "Gasoline" },
] as const;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function paidWithLabel(value: string | null | undefined): string {
  return PAID_WITH.find((c) => c.value === value)?.label ?? "—";
}

/** Expenses move money summaries, drivers' draft settlements and the dashboard. */
export function invalidateExpenses(queryClient: QueryClient, orgId: string) {
  for (const key of ["expenses", "settlements", "dashboard", "documents"]) {
    void queryClient.invalidateQueries({ queryKey: [orgId, key] });
  }
}
