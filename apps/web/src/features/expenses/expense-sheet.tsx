"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, FormSection, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CATEGORIES, FUEL_TYPES, PAID_WITH, TREATMENTS, categoryLabel, invalidateExpenses, type Expense } from "@/features/expenses/lib";
import { LoadPicker } from "@/features/loads/load-picker";
import { DriverPicker, UnitPicker, type UnitType } from "@/features/maintenance/pickers";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";
import { todayIn } from "@/lib/format/dates";
import { intOrNull, optionalState, optionalText, requiredMoney, wholeNumber } from "@/lib/validation";

const schema = z
  .object({
    category: z.enum(CATEGORIES.map((c) => c.value) as [Schema<"ExpenseCreate">["category"], ...Schema<"ExpenseCreate">["category"][]]),
    incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
    amount: requiredMoney.refine((v) => Number(v) > 0, "Enter an amount above zero"),
    vendor: optionalText(160),
    description: optionalText(300),
    paid_with: z.string(),
    reference: optionalText(80),
    unit_id: z.string(),
    driver_id: z.string(),
    load_id: z.string(),
    driver_treatment: z.enum(["none", "reimburse", "deduct"]),
    gallons: z.string().trim().regex(/^$|^\d{1,7}(\.\d{1,3})?$/, "Enter gallons like 112.5"),
    fuel_type: z.string(),
    jurisdiction: optionalState,
    odometer: wholeNumber({ max: 5_000_000, label: "the odometer reading" }),
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.category === "fuel") {
      if (!v.gallons || Number(v.gallons) <= 0) ctx.addIssue({ code: "custom", path: ["gallons"], message: "Enter the gallons bought" });
      if (!v.jurisdiction) ctx.addIssue({ code: "custom", path: ["jurisdiction"], message: "Enter the state it was bought in" });
    }
    if (v.driver_treatment !== "none" && !v.driver_id) ctx.addIssue({ code: "custom", path: ["driver_id"], message: "Choose the driver to reimburse or deduct" });
  });
type Values = z.infer<typeof schema>;

function defaults(expense: Expense | undefined, timeZone: string, preset?: Partial<Values>): Values {
  return {
    category: expense?.category ?? "fuel",
    incurred_on: expense?.incurred_on ?? todayIn(timeZone),
    amount: expense?.amount ?? "",
    vendor: expense?.vendor ?? "",
    description: expense?.description ?? "",
    paid_with: expense?.paid_with ?? "",
    reference: expense?.reference ?? "",
    unit_id: expense?.vehicle?.id ?? expense?.trailer?.id ?? "",
    driver_id: expense?.driver?.id ?? "",
    load_id: expense?.load?.id ?? "",
    driver_treatment: expense?.driver_treatment ?? "none",
    gallons: expense?.gallons ? String(Number(expense.gallons)) : "",
    fuel_type: expense?.fuel_type ?? "diesel",
    jurisdiction: expense?.jurisdiction ?? "",
    odometer: expense?.odometer !== null && expense?.odometer !== undefined ? String(expense.odometer) : "",
    notes: expense?.notes ?? "",
    ...preset,
  };
}

