"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PackageIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { loadColumns } from "@/features/loads/columns";
import { LOAD_STATUSES, VIEWS } from "@/features/loads/lib";
import { useListState } from "@/hooks/use-list-state";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";

const FILTERS = { view: "", status: "", customer_id: "", terminal_id: "", pickup_from: "", pickup_to: "" };
const VIEW_OPTIONS = [{ value: "", label: "Any load" }, ...VIEWS.map((v) => ({ value: v.value, label: v.label })), { value: "ready_to_invoice", label: "Ready to invoice" }];

/** Every load, past and present: the register to search, filter and export from. Dispatch works from the board. */
export function LoadsList() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const terminals = useTerminals();
  const state = useListState({ defaultSort: "-created_at", filters: FILTERS });

  const query = useQuery({
    queryKey: [org.id, "loads", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/loads", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns = loadColumns({ href: (load) => path("loads", load.id), timezone: org.timezone, showRates: can("loads.rates.read") });
  const newButton = can("loads.create") ? (
    <Button asChild>
      <Link href={path("loads", "new")}>
        <PlusIcon /> New load
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Loads" description="Every load, from draft to paid. Search by load number, reference, BOL, customer or city." actions={newButton} />
      <DataTable
        label="Loads"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("loads", row.id)}
        preferenceKey="loads"
        searchPlaceholder="Load, reference, BOL, city"
        filters={
          <>
            <FilterSelect label="Show" value={state.filters.view ?? ""} onChange={(value) => state.setFilter("view", value)} options={VIEW_OPTIONS} />
            <FilterSelect label="Status" value={state.filters.status ?? ""} onChange={(value) => state.setFilter("status", value)} options={[{ value: "", label: "Any status" }, ...LOAD_STATUSES]} />
            {terminals.options.length ? <FilterSelect label="Terminal" value={state.filters.terminal_id ?? ""} onChange={(value) => state.setFilter("terminal_id", value)} options={[{ value: "", label: "Any terminal" }, ...terminals.options]} /> : null}
            {can("customers.read") ? (
              <div className="w-52">
                <CustomerPicker value={state.filters.customer_id ?? ""} onChange={(id) => state.setFilter("customer_id", id)} placeholder="Any customer" />
              </div>
            ) : null}
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Pickup
              <Input type="date" aria-label="Pickup from" value={state.filters.pickup_from ?? ""} onChange={(e) => state.setFilter("pickup_from", e.target.value)} className="h-9 w-36" />
              to
              <Input type="date" aria-label="Pickup to" value={state.filters.pickup_to ?? ""} onChange={(e) => state.setFilter("pickup_to", e.target.value)} className="h-9 w-36" />
            </label>
          </>
        }
        empty={{ icon: PackageIcon, title: "No loads yet", description: "Book your first load: pick a customer, add the pickup and delivery, and set the rate.", action: newButton ?? undefined }}
      />
    </>
  );
}
