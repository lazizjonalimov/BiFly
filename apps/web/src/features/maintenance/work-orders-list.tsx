"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardCheckIcon, PlusIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InspectionSheet } from "@/features/maintenance/inspection-sheet";
import { PRIORITIES, WORK_ORDER_STATUSES, unitPath, useMaintenanceSummary, type WorkOrderItem } from "@/features/maintenance/lib";
import { MaintenanceTabs, PriorityBadge } from "@/features/maintenance/parts";
import { WorkOrderSheet } from "@/features/maintenance/work-order-sheet";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDay, todayIn } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber } from "@/lib/format/text";
import { cn } from "@/lib/utils";

const FILTERS = { open: "true", status: "", priority: "", unit_type: "", overdue: "" };
const dash = <span className="text-muted-foreground">—</span>;

function Tiles({ onPick, filters }: { onPick: (values: Record<string, string>) => void; filters: Record<string, string> }) {
  const summary = useMaintenanceSummary();
  const s = summary.data;
  const tiles = [
    { label: "Open work orders", value: s?.open_work_orders, pick: { open: "true", priority: "", overdue: "", status: "" } },
    { label: "Urgent", value: s?.urgent_open, pick: { open: "true", priority: "urgent", overdue: "", status: "" }, danger: true },
    { label: "Past their date", value: s?.overdue, pick: { open: "true", priority: "", overdue: "true", status: "" }, warn: true },
    { label: "Units off the road", value: s?.units_out_of_service, danger: true },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5" role="group" aria-label="Maintenance summary">
      {tiles.map((tile) => {
        const active = tile.pick ? Object.entries(tile.pick).every(([k, v]) => (filters[k] ?? "") === v) : false;
        const number = s ? <span className={cn("tabular mt-0.5 block text-xl font-semibold", tile.danger && (tile.value ?? 0) > 0 && "text-destructive", tile.warn && (tile.value ?? 0) > 0 && "text-warning")}>{formatNumber(tile.value ?? 0)}</span> : <Skeleton className="mt-1.5 h-6 w-10" />;
        return tile.pick ? (
          <button key={tile.label} type="button" aria-pressed={active} onClick={() => onPick(tile.pick)} className={cn("rounded-lg border bg-card p-3 text-left shadow-xs hover:bg-accent", active && "border-primary bg-primary/5 ring-1 ring-primary")}>
            <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
            {number}
          </button>
        ) : (
          <div key={tile.label} className="rounded-lg border bg-card p-3 shadow-xs">
            <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
            {number}
          </div>
        );
      })}
      <div className="col-span-2 rounded-lg border bg-card p-3 shadow-xs lg:col-span-1">
        <span className="block text-xs font-medium text-muted-foreground">Spent this month</span>
        {s ? <span className="tabular mt-0.5 block text-xl font-semibold">{formatMoney(s.spend_this_month, s.currency)}</span> : <Skeleton className="mt-1.5 h-6 w-20" />}
      </div>
    </div>
  );
}

