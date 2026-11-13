"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { RISK_LABEL, RISK_TONE, route, type LoadListItem } from "@/features/loads/lib";
import { formatDateTime } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber, humanize } from "@/lib/format/text";

const dash = <span className="text-muted-foreground">—</span>;

export function RouteCell({ load }: { load: LoadListItem }) {
  const { from, to } = route(load);
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {from} <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" /> {to}
    </span>
  );
}

export function Risks({ risks }: { risks: LoadListItem["risks"] }) {
  if (!risks.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {risks.map((risk) => (
        <Badge key={risk.code} variant={RISK_TONE[risk.code] ?? "warning"} title={risk.message}>
          {RISK_LABEL[risk.code] ?? risk.message}
        </Badge>
      ))}
    </span>
  );
}

/**
 * The columns a load list can show. Sortable ones use the API's sort keys as their ids, so a header click
 * becomes a database sort over every load, not a reshuffle of the page on screen.
 */
export function loadColumns({ href, timezone, showRates, onAssign }: { href: (load: LoadListItem) => string; timezone: string; showRates: boolean; onAssign?: (load: LoadListItem) => void }): ColumnDef<LoadListItem, unknown>[] {
  return [
    {
      id: "created_at",
      header: "Load",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <Link href={href(row.original)} className="font-medium hover:underline">
            {row.original.load_number}
          </Link>
          {row.original.reference ? <p className="text-xs text-muted-foreground">{row.original.reference}</p> : null}
        </div>
      ),
    },
    { id: "status", header: "Status", enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "customer", header: "Customer", enableSorting: true, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.customer.name}</span> },
    { id: "route", header: "Route", cell: ({ row }) => <RouteCell load={row.original} /> },
    { id: "pickup_at", header: "Pickup", enableSorting: true, cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.pickup_at, timezone)}</span> },
    { id: "delivery_at", header: "Delivery", enableSorting: true, cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.delivery_at, timezone)}</span> },
    {
      id: "assignment",
      header: "Driver and truck",
      cell: ({ row }) => {
        const a = row.original.assignment;
        if (a) {
          return (
            <div className="whitespace-nowrap">
              <p>{a.driver.name}</p>
              <p className="text-xs text-muted-foreground">
                Truck {a.vehicle.name}
                {a.trailer ? ` · Trailer ${a.trailer.name}` : ""}
              </p>
            </div>
          );
        }
        if (onAssign && row.original.status === "planned") {
          return (
            <button type="button" onClick={() => onAssign(row.original)} className="text-sm font-medium text-primary hover:underline">
              Assign
            </button>
          );
        }
        return dash;
      },
    },
    { id: "equipment", header: "Equipment", cell: ({ row }) => humanize(row.original.equipment_type) },
    { id: "miles", header: "Miles", meta: { align: "right" }, cell: ({ row }) => (row.original.miles !== null && row.original.miles !== undefined ? formatNumber(row.original.miles) : dash) },
    ...(showRates ? ([{ id: "revenue", header: "Revenue", enableSorting: true, meta: { align: "right" }, cell: ({ row }) => formatMoney(row.original.revenue, row.original.currency) }] satisfies ColumnDef<LoadListItem, unknown>[]) : []),
    { id: "risks", header: "Attention", cell: ({ row }) => <Risks risks={row.original.risks} /> },
  ];
}
