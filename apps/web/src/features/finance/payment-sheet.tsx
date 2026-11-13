"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, FormSection, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { AllocationEditor, allocationsToApi, checkAllocations, useOpenInvoices, type Allocations } from "@/features/finance/allocation-editor";
import { PAYMENT_METHODS, invalidateFinance, paymentKey, type Invoice } from "@/features/finance/lib";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { todayIn } from "@/lib/format/dates";
import { optionalText, requiredMoney } from "@/lib/validation";

const schema = z.object({
  customer_id: z.string().min(1, "Choose who paid"),
  amount: requiredMoney.refine((v) => Number(v) > 0, "Enter an amount above zero"),
  received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it arrived"),
  method: z.string(),
  reference: optionalText(80),
  notes: optionalText(500),
});
type Values = z.infer<typeof schema>;

/**
 * Record money received from a customer and say which invoices it pays. Anything not applied stays on the
 * payment as unapplied, to apply later. A payment is never edited afterwards: a mistake is reversed.
 */
export function PaymentSheet({ open, onOpenChange, invoice }: { open: boolean; onOpenChange: (open: boolean) => void; invoice?: Invoice }) {
  const org = useOrg();
  const router = useRouter();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const initial: Values = { customer_id: invoice?.customer.id ?? "", amount: invoice ? invoice.balance : "", received_on: todayIn(org.timezone), method: "ach", reference: "", notes: "" };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const [customerId, amount] = useWatch({ control: form.control, name: ["customer_id", "amount"] });
  const [allocations, setAllocations] = useState<Allocations>(invoice ? { [invoice.id]: invoice.balance } : {});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);
  const open_ = useOpenInvoices(customerId);

  const save = useMutation({
    mutationFn: (body: Schema<"PaymentCreate">) => unwrap(api.POST("/api/v1/payments", { body, params: { header: { "idempotency-key": key } } })),
    onSuccess: (payment) => {
      queryClient.setQueryData(paymentKey(org.id, payment.id), payment);
      invalidateFinance(queryClient, org.id);
      form.reset(initial);
      onOpenChange(false);
      toast.success(Number(payment.unapplied) > 0 ? `Payment recorded. ${payment.unapplied} ${payment.currency} is left to apply.` : "Payment recorded");
      if (!invoice) router.push(path("finance", "payments", payment.id));
    },
    onError: (error, body) => {
      // Problems with one invoice's amount go beside that invoice.
      if (error instanceof ApiError) {
        const rows: Record<string, string> = {};
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          const match = /^allocations\.(\d+)\./.exec(field);
          const target = match ? body.allocations?.[Number(match[1])]?.invoice_id : undefined;
          if (target) rows[target] = message;
        }
        setRowErrors(rows);
        if (Object.keys(rows).length) return setFormError(error.message);
      }
      setFormError(applyApiErrors(form, error));
    },
  });

  function submit(values: Values) {
    setFormError(null);
    const balances = Object.fromEntries((open_.data?.items ?? []).map((i) => [i.id, i.balance]));
    const checked = checkAllocations(allocations, balances, values.amount, org.base_currency);
    setRowErrors(checked.rows);
    if (Object.keys(checked.rows).length || checked.total) {
      setFormError(checked.total ?? "Check the amounts applied to the invoices");
      return;
    }
    const body: Schema<"PaymentCreate"> = {
      customer_id: values.customer_id,
      amount: values.amount,
      received_on: values.received_on,
      method: (values.method || null) as Schema<"PaymentCreate">["method"],
      reference: values.reference.trim() || null,
      notes: values.notes.trim() || null,
      allocations: allocationsToApi(allocations),
    };
    save.mutate(body);
  }

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
      title={invoice ? `Record a payment for ${invoice.invoice_number}` : "Record a payment"}
      description="Money that isn't applied to an invoice stays on the payment, to apply later."
      form={form}
      onSubmit={submit}
      pending={save.isPending}
      formError={formError}
      submitLabel="Record payment"
    >
      <FormSection title="Payment">
        <FieldGrid>
          <FormField
            control={form.control}
            name="customer_id"
            render={({ field, fieldState }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>
                  Customer <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  {invoice ? (
                    <p className="text-sm font-medium">{invoice.customer.name}</p>
                  ) : (
                    <CustomerPicker
                      value={field.value}
                      onChange={(id) => {
                        field.onChange(id);
                        setAllocations({});
                        setRowErrors({});
                      }}
                      aria-invalid={!!fieldState.error}
                    />
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <TextField control={form.control} name="amount" label={`Amount (${org.base_currency})`} inputMode="decimal" required />
          <TextField control={form.control} name="received_on" label="Received on" type="date" required />
          <SelectField control={form.control} name="method" label="Method" placeholder="Not recorded" options={[...PAYMENT_METHODS]} />
          <TextField control={form.control} name="reference" label="Reference" hint="Check or transaction number" />
          <TextareaField control={form.control} name="notes" label="Notes" rows={2} className="sm:col-span-2" />
        </FieldGrid>
      </FormSection>
      {customerId ? (
        <FormSection title="Apply to invoices">
          <AllocationEditor customerId={customerId} available={amount ?? ""} value={allocations} onChange={setAllocations} errors={rowErrors} />
        </FormSection>
      ) : null}
    </EntitySheet>
  );
}
