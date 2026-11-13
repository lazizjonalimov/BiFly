"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PackageIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RouteCell } from "@/features/loads/columns";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";

type Filter = { customer_id?: string; driver_id?: string; vehicle_id?: string; trailer_id?: string };

/** The loads of one customer, driver or unit, newest first, with a link to see them all in the loads list. */
export function RelatedLoads({ filter, emptyText }: { filter: Filter; emptyText: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const [cursor, setCursor] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [org.id, "loads", "list", "related", filter, cursor],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/loads", { params: { query: { ...filter, sort: "-created_at", limit: 10, count: true, cursor: cursor ?? undefined } }, signal })),
    placeholderData: keepPreviousData,
    enabled: can("loads.read"),
  });
  if (!can("loads.read")) return null;
  if (query.isPending) {
    return (
      <div className="grid gap-2 p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { items, page } = query.data;
  if (!items.length && !cursor) return <EmptyState icon={PackageIcon} title="No loads yet" description={emptyText} />;
  const rates = can("loads.rates.read");
  const search = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  return (
    <div>
      <Table aria-label="Loads">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Load</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Route</TableHead>
            <TableHead>Pickup</TableHead>
            {rates ? <TableHead className="text-right">Revenue</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((load) => (
            <TableRow key={load.id}>
              <TableCell>
                <Link href={path("loads", load.id)} className="font-medium hover:underline">
                  {load.load_number}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={load.status} />
              </TableCell>
              <TableCell>
                <RouteCell load={load} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDateTime(load.pickup_at, org.timezone)}</TableCell>
              {rates ? <TableCell className="tabular text-right">{formatMoney(load.revenue, load.currency)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm text-muted-foreground">
        <Link href={`${path("loads")}?${search}`} className="font-medium text-primary hover:underline">
          Open in the loads list{page.total_count ? ` (${page.total_count})` : ""}
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>
            Newest
          </Button>
          <Button variant="outline" size="sm" disabled={!page.has_more || !page.next_cursor} onClick={() => setCursor(page.next_cursor ?? null)}>
            Older
          </Button>
        </div>
      </div>
    </div>
  );
}
