"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { BanknoteIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import { methodLabel, type PaymentItem } from "@/features/finance/lib";
import { PaymentSheet } from "@/features/finance/payment-sheet";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { cn } from "@/lib/utils";

const FILTERS = { status: "", received_from: "", received_to: "" };
const dash = <span className="text-muted-foreground">—</span>;

/** Money received: from whom, how, and how much of it is still to be matched to invoices. */
export function PaymentsList() {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const path = useWorkspacePath();
  const state = useListState({ defaultSort: "-received_on", filters: FILTERS });
  const [recording, setRecording] = useState(false);
  const wantsNew = search.get("new") === "1";

  const query = useQuery({
    queryKey: [org.id, "payments", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/payments", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<PaymentItem, unknown>[] = [
    {
      id: "received_on",
      header: "Received",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={path("finance", "payments", row.original.id)} className="font-medium whitespace-nowrap hover:underline">
          {formatDate(row.original.received_on)}
        </Link>
      ),
    },
    { id: "customer", header: "Customer", enableSorting: true, cell: ({ row }) => row.original.customer.name },
    { id: "method", header: "Method", cell: ({ row }) => methodLabel(row.original.method) },
    { id: "reference", header: "Reference", cell: ({ row }) => row.original.reference ?? dash },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "amount", header: "Amount", enableSorting: true, meta: { align: "right" }, cell: ({ row }) => <span className={cn("tabular", row.original.status === "reversed" && "text-muted-foreground line-through")}>{formatMoney(row.original.amount, row.original.currency)}</span> },
    { id: "unapplied", header: "Unapplied", meta: { align: "right" }, cell: ({ row }) => (Number(row.original.unapplied) > 0 && row.original.status === "recorded" ? <span className="tabular font-medium text-warning">{formatMoney(row.original.unapplied, row.original.currency)}</span> : dash) },
  ];

  const closeNew = () => {
    setRecording(false);
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
          can("payments.record") ? (
            <Button onClick={() => setRecording(true)}>
              <PlusIcon /> Record payment
            </Button>
          ) : null
        }
      />
      <FinanceTabs current="payments" />
      <DataTable
        label="Payments"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("finance", "payments", row.id)}
        preferenceKey="finance.payments"
        searchPlaceholder="Search by customer or reference"
        filters={
          <FilterSelect
            label="Status"
            value={state.filters.status ?? ""}
            onChange={(v) => state.setFilter("status", v)}
            options={[
              { value: "", label: "Any status" },
              { value: "recorded", label: "Recorded" },
              { value: "reversed", label: "Reversed" },
            ]}
          />
        }
        empty={{ icon: BanknoteIcon, title: "No payments recorded", description: can("payments.record") ? "Record money as it arrives, and apply it to the invoices it pays." : "Payments appear here once accounting records them." }}
      />
      {recording || (wantsNew && can("payments.record")) ? <PaymentSheet open onOpenChange={(open) => !open && closeNew()} /> : null}
    </>
  );
}
