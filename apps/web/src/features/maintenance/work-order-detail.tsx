"use client";

import { PencilIcon, PlayIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/states";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentsPanel } from "@/features/documents/documents-panel";
import { CostLines } from "@/features/maintenance/cost-lines";
import { kindLabel, severityLabel, unitPath, useWorkOrder, useWorkOrderMutation, type WorkOrder } from "@/features/maintenance/lib";
import { PriorityBadge, ReturnToService } from "@/features/maintenance/parts";
import { WorkOrderSheet } from "@/features/maintenance/work-order-sheet";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber } from "@/lib/format/text";

type Action = Schema<"WorkOrderTransition">["action"];
const OPEN = new Set(["open", "in_progress"]);

function Actions({ workOrder }: { workOrder: WorkOrder }) {
  const [confirming, setConfirming] = useState<"complete" | "cancel" | null>(null);
  const allowed = new Set(workOrder.allowed_actions);
  const move = useWorkOrderMutation(
    workOrder.id,
    ({ action, notes }: { action: Action; notes?: string }) => unwrap(api.POST("/api/v1/maintenance/work-orders/{work_order_id}/transitions", { params: { path: { work_order_id: workOrder.id } }, body: { action, version: workOrder.version, notes: notes || null } })),
    { success: (wo, { action }) => `${wo.number} ${action === "start" ? "started" : action === "complete" ? "completed" : "cancelled"}`, quiet: true },
  );
  return (
    <>
      {allowed.has("start") ? (
        <Button variant="outline" onClick={() => move.mutate({ action: "start" }, { onError: (error) => toast.error(errorMessage(error)) })} disabled={move.isPending}>
          <PlayIcon /> Start work
        </Button>
      ) : null}
      {allowed.has("complete") ? (
        <Button onClick={() => setConfirming("complete")}>
          <CheckIcon /> Complete
        </Button>
      ) : null}
      {allowed.has("cancel") ? (
        <Button variant="outline" onClick={() => setConfirming("cancel")}>
          <XIcon /> Cancel work order
        </Button>
      ) : null}
      {confirming === "complete" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`Complete ${workOrder.number}?`}
          description={workOrder.out_of_service ? `Costs are then fixed. ${workOrder.unit.name} stays off the road until someone returns it to service.` : "Costs are then fixed."}
          confirmLabel="Complete"
          reason={{ label: "What was done (optional)", placeholder: "Pads and rotors replaced on both axles" }}
          onConfirm={(notes) => move.mutateAsync({ action: "complete", notes })}
        />
      ) : null}
      {confirming === "cancel" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`Cancel ${workOrder.number}?`}
          description="The work order is kept as a record, but nothing more can be added to it."
          confirmLabel="Cancel work order"
          destructive
          reason={{ label: "Why", required: true }}
          onConfirm={(notes) => move.mutateAsync({ action: "cancel", notes })}
        />
      ) : null}
    </>
  );
}

function DetailsCard({ workOrder }: { workOrder: WorkOrder }) {
  const org = useOrg();
  const path = useWorkspacePath();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <DescriptionList className="sm:grid-cols-1 lg:grid-cols-1">
          <Detail label="Unit">
            <Link href={path(...unitPath(workOrder.unit))} className="font-medium hover:underline">
              {workOrder.unit.name}
            </Link>{" "}
            <StatusBadge status={workOrder.unit.status} className="ml-1" />
          </Detail>
          <Detail label="Shop">{workOrder.vendor ?? "Own shop"}</Detail>
          <Detail label="Scheduled for">{workOrder.scheduled_for ? formatDate(workOrder.scheduled_for) : null}</Detail>
          <Detail label="Odometer">{workOrder.odometer !== null && workOrder.odometer !== undefined ? `${formatNumber(workOrder.odometer)} mi` : null}</Detail>
          <Detail label="Opened">
            {formatDateTime(workOrder.created_at, org.timezone)}
            {workOrder.created_by_name ? ` by ${workOrder.created_by_name}` : ""}
          </Detail>
          {workOrder.started_at ? <Detail label="Started">{formatDateTime(workOrder.started_at, org.timezone)}</Detail> : null}
          {workOrder.completed_at ? (
            <Detail label="Completed">
              {formatDateTime(workOrder.completed_at, org.timezone)}
              {workOrder.completed_by_name ? ` by ${workOrder.completed_by_name}` : ""}
            </Detail>
          ) : null}
          {workOrder.resolution ? (
            <Detail label={workOrder.status === "cancelled" ? "Why it was cancelled" : "What was done"}>
              <span className="whitespace-pre-wrap">{workOrder.resolution}</span>
            </Detail>
          ) : null}
          {workOrder.description ? (
            <Detail label="Details">
              <span className="whitespace-pre-wrap">{workOrder.description}</span>
            </Detail>
          ) : null}
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

export function WorkOrderDetail({ id }: { id: string }) {
  const can = useCan();
  const path = useWorkspacePath();
  const query = useWorkOrder(id);
  const [editing, setEditing] = useState(false);
  const workOrder = query.data;
  useBreadcrumbLabel(workOrder?.number);

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading work order">
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (query.isError || !workOrder) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const isOpen = OPEN.has(workOrder.status);
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {workOrder.number} <StatusBadge status={workOrder.status} /> <PriorityBadge priority={workOrder.priority} />
            {workOrder.out_of_service && isOpen ? <Badge variant="danger">Keeps the unit off the road</Badge> : null}
          </span>
        }
        description={
          <span>
            {workOrder.title} ·{" "}
            <Link href={path(...unitPath(workOrder.unit))} className="hover:underline">
              {workOrder.unit.name}
            </Link>
          </span>
        }
        actions={
          <>
            {workOrder.editable ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
            ) : null}
            <Actions workOrder={workOrder} />
            {!isOpen ? <ReturnToService unit={workOrder.unit} /> : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs defaultValue="costs">
            <TabsList>
              <TabsTrigger value="costs">
                Costs <span className="tabular ml-1 text-muted-foreground">{formatMoney(workOrder.total_cost, workOrder.currency)}</span>
              </TabsTrigger>
              {can("documents.read") ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="costs">
              <Card>
                <CostLines workOrder={workOrder} />
              </Card>
            </TabsContent>
            {can("documents.read") ? (
              <TabsContent value="documents">
                <Card>
                  <DocumentsPanel entityType="work_order" entityId={workOrder.id} types={["maintenance", "receipt", "inspection", "other"]} emptyHint="Keep the shop's invoice, receipts for parts and photos of the repair here." />
                </Card>
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
        <div className="grid content-start gap-4">
          <DetailsCard workOrder={workOrder} />
          {workOrder.defects.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Found by inspection</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {workOrder.defects.map((d) => (
                    <li key={`${d.inspection_id}-${d.item}`}>
                      <span className="font-medium">{d.item}</span> <Badge variant={d.severity === "out_of_service" ? "danger" : d.severity === "major" ? "warning" : "neutral"}>{severityLabel(d.severity)}</Badge>
                      <span className="block text-muted-foreground">
                        <Link href={path("maintenance", "inspections", d.inspection_id)} className="hover:underline">
                          {kindLabel(d.inspection_kind)} inspection, {formatDate(d.inspected_on)}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      {editing ? <WorkOrderSheet open workOrder={workOrder} onOpenChange={setEditing} /> : null}
    </>
  );
}
