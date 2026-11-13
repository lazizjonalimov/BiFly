"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileCheckIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/states";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DOCUMENT_TYPES } from "@/features/documents/documents-panel";
import { linkPath } from "@/features/documents/documents-center";
import { ReviewDialog } from "@/features/documents/review-dialog";
import { useListState } from "@/hooks/use-list-state";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, relativeDays } from "@/lib/format/dates";
import { formatNumber } from "@/lib/format/text";
import { cn } from "@/lib/utils";

type Expiration = Schema<"Expiration">;
type Document = Schema<"DocumentOut">;

const FILTERS = { state: "", entity_type: "", terminal_id: "", within_days: "30" };
const ENTITY_PATH: Record<string, string> = { driver: "drivers", vehicle: "equipment/trucks", trailer: "equipment/trailers" };

function Tiles({ onPick, current }: { onPick: (state: string, entityType: string) => void; current: { state: string; entity_type: string } }) {
  const org = useOrg();
  const summary = useQuery({ queryKey: [org.id, "safety", "summary"], queryFn: () => unwrap(api.GET("/api/v1/safety/summary")) });
  const s = summary.data;
  const tiles = [
    { label: "Can't be dispatched: drivers", value: s?.drivers_blocked, state: "expired", entity: "driver", danger: true },
    { label: "Can't be dispatched: equipment", value: s?.units_blocked, state: "expired", entity: "equipment", danger: true },
    { label: "Expired", value: s?.expired, state: "expired", entity: "", danger: true },
    { label: "Expiring in 30 days", value: s?.expiring, state: "expiring", entity: "", warn: true },
    { label: "Dates not on file", value: s?.missing, state: "missing", entity: "" },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5" role="group" aria-label="Compliance summary">
      {tiles.map((tile) => {
        const active = current.state === tile.state && current.entity_type === tile.entity;
        return (
          <button key={tile.label} type="button" aria-pressed={active} onClick={() => onPick(tile.state, tile.entity)} className={cn("rounded-lg border bg-card p-3 text-left shadow-xs hover:bg-accent", active && "border-primary bg-primary/5 ring-1 ring-primary")}>
            <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
            {s ? <span className={cn("tabular mt-0.5 block text-xl font-semibold", tile.danger && (tile.value ?? 0) > 0 && "text-destructive", tile.warn && (tile.value ?? 0) > 0 && "text-warning")}>{formatNumber(tile.value ?? 0)}</span> : <Skeleton className="mt-1.5 h-6 w-10" />}
          </button>
        );
      })}
    </div>
  );
}

