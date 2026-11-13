"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invoiceLabel } from "@/features/finance/lib";
import { NewInvoiceDialog } from "@/features/finance/new-invoice-dialog";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney, sumMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/text";

/** One customer's invoices, newest first, with what they owe and a way to bill them. */
export function RelatedInvoices({ customerId }: { customerId: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const [cursor, setCursor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: [org.id, "invoices", "list", "customer", customerId, cursor],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/invoices", { params: { query: { customer_id: customerId, sort: "-created_at", limit: 10, count: true, cursor: cursor ?? undefined } }, signal })),
    placeholderData: keepPreviousData,
  });
  const owed = useQuery({
    queryKey: [org.id, "invoices", "list", "open-for", customerId],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/invoices", { params: { query: { customer_id: customerId, status: "issued", sort: "due_date", limit: 100 } }, signal })),
  });

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
      <p className="text-sm">
        {owed.data ? (
          <>
            Owes <span className="tabular font-semibold">{formatMoney(sumMoney(owed.data.items.map((i) => i.balance)), org.base_currency)}</span> on {plural(owed.data.items.length, "invoice")}
            {owed.data.items.some((i) => i.is_overdue) ? <Badge variant="danger" className="ml-2">Some overdue</Badge> : null}
          </>
        ) : (
          <Skeleton className="h-5 w-48" />
        )}
      </p>
      {can("invoices.create") ? (
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          New invoice
        </Button>
      ) : null}
    </div>
  );

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <div className="grid gap-2 p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  } else if (query.isError) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else if (!query.data.items.length && !cursor) {
    body = <EmptyState icon={FileTextIcon} title="No invoices yet" description="Invoices for this customer's completed loads will be listed here." />;
  } else {
    const { items, page } = query.data;
    body = (
      <div className="pt-3">
        <Table aria-label="Invoices">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <Link href={path("finance", "invoices", invoice.id)} className="font-medium hover:underline">
                    {invoiceLabel(invoice)}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={invoice.status} />
                    {invoice.is_overdue ? <Badge variant="danger">Late</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{invoice.issue_date ? formatDate(invoice.issue_date) : "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{invoice.due_date ? formatDate(invoice.due_date) : "—"}</TableCell>
                <TableCell className="tabular text-right">{formatMoney(invoice.total, invoice.currency)}</TableCell>
                <TableCell className="tabular text-right">{invoice.status === "void" ? "—" : formatMoney(invoice.balance, invoice.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {cursor || page.has_more ? (
          <div className="flex justify-end gap-2 p-3">
            <Button variant="outline" size="sm" onClick={() => setCursor(null)} disabled={!cursor}>
              First page
            </Button>
            <Button variant="outline" size="sm" onClick={() => page.next_cursor && setCursor(page.next_cursor)} disabled={!page.has_more}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {header}
      {body}
      {creating ? <NewInvoiceDialog open customerId={customerId} onOpenChange={(open) => !open && setCreating(false)} /> : null}
    </div>
  );
}
