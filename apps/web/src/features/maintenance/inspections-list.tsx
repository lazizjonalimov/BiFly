"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardCheckIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { InspectionSheet } from "@/features/maintenance/inspection-sheet";
import { INSPECTION_KINDS, RESULTS, kindLabel, unitPath, type Inspection } from "@/features/maintenance/lib";
import { MaintenanceTabs } from "@/features/maintenance/parts";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { plural } from "@/lib/format/text";

const FILTERS = { kind: "", result: "", unit_type: "" };
const dash = <span className="text-muted-foreground">—</span>;

/** Every recorded inspection, newest first: what was found, and whether it was dealt with. */
export function InspectionsList() {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const path = useWorkspacePath();
  const state = useListState({ defaultSort: "-inspected_on", filters: FILTERS });
  const [recording, setRecording] = useState(false);
  const canRecord = can("safety.manage") || can("maintenance.manage");
  const wantsNew = search.get("new") === "1";

  const query = useQuery({
    queryKey: [org.id, "maintenance", "inspections", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/maintenance/inspections", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<Inspection, unknown>[] = [
    {
      id: "inspected_on",
      header: "Date",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={path("maintenance", "inspections", row.original.id)} className="font-medium whitespace-nowrap hover:underline">
          {formatDate(row.original.inspected_on)}
        </Link>
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
    { id: "kind", header: "Kind", cell: ({ row }) => kindLabel(row.original.kind) },
    { id: "result", header: "Result", cell: ({ row }) => <StatusBadge status={row.original.result} /> },
    {
      id: "defects",
      header: "Defects",
      cell: ({ row }) => {
        const defects = row.original.defects;
        if (!defects.length) return dash;
        const waiting = defects.filter((d) => !d.work_order).length;
        return (
          <span className="whitespace-nowrap">
            {plural(defects.length, "defect")}
            {waiting ? <span className="text-muted-foreground"> · {waiting} without a work order</span> : null}
          </span>
        );
      },
    },
    { id: "driver", header: "Driver", cell: ({ row }) => row.original.driver?.name ?? dash },
    { id: "where", header: "Where", cell: ({ row }) => row.original.location ?? dash },
    { id: "report", header: "Report", cell: ({ row }) => row.original.report_number ?? dash },
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
        title="Maintenance"
        description="Inspections and what they found. An out-of-service result keeps the unit off the road until it is repaired."
        actions={
          canRecord ? (
            <Button onClick={() => setRecording(true)}>
              <PlusIcon /> Record inspection
            </Button>
          ) : null
        }
      />
      <MaintenanceTabs current="inspections" />
      <DataTable
        label="Inspections"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("maintenance", "inspections", row.id)}
        preferenceKey="maintenance.inspections"
        searchPlaceholder="Search by unit, place, inspector or report"
        filters={
          <>
            <FilterSelect label="Kind" value={state.filters.kind ?? ""} onChange={(v) => state.setFilter("kind", v)} options={[{ value: "", label: "Any kind" }, ...INSPECTION_KINDS]} />
            <FilterSelect label="Result" value={state.filters.result ?? ""} onChange={(v) => state.setFilter("result", v)} options={[{ value: "", label: "Any result" }, ...RESULTS]} />
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
          </>
        }
        empty={{ icon: ClipboardCheckIcon, title: "No inspections recorded", description: canRecord ? "Record daily checks, annual inspections and roadside inspections here." : "Inspections appear here once they are recorded." }}
      />
      {recording || (wantsNew && canRecord) ? <InspectionSheet open onOpenChange={(open) => !open && closeNew()} /> : null}
    </>
  );
}
