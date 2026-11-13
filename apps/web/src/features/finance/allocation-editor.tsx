"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invoiceLabel } from "@/features/finance/lib";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney, fromCents, sumMoney, toCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";

export type Allocations = Record<string, string>;
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/** The customer's issued, unpaid invoices, oldest due first. */
export function useOpenInvoices(customerId: string) {
  const org = useOrg();
  return useQuery({
    queryKey: [org.id, "invoices", "list", "open-for", customerId],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/invoices", { params: { query: { customer_id: customerId, status: "issued", sort: "due_date", limit: 100 } }, signal })),
    enabled: !!customerId,
  });
}

/**
 * Check allocations before sending them: amounts are money, none is more than the invoice still owes, and
 * together they are no more than the money available. Returns errors by invoice id, and one for the whole.
 */
export function checkAllocations(value: Allocations, balances: Record<string, string>, available: string, currency = "USD"): { rows: Record<string, string>; total: string | null } {
  const rows: Record<string, string> = {};
  let sum = 0;
  for (const [id, raw] of Object.entries(value)) {
    const text = raw.trim();
    if (!text) continue;
    if (!AMOUNT.test(text)) {
      rows[id] = "Enter an amount like 250 or 250.00";
      continue;
    }
    const cents = toCents(text)!;
    if (cents > (toCents(balances[id]) ?? 0)) rows[id] = `Only ${formatMoney(balances[id], currency)} is owed`;
    sum += cents;
  }
  const limit = toCents(available) ?? 0;
  return { rows, total: sum > limit ? `That applies ${formatMoney(fromCents(sum), currency)}, more than the ${formatMoney(available, currency)} available` : null };
}

/** Allocations as the API takes them: only the invoices that get something. */
export function allocationsToApi(value: Allocations) {
  return Object.entries(value)
    .filter(([, amount]) => amount.trim() && Number(amount) > 0)
    .map(([invoice_id, amount]) => ({ invoice_id, amount: amount.trim() }));
}

/** Choose how much of a payment goes to each open invoice of the customer. */
export function AllocationEditor({ customerId, available, value, onChange, errors = {} }: { customerId: string; available: string; value: Allocations; onChange: (next: Allocations) => void; errors?: Record<string, string> }) {
  const query = useOpenInvoices(customerId);
  if (!customerId) return null;
  if (query.isPending) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const invoices = query.data.items;
  if (!invoices.length) {
    return <EmptyState icon={FileTextIcon} title="No open invoices" description="Nothing issued to this customer is waiting to be paid. The money is kept as unapplied, to apply later." className="py-6" />;
  }
  const currency = invoices[0]!.currency;
  const applied = sumMoney(Object.values(value).filter((v) => AMOUNT.test(v.trim())));
  const left = fromCents((toCents(available) ?? 0) - (toCents(applied) ?? 0));

  function fillOldest() {
    let remaining = toCents(available) ?? 0;
    const next: Allocations = {};
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const take = Math.min(toCents(invoice.balance) ?? 0, remaining);
      if (take > 0) {
        next[invoice.id] = fromCents(take);
        remaining -= take;
      }
    }
    onChange(next);
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Applied <span className="tabular font-medium">{formatMoney(applied, currency)}</span> · Left unapplied{" "}
          <span className={cn("tabular font-medium", (toCents(left) ?? 0) < 0 && "text-destructive")}>{formatMoney(left, currency)}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={fillOldest} disabled={!toCents(available)}>
          Apply oldest first
        </Button>
      </div>
      <div className="max-h-72 overflow-auto rounded-md border">
        <Table aria-label="Open invoices">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Owed</TableHead>
              <TableHead className="w-36 text-right">Apply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">{invoiceLabel(invoice)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(invoice.due_date)} {invoice.is_overdue ? <Badge variant="danger">Late</Badge> : null}
                </TableCell>
                <TableCell className="tabular text-right">{formatMoney(invoice.balance, invoice.currency)}</TableCell>
                <TableCell className="text-right">
                  <Input
                    value={value[invoice.id] ?? ""}
                    onChange={(e) => onChange({ ...value, [invoice.id]: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Apply to ${invoiceLabel(invoice)}`}
                    aria-invalid={!!errors[invoice.id]}
                    className="tabular h-8 text-right"
                  />
                  {errors[invoice.id] ? <span className="mt-1 block text-xs text-destructive">{errors[invoice.id]}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
