"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/states";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentsPanel } from "@/features/documents/documents-panel";
import { UnitSheet, type Unit, type UnitKind } from "@/features/equipment/unit-sheet";
import { RelatedLoads } from "@/features/loads/related-loads";
import { Availability, ComplianceAlert, ComplianceBadge, ExpiryDate } from "@/features/safety/compliance";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatNumber } from "@/lib/format/text";

/** A truck or a trailer: what it is, whether it can roll, its paperwork and the loads it has hauled. */
export function UnitDetail({ kind, id }: { kind: UnitKind; id: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const terminals = useTerminals();
  const [editing, setEditing] = useState(false);
  const resource = kind === "truck" ? "vehicles" : "trailers";
  const noun = kind === "truck" ? "Truck" : "Trailer";
  const query = useQuery<Unit>({
    queryKey: [org.id, resource, "detail", id],
    queryFn: () => (kind === "truck" ? unwrap(api.GET("/api/v1/vehicles/{item_id}", { params: { path: { item_id: id } } })) : unwrap(api.GET("/api/v1/trailers/{item_id}", { params: { path: { item_id: id } } }))),
  });
  const unit = query.data;
  useBreadcrumbLabel(unit ? `${noun} ${unit.unit_number}` : null);

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label={`Loading ${noun.toLowerCase()}`}>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !unit) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const truck = "odometer" in unit ? unit : null;
  const trailer = "type" in unit ? unit : null;
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {noun} {unit.unit_number} <StatusBadge status={unit.status} /> <ComplianceBadge compliance={unit.compliance} />
          </span>
        }
        description={[trailer ? statusLabel(trailer.type) : null, [unit.year, unit.make, truck?.model].filter(Boolean).join(" ") || null, unit.terminal_id ? terminals.nameOf(unit.terminal_id) : null].filter(Boolean).join(" · ")}
        actions={
          can("equipment.manage") ? (
            <Button onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
          ) : null
        }
      />
      <ComplianceAlert compliance={unit.compliance} subject={`${noun} ${unit.unit_number}`} />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {can("documents.read") ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
          {can("loads.read") ? <TabsTrigger value="loads">Loads</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent>
              <DescriptionList>
                <Detail label="Availability">
                  <Availability status={unit.status} compliance={unit.compliance} currentLoad={unit.current_load} />
                  {unit.current_load ? (
                    <Link href={path("loads", unit.current_load.id)} className="ml-2 text-sm text-primary hover:underline">
                      Open load
                    </Link>
                  ) : null}
                </Detail>
                <Detail label="VIN">{unit.vin}</Detail>
                <Detail label="Plate">{unit.plate ? [unit.plate_state, unit.plate].filter(Boolean).join(" ") : null}</Detail>
                <Detail label="Ownership">{statusLabel(unit.ownership)}</Detail>
                {truck ? <Detail label="Odometer">{truck.odometer !== null && truck.odometer !== undefined ? `${formatNumber(truck.odometer)} mi` : null}</Detail> : null}
                {trailer ? <Detail label="Length">{trailer.length_ft ? `${trailer.length_ft} ft` : null}</Detail> : null}
                <Detail label="Insurance expires">{unit.insurance_expiry ? <ExpiryDate date={unit.insurance_expiry} issues={unit.compliance.issues} codes={["INSURANCE_"]} /> : null}</Detail>
                <Detail label="Registration expires">{unit.registration_expiry ? <ExpiryDate date={unit.registration_expiry} issues={unit.compliance.issues} codes={["REGISTRATION_"]} /> : null}</Detail>
                <Detail label="Inspection expires">{unit.inspection_expiry ? <ExpiryDate date={unit.inspection_expiry} issues={unit.compliance.issues} codes={["INSPECTION_"]} /> : null}</Detail>
                <Detail label="Added">{formatDate(unit.created_at.slice(0, 10))}</Detail>
                <Detail label="Notes" className="sm:col-span-2 lg:col-span-3">
                  {unit.notes ? <span className="whitespace-pre-wrap">{unit.notes}</span> : null}
                </Detail>
              </DescriptionList>
            </CardContent>
          </Card>
        </TabsContent>
        {can("documents.read") ? (
          <TabsContent value="documents">
            <Card>
              <DocumentsPanel entityType={kind === "truck" ? "vehicle" : "trailer"} entityId={unit.id} types={["insurance", "registration", "inspection", "maintenance", "other"]} emptyHint="Keep the insurance card, registration and inspection reports here, with their expiry dates." />
            </Card>
          </TabsContent>
        ) : null}
        {can("loads.read") ? (
          <TabsContent value="loads">
            <Card>
              <RelatedLoads filter={kind === "truck" ? { vehicle_id: unit.id } : { trailer_id: unit.id }} emptyText={`This ${noun.toLowerCase()} hasn't hauled a load yet.`} />
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
      {editing ? <UnitSheet kind={kind} open unit={unit} onOpenChange={setEditing} /> : null}
    </>
  );
}
