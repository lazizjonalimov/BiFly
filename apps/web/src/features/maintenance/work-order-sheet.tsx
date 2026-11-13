"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { CheckboxField, FieldGrid, FormSection, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CONFLICT_MESSAGE, PRIORITIES, invalidateMaintenance, workOrderKey, type WorkOrder } from "@/features/maintenance/lib";
import { UnitPicker, type UnitType } from "@/features/maintenance/pickers";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { intOrNull, optionalDate, optionalText, requiredText, wholeNumber } from "@/lib/validation";

const schema = z.object({
  unit_id: z.string().min(1, "Choose the truck or trailer"),
  title: requiredText("what needs doing", 160),
  description: optionalText(4000),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  vendor: optionalText(160),
  odometer: wholeNumber({ max: 5_000_000, label: "the odometer reading" }),
  scheduled_for: optionalDate,
  out_of_service: z.boolean(),
});
type Values = z.infer<typeof schema>;

function defaults(wo?: WorkOrder, unit?: { type: UnitType; id: string }): Values {
  return {
    unit_id: wo?.unit.id ?? unit?.id ?? "",
    title: wo?.title ?? "",
    description: wo?.description ?? "",
    priority: (wo?.priority as Values["priority"]) ?? "normal",
    vendor: wo?.vendor ?? "",
    odometer: wo?.odometer !== null && wo?.odometer !== undefined ? String(wo.odometer) : "",
    scheduled_for: wo?.scheduled_for ?? "",
    out_of_service: wo?.out_of_service ?? false,
  };
}

/**
 * Open a work order, or change one that is still open. Taking the unit off the road is a choice made here,
 * not a side effect: only "Keep it off the road" makes the unit unavailable to dispatch.
 */
export function WorkOrderSheet({ open, onOpenChange, workOrder, unit }: { open: boolean; onOpenChange: (open: boolean) => void; workOrder?: WorkOrder; unit?: { type: UnitType; id: string } }) {
  const org = useOrg();
  const router = useRouter();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const [unitType, setUnitType] = useState<UnitType>(workOrder?.unit.type ?? unit?.type ?? "vehicle");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(workOrder, unit) });
  const [formError, setFormError] = useState<string | null>(null);
  // One key per form: a retried submission can't open the same work order twice.
  const [key] = useState(idempotencyKey);

  const save = useMutation({
    mutationFn: (v: Values) => {
      const fields = {
        title: v.title.trim(),
        description: v.description.trim() || null,
        priority: v.priority,
        vendor: v.vendor.trim() || null,
        odometer: intOrNull(v.odometer),
        scheduled_for: v.scheduled_for || null,
        out_of_service: v.out_of_service,
      };
      if (workOrder) {
        return unwrap(api.PATCH("/api/v1/maintenance/work-orders/{work_order_id}", { params: { path: { work_order_id: workOrder.id } }, body: { version: workOrder.version, ...fields } }));
      }
      const body: Schema<"WorkOrderCreate"> = { ...fields, vehicle_id: unitType === "vehicle" ? v.unit_id : null, trailer_id: unitType === "trailer" ? v.unit_id : null };
      return unwrap(api.POST("/api/v1/maintenance/work-orders", { body, params: { header: { "idempotency-key": key } } }));
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(workOrderKey(org.id, saved.id), saved);
      invalidateMaintenance(queryClient, org.id);
      form.reset(defaults(saved));
      onOpenChange(false);
      if (workOrder) {
        toast.success(`${saved.number} saved`);
      } else {
        toast.success(`Work order ${saved.number} opened`);
        router.push(path("maintenance", saved.id));
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        void queryClient.invalidateQueries({ queryKey: workOrderKey(org.id, workOrder!.id) });
        setFormError(CONFLICT_MESSAGE);
        return;
      }
      setFormError(applyApiErrors(form, error, { vehicle_id: "unit_id", trailer_id: "unit_id" }));
    },
  });

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(defaults(workOrder, unit));
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title={workOrder ? `Edit ${workOrder.number}` : "New work order"}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={workOrder ? "Save changes" : "Open work order"}
    >
      <FormSection title="Unit">
        <FormField
          control={form.control}
          name="unit_id"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>
                Truck or trailer <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <UnitPicker type={unitType} onTypeChange={setUnitType} value={field.value} onChange={field.onChange} disabled={!!workOrder} aria-invalid={!!fieldState.error} />
              </FormControl>
              {workOrder ? <p className="text-xs text-muted-foreground">A work order stays with its unit. Cancel it and open another to change the unit.</p> : null}
              <FormMessage />
            </FormItem>
          )}
        />
      </FormSection>
      <FormSection title="The work">
        <FieldGrid>
          <TextField control={form.control} name="title" label="What needs doing" required autoFocus={!workOrder} className="sm:col-span-2" placeholder="Brake service" />
          <SelectField control={form.control} name="priority" label="Priority" options={[...PRIORITIES]} />
          <TextField control={form.control} name="scheduled_for" label="Scheduled for" type="date" />
          <TextField control={form.control} name="vendor" label="Shop or vendor" hint="Leave empty for your own shop" />
          <TextField control={form.control} name="odometer" label="Odometer (miles)" inputMode="numeric" />
          <TextareaField control={form.control} name="description" label="Details" rows={3} className="sm:col-span-2" />
          <CheckboxField control={form.control} name="out_of_service" label="Keep it off the road until this is done" hint="The unit can't be assigned to a load until someone returns it to service." className="sm:col-span-2" />
        </FieldGrid>
      </FormSection>
    </EntitySheet>
  );
}
