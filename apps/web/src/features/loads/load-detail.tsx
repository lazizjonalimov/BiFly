"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, ReceiptIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
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
import { invalidateFinance } from "@/features/finance/lib";
import { ActivityPanel } from "@/features/loads/activity-panel";
import { FreightPanel } from "@/features/loads/charges-panel";
import { Risks } from "@/features/loads/columns";
import { LoadActions } from "@/features/loads/load-actions";
import { LoadEditSheet } from "@/features/loads/load-edit-sheet";
import { route, type LoadDetail } from "@/features/loads/lib";
import { RoutePanel } from "@/features/loads/route-panel";
import { loadKey, useLoad } from "@/features/loads/use-load";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber, humanize } from "@/lib/format/text";

function AssignmentCard({ load }: { load: LoadDetail }) {
  const org = useOrg();
  const path = useWorkspacePath();
  const can = useCan();
  const a = load.assignment;
  const history = load.assignments.filter((x) => x.id !== a?.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Driver and equipment</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {a ? (
          <div className="grid gap-1">
            <p>
              {can("drivers.read") ? (
                <Link href={path("drivers", a.driver.id)} className="font-medium hover:underline">
                  {a.driver.name}
                </Link>
              ) : (
                <span className="font-medium">{a.driver.name}</span>
              )}
            </p>
            <p className="text-muted-foreground">
              Truck {a.vehicle.name}
              {a.trailer ? ` · Trailer ${a.trailer.name}` : ""}
            </p>
            {a.status === "completed" ? <p className="text-xs text-muted-foreground">Delivered; the driver and equipment are free again.</p> : null}
          </div>
        ) : (
          <p className="text-muted-foreground">{load.status === "planned" ? "Nobody assigned yet." : "Not assigned."}</p>
        )}
        {history.length ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Earlier assignments ({history.length})</summary>
            <ul className="mt-2 grid gap-2">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="text-foreground">{h.driver.name}</span>, truck {h.vehicle.name}
                  {h.trailer ? `, trailer ${h.trailer.name}` : ""}
                  <br />
                  {formatDateTime(h.assigned_at, org.timezone)}
                  {h.assigned_by_name ? ` by ${h.assigned_by_name}` : ""}
                  {h.release_reason ? ` · ended: ${h.release_reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MoneyCard({ load }: { load: LoadDetail }) {
  const path = useWorkspacePath();
  const can = useCan();
  if (load.revenue === null || load.revenue === undefined) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Money</CardTitle>
        <StatusBadge status={load.billing_status} />
      </CardHeader>
      <CardContent className="grid gap-1.5 text-sm">
        <p className="flex justify-between">
          <span className="text-muted-foreground">Line haul</span> <span className="tabular">{formatMoney(load.customer_rate, load.currency)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-muted-foreground">Billable charges</span> <span className="tabular">{formatMoney(load.charges_total, load.currency)}</span>
        </p>
        <p className="flex justify-between border-t pt-1.5 font-semibold">
          <span>Revenue</span> <span className="tabular">{formatMoney(load.revenue, load.currency)}</span>
        </p>
        {load.invoice ? (
          <p className="mt-1 text-muted-foreground">
            On invoice{" "}
            {can("invoices.read") ? (
              <Link href={path("finance", "invoices", load.invoice.id)} className="font-medium text-foreground hover:underline">
                {load.invoice.invoice_number ?? "draft"}
              </Link>
            ) : (
              (load.invoice.invoice_number ?? "draft")
            )}{" "}
            ({humanize(load.invoice.status)})
          </p>
        ) : null}
        {!load.invoice && load.status === "completed" && load.billing_status === "unbilled" && can("invoices.create") ? <InvoiceThisLoad load={load} /> : null}
      </CardContent>
    </Card>
  );
}

/** A completed load not on any invoice: start a draft for it in one step. */
function InvoiceThisLoad({ load }: { load: LoadDetail }) {
  const org = useOrg();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/invoices", { body: { customer_id: load.customer.id, load_ids: [load.id] } })),
    onSuccess: (invoice) => {
      invalidateFinance(queryClient, org.id);
      toast.success("Draft invoice created");
      router.push(path("finance", "invoices", invoice.id));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Button size="sm" className="mt-2 w-fit" onClick={() => create.mutate()} disabled={create.isPending}>
      <ReceiptIcon /> Invoice this load
    </Button>
  );
}

export function LoadDetailPage({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const terminals = useTerminals();
  const query = useLoad(id);
  const [editing, setEditing] = useState(false);
  const load = query.data;
  useBreadcrumbLabel(load?.load_number);

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading load">
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (query.isError || !load) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const { from, to } = route(load);
  const showRates = can("loads.rates.read");
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {load.load_number} <StatusBadge status={load.status} />
            {load.status === "on_hold" && load.held_from_status ? <span className="text-sm font-normal text-muted-foreground">(was {humanize(load.held_from_status)})</span> : null}
            <Risks risks={load.risks} />
          </span>
        }
        description={
          <span>
            {can("customers.read") ? (
              <Link href={path("customers", load.customer.id)} className="hover:underline">
                {load.customer.name}
              </Link>
            ) : (
              load.customer.name
            )}{" "}
            · {from} to {to}
            {load.reference ? ` · Ref ${load.reference}` : ""}
          </span>
        }
        actions={
          <>
            {load.editable.details ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
            ) : null}
            <LoadActions load={load} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs defaultValue="route">
            <TabsList>
              <TabsTrigger value="route">Route</TabsTrigger>
              <TabsTrigger value="freight">{showRates ? "Freight and charges" : "Freight"}</TabsTrigger>
              {can("documents.read") ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
              <TabsTrigger value="activity">
                Activity <Badge>{load.events.length + load.notes.length + load.tracking.length}</Badge>
              </TabsTrigger>
            </TabsList>
            <Card className="mt-1">
              <TabsContent value="route">
                <RoutePanel load={load} />
              </TabsContent>
              <TabsContent value="freight">
                <FreightPanel load={load} showRates={showRates} />
              </TabsContent>
              {can("documents.read") ? (
                <TabsContent value="documents">
                  <DocumentsPanel
                    entityType="load"
                    entityId={load.id}
                    types={["pod", "bol", "rate_confirmation", "receipt", "other"]}
                    emptyHint="Upload the rate confirmation, the signed BOL and the proof of delivery."
                    onUploaded={(doc) => {
                      // A proof of delivery moves a delivered load into review: show the new state.
                      if (doc.type === "pod") void queryClient.invalidateQueries({ queryKey: loadKey(org.id, load.id) });
                    }}
                  />
                </TabsContent>
              ) : null}
              <TabsContent value="activity">
                <ActivityPanel load={load} />
              </TabsContent>
            </Card>
          </Tabs>
        </div>

        <div className="grid content-start gap-4">
          <AssignmentCard load={load} />
          <MoneyCard load={load} />
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList className="sm:grid-cols-2 lg:grid-cols-2">
                <Detail label="Equipment">{humanize(load.equipment_type)}</Detail>
                <Detail label="Commodity">{load.commodity}</Detail>
                <Detail label="Weight">{load.weight_lbs ? `${formatNumber(load.weight_lbs)} lb` : null}</Detail>
                <Detail label="Miles">{load.miles ? formatNumber(load.miles) : null}</Detail>
                <Detail label="BOL">{load.bol_number}</Detail>
                <Detail label="Terminal">{load.terminal_id ? terminals.nameOf(load.terminal_id) : null}</Detail>
                <Detail label="Booked">{formatDateTime(load.created_at, org.timezone)}</Detail>
                <Detail label="Delivered">{load.delivered_at ? formatDateTime(load.delivered_at, org.timezone) : null}</Detail>
                <Detail label="Instructions" className="sm:col-span-2">
                  {load.instructions ? <span className="whitespace-pre-wrap">{load.instructions}</span> : null}
                </Detail>
              </DescriptionList>
            </CardContent>
          </Card>
        </div>
      </div>
      {editing ? <LoadEditSheet load={load} onOpenChange={setEditing} /> : null}
    </>
  );
}
