"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HandCoinsIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { settlementLabel } from "@/features/settlements/lib";
import { NewSettlementDialog } from "@/features/settlements/new-settlement-dialog";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";

/** One driver's settlements, newest first, with the way to start the next one. */
export function DriverPay({ driverId }: { driverId: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const [cursor, setCursor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: [org.id, "settlements", "list", "driver", driverId, cursor],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/settlements", { params: { query: { driver_id: driverId, sort: "-created_at", limit: 10, count: true, cursor: cursor ?? undefined } }, signal })),
    placeholderData: keepPreviousData,
  });

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <div className="grid gap-2 p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  } else if (query.isError) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else if (!query.data.items.length && !cursor) {
    body = <EmptyState icon={HandCoinsIcon} title="No settlements yet" description="This driver's pay statements will be listed here." />;
  } else {
    const { items, page } = query.data;
    body = (
      <div className="pt-3">
        <Table aria-label="Settlements">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Settlement</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Net pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((st) => (
              <TableRow key={st.id}>
                <TableCell>
                  <Link href={path("finance", "settlements", st.id)} className="font-medium hover:underline">
                    {settlementLabel(st)}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(st.period_start)} to {formatDate(st.period_end)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={st.status} />
                </TableCell>
                <TableCell className="tabular text-right">{formatMoney(st.net_pay, st.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {cursor || page.has_more ? (
          <div className="flex justify-end gap-2 p-3">
            <Button variant="outline" size="sm" onClick={() => setCursor(null)} disabled={!cursor}>
              First page
            </Button>
            <Button variant="outline" size="sm" onClick={() => page.next_cursor && setCursor(page.next_cursor)} disabled={!page.has_more}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {can("settlements.manage") ? (
        <div className="flex justify-end px-5 pt-5">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            New settlement
          </Button>
        </div>
      ) : null}
      {body}
      {creating ? <NewSettlementDialog open driverId={driverId} onOpenChange={(open) => !open && setCreating(false)} /> : null}
    </div>
  );
}
