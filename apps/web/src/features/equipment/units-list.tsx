"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ContainerIcon, PlusIcon, TruckIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { EQUIPMENT_TYPES, OWNERSHIP, UNIT_STATUSES, UnitSheet, type Unit, type UnitKind } from "@/features/equipment/unit-sheet";
import { Availability, ComplianceBadge } from "@/features/safety/compliance";
import { useListState } from "@/hooks/use-list-state";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Page } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatNumber } from "@/lib/format/text";

const FILTERS = { status: "", ownership: "", terminal_id: "", type: "" };
const dash = <span className="text-muted-foreground">—</span>;

/** The earliest of a unit's three expiry dates: the one that will need attention first. */
function nextExpiry(unit: Unit): string | null {
  const dates = [unit.insurance_expiry, unit.registration_expiry, unit.inspection_expiry].filter((d): d is string => !!d).sort();
  return dates[0] ?? null;
}

export function UnitsList({ kind }: { kind: UnitKind }) {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const terminals = useTerminals();
  const state = useListState({ defaultSort: "unit_number", filters: FILTERS });
  const [sheet, setSheet] = useState<{ unit?: Unit } | null>(null);
  const wantsNew = search.get("new") === "1";
  const resource = kind === "truck" ? "vehicles" : "trailers";
  const title = kind === "truck" ? "Trucks" : "Trailers";
  const noun = kind === "truck" ? "truck" : "trailer";

  const query = useQuery<Page<Unit>>({
    queryKey: [org.id, resource, "list", state.apiParams],
    queryFn: ({ signal }) => {
      const params = { query: { ...state.apiParams, count: true } as never };
      return kind === "truck" ? unwrap(api.GET("/api/v1/vehicles", { params, signal })) : unwrap(api.GET("/api/v1/trailers", { params, signal }));
    },
    placeholderData: keepPreviousData,
  });

  const canManage = can("equipment.manage");
  const columns: ColumnDef<Unit, unknown>[] = [
    {
      id: "unit_number",
      header: "Unit",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) =>
        canManage ? (
          <button type="button" className="font-medium hover:underline" onClick={() => setSheet({ unit: row.original })}>
            {row.original.unit_number}
          </button>
        ) : (
          <span className="font-medium">{row.original.unit_number}</span>
        ),
    },
    ...(kind === "trailer"
      ? ([
          { id: "type", header: "Type", cell: ({ row }) => ("type" in row.original ? statusLabel(row.original.type) : null) },
          { id: "length", header: "Length", cell: ({ row }) => ("length_ft" in row.original && row.original.length_ft ? `${row.original.length_ft} ft` : dash) },
        ] satisfies ColumnDef<Unit, unknown>[])
      : []),
    { id: "vehicle", header: kind === "truck" ? "Year, make, model" : "Year and make", cell: ({ row }) => [row.original.year, row.original.make, "model" in row.original ? row.original.model : null].filter(Boolean).join(" ") || dash },
    { id: "plate", header: "Plate", cell: ({ row }) => (row.original.plate ? <span className="tabular">{[row.original.plate_state, row.original.plate].filter(Boolean).join(" ")}</span> : dash) },
    { id: "terminal", header: "Terminal", cell: ({ row }) => terminals.nameOf(row.original.terminal_id) },
    ...(kind === "truck" ? ([{ id: "odometer", header: "Odometer", meta: { align: "right" }, cell: ({ row }) => ("odometer" in row.original && row.original.odometer !== null && row.original.odometer !== undefined ? formatNumber(row.original.odometer) : dash) }] satisfies ColumnDef<Unit, unknown>[]) : []),
    { id: "next_expiry", header: "Next expiry", cell: ({ row }) => (nextExpiry(row.original) ? formatDate(nextExpiry(row.original)) : dash) },
    { id: "compliance", header: "Compliance", cell: ({ row }) => <ComplianceBadge compliance={row.original.compliance} /> },
    {
      id: "availability",
      header: "Availability",
      cell: ({ row }) => <Availability status={row.original.status} compliance={row.original.compliance} currentLoad={row.original.current_load} />,
    },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "created_at", header: "Added", enableSorting: true, cell: ({ row }) => formatDate(row.original.created_at.slice(0, 10)) },
  ];

  const newButton = canManage ? (
    <Button onClick={() => setSheet({})}>
      <PlusIcon /> New {noun}
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={title} description={kind === "truck" ? "Your power units, where they are based and whether they are clear to roll." : "Your trailers, by type, and whether they are clear to roll."} actions={newButton} />
      <DataTable
        label={title}
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        onRowClick={canManage ? (row) => setSheet({ unit: row }) : undefined}
        preferenceKey={resource}
        searchPlaceholder="Search unit, plate or VIN"
        filters={
          <>
            <FilterSelect label="Status" value={state.filters.status ?? ""} onChange={(value) => state.setFilter("status", value)} options={[{ value: "", label: "Any status" }, ...UNIT_STATUSES]} />
            {kind === "trailer" ? <FilterSelect label="Type" value={state.filters.type ?? ""} onChange={(value) => state.setFilter("type", value)} options={[{ value: "", label: "Any type" }, ...EQUIPMENT_TYPES]} /> : null}
            <FilterSelect label="Ownership" value={state.filters.ownership ?? ""} onChange={(value) => state.setFilter("ownership", value)} options={[{ value: "", label: "Any ownership" }, ...OWNERSHIP]} />
            {terminals.options.length ? <FilterSelect label="Terminal" value={state.filters.terminal_id ?? ""} onChange={(value) => state.setFilter("terminal_id", value)} options={[{ value: "", label: "Any terminal" }, ...terminals.options]} /> : null}
          </>
        }
        empty={{
          icon: kind === "truck" ? TruckIcon : ContainerIcon,
          title: `No ${noun}s yet`,
          description: `Add your ${noun}s with their insurance, registration and inspection dates. BiFly then keeps expired units off loads.`,
          action: newButton ?? undefined,
        }}
      />
      <UnitSheet
        kind={kind}
        open={sheet !== null || (wantsNew && canManage)}
        unit={sheet?.unit}
        onOpenChange={(open) => {
          if (!open) {
            setSheet(null);
            if (wantsNew) router.replace(pathname);
          }
        }}
      />
    </>
  );
}
