"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WrenchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invalidateMaintenance, kindLabel, severityLabel, unitPath, workOrderKey, type Inspection } from "@/features/maintenance/lib";
import { ReturnToService } from "@/features/maintenance/parts";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatNumber } from "@/lib/format/text";

type Defect = Inspection["defects"][number];

function Defects({ inspection }: { inspection: Inspection }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const raise = useMutation({
    mutationFn: (defect: Defect) => unwrap(api.POST("/api/v1/maintenance/inspections/{inspection_id}/defects/{defect_id}/work-order", { params: { path: { inspection_id: inspection.id, defect_id: defect.id } } })),
    onSuccess: (wo) => {
      queryClient.setQueryData(workOrderKey(org.id, wo.id), wo);
      invalidateMaintenance(queryClient, org.id);
      toast.success(`Work order ${wo.number} opened`);
      router.push(path("maintenance", wo.id));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!inspection.defects.length) {
    return <p className="p-5 text-sm text-muted-foreground">Nothing was found. The unit passed.</p>;
  }
  return (
    <Table aria-label="Defects">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Defect</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Repair</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inspection.defects.map((defect) => (
          <TableRow key={defect.id}>
            <TableCell>
              <span className="font-medium">{defect.item}</span>
              {defect.description ? <span className="block text-xs text-muted-foreground">{defect.description}</span> : null}
            </TableCell>
            <TableCell>
              <Badge variant={defect.severity === "out_of_service" ? "danger" : defect.severity === "major" ? "warning" : "neutral"}>{severityLabel(defect.severity)}</Badge>
            </TableCell>
            <TableCell>
              {defect.work_order ? (
                <span className="flex flex-wrap items-center gap-2">
                  {can("maintenance.read") ? (
                    <Link href={path("maintenance", defect.work_order.id)} className="font-medium hover:underline">
                      {defect.work_order.number}
                    </Link>
                  ) : (
                    defect.work_order.number
                  )}
                  <StatusBadge status={defect.work_order.status} />
                </span>
              ) : can("maintenance.manage") ? (
                <Button size="sm" variant="outline" onClick={() => raise.mutate(defect)} disabled={raise.isPending} aria-label={`Open a work order for ${defect.item}`}>
                  <WrenchIcon /> Open work order
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">No work order yet</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function InspectionDetail({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const query = useQuery({
    queryKey: [org.id, "maintenance", "inspections", "detail", id],
    queryFn: () => unwrap(api.GET("/api/v1/maintenance/inspections/{inspection_id}", { params: { path: { inspection_id: id } } })),
  });
  const inspection = query.data;
  useBreadcrumbLabel(inspection ? `${kindLabel(inspection.kind)}, ${formatDate(inspection.inspected_on)}` : null);

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading inspection">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !inspection) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {kindLabel(inspection.kind)} inspection <StatusBadge status={inspection.result} />
          </span>
        }
        description={
          <span>
            <Link href={path(...unitPath(inspection.unit))} className="hover:underline">
              {inspection.unit.name}
            </Link>{" "}
            · {formatDate(inspection.inspected_on)}
          </span>
        }
        actions={<ReturnToService unit={inspection.unit} variant="outline" />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>What it found</CardTitle>
          </CardHeader>
          <Defects inspection={inspection} />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList className="sm:grid-cols-1 lg:grid-cols-1">
              <Detail label="Unit">
                <Link href={path(...unitPath(inspection.unit))} className="font-medium hover:underline">
                  {inspection.unit.name}
                </Link>{" "}
                <StatusBadge status={inspection.unit.status} className="ml-1" />
              </Detail>
              <Detail label="Driver">
                {inspection.driver ? (
                  can("drivers.read") ? (
                    <Link href={path("drivers", inspection.driver.id)} className="hover:underline">
                      {inspection.driver.name}
                    </Link>
                  ) : (
                    inspection.driver.name
                  )
                ) : null}
              </Detail>
              <Detail label="Where">{inspection.location}</Detail>
              <Detail label="Inspector">{inspection.inspector}</Detail>
              <Detail label="Report number">{inspection.report_number}</Detail>
              <Detail label="Odometer">{inspection.odometer !== null && inspection.odometer !== undefined ? `${formatNumber(inspection.odometer)} mi` : null}</Detail>
              <Detail label="Recorded">
                {formatDateTime(inspection.created_at, org.timezone)}
                {inspection.created_by_name ? ` by ${inspection.created_by_name}` : ""}
              </Detail>
              {inspection.notes ? (
                <Detail label="Notes">
                  <span className="whitespace-pre-wrap">{inspection.notes}</span>
                </Detail>
              ) : null}
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
