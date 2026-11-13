"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { CheckboxField, FieldGrid, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentsPanel } from "@/features/documents/documents-panel";
import { DriverSheet } from "@/features/drivers/driver-sheet";
import { RelatedLoads } from "@/features/loads/related-loads";
import { ComplianceAlert, ComplianceBadge, ExpiryDate } from "@/features/safety/compliance";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { blankToNull, optionalDate, optionalText } from "@/lib/validation";

type Driver = Schema<"DriverRead">;
type Qualification = Schema<"QualificationRead">;

export const QUALIFICATION_LABELS: Record<Qualification["type"], string> = {
  mvr: "Motor vehicle record",
  drug_test: "Drug and alcohol test",
  road_test: "Road test",
  employment_application: "Employment application",
  annual_review: "Annual review",
  hazmat: "Hazmat endorsement",
  twic: "TWIC card",
  training: "Training",
  other: "Other",
};
const QUALIFICATION_TYPES = Object.keys(QUALIFICATION_LABELS) as Qualification["type"][];

const qualificationSchema = z
  .object({
    type: z.enum(QUALIFICATION_TYPES as [Qualification["type"], ...Qualification["type"][]]),
    issued_on: optionalDate,
    expires_on: optionalDate,
    required: z.boolean(),
    reference: optionalText(80),
    notes: optionalText(500),
  })
  .refine((v) => !v.issued_on || !v.expires_on || v.expires_on >= v.issued_on, { path: ["expires_on"], message: "The expiry date can't be before the issue date" });
type QualificationValues = z.infer<typeof qualificationSchema>;
const qualificationDefaults = (q?: Qualification): QualificationValues => ({
  type: q?.type ?? "mvr", issued_on: q?.issued_on ?? "", expires_on: q?.expires_on ?? "", required: q?.required ?? false, reference: q?.reference ?? "", notes: q?.notes ?? "",
});