function ToReview() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const [reviewing, setReviewing] = useState<Document | null>(null);
  const query = useQuery({ queryKey: [org.id, "documents", "list", "to-review"], queryFn: () => unwrap(api.GET("/api/v1/documents", { params: { query: { review_status: "pending", limit: 50, sort: "created_at" } } })) });
  const docs = (query.data?.items ?? []).filter((d) => d.type !== "pod");
  if (!can("documents.read")) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Documents waiting for review</CardTitle>
        {docs.length ? <Badge variant="warning">{docs.length}</Badge> : null}
      </CardHeader>
      {query.isPending ? (
        <div className="grid gap-2 p-5">
          <Skeleton className="h-10" />
        </div>
      ) : docs.length === 0 ? (
        <EmptyState icon={FileCheckIcon} title="Nothing to review" description="Licences, medical cards, insurance and inspection reports appear here when they are uploaded." className="py-8" />
      ) : (
        <ul className="divide-y border-t">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {DOCUMENT_TYPES[doc.type]} ·{" "}
                  {doc.links.map((link) => (
                    <Link key={link.id} href={path(...linkPath(link))} className="text-primary hover:underline">
                      {link.label}
                    </Link>
                  ))}
                </p>
                <p className="text-muted-foreground">
                  {doc.filename}
                  {doc.expires_on ? ` · expires ${formatDate(doc.expires_on)}` : ""}
                  {doc.uploaded_by_name ? ` · from ${doc.uploaded_by_name}` : ""}
                </p>
              </div>
              {can("safety.manage") ? (
                <Button size="sm" variant="outline" onClick={() => setReviewing(doc)}>
                  Review
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {reviewing ? <ReviewDialog document={reviewing} onOpenChange={(open) => !open && setReviewing(null)} /> : null}
    </Card>
  );
}

/**
 * Compliance in one place: what has expired (and so stops a driver or unit from being dispatched), what is
 * about to, which dates are missing, and the paperwork waiting for review.
 */
export function SafetyPage() {
  const org = useOrg();
  const path = useWorkspacePath();
  const terminals = useTerminals();
  const state = useListState({ defaultSort: "expires_on", filters: FILTERS });
  const query = useQuery({
    queryKey: [org.id, "safety", "expirations", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/safety/expirations", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<Expiration, unknown>[] = [
    {
      id: "entity",
      header: "Driver or unit",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={path(ENTITY_PATH[row.original.entity_type] ?? "drivers", row.original.entity_id)} className="font-medium hover:underline">
          {row.original.entity_label}
        </Link>
      ),
    },
    { id: "item", header: "Item", cell: ({ row }) => row.original.item_label },
    {
      id: "expires_on",
      header: "Expires",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.expires_on ? (
          <span className="whitespace-nowrap">
            {formatDate(row.original.expires_on)} <span className="text-muted-foreground">({relativeDays(row.original.days_left)})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No date on file</span>
        ),
    },
    { id: "state", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.state} label={row.original.state === "expiring" ? "Expiring soon" : row.original.state === "missing" ? "Missing" : "Expired"} /> },
    { id: "blocks", header: "Stops dispatch", cell: ({ row }) => (row.original.blocks_dispatch ? (row.original.state === "expired" ? <span className="font-medium text-destructive">Yes, now</span> : "When it expires") : <span className="text-muted-foreground">No</span>) },
    { id: "terminal", header: "Terminal", cell: ({ row }) => terminals.nameOf(row.original.terminal_id) },
  ];

  return (
    <>
      <PageHeader title="Safety and compliance" description="Expired items stop a driver or unit from being assigned. Renew them before they get there." />
      <Tiles current={{ state: state.filters.state ?? "", entity_type: state.filters.entity_type ?? "" }} onPick={(s, entity) => state.setFilters({ state: s, entity_type: entity })} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DataTable
          label="Expirations"
          columns={columns}
          query={query}
          state={state}
          getRowId={(row) => row.id}
          rowHref={(row) => path(ENTITY_PATH[row.entity_type] ?? "drivers", row.entity_id)}
          searchPlaceholder="Search drivers and units"
          filters={
            <>
              <FilterSelect
                label="Status"
                value={state.filters.state ?? ""}
                onChange={(v) => state.setFilter("state", v)}
                options={[
                  { value: "", label: "Expired and expiring" },
                  { value: "expired", label: "Expired" },
                  { value: "expiring", label: "Expiring" },
                  { value: "missing", label: "No date on file" },
                ]}
              />
              <FilterSelect
                label="Who"
                value={state.filters.entity_type ?? ""}
                onChange={(v) => state.setFilter("entity_type", v)}
                options={[
                  { value: "", label: "Drivers and equipment" },
                  { value: "driver", label: "Drivers" },
                  { value: "equipment", label: "Trucks and trailers" },
                  { value: "vehicle", label: "Trucks" },
                  { value: "trailer", label: "Trailers" },
                ]}
              />
              <FilterSelect
                label="Within"
                value={state.filters.within_days ?? "30"}
                onChange={(v) => state.setFilter("within_days", v)}
                options={[
                  { value: "30", label: "Next 30 days" },
                  { value: "60", label: "Next 60 days" },
                  { value: "90", label: "Next 90 days" },
                ]}
              />
              {terminals.options.length ? <FilterSelect label="Terminal" value={state.filters.terminal_id ?? ""} onChange={(v) => state.setFilter("terminal_id", v)} options={[{ value: "", label: "Any terminal" }, ...terminals.options]} /> : null}
            </>
          }
          empty={{ icon: ShieldCheckIcon, title: "All clear", description: "Nothing has expired or is about to." }}
        />
        <ToReview />
      </div>
    </>
  );
}
