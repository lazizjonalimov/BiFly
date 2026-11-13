"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon, PlusIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InspectionSheet } from "@/features/maintenance/inspection-sheet";
import { kindLabel } from "@/features/maintenance/lib";
import { PriorityBadge } from "@/features/maintenance/parts";
import type { UnitType } from "@/features/maintenance/pickers";
import { WorkOrderSheet } from "@/features/maintenance/work-order-sheet";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDay } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/text";

function Loading() {
  return (
    <div className="grid gap-2 p-5">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

/** One truck's or trailer's work orders and inspections, newest first, with the way to add either. */
export function UnitMaintenance({ type, id, noun }: { type: UnitType; id: string; noun: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const [sheet, setSheet] = useState<"work-order" | "inspection" | null>(null);
  const filter = type === "vehicle" ? { vehicle_id: id } : { trailer_id: id };
  const workOrders = useQuery({
    queryKey: [org.id, "maintenance", "work-orders", "list", "unit", id],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/maintenance/work-orders", { params: { query: { ...filter, sort: "-created_at", limit: 10, count: true } }, signal })),
    enabled: can("maintenance.read"),
  });
  const inspections = useQuery({
    queryKey: [org.id, "maintenance", "inspections", "list", "unit", id],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/maintenance/inspections", { params: { query: { ...filter, sort: "-inspected_on", limit: 10, count: true } }, signal })),
    enabled: can("maintenance.read") || can("safety.read"),
  });
  const unit = { type, id };
  const unitParam = type === "vehicle" ? `vehicle_id=${id}` : `trailer_id=${id}`;
  const listHref = (section: "work-orders" | "inspections") => (section === "inspections" ? `${path("maintenance", "inspections")}?${unitParam}` : `${path("maintenance")}?${unitParam}&open=all`);

  return (
    <div className="grid gap-6 p-5">
      {can("maintenance.read") ? (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Work orders</h3>
            <div className="flex items-center gap-2">
              {workOrders.data?.page.has_more ? (
                <Link href={listHref("work-orders")} className="text-sm text-primary hover:underline">
                  All {plural(workOrders.data.page.total_count ?? 0, "work order")}
                </Link>
              ) : null}
              {can("maintenance.manage") ? (
                <Button size="sm" variant="outline" onClick={() => setSheet("work-order")}>
                  <PlusIcon /> New work order
                </Button>
              ) : null}
            </div>
          </div>
          {workOrders.isPending ? (
            <Loading />
          ) : workOrders.isError ? (
            <ErrorState error={workOrders.error} onRetry={() => workOrders.refetch()} />
          ) : workOrders.data.items.length === 0 ? (
            <EmptyState icon={WrenchIcon} title="No work orders" description={`Repairs and services for this ${noun} will be listed here.`} className="py-6" />
          ) : (
            <Table aria-label="Work orders">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Work order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workOrders.data.items.map((wo) => (
                  <TableRow key={wo.id}>
                    <TableCell>
                      <Link href={path("maintenance", wo.id)} className="font-medium hover:underline">
                        {wo.number}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{wo.title}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={wo.status} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={wo.priority} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDay(wo.created_at, org.timezone)}</TableCell>
                    <TableCell className="tabular text-right">{formatMoney(wo.total_cost, wo.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Inspections</h3>
          <div className="flex items-center gap-2">
            {inspections.data?.page.has_more ? (
              <Link href={listHref("inspections")} className="text-sm text-primary hover:underline">
                All {plural(inspections.data.page.total_count ?? 0, "inspection")}
              </Link>
            ) : null}
            {can("safety.manage") || can("maintenance.manage") ? (
              <Button size="sm" variant="outline" onClick={() => setSheet("inspection")}>
                <ClipboardCheckIcon /> Record inspection
              </Button>
            ) : null}
          </div>
        </div>
        {inspections.isPending ? (
          <Loading />
        ) : inspections.isError ? (
          <ErrorState error={inspections.error} onRetry={() => inspections.refetch()} />
        ) : inspections.data.items.length === 0 ? (
          <EmptyState icon={ClipboardCheckIcon} title="No inspections recorded" description="Daily checks, annual and roadside inspections of this unit will be listed here." className="py-6" />
        ) : (
          <Table aria-label="Inspections">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Defects</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.data.items.map((inspection) => (
                <TableRow key={inspection.id}>
                  <TableCell>
                    <Link href={path("maintenance", "inspections", inspection.id)} className="font-medium whitespace-nowrap hover:underline">
                      {formatDate(inspection.inspected_on)}
                    </Link>
                  </TableCell>
                  <TableCell>{kindLabel(inspection.kind)}</TableCell>
                  <TableCell>
                    <StatusBadge status={inspection.result} />
                  </TableCell>
                  <TableCell>{inspection.defects.length ? plural(inspection.defects.length, "defect") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      {sheet === "work-order" ? <WorkOrderSheet open unit={unit} onOpenChange={(open) => !open && setSheet(null)} /> : null}
      {sheet === "inspection" ? <InspectionSheet open unit={unit} onOpenChange={(open) => !open && setSheet(null)} /> : null}
    </div>
  );
}
