"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileTextIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import { INVOICE_STATUSES, invoiceLabel, useReceivables, type InvoiceItem } from "@/features/finance/lib";
import { NewInvoiceDialog } from "@/features/finance/new-invoice-dialog";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber, plural } from "@/lib/format/text";
import { cn } from "@/lib/utils";

const FILTERS = { status: "", overdue: "" };
const dash = <span className="text-muted-foreground">—</span>;

function Tiles({ filters, onPick }: { filters: Record<string, string>; onPick: (values: Record<string, string>) => void }) {
  const path = useWorkspacePath();
  const can = useCan();
  const query = useReceivables();
  const r = query.data;
  const value = (text: React.ReactNode, tone?: string) => (r ? <span className={cn("tabular mt-0.5 block text-xl font-semibold", tone)}>{text}</span> : <Skeleton className="mt-1.5 h-6 w-20" />);
  const tile = "rounded-lg border bg-card p-3 text-left shadow-xs";
  const active = (pick: Record<string, string>) => Object.entries(pick).every(([k, v]) => (filters[k] ?? "") === v);
  const openPick = { status: "issued", overdue: "" };
  const overduePick = { status: "", overdue: "true" };
  const draftPick = { status: "draft", overdue: "" };
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Receivables">
      <button type="button" aria-pressed={active(openPick)} onClick={() => onPick(openPick)} className={cn(tile, "hover:bg-accent", active(openPick) && "border-primary bg-primary/5 ring-1 ring-primary")}>
        <span className="block text-xs font-medium text-muted-foreground">Owed to you{r ? ` · ${plural(r.open_invoices, "invoice")}` : ""}</span>
        {value(r ? formatMoney(r.open_balance, r.currency) : null)}
      </button>
      <button type="button" aria-pressed={active(overduePick)} onClick={() => onPick(overduePick)} className={cn(tile, "hover:bg-accent", active(overduePick) && "border-primary bg-primary/5 ring-1 ring-primary")}>
        <span className="block text-xs font-medium text-muted-foreground">Overdue{r ? ` · ${plural(r.overdue_invoices, "invoice")}` : ""}</span>
        {value(r ? formatMoney(r.overdue_balance, r.currency) : null, r && r.overdue_invoices > 0 ? "text-destructive" : undefined)}
      </button>
      <button type="button" aria-pressed={active(draftPick)} onClick={() => onPick(draftPick)} className={cn(tile, "hover:bg-accent", active(draftPick) && "border-primary bg-primary/5 ring-1 ring-primary")}>
        <span className="block text-xs font-medium text-muted-foreground">Drafts not issued</span>
        {value(r ? formatNumber(r.draft_invoices) : null)}
      </button>
      {can("loads.read") ? (
        <Link href={`${path("loads")}?view=ready_to_invoice`} className={cn(tile, "hover:bg-accent")}>
          <span className="block text-xs font-medium text-muted-foreground">Ready to invoice{r ? ` · ${plural(r.ready_to_invoice_loads, "load")}` : ""}</span>
          {value(r ? formatMoney(r.ready_to_invoice_amount, r.currency) : null, r && r.ready_to_invoice_loads > 0 ? "text-warning" : undefined)}
        </Link>
      ) : (
        <div className={tile}>
          <span className="block text-xs font-medium text-muted-foreground">Ready to invoice</span>
          {value(r ? formatMoney(r.ready_to_invoice_amount, r.currency) : null)}
        </div>
      )}
    </div>
  );
}

/** Invoices: drafts waiting to be issued, what is owed, and what is late. */
export function InvoicesList() {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const path = useWorkspacePath();
  const state = useListState({ defaultSort: "-created_at", filters: FILTERS });
  const [creating, setCreating] = useState(false);
  const wantsNew = search.get("new") === "1";

  const query = useQuery({
    queryKey: [org.id, "invoices", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/invoices", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<InvoiceItem, unknown>[] = [
    {
      id: "number",
      header: "Invoice",
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={path("finance", "invoices", row.original.id)} className={cn("font-medium hover:underline", !row.original.invoice_number && "italic")}>
          {invoiceLabel(row.original)}
        </Link>
      ),
    },
    { id: "customer", header: "Customer", enableSorting: true, cell: ({ row }) => row.original.customer.name },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={row.original.status} />
          {row.original.is_overdue ? <Badge variant="danger">{plural(row.original.days_overdue, "day")} late</Badge> : null}
        </span>
      ),
    },
    { id: "issue_date", header: "Issued", enableSorting: true, cell: ({ row }) => (row.original.issue_date ? <span className="whitespace-nowrap">{formatDate(row.original.issue_date)}</span> : dash) },
    { id: "due_date", header: "Due", enableSorting: true, cell: ({ row }) => (row.original.due_date ? <span className={cn("whitespace-nowrap", row.original.is_overdue && "font-medium text-destructive")}>{formatDate(row.original.due_date)}</span> : dash) },
    { id: "total", header: "Total", enableSorting: true, meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{formatMoney(row.original.total, row.original.currency)}</span> },
    { id: "balance", header: "Balance", meta: { align: "right" }, cell: ({ row }) => <span className={cn("tabular", Number(row.original.balance) > 0 && row.original.status === "issued" && "font-medium")}>{row.original.status === "void" ? dash : formatMoney(row.original.balance, row.original.currency)}</span> },
  ];

  const closeNew = () => {
    setCreating(false);
    if (wantsNew) {
      const params = new URLSearchParams(search.toString());
      params.delete("new");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  };

  return (
    <>
      <PageHeader
        title="Finance"
        description="Bill completed loads, record what customers pay, and see what is owed."
        actions={
          can("invoices.create") ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New invoice
            </Button>
          ) : null
        }
      />
      <FinanceTabs current="invoices" />
      <Tiles filters={state.filters} onPick={(values) => state.setFilters(values)} />
      <DataTable
        label="Invoices"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("finance", "invoices", row.id)}
        preferenceKey="finance.invoices"
        searchPlaceholder="Search by number or customer"
        filters={
          <>
            <FilterSelect label="Status" value={state.filters.status ?? ""} onChange={(v) => state.setFilter("status", v)} options={[{ value: "", label: "Any status" }, ...INVOICE_STATUSES]} />
            <FilterSelect
              label="Due"
              value={state.filters.overdue ?? ""}
              onChange={(v) => state.setFilter("overdue", v)}
              options={[
                { value: "", label: "Any due date" },
                { value: "true", label: "Overdue" },
                { value: "false", label: "Not overdue" },
              ]}
            />
          </>
        }
        empty={{ icon: FileTextIcon, title: "No invoices yet", description: can("invoices.create") ? "Create one from completed loads. It stays a draft until you issue it." : "Invoices appear here once accounting creates them." }}
      />
      {creating || (wantsNew && can("invoices.create")) ? <NewInvoiceDialog open onOpenChange={(open) => !open && closeNew()} /> : null}
    </>
  );
}
