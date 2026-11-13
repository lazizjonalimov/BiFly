"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";

export type Invoice = Schema<"InvoiceDetail">;
export type InvoiceItem = Schema<"InvoiceListItem">;
export type Payment = Schema<"PaymentDetail">;
export type PaymentItem = Schema<"PaymentListItem">;
export type InvoiceLine = Schema<"InvoiceLineOut">;

export const PAYMENT_METHODS = [
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "factoring", label: "Factoring" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;

export const INVOICE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
] as const;

export function methodLabel(method: string | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? "—";
}

/** An issued invoice is known by its number; a draft has none until it is issued. */
export function invoiceLabel(invoice: { invoice_number?: string | null }): string {
  return invoice.invoice_number ?? "Draft invoice";
}

export function invoiceKey(orgId: string, id: string) {
  return [orgId, "invoices", "detail", id];
}

export function paymentKey(orgId: string, id: string) {
  return [orgId, "payments", "detail", id];
}

export function useInvoice(id: string) {
  const org = useOrg();
  return useQuery({ queryKey: invoiceKey(org.id, id), queryFn: () => unwrap(api.GET("/api/v1/invoices/{invoice_id}", { params: { path: { invoice_id: id } } })) });
}

export function usePayment(id: string) {
  const org = useOrg();
  return useQuery({ queryKey: paymentKey(org.id, id), queryFn: () => unwrap(api.GET("/api/v1/payments/{payment_id}", { params: { path: { payment_id: id } } })) });
}

/** Everything money touches: invoices, payments, receivables, the loads' billing status and the dashboard. */
export function invalidateFinance(queryClient: QueryClient, orgId: string) {
  for (const key of ["invoices", "payments", "finance", "loads", "dashboard", "customers"]) {
    void queryClient.invalidateQueries({ queryKey: [orgId, key] });
  }
}

/** A change to an invoice. The API answers with the whole invoice, which the page shows at once. */
export function useInvoiceMutation<TArgs>(id: string, request: (args: TArgs) => Promise<Invoice>, { success, quiet }: { success?: (invoice: Invoice, args: TArgs) => string | null; quiet?: boolean } = {}) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (invoice, args) => {
      queryClient.setQueryData(invoiceKey(org.id, id), invoice);
      invalidateFinance(queryClient, org.id);
      const message = success?.(invoice, args);
      if (message) toast.success(message);
    },
    onError: (error) => {
      if (!quiet) toast.error(errorMessage(error));
    },
  });
}

export function useReceivables(enabled = true) {
  const org = useOrg();
  return useQuery({ queryKey: [org.id, "finance", "receivables"], queryFn: () => unwrap(api.GET("/api/v1/finance/receivables")), enabled });
}