/** Work orders: what is in the shop, what is waiting, and what it costs. */
export function WorkOrdersList() {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const path = useWorkspacePath();
  const state = useListState({ defaultSort: "-created_at", filters: FILTERS });
  const [creating, setCreating] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const wantsNew = search.get("new") === "1";
  const today = todayIn(org.timezone);

  const query = useQuery({
    queryKey: [org.id, "maintenance", "work-orders", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/maintenance/work-orders", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<WorkOrderItem, unknown>[] = [
    {
      id: "number",
      header: "Work order",
      enableHiding: false,
      cell: ({ row }) => (
        <span className="grid">
          <Link href={path("maintenance", row.original.id)} className="font-medium hover:underline">
            {row.original.number}
          </Link>
          <span className="text-xs text-muted-foreground">{row.original.title}</span>
        </span>
      ),
    },
    {
      id: "unit",
      header: "Unit",
      cell: ({ row }) => (
        <Link href={path(...unitPath(row.original.unit))} className="hover:underline">
          {row.original.unit.name}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={row.original.status} />
          {row.original.out_of_service && (row.original.status === "open" || row.original.status === "in_progress") ? <Badge variant="danger">Off the road</Badge> : null}
        </span>
      ),
    },
    { id: "priority", header: "Priority", enableSorting: true, cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
    {
      id: "scheduled_for",
      header: "Scheduled",
      enableSorting: true,
      cell: ({ row }) => {
        const date = row.original.scheduled_for;
        if (!date) return dash;
        const late = date < today && (row.original.status === "open" || row.original.status === "in_progress");
        return <span className={cn("whitespace-nowrap", late && "font-medium text-destructive")}>{formatDate(date)}{late ? " (late)" : ""}</span>;
      },
    },
    { id: "vendor", header: "Shop", cell: ({ row }) => row.original.vendor ?? dash },
    { id: "total_cost", header: "Cost", enableSorting: true, meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{formatMoney(row.original.total_cost, row.original.currency)}</span> },
    { id: "created_at", header: "Opened", enableSorting: true, cell: ({ row }) => <span className="whitespace-nowrap">{formatDay(row.original.created_at, org.timezone)}</span> },
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
        title="Maintenance"
        description="Repairs and services, and the inspections that find them. A unit kept off the road can't be dispatched."
        actions={
          <>
            {can("safety.manage") || can("maintenance.manage") ? (
              <Button variant="outline" onClick={() => setInspecting(true)}>
                <ClipboardCheckIcon /> Record inspection
              </Button>
            ) : null}
            {can("maintenance.manage") ? (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> New work order
              </Button>
            ) : null}
          </>
        }
      />
      <MaintenanceTabs current="work-orders" />
      <Tiles filters={state.filters} onPick={(values) => state.setFilters(values)} />
      <DataTable
        label="Work orders"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("maintenance", row.id)}
        preferenceKey="maintenance.work-orders"
        searchPlaceholder="Search by number, title, shop or unit"
        filters={
          <>
            <FilterSelect
              label="Open"
              value={state.filters.open ?? "true"}
              onChange={(v) => state.setFilter("open", v)}
              options={[
                { value: "true", label: "Open only" },
                { value: "false", label: "Finished only" },
                { value: "all", label: "Open and finished" },
              ]}
            />
            {/* Choosing a status says everything about open or finished, so that filter steps aside. */}
            <FilterSelect label="Status" value={state.filters.status ?? ""} onChange={(v) => state.setFilters({ status: v, open: v ? "all" : "true" })} options={[{ value: "", label: "Any status" }, ...WORK_ORDER_STATUSES]} />
            <FilterSelect label="Priority" value={state.filters.priority ?? ""} onChange={(v) => state.setFilter("priority", v)} options={[{ value: "", label: "Any priority" }, ...PRIORITIES]} />
            <FilterSelect
              label="Unit"
              value={state.filters.unit_type ?? ""}
              onChange={(v) => state.setFilter("unit_type", v)}
              options={[
                { value: "", label: "Trucks and trailers" },
                { value: "vehicle", label: "Trucks" },
                { value: "trailer", label: "Trailers" },
              ]}
            />
            <FilterSelect
              label="Date"
              value={state.filters.overdue ?? ""}
              onChange={(v) => state.setFilter("overdue", v)}
              options={[
                { value: "", label: "Any date" },
                { value: "true", label: "Past their date" },
              ]}
            />
          </>
        }
        empty={{ icon: WrenchIcon, title: "No work orders", description: can("maintenance.manage") ? "Open one when a truck or trailer needs a repair or a service." : "Work orders appear here when the shop opens them." }}
      />
      {creating || (wantsNew && can("maintenance.manage")) ? <WorkOrderSheet open onOpenChange={(open) => !open && closeNew()} /> : null}
      {inspecting ? <InspectionSheet open onOpenChange={setInspecting} /> : null}
    </>
  );
}
