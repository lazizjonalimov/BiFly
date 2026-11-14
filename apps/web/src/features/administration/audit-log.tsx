"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollTextIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format/dates";

type Entry = Schema<"AuditOut">;

const FILTERS = { entity_type: "" };

/** What each kind of record is called, and where its page is, for linking an entry to what it changed. */
const RECORDS: Record<string, { label: string; path?: (id: string) => string[] }> = {
  load: { label: "Load", path: (id) => ["loads", id] },
  customer: { label: "Customer", path: (id) => ["customers", id] },
  driver: { label: "Driver", path: (id) => ["drivers", id] },
  vehicle: { label: "Truck", path: (id) => ["equipment/trucks", id] },
  trailer: { label: "Trailer", path: (id) => ["equipment/trailers", id] },
  invoice: { label: "Invoice", path: (id) => ["finance/invoices", id] },
  payment: { label: "Payment", path: (id) => ["finance/payments", id] },
  expense: { label: "Expense", path: (id) => [`finance/expenses?expense=${id}`] },
  settlement: { label: "Settlement", path: (id) => ["finance/settlements", id] },
  work_order: { label: "Work order", path: (id) => ["maintenance", id] },
  inspection: { label: "Inspection", path: (id) => ["maintenance/inspections", id] },
  customer_contact: { label: "Customer contact" },
  customer_address: { label: "Customer address" },
  driver_qualification: { label: "Driver qualification" },
  load_charge: { label: "Load charge" },
  load_item: { label: "Freight line" },
  work_order_line: { label: "Work order cost" },
  document: { label: "Document" },
  assignment: { label: "Assignment" },
  user: { label: "Team member" },
  organization: { label: "Company" },
  terminal: { label: "Terminal" },
  report: { label: "Report" },
};

/** "load.status_changed" -> "Load status changed" */
export function describeAction(action: string): string {
  const text = action.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function EntryDialog({ entry, onOpenChange }: { entry: Entry; onOpenChange: (open: boolean) => void }) {
  const org = useOrg();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{describeAction(entry.action)}</DialogTitle>
          <DialogDescription>
            {formatDateTime(entry.created_at, org.timezone)} by {entry.actor_name ?? "the system"}
          </DialogDescription>
        </DialogHeader>
        <DescriptionList className="sm:grid-cols-2 lg:grid-cols-2">
          <Detail label="Record">{RECORDS[entry.entity_type]?.label ?? entry.entity_type}</Detail>
          <Detail label="Request">{entry.request_id ? <span className="font-mono text-xs">{entry.request_id}</span> : null}</Detail>
        </DescriptionList>
        {entry.data ? (
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(entry.data, null, 2)}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">No details were recorded for this change.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Every change made in the company, newest first: who, what, when, and from which request. */
export function AuditLog() {
  const org = useOrg();
  const path = useWorkspacePath();
  const state = useListState({ defaultSort: "-created_at", filters: FILTERS });
  const [viewing, setViewing] = useState<Entry | null>(null);
  const query = useQuery({
    queryKey: [org.id, "audit-logs", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/audit-logs", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<Entry, unknown>[] = [
    { id: "created_at", header: "When", enableSorting: true, enableHiding: false, cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.created_at, org.timezone)}</span> },
    { id: "actor", header: "Who", cell: ({ row }) => row.original.actor_name ?? <span className="text-muted-foreground">System</span> },
    { id: "action", header: "What", cell: ({ row }) => <span className="font-medium">{describeAction(row.original.action)}</span> },
    {
      id: "record",
      header: "Record",
      cell: ({ row }) => {
        const record = RECORDS[row.original.entity_type];
        const id = row.original.entity_id;
        const label = record?.label ?? row.original.entity_type;
        return record?.path && id ? (
          <Link href={path(...record.path(id))} className="hover:underline" onClick={(e) => e.stopPropagation()}>
            {label}
          </Link>
        ) : (
          label
        );
      },
    },
    { id: "request", header: "Request", cell: ({ row }) => (row.original.request_id ? <span className="font-mono text-xs text-muted-foreground">{row.original.request_id.slice(0, 12)}</span> : null) },
  ];

  return (
    <>
      <PageHeader title="Audit log" description="Every change made in this company, by whom and when. Entries can't be edited or removed." />
      <DataTable
        label="Audit log"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        onRowClick={(row) => setViewing(row)}
        preferenceKey="settings.audit-log"
        searchPlaceholder="Search by action or request id"
        filters={<FilterSelect label="Record" value={state.filters.entity_type ?? ""} onChange={(v) => state.setFilter("entity_type", v)} options={[{ value: "", label: "Any record" }, ...Object.entries(RECORDS).map(([value, r]) => ({ value, label: r.label }))]} />}
        empty={{ icon: ScrollTextIcon, title: "Nothing recorded", description: "Changes appear here as people work." }}
      />
      {viewing ? <EntryDialog entry={viewing} onOpenChange={(open) => !open && setViewing(null)} /> : null}
    </>
  );
}
