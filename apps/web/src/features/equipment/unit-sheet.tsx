"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, FormSection, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";
import { blankToNull, intOrNull, optionalDate, optionalState, optionalText, requiredText, wholeNumber } from "@/lib/validation";

export type UnitKind = "truck" | "trailer";
type Truck = Schema<"VehicleRead">;
type Trailer = Schema<"TrailerRead">;
export type Unit = Truck | Trailer;

export const EQUIPMENT_TYPES = [
  { value: "dry_van", label: "Dry van" },
  { value: "reefer", label: "Reefer" },
  { value: "flatbed", label: "Flatbed" },
  { value: "step_deck", label: "Step deck" },
  { value: "box_truck", label: "Box truck" },
  { value: "tanker", label: "Tanker" },
  { value: "other", label: "Other" },
];
export const UNIT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "in_maintenance", label: "In the shop" },
  { value: "out_of_service", label: "Out of service" },
  { value: "retired", label: "Retired" },
];
export const OWNERSHIP = [
  { value: "owned", label: "Owned" },
  { value: "leased", label: "Leased" },
  { value: "owner_operator", label: "Owner-operator's" },
];

const schema = z.object({
  unit_number: requiredText("the unit number", 40),
  vin: optionalText(25),
  plate: optionalText(20),
  plate_state: optionalState,
  make: optionalText(60),
  model: optionalText(60),
  year: wholeNumber({ min: 1950, max: 2100, label: "a year" }),
  type: z.string(),
  length_ft: wholeNumber({ min: 1, max: 100, label: "a length in feet" }),
  odometer: wholeNumber({ max: 5_000_000, label: "the odometer reading" }),
  ownership: z.enum(["owned", "leased", "owner_operator"]),
  terminal_id: z.string(),
  insurance_expiry: optionalDate,
  registration_expiry: optionalDate,
  inspection_expiry: optionalDate,
  status: z.enum(["active", "in_maintenance", "out_of_service", "retired"]),
  notes: optionalText(4000),
});
type Values = z.infer<typeof schema>;

function defaults(unit?: Unit): Values {
  const truck = unit && "odometer" in unit ? unit : undefined;
  const trailer = unit && "type" in unit ? unit : undefined;
  return {
    unit_number: unit?.unit_number ?? "",
    vin: unit?.vin ?? "",
    plate: unit?.plate ?? "",
    plate_state: unit?.plate_state ?? "",
    make: unit?.make ?? "",
    model: truck?.model ?? "",
    year: unit?.year ? String(unit.year) : "",
    type: trailer?.type ?? "dry_van",
    length_ft: trailer?.length_ft ? String(trailer.length_ft) : "",
    odometer: truck?.odometer !== null && truck?.odometer !== undefined ? String(truck.odometer) : "",
    ownership: (unit?.ownership as Values["ownership"]) ?? "owned",
    terminal_id: unit?.terminal_id ?? "",
    insurance_expiry: unit?.insurance_expiry ?? "",
    registration_expiry: unit?.registration_expiry ?? "",
    inspection_expiry: unit?.inspection_expiry ?? "",
    status: (unit?.status as Values["status"]) ?? "active",
    notes: unit?.notes ?? "",
  };
}

/** Create or edit a truck or a trailer. The two share almost everything, so they share this form. */
export function UnitSheet({ kind, open, onOpenChange, unit }: { kind: UnitKind; open: boolean; onOpenChange: (open: boolean) => void; unit?: Unit }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const terminals = useTerminals();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: open ? defaults(unit) : undefined, defaultValues: defaults(unit) });
  const [formError, setFormError] = useState<string | null>(null);
  const noun = kind === "truck" ? "truck" : "trailer";

  const save = useMutation({
    mutationFn: (values: Values) => {
      const { model, odometer, type, length_ft, year, ...shared } = values;
      const common = {
        ...blankToNull(shared),
        unit_number: values.unit_number.trim(),
        ownership: values.ownership,
        status: values.status,
        plate_state: values.plate_state.trim().toUpperCase() || null,
        year: intOrNull(year),
      };
      if (kind === "truck") {
        const body = { ...common, model: model.trim() || null, odometer: intOrNull(odometer) };
        return unit
          ? unwrap(api.PATCH("/api/v1/vehicles/{item_id}", { params: { path: { item_id: unit.id } }, body }))
          : unwrap(api.POST("/api/v1/vehicles", { body }));
      }
      const body = { ...common, type: type as Schema<"TrailerCreate">["type"], length_ft: intOrNull(length_ft) };
      return unit
        ? unwrap(api.PATCH("/api/v1/trailers/{item_id}", { params: { path: { item_id: unit.id } }, body }))
        : unwrap(api.POST("/api/v1/trailers", { body }));
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: [org.id, kind === "truck" ? "vehicles" : "trailers"] });
      toast.success(unit ? `${kind === "truck" ? "Truck" : "Trailer"} ${saved.unit_number} saved` : `${kind === "truck" ? "Truck" : "Trailer"} ${saved.unit_number} added`);
      form.reset(defaults(saved));
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(defaults(unit));
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title={unit ? `Edit ${noun} ${unit.unit_number}` : `New ${noun}`}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={unit ? "Save changes" : `Add ${noun}`}
    >
      <FormSection title={kind === "truck" ? "Truck" : "Trailer"}>
        <FieldGrid>
          <TextField control={form.control} name="unit_number" label="Unit number" required autoFocus hint="What your team calls it" />
          {kind === "trailer" ? <SelectField control={form.control} name="type" label="Type" options={EQUIPMENT_TYPES} /> : <TextField control={form.control} name="year" label="Year" inputMode="numeric" />}
          <TextField control={form.control} name="make" label="Make" />
          {kind === "truck" ? <TextField control={form.control} name="model" label="Model" /> : <TextField control={form.control} name="year" label="Year" inputMode="numeric" />}
          <TextField control={form.control} name="vin" label="VIN" autoComplete="off" />
          <div className="grid grid-cols-[1fr_5rem] gap-4">
            <TextField control={form.control} name="plate" label="Plate" autoComplete="off" />
            <TextField control={form.control} name="plate_state" label="State" maxLength={2} />
          </div>
          {kind === "truck" ? <TextField control={form.control} name="odometer" label="Odometer (miles)" inputMode="numeric" /> : <TextField control={form.control} name="length_ft" label="Length (feet)" inputMode="numeric" />}
          <SelectField control={form.control} name="ownership" label="Ownership" options={OWNERSHIP} />
          {terminals.options.length ? <SelectField control={form.control} name="terminal_id" label="Home terminal" placeholder="None" options={terminals.options} /> : null}
          {unit ? <SelectField control={form.control} name="status" label="Status" options={UNIT_STATUSES} hint="Only an active unit can be assigned to a load" /> : null}
        </FieldGrid>
      </FormSection>
      <FormSection title="Expiry dates" description={`Once one of these passes, the ${noun} can't be assigned until it is renewed.`}>
        <FieldGrid className="sm:grid-cols-3">
          <TextField control={form.control} name="insurance_expiry" label="Insurance" type="date" />
          <TextField control={form.control} name="registration_expiry" label="Registration" type="date" />
          <TextField control={form.control} name="inspection_expiry" label="Annual inspection" type="date" />
        </FieldGrid>
      </FormSection>
      <FormSection title="Notes">
        <TextareaField control={form.control} name="notes" label="Notes for your team" rows={3} />
      </FormSection>
    </EntitySheet>
  );
}