/** Record an expense, or correct one that isn't part of an approved settlement yet. */
export function ExpenseSheet({ open, onOpenChange, expense, preset, presetUnitType }: { open: boolean; onOpenChange: (open: boolean) => void; expense?: Expense; preset?: Partial<Values>; presetUnitType?: UnitType }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [unitType, setUnitType] = useState<UnitType>(expense?.trailer ? "trailer" : (presetUnitType ?? "vehicle"));
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(expense, org.timezone, preset) });
  const category = useWatch({ control: form.control, name: "category" });
  const [formError, setFormError] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);
  const fuel = category === "fuel";

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        category: v.category,
        incurred_on: v.incurred_on,
        amount: v.amount.trim(),
        vendor: v.vendor.trim() || null,
        description: v.description.trim() || null,
        paid_with: (v.paid_with || null) as Schema<"ExpenseCreate">["paid_with"],
        reference: v.reference.trim() || null,
        vehicle_id: unitType === "vehicle" && v.unit_id ? v.unit_id : null,
        trailer_id: unitType === "trailer" && v.unit_id ? v.unit_id : null,
        driver_id: v.driver_id || null,
        load_id: v.load_id || null,
        driver_treatment: v.driver_treatment,
        gallons: fuel ? v.gallons.trim() : null,
        fuel_type: (fuel ? v.fuel_type || "diesel" : null) as Schema<"ExpenseCreate">["fuel_type"],
        jurisdiction: fuel ? v.jurisdiction.trim().toUpperCase() : null,
        odometer: intOrNull(v.odometer),
        notes: v.notes.trim() || null,
      };
      return expense
        ? unwrap(api.PATCH("/api/v1/expenses/{expense_id}", { params: { path: { expense_id: expense.id } }, body }))
        : unwrap(api.POST("/api/v1/expenses", { body, params: { header: { "idempotency-key": key } } }));
    },
    onSuccess: (saved) => {
      invalidateExpenses(queryClient, org.id);
      toast.success(expense ? "Expense saved" : `${categoryLabel(saved.category)} expense recorded`);
      form.reset(defaults(saved, org.timezone));
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error, { vehicle_id: "unit_id", trailer_id: "unit_id" })),
  });

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(defaults(expense, org.timezone, preset));
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title={expense ? `Edit ${categoryLabel(expense.category).toLowerCase()} expense` : "Record an expense"}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={expense ? "Save changes" : "Record expense"}
    >
      <FormSection title="Expense">
        <FieldGrid>
          <SelectField control={form.control} name="category" label="Category" options={[...CATEGORIES]} />
          <TextField control={form.control} name="incurred_on" label="Date" type="date" required />
          <TextField control={form.control} name="amount" label={`Amount (${org.base_currency})`} inputMode="decimal" required />
          <TextField control={form.control} name="vendor" label={fuel ? "Fuel stop" : "Vendor"} placeholder={fuel ? "Pilot #412" : undefined} />
          {fuel ? (
            <>
              <TextField control={form.control} name="gallons" label="Gallons" inputMode="decimal" required />
              <TextField control={form.control} name="jurisdiction" label="State bought in" maxLength={2} required hint="For fuel-tax reporting" />
              <SelectField control={form.control} name="fuel_type" label="Fuel" options={[...FUEL_TYPES]} />
              <TextField control={form.control} name="odometer" label="Odometer (miles)" inputMode="numeric" />
            </>
          ) : null}
          <SelectField control={form.control} name="paid_with" label="Paid with" placeholder="Not recorded" options={[...PAID_WITH]} />
          <TextField control={form.control} name="reference" label="Receipt or card number" />
          <TextField control={form.control} name="description" label="What for" className="sm:col-span-2" />
        </FieldGrid>
      </FormSection>
      <FormSection title="Attach to" description="Optional. Ties the cost to a unit, a driver or a load for reporting.">
        <FieldGrid>
          <FormField
            control={form.control}
            name="unit_id"
            render={({ field, fieldState }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Truck or trailer</FormLabel>
                <FormControl>
                  <UnitPicker type={unitType} onTypeChange={setUnitType} value={field.value} onChange={field.onChange} aria-invalid={!!fieldState.error} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="driver_id"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Driver</FormLabel>
                <FormControl>
                  <DriverPicker value={field.value} onChange={field.onChange} aria-invalid={!!fieldState.error} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="load_id"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Load</FormLabel>
                <FormControl>
                  <LoadPicker value={field.value} onChange={field.onChange} aria-invalid={!!fieldState.error} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SelectField control={form.control} name="driver_treatment" label="Driver pay" options={[...TREATMENTS]} hint="Reimbursements and deductions go on the driver's next settlement" className="sm:col-span-2" />
          <TextareaField control={form.control} name="notes" label="Notes" rows={2} className="sm:col-span-2" />
        </FieldGrid>
      </FormSection>
    </EntitySheet>
  );
}
