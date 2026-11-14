"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { HandCoinsIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import { SETTLEMENT_STATUSES, settlementLabel, type SettlementItem } from "@/features/settlements/lib";
import { NewSettlementDialog } from "@/features/settlements/new-settlement-dialog";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber } from "@/lib/format/text";
import { cn } from "@/lib/utils";

const FILTERS = { status: "" };

function Tiles({ status, onPick }: { status: string; onPick: (status: string) => void }) {
  const org = useOrg();
  const summary = useQuery({ queryKey: [org.id, "settlements", "summary"], queryFn: () => unwrap(api.GET("/api/v1/settlements/summary")) });
  const s = summary.data;
  const tiles = [
    { label: "Drafts in progress", value: s ? formatNumber(s.drafts) : null, pick: "draft" },
    { label: `Approved, to pay${s ? ` · ${s.approved_unpaid}` : ""}`, value: s ? formatMoney(s.to_pay, s.currency) : null, pick: "approved", warn: (s?.approved_unpaid ?? 0) > 0 },
    { label: "Paid this month", value: s ? formatMoney(s.paid_this_month, s.currency) : null, pick: "paid" },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Driver pay">
      {tiles.map((tile) => (
        <button key={tile.pick} type="button" aria-pressed={status === tile.pick} onClick={() => onPick(status === tile.pick ? "" : tile.pick)} className={cn("rounded-lg border bg-card p-3 text-left shadow-xs hover:bg-accent", status === tile.pick && "border-primary bg-primary/5 ring-1 ring-primary")}>
          <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
          {tile.value !== null ? <span className={cn("tabular mt-0.5 block text-xl font-semibold", tile.warn && "text-warning")}>{tile.value}</span> : <Skeleton className="mt-1.5 h-6 w-20" />}
        </button>
      ))}
    </div>
  );
}

/** Driver settlements: drafts being checked, approved pay waiting to go out, and what has been paid. */
export function SettlementsList() {
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
    queryKey: [org.id, "settlements", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/settlements", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<SettlementItem, unknown>[] = [
    {
      id: "number",
      header: "Settlement",
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={path("finance", "settlements", row.original.id)} className={cn("font-medium hover:underline", !row.original.number && "italic")}>
          {settlementLabel(row.original)}
        </Link>
      ),
    },
    { id: "driver", header: "Driver", cell: ({ row }) => row.original.driver.name },
    { id: "period_end", header: "Period", enableSorting: true, cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.period_start)} to {formatDate(row.original.period_end)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "earnings", header: "Earnings", meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{formatMoney(row.original.earnings, row.original.currency)}</span> },
    { id: "deductions", header: "Deductions", meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{formatMoney(row.original.deductions, row.original.currency)}</span> },
    { id: "net_pay", header: "Net pay", enableSorting: true, meta: { align: "right" }, cell: ({ row }) => <span className="tabular font-medium">{formatMoney(row.original.net_pay, row.original.currency)}</span> },
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
        description="Driver pay: loads delivered, charges payable to the driver, reimbursements and deductions."
        actions={
          can("settlements.manage") ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New settlement
            </Button>
          ) : null
        }
      />
      <FinanceTabs current="settlements" />
      <Tiles status={state.filters.status ?? ""} onPick={(status) => state.setFilter("status", status)} />
      <DataTable
        label="Settlements"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("finance", "settlements", row.id)}
        preferenceKey="finance.settlements"
        searchPlaceholder="Search by number or driver"
        filters={<FilterSelect label="Status" value={state.filters.status ?? ""} onChange={(v) => state.setFilter("status", v)} options={[{ value: "", label: "Any status" }, ...SETTLEMENT_STATUSES]} />}
        empty={{ icon: HandCoinsIcon, title: "No settlements yet", description: can("settlements.manage") ? "Start one for a driver and a period: it fills itself from their delivered loads and expenses." : "Driver settlements appear here once accounting creates them." }}
      />
      {creating || (wantsNew && can("settlements.manage")) ? <NewSettlementDialog open onOpenChange={(open) => !open && closeNew()} /> : null}
    </>
  );
}