function QualificationSheet({ driverId, item, open, onOpenChange, onSaved }: { driverId: string; item?: Qualification; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const form = useForm<QualificationValues>({ resolver: zodResolver(qualificationSchema), values: open ? qualificationDefaults(item) : undefined, defaultValues: qualificationDefaults(item) });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (values: QualificationValues) => {
      const body = blankToNull(values) as Schema<"QualificationCreate">;
      return item
        ? unwrap(api.PATCH("/api/v1/drivers/{parent_id}/qualifications/{item_id}", { params: { path: { parent_id: driverId, item_id: item.id } }, body }))
        : unwrap(api.POST("/api/v1/drivers/{parent_id}/qualifications", { params: { path: { parent_id: driverId } }, body }));
    },
    onSuccess: () => {
      toast.success(item ? "Saved" : "Added to the qualification file");
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={item ? `Edit ${QUALIFICATION_LABELS[item.type]}` : "Add to the qualification file"}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={item ? "Save changes" : "Add"}
    >
      <FieldGrid>
        <SelectField control={form.control} name="type" label="What it is" options={QUALIFICATION_TYPES.map((t) => ({ value: t, label: QUALIFICATION_LABELS[t] }))} className="sm:col-span-2" />
        <TextField control={form.control} name="issued_on" label="Issued" type="date" />
        <TextField control={form.control} name="expires_on" label="Expires" type="date" hint="Leave empty if it doesn't expire" />
        <TextField control={form.control} name="reference" label="Reference number" className="sm:col-span-2" />
        <CheckboxField control={form.control} name="required" label="Required to drive" hint="When this expires, the driver can't be assigned to a load until it is renewed." className="sm:col-span-2" />
        <TextareaField control={form.control} name="notes" label="Notes" rows={3} className="sm:col-span-2" />
      </FieldGrid>
    </EntitySheet>
  );
}

const PAY_LABEL: Record<string, (rate: string, currency: string) => string> = {
  per_mile: (rate, currency) => `${formatMoney(Number(rate).toFixed(2), currency)} per mile`,
  percent: (rate) => `${Number(rate)}% of revenue`,
  flat: (rate, currency) => `${formatMoney(Number(rate).toFixed(2), currency)} per load`,
};

export function DriverDetail({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const terminals = useTerminals();
  const [editing, setEditing] = useState(false);
  const [qualification, setQualification] = useState<{ item?: Qualification } | null>(null);
  const [removing, setRemoving] = useState<Qualification | null>(null);

  const query = useQuery({ queryKey: [org.id, "drivers", "detail", id], queryFn: () => unwrap(api.GET("/api/v1/drivers/{item_id}", { params: { path: { item_id: id } } })) });
  const qualifications = useQuery({ queryKey: [org.id, "drivers", "detail", id, "qualifications"], queryFn: () => unwrap(api.GET("/api/v1/drivers/{parent_id}/qualifications", { params: { path: { parent_id: id } } })) });
  const driver: Driver | undefined = query.data;
  useBreadcrumbLabel(driver?.full_name);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [org.id, "drivers"] });

  const remove = useMutation({
    mutationFn: (item: Qualification) => unwrap(api.DELETE("/api/v1/drivers/{parent_id}/qualifications/{item_id}", { params: { path: { parent_id: id, item_id: item.id } } })),
    onSuccess: () => {
      toast.success("Removed");
      void refresh();
    },
  });

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading driver">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !driver) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const canManage = can("drivers.manage");
  const items = qualifications.data ?? [];
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {driver.full_name} <StatusBadge status={driver.status} /> <ComplianceBadge compliance={driver.compliance} />
          </span>
        }
        description={[statusLabel(driver.driver_type), driver.employee_number, driver.current_load ? `On load ${driver.current_load.load_number}` : driver.status === "active" && driver.compliance.status !== "expired" ? "Available" : null].filter(Boolean).join(" · ")}
        actions={
          canManage ? (
            <Button onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
          ) : null
        }
      />
      <ComplianceAlert compliance={driver.compliance} subject={driver.first_name} />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="qualifications">
            Qualification file <Badge>{items.length}</Badge>
          </TabsTrigger>
          {can("documents.read") ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
          {can("loads.read") ? <TabsTrigger value="loads">Loads</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="profile" className="grid gap-4">
          <Card>
            <CardContent>
              <h2 className="mb-4 text-sm font-semibold">Contact and employment</h2>
              <DescriptionList>
                <Detail label="Phone">{driver.phone ? <a href={`tel:${driver.phone}`} className="hover:underline">{driver.phone}</a> : null}</Detail>
                <Detail label="Email">{driver.email ? <a href={`mailto:${driver.email}`} className="hover:underline">{driver.email}</a> : null}</Detail>
                <Detail label="Home terminal">{driver.terminal_id ? terminals.nameOf(driver.terminal_id) : null}</Detail>
                <Detail label="Hired">{driver.hire_date ? formatDate(driver.hire_date) : null}</Detail>
                <Detail label="Sign-in">{driver.user_id ? "Linked: can see and update their own loads" : "Not linked"}</Detail>
                {driver.pay_type && driver.pay_rate ? <Detail label="Pay">{Number(driver.pay_rate) > 0 ? PAY_LABEL[driver.pay_type]?.(driver.pay_rate, org.base_currency) : "Not set"}</Detail> : null}
                <Detail label="Notes" className="sm:col-span-2 lg:col-span-3">
                  {driver.notes ? <span className="whitespace-pre-wrap">{driver.notes}</span> : null}
                </Detail>
              </DescriptionList>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <h2 className="mb-4 text-sm font-semibold">Licence and medical card</h2>
              <DescriptionList>
                <Detail label="CDL number">
                  {driver.cdl_number_masked ? (
                    <span className="tabular">
                      {driver.cdl_number ?? driver.cdl_number_masked}
                      {driver.cdl_number ? null : <span className="ml-2 text-xs text-muted-foreground">Your role sees the last four characters</span>}
                    </span>
                  ) : null}
                </Detail>
                <Detail label="State and class">{[driver.cdl_state, driver.cdl_class ? `Class ${driver.cdl_class}` : null].filter(Boolean).join(" · ")}</Detail>
                <Detail label="CDL expires">{driver.cdl_expiry ? <ExpiryDate date={driver.cdl_expiry} issues={driver.compliance.issues} codes={["CDL_"]} /> : null}</Detail>
                <Detail label="Medical card expires">{driver.medical_cert_expiry ? <ExpiryDate date={driver.medical_cert_expiry} issues={driver.compliance.issues} codes={["MEDICAL_"]} /> : null}</Detail>
              </DescriptionList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qualifications">
          <Card>
            {qualifications.isPending ? (
              <div className="grid gap-2 p-5">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : qualifications.isError ? (
              <ErrorState error={qualifications.error} onRetry={() => qualifications.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={FileCheckIcon}
                title="Nothing in the qualification file yet"
                description="Record the motor vehicle record, drug test, endorsements and reviews, with their expiry dates."
                action={
                  canManage ? (
                    <Button variant="outline" size="sm" onClick={() => setQualification({})}>
                      <PlusIcon /> Add an item
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <ul className="divide-y">
                  {items.map((item) => {
                    // Whether it has expired is the API's call, made on the company's date, not this browser's.
                    const expired = driver.compliance.issues.some((i) => i.code === `QUALIFICATION_${item.type.toUpperCase()}_EXPIRED` && i.expires_on === item.expires_on);
                    return (
                      <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {QUALIFICATION_LABELS[item.type]}
                            {item.required ? <Badge variant="default">Required to drive</Badge> : null}
                            {expired ? <Badge variant="danger">Expired</Badge> : null}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            {item.issued_on ? <span>Issued {formatDate(item.issued_on)}</span> : null}
                            <span>{item.expires_on ? `Expires ${formatDate(item.expires_on)}` : "Doesn't expire"}</span>
                            {item.reference ? <span>Ref {item.reference}</span> : null}
                          </p>
                          {item.notes ? <p className="mt-1 text-sm whitespace-pre-wrap">{item.notes}</p> : null}
                        </div>
                        {canManage ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon-sm" onClick={() => setQualification({ item })} aria-label={`Edit ${QUALIFICATION_LABELS[item.type]}`}>
                              <PencilIcon />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(item)} aria-label={`Remove ${QUALIFICATION_LABELS[item.type]}`}>
                              <Trash2Icon />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {canManage ? (
                  <div className="border-t p-3">
                    <Button variant="outline" size="sm" onClick={() => setQualification({})}>
                      <PlusIcon /> Add an item
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </TabsContent>
        {can("documents.read") ? (
          <TabsContent value="documents">
            <Card>
              <DocumentsPanel entityType="driver" entityId={driver.id} types={["license", "medical", "other"]} emptyHint="Keep scans of the licence and medical card here. Safety reviews them; only roles allowed to see licence numbers can open them." />
            </Card>
          </TabsContent>
        ) : null}
        {can("loads.read") ? (
          <TabsContent value="loads">
            <Card>
              <RelatedLoads filter={{ driver_id: driver.id }} emptyText="This driver hasn't been assigned a load yet." />
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <DriverSheet open={editing} onOpenChange={setEditing} driver={driver} />
      <QualificationSheet driverId={id} open={qualification !== null} item={qualification?.item} onOpenChange={(open) => !open && setQualification(null)} onSaved={refresh} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? QUALIFICATION_LABELS[removing.type] : ""}?`}
        description="It is taken out of the driver's qualification file. This can't be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing) : Promise.resolve())}
      />
    </>
  );
}
