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
import { FieldGrid, FormSection, TextField, TextareaField } from "@/components/forms/fields";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { blankToNull, optionalEmail, optionalMoney, optionalState, optionalText, requiredText, wholeNumber } from "@/lib/validation";

type Customer = Schema<"CustomerRead">;

const schema = z.object({
  name: requiredText("the customer's name", 160),
  code: optionalText(30),
  legal_name: optionalText(200),
  phone: optionalText(40),
  billing_email: optionalEmail,
  billing_address: optionalText(300),
  billing_city: optionalText(80),
  billing_state: optionalState,
  billing_postal_code: optionalText(20),
  payment_terms_days: wholeNumber({ max: 365, optional: false, label: "a number of days" }),
  credit_limit: optionalMoney,
  notes: optionalText(4000),
});
type Values = z.infer<typeof schema>;

function defaults(customer?: Customer): Values {
  return {
    name: customer?.name ?? "",
    code: customer?.code ?? "",
    legal_name: customer?.legal_name ?? "",
    phone: customer?.phone ?? "",
    billing_email: customer?.billing_email ?? "",
    billing_address: customer?.billing_address ?? "",
    billing_city: customer?.billing_city ?? "",
    billing_state: customer?.billing_state ?? "",
    billing_postal_code: customer?.billing_postal_code ?? "",
    payment_terms_days: String(customer?.payment_terms_days ?? 30),
    credit_limit: customer?.credit_limit ?? "",
    notes: customer?.notes ?? "",
  };
}

/** Create a customer, or edit one when `customer` is given. */
export function CustomerSheet({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (open: boolean) => void; customer?: Customer }) {
  const org = useOrg();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: open ? defaults(customer) : undefined, defaultValues: defaults(customer) });
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: Values) => {
      const body = { ...blankToNull(values), name: values.name.trim(), payment_terms_days: Number(values.payment_terms_days), billing_state: values.billing_state.trim().toUpperCase() || null };
      return customer
        ? unwrap(api.PATCH("/api/v1/customers/{item_id}", { params: { path: { item_id: customer.id } }, body }))
        : unwrap(api.POST("/api/v1/customers", { body }));
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: [org.id, "customers"] });
      toast.success(customer ? "Customer saved" : `${saved.name} added`);
      form.reset(defaults(saved));
      onOpenChange(false);
      if (!customer) router.push(path("customers", saved.id));
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(defaults(customer));
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title={customer ? `Edit ${customer.name}` : "New customer"}
      description={customer ? undefined : "A shipper or broker you haul for. Contacts and addresses are added after saving."}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={customer ? "Save changes" : "Add customer"}
    >
      <FormSection title="Customer">
        <FieldGrid>
          <TextField control={form.control} name="name" label="Name" required autoFocus className="sm:col-span-2" />
          <TextField control={form.control} name="code" label="Short code" hint="Your own reference, like GLOBEX" />
          <TextField control={form.control} name="phone" label="Phone" type="tel" autoComplete="off" />
        </FieldGrid>
      </FormSection>
      <FormSection title="Billing" description="Printed on invoices. Each invoice keeps the details as they were when it was issued.">
        <FieldGrid>
          <TextField control={form.control} name="legal_name" label="Legal name" className="sm:col-span-2" />
          <TextField control={form.control} name="billing_email" label="Billing email" type="email" autoComplete="off" className="sm:col-span-2" />
          <TextField control={form.control} name="billing_address" label="Street address" className="sm:col-span-2" />
          <TextField control={form.control} name="billing_city" label="City" />
          <div className="grid grid-cols-2 gap-4">
            <TextField control={form.control} name="billing_state" label="State" maxLength={2} />
            <TextField control={form.control} name="billing_postal_code" label="ZIP" />
          </div>
          <TextField control={form.control} name="payment_terms_days" label="Payment terms (days)" inputMode="numeric" required hint="An invoice is due this many days after it is issued" />
          <TextField control={form.control} name="credit_limit" label="Credit limit" inputMode="decimal" />
        </FieldGrid>
      </FormSection>
      <FormSection title="Notes">
        <TextareaField control={form.control} name="notes" label="Notes for your team" rows={3} />
      </FormSection>
    </EntitySheet>
  );
}
