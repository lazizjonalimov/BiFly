"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DownloadIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPES } from "@/features/documents/documents-panel";
import { ReviewDialog } from "@/features/documents/review-dialog";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatBytes } from "@/lib/format/text";

type Document = Schema<"DocumentOut">;

const FILTERS = { type: "", review_status: "", entity_type: "", expiring: "" };
const ENTITY_LABELS: Record<string, string> = { load: "Loads", driver: "Drivers", vehicle: "Trucks", trailer: "Trailers", customer: "Customers", invoice: "Invoices", work_order: "Work orders" };

export function linkPath(link: Document["links"][number]): string[] {
  switch (link.entity_type) {
    case "load":
      return ["loads", link.entity_id];
    case "driver":
      return ["drivers", link.entity_id];
    case "vehicle":
      return ["equipment/trucks", link.entity_id];
    case "trailer":
      return ["equipment/trailers", link.entity_id];
    case "customer":
      return ["customers", link.entity_id];
    case "work_order":
      return ["maintenance", link.entity_id];
    default:
      return ["finance/invoices", link.entity_id];
  }
}

/** Every document the person's role may see, across loads, drivers, equipment and customers. */
export function DocumentsCenter() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const state = useListState({ defaultSort: "-created_at", filters: FILTERS });
  const [reviewing, setReviewing] = useState<Document | null>(null);
  const query = useQuery({
    queryKey: [org.id, "documents", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/documents", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });
  const reviewer = can("safety.manage");

  const columns: ColumnDef<Document, unknown>[] = [
    {
      id: "filename",
      header: "Document",
      enableHiding: false,
      cell: ({ row }) => (
        <a href={`/api/v1/documents/${row.original.id}/download?disposition=inline`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {row.original.filename}
        </a>
      ),
    },
    { id: "type", header: "Type", cell: ({ row }) => DOCUMENT_TYPES[row.original.type] ?? row.original.type },
    {
      id: "links",
      header: "Attached to",
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-x-2">
          {row.original.links.map((link) => (
            <Link key={link.id} href={path(...linkPath(link))} className="text-primary hover:underline">
              {link.label ?? link.entity_type}
            </Link>
          ))}
        </span>
      ),
    },
    {
      id: "review",
      header: "Review",
      cell: ({ row }) => {
        const doc = row.original;
        if (doc.review_status === "not_required") return <span className="text-muted-foreground">Not needed</span>;
        const badge = <StatusBadge status={doc.review_status} label={doc.review_status === "pending" ? "Waiting" : undefined} />;
        if (!reviewer || doc.type === "pod") return badge;
        return (
          <button type="button" onClick={() => setReviewing(doc)} className="rounded-full" aria-label={`Review ${doc.filename}`}>
            {badge}
          </button>
        );
      },
    },
    { id: "expires_on", header: "Expires", cell: ({ row }) => (row.original.expires_on ? formatDate(row.original.expires_on) : <span className="text-muted-foreground">—</span>) },
    { id: "created_at", header: "Added", enableSorting: true, cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.created_at, org.timezone)}{row.original.uploaded_by_name ? ` · ${row.original.uploaded_by_name}` : ""}</span> },
    { id: "size", header: "Size", meta: { align: "right" }, cell: ({ row }) => formatBytes(row.original.size_bytes) },
    {
      id: "download",
      header: () => <span className="sr-only">Download</span>,
      enableHiding: false,
      cell: ({ row }) => (
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={`/api/v1/documents/${row.original.id}/download`} aria-label={`Download ${row.original.filename}`}>
            <DownloadIcon />
          </a>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Documents" description="Paperwork across loads, drivers, equipment and customers. Every download is checked and logged." />
      <DataTable
        label="Documents"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        preferenceKey="documents"
        searchPlaceholder="Search file names"
        filters={
          <>
            <FilterSelect label="Type" value={state.filters.type ?? ""} onChange={(v) => state.setFilter("type", v)} options={[{ value: "", label: "Any type" }, ...Object.entries(DOCUMENT_TYPES).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect
              label="Review"
              value={state.filters.review_status ?? ""}
              onChange={(v) => state.setFilter("review_status", v)}
              options={[
                { value: "", label: "Any review" },
                { value: "pending", label: "Waiting for review" },
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Sent back" },
                { value: "not_required", label: "No review needed" },
              ]}
            />
            <FilterSelect label="Attached to" value={state.filters.entity_type ?? ""} onChange={(v) => state.setFilter("entity_type", v)} options={[{ value: "", label: "Anything" }, ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect
              label="Expiry"
              value={state.filters.expiring ?? ""}
              onChange={(v) => state.setFilter("expiring", v)}
              options={[
                { value: "", label: "Any expiry" },
                { value: "true", label: "Expired or expiring soon" },
              ]}
            />
          </>
        }
        empty={{ icon: FileTextIcon, title: "No documents yet", description: "Upload documents from a load, a driver, a truck or a customer, and they appear here." }}
      />
      {reviewing ? <ReviewDialog document={reviewing} onOpenChange={(open) => !open && setReviewing(null)} /> : null}
    </>
  );
}
