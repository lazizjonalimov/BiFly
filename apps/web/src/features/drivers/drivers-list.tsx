"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { IdCardIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DriverSheet } from "@/features/drivers/driver-sheet";
import { Availability, ComplianceBadge, ExpiryDate } from "@/features/safety/compliance";
import { useListState } from "@/hooks/use-list-state";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";

type Driver = Schema<"DriverRead">;

const FILTERS = { status: "active", driver_type: "", terminal_id: "" };
const dash = <span className="text-muted-foreground">—</span>;

export function DriversList() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const terminals = useTerminals();
  const state = useListState({ defaultSort: "name", filters: FILTERS });
  const [creating, setCreating] = useState(false);
  const wantsNew = search.get("new") === "1";

  const query = useQuery({
    queryKey: [org.id, "drivers", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/drivers", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<Driver, unknown>[] = [
    {
      id: "name",
      header: "Driver",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <Link href={path("drivers", row.original.id)} className="font-medium hover:underline">
            {row.original.full_name}
          </Link>
          {row.original.employee_number ? <p className="text-xs text-muted-foreground">{row.original.employee_number}</p> : null}
        </div>
      ),
    },
    { id: "type", header: "Type", cell: ({ row }) => statusLabel(row.original.driver_type) },
    { id: "terminal", header: "Terminal", cell: ({ row }) => terminals.nameOf(row.original.terminal_id) },
    { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? dash },
    { id: "cdl", header: "CDL", meta: { label: "CDL number" }, cell: ({ row }) => (row.original.cdl_number_masked ? <span className="tabular">{[row.original.cdl_state, row.original.cdl_number_masked].filter(Boolean).join(" ")}</span> : dash) },
    { id: "cdl_expiry", header: "CDL expires", enableSorting: true, cell: ({ row }) => <ExpiryDate date={row.original.cdl_expiry} issues={row.original.compliance.issues} codes={["CDL_"]} /> },
    { id: "medical_cert_expiry", header: "Medical expires", enableSorting: true, cell: ({ row }) => <ExpiryDate date={row.original.medical_cert_expiry} issues={row.original.compliance.issues} codes={["MEDICAL_"]} /> },
    { id: "compliance", header: "Compliance", cell: ({ row }) => <ComplianceBadge compliance={row.original.compliance} /> },
    { id: "availability", header: "Availability", cell: ({ row }) => <Availability status={row.original.status} compliance={row.original.compliance} currentLoad={row.original.current_load} /> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];

  const canManage = can("drivers.manage");
  const newButton = canManage ? (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon /> New driver
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Drivers" description="Who drives for you, and whether each of them is clear to be dispatched." actions={newButton} />
      <DataTable
        label="Drivers"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("drivers", row.id)}
        preferenceKey="drivers"
        searchPlaceholder="Search name, number or phone"
        filters={
          <>
            <FilterSelect
              label="Status"
              value={state.filters.status ?? "active"}
              onChange={(value) => state.setFilter("status", value)}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "terminated", label: "Terminated" },
                { value: "all", label: "All drivers" },
              ]}
            />
            <FilterSelect
              label="Type"
              value={state.filters.driver_type ?? ""}
              onChange={(value) => state.setFilter("driver_type", value)}
              options={[
                { value: "", label: "Any type" },
                { value: "company", label: "Company" },
                { value: "owner_operator", label: "Owner-operator" },
                { value: "contractor", label: "Contractor" },
              ]}
            />
            {terminals.options.length ? <FilterSelect label="Terminal" value={state.filters.terminal_id ?? ""} onChange={(value) => state.setFilter("terminal_id", value)} options={[{ value: "", label: "Any terminal" }, ...terminals.options]} /> : null}
          </>
        }
        empty={{ icon: IdCardIcon, title: "No drivers yet", description: "Add your drivers with their licence and medical card dates. BiFly then keeps expired drivers off loads.", action: newButton ?? undefined }}
      />
      <DriverSheet
        open={creating || (wantsNew && canManage)}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open && wantsNew) router.replace(pathname);
        }}
      />
    </>
  );
}
