"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, FormSection, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { INSPECTION_KINDS, RESULTS, SEVERITIES, invalidateMaintenance } from "@/features/maintenance/lib";
import { DriverPicker, UnitPicker, type UnitType } from "@/features/maintenance/pickers";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { todayIn } from "@/lib/format/dates";
import { intOrNull, optionalText, wholeNumber } from "@/lib/validation";

const defect = z.object({ item: z.string().trim().max(120, "Keep this under 120 characters"), severity: z.enum(["minor", "major", "out_of_service"]), description: optionalText(500) });

// The same rules the API applies, checked here first so they are explained beside the right field.
const schema = z
  .object({
    unit_id: z.string().min(1, "Choose the truck or trailer"),
    kind: z.enum(["pre_trip", "post_trip", "annual", "roadside", "other"]),
    inspected_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
    result: z.enum(["pass", "defects", "out_of_service"]),
    driver_id: z.string(),
    odometer: wholeNumber({ max: 5_000_000, label: "the odometer reading" }),
    location: optionalText(160),
    inspector: optionalText(160),
    report_number: optionalText(80),
    notes: optionalText(4000),
    defects: z.array(defect).max(50),
  })
  .superRefine((v, ctx) => {
    if (v.result === "pass") return; // a pass has no defects: any listed are not sent
    if (!v.defects.length) ctx.addIssue({ code: "custom", path: ["defects"], message: "List what the inspection found" });
    v.defects.forEach((d, i) => {
      if (!d.item.trim()) ctx.addIssue({ code: "custom", path: ["defects", i, "item"], message: "Say what was found" });
    });
    if (v.defects.some((d) => d.severity === "out_of_service") && v.result !== "out_of_service") {
      ctx.addIssue({ code: "custom", path: ["result"], message: "An out-of-service defect puts the unit out of service: choose that result" });
    }
  });
type Values = z.infer<typeof schema>;

/** Record an inspection of a truck or a trailer, and what it found. */
export function InspectionSheet({ open, onOpenChange, unit }: { open: boolean; onOpenChange: (open: boolean) => void; unit?: { type: UnitType; id: string } }) {
  const org = useOrg();
  const router = useRouter();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const [unitType, setUnitType] = useState<UnitType>(unit?.type ?? "vehicle");
  const initial: Values = { unit_id: unit?.id ?? "", kind: "pre_trip", inspected_on: todayIn(org.timezone), result: "pass", driver_id: "", odometer: "", location: "", inspector: "", report_number: "", notes: "", defects: [] };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const defects = useFieldArray({ control: form.control, name: "defects" });
  const result = useWatch({ control: form.control, name: "result" });
  const [formError, setFormError] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body: Schema<"InspectionCreate"> = {
        vehicle_id: unitType === "vehicle" ? v.unit_id : null,
        trailer_id: unitType === "trailer" ? v.unit_id : null,
        driver_id: v.driver_id || null,
        kind: v.kind,
        inspected_on: v.inspected_on,
        result: v.result,
        odometer: unitType === "vehicle" ? intOrNull(v.odometer) : null,
        location: v.location.trim() || null,
        inspector: v.inspector.trim() || null,
        report_number: v.report_number.trim() || null,
        notes: v.notes.trim() || null,
        defects: v.result === "pass" ? [] : v.defects.map((d) => ({ item: d.item.trim(), severity: d.severity, description: d.description.trim() || null })),
      };
      return unwrap(api.POST("/api/v1/maintenance/inspections", { body, params: { header: { "idempotency-key": key } } }));
    },
    onSuccess: (saved) => {
      invalidateMaintenance(queryClient, org.id);
      form.reset(initial);
      onOpenChange(false);
      toast.success(saved.result === "out_of_service" ? `Inspection recorded. ${saved.unit.name} is out of service.` : "Inspection recorded");
      router.push(path("maintenance", "inspections", saved.id));
    },
    onError: (error) => setFormError(applyApiErrors(form, error, { vehicle_id: "unit_id", trailer_id: "unit_id" })),
  });

  const listError = form.formState.errors.defects?.message ?? form.formState.errors.defects?.root?.message;
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(initial);
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title="Record an inspection"
      description="An out-of-service result takes the unit off the road until it is repaired and returned to service."
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel="Record inspection"
    >
      <FormSection title="Inspection">
        <FieldGrid>
          <FormField
            control={form.control}
            name="unit_id"
            render={({ field, fieldState }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>
                  Truck or trailer <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <UnitPicker type={unitType} onTypeChange={setUnitType} value={field.value} onChange={field.onChange} aria-invalid={!!fieldState.error} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SelectField control={form.control} name="kind" label="Inspection type" options={[...INSPECTION_KINDS]} />
          <TextField control={form.control} name="inspected_on" label="Date" type="date" required />
          <SelectField control={form.control} name="result" label="Result" options={[...RESULTS]} />
          <FormField
            control={form.control}
            name="driver_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Driver</FormLabel>
                <FormControl>
                  <DriverPicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {unitType === "vehicle" ? <TextField control={form.control} name="odometer" label="Odometer (miles)" inputMode="numeric" /> : null}
          <TextField control={form.control} name="location" label="Where" placeholder="I-80 MM 112" />
          <TextField control={form.control} name="inspector" label="Inspector" placeholder="Officer, mechanic or driver" />
          <TextField control={form.control} name="report_number" label="Report number" />
          <TextareaField control={form.control} name="notes" label="Notes" rows={2} className="sm:col-span-2" />
        </FieldGrid>
      </FormSection>
      {result !== "pass" ? (
        <FormSection title="What it found" description="Each defect can be turned into a work order. Out-of-service defects keep the unit off the road until they are repaired.">
          <div className="grid gap-3">
            {defects.fields.map((row, index) => (
              <div key={row.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <TextField control={form.control} name={`defects.${index}.item`} label={`Defect ${index + 1}`} required placeholder="Brake chamber" />
                <SelectField control={form.control} name={`defects.${index}.severity`} label="Severity" options={[...SEVERITIES]} />
                <Button type="button" variant="ghost" size="icon-sm" className="self-end" onClick={() => defects.remove(index)} aria-label={`Remove defect ${index + 1}`}>
                  <Trash2Icon />
                </Button>
                <TextField control={form.control} name={`defects.${index}.description`} label="Details" className="sm:col-span-3" />
              </div>
            ))}
            {listError ? (
              <p role="alert" className="text-sm text-destructive">
                {listError}
              </p>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => defects.append({ item: "", severity: result === "out_of_service" ? "out_of_service" : "minor", description: "" })}>
              <PlusIcon /> Add defect
            </Button>
          </div>
        </FormSection>
      ) : null}
    </EntitySheet>
  );
}
