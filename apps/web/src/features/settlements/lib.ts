"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";

export type Settlement = Schema<"SettlementDetail">;
export type SettlementItem = Schema<"SettlementListItem">;

export const PAY_METHODS = [
  { value: "direct_deposit", label: "Direct deposit" },
  { value: "ach", label: "ACH" },
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;

export const SETTLEMENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
] as const;

const PAY_TYPES: Record<string, string> = { per_mile: "per mile", percent: "% of the load's revenue", flat: "per load" };

export function payTermsText(terms: { pay_type: string; pay_rate: string }, currency = "USD"): string {
  if (terms.pay_type === "percent") return `${terms.pay_rate}${PAY_TYPES.percent}`;
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 4 }).format(Number(terms.pay_rate))} ${PAY_TYPES[terms.pay_type] ?? ""}`.trim();
}

export function settlementLabel(st: { number?: string | null }): string {
  return st.number ?? "Draft settlement";
}

export function methodLabel(value: string | null | undefined): string {
  return PAY_METHODS.find((m) => m.value === value)?.label ?? "—";
}

export function settlementKey(orgId: string, id: string) {
  return [orgId, "settlements", "detail", id];
}

export function useSettlement(id: string) {
  const org = useOrg();
  return useQuery({ queryKey: settlementKey(org.id, id), queryFn: () => unwrap(api.GET("/api/v1/settlements/{settlement_id}", { params: { path: { settlement_id: id } } })) });
}

/** Settlements touch the expenses they reimburse or deduct, and the dashboard's driver-pay alert. */
export function invalidateSettlements(queryClient: QueryClient, orgId: string) {
  for (const key of ["settlements", "expenses", "dashboard"]) {
    void queryClient.invalidateQueries({ queryKey: [orgId, key] });
  }
}

/**
 * A change to a settlement. The API answers with the whole settlement. When someone else changed it first
 * (VERSION_CONFLICT), the latest version is fetched and the person told, rather than overwriting their work.
 */
export function useSettlementMutation<TArgs>(id: string, request: (args: TArgs) => Promise<Settlement>, { success, quiet }: { success?: (st: Settlement, args: TArgs) => string | null; quiet?: boolean } = {}) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (st, args) => {
      queryClient.setQueryData(settlementKey(org.id, id), st);
      invalidateSettlements(queryClient, org.id);
      const message = success?.(st, args);
      if (message) toast.success(message);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") void queryClient.invalidateQueries({ queryKey: settlementKey(org.id, id) });
      if (!quiet) toast.error(errorMessage(error));
    },
  });
}
