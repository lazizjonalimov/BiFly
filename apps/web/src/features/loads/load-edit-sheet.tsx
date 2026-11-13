"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { EQUIPMENT_TYPES } from "@/features/equipment/unit-sheet";
import type { LoadDetail } from "@/features/loads/lib";
import { CONFLICT_MESSAGE, isVersionConflict, useLatestLoad, useLoadMutation } from "@/features/loads/use-load";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { optionalText, requiredMoney, wholeNumber } from "@/lib/validation";

const schema = z.object({
  customer_id: z.string().min(1, "Choose the customer"),
  reference: optionalText(80),
  bol_number: optionalText(80),
  commodity: optionalText(200),
  equipment_type: z.string(),
  weight_lbs: wholeNumber({ max: 1_000_000, label: "a weight" }),
  miles: wholeNumber({ max: 50_000, label: "a distance" }),
  terminal_id: z.string(),
  instructions: optionalText(4000),
  customer_rate: requiredMoney,
});
type Values = z.infer<typeof schema>;

function fromLoad(load: LoadDetail): Values {
  return {
    customer_id: load.customer.id, reference: load.reference ?? "", bol_number: load.bol_number ?? "", commodity: load.commodity ?? "", equipment_type: load.equipment_type,
    weight_lbs: load.weight_lbs?.toString() ?? "", miles: load.miles?.toString() ?? "", terminal_id: load.terminal_id ?? "", instructions: load.instructions ?? "",
    customer_rate: load.customer_rate ? String(load.customer_rate) : "0",
  };
}

/** Change a load's details. Only what changed is sent, with the version the screen showed. */
export function LoadEditSheet({ load, onOpenChange }: { load: LoadDetail; onOpenChange: (open: boolean) => void }) {
  const terminals = useTerminals();
  const latest = useLatestLoad(load.id);
  // What the form started from; after a conflict it is the newer version, so only real edits are sent.
  const initial = fromLoad(load);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useLoadMutation(load.id, (body: Schema<"LoadUpdate">) => unwrap(api.PATCH("/api/v1/loads/{load_id}", { params: { path: { load_id: load.id } }, body })), { success: (saved) => `${saved.load_number} saved`, quiet: true });

  function submit(values: Values) {
    setFormError(null);
    const body: Record<string, unknown> = { version: load.version };
    const text = (k: "reference" | "bol_number" | "commodity" | "instructions") => (values[k].trim() || null) !== (initial[k] || null) && (body[k] = values[k].trim() || null);
    (["reference", "bol_number", "commodity", "instructions"] as const).forEach(text);
    if (values.customer_id !== initial.customer_id) body.customer_id = values.customer_id;
    if (values.equipment_type !== initial.equipment_type) body.equipment_type = values.equipment_type;
    if (values.weight_lbs !== initial.weight_lbs) body.weight_lbs = values.weight_lbs ? Number(values.weight_lbs) : null;
    if (values.miles !== initial.miles) body.miles = values.miles ? Number(values.miles) : null;
    if (values.terminal_id !== initial.terminal_id) body.terminal_id = values.terminal_id || null;
    if (load.editable.rates && Number(values.customer_rate) !== Number(initial.customer_rate)) body.customer_rate = values.customer_rate;
    if (Object.keys(body).length === 1) return onOpenChange(false); // nothing changed
    save.mutate(body as Schema<"LoadUpdate">, {
      onSuccess: () => onOpenChange(false),
      onError: async (error) => {
        if (!isVersionConflict(error)) return setFormError(applyApiErrors(form, error));
        form.reset(fromLoad(await latest()));
        setFormError(CONFLICT_MESSAGE);
      },
    });
  }

  return (
    <EntitySheet open onOpenChange={onOpenChange} title={`Edit ${load.load_number}`} form={form} onSubmit={submit} pending={save.isPending} formError={formError} submitLabel="Save changes">
      <FieldGrid>
        {load.editable.customer ? (
          <FormField
            control={form.control}
            name="customer_id"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Customer</FormLabel>
                <FormControl>
                  <CustomerPicker value={field.value} onChange={(id) => field.onChange(id)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <TextField control={form.control} name="reference" label="Customer's reference" />
        <TextField control={form.control} name="bol_number" label="BOL number" />
        <TextField control={form.control} name="commodity" label="Commodity" />
        {load.editable.stops ? <SelectField control={form.control} name="equipment_type" label="Equipment" options={EQUIPMENT_TYPES} /> : null}
        <TextField control={form.control} name="weight_lbs" label="Weight (lb)" inputMode="numeric" />
        <TextField control={form.control} name="miles" label="Miles" inputMode="numeric" />
        {terminals.options.length ? <SelectField control={form.control} name="terminal_id" label="Terminal" placeholder="None" options={terminals.options} /> : null}
        {load.editable.rates ? <TextField control={form.control} name="customer_rate" label={`Line haul (${load.currency})`} inputMode="decimal" /> : null}
        <TextareaField control={form.control} name="instructions" label="Instructions for the driver" rows={3} className="sm:col-span-2" />
      </FieldGrid>
    </EntitySheet>
  );
}
