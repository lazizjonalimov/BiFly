"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorState } from "@/components/feedback/states";
import { applyApiErrors } from "@/components/forms/api-errors";
import { FieldGrid, FormSection, SelectField, TextField } from "@/components/forms/fields";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { hardNavigate } from "@/lib/hard-navigation";
import { optionalEmail, optionalText, requiredText, wholeNumber } from "@/lib/validation";

type Organization = Schema<"OrganizationOut">;

const prefix = z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, "Use up to 10 letters and digits");
const schema = z.object({
  name: requiredText("the company's name", 160).refine((v) => v.length >= 2, "Enter at least two characters"),
  legal_name: optionalText(200),
  dot_number: optionalText(20),
  mc_number: optionalText(20),
  phone: optionalText(40),
  email: optionalEmail,
  address: optionalText(300),
  city: optionalText(80),
  state: optionalText(40),
  postal_code: optionalText(20),
  timezone: z.string().min(1, "Choose the time zone"),
  default_payment_terms_days: wholeNumber({ max: 365, optional: false, label: "a number of days" }),
  load_number_prefix: prefix,
  invoice_number_prefix: prefix,
});
type Values = z.infer<typeof schema>;

function defaults(org: Organization): Values {
  return {
    name: org.name,
    legal_name: org.legal_name ?? "",
    dot_number: org.dot_number ?? "",
    mc_number: org.mc_number ?? "",
    phone: org.phone ?? "",
    email: org.email ?? "",
    address: org.address ?? "",
    city: org.city ?? "",
    state: org.state ?? "",
    postal_code: org.postal_code ?? "",
    timezone: org.timezone,
    default_payment_terms_days: String(org.default_payment_terms_days),
    load_number_prefix: org.load_number_prefix,
    invoice_number_prefix: org.invoice_number_prefix,
  };
}

/** The time zones the browser knows, with the company's own first even if it is unusual. */
function timeZones(current: string): { value: string; label: string }[] {
  const all: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([current, ...all])].map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}

function SettingsForm({ organization }: { organization: Organization }) {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const editable = can("organization.manage");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(organization) });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: Values) => {
      const text = (s: string) => s.trim() || null;
      return unwrap(api.PATCH("/api/v1/organization", {
        body: {
          name: v.name.trim(), legal_name: text(v.legal_name), dot_number: text(v.dot_number), mc_number: text(v.mc_number),
          phone: text(v.phone), email: text(v.email), address: text(v.address), city: text(v.city), state: text(v.state),
          postal_code: text(v.postal_code), timezone: v.timezone, default_payment_terms_days: Number(v.default_payment_terms_days),
          load_number_prefix: v.load_number_prefix.trim().toUpperCase(), invoice_number_prefix: v.invoice_number_prefix.trim().toUpperCase(),
        },
      }));
    },
    onSuccess: (saved) => {
      toast.success("Company settings saved");
      // The time zone and name are part of the session every screen reads, so reload to pick them up.
      if (saved.timezone !== organization.timezone || saved.name !== organization.name) {
        hardNavigate(window.location.pathname);
        return;
      }
      queryClient.setQueryData([org.id, "organization"], saved);
      form.reset(defaults(saved));
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => {
          setFormError(null);
          save.mutate(values);
        })}
        className="grid gap-4"
        noValidate
      >
        <fieldset disabled={!editable || save.isPending} className="grid gap-4">
          <FormError message={formError} />
          <Card>
            <CardContent className="grid gap-6 pt-6">
              <FormSection title="Company" description="Shown on invoices and pay statements.">
                <FieldGrid>
                  <TextField control={form.control} name="name" label="Name" required />
                  <TextField control={form.control} name="legal_name" label="Legal name" hint="If it differs from the name" />
                  <TextField control={form.control} name="dot_number" label="USDOT number" />
                  <TextField control={form.control} name="mc_number" label="MC number" />
                  <TextField control={form.control} name="phone" label="Phone" />
                  <TextField control={form.control} name="email" label="Billing email" type="email" />
                </FieldGrid>
              </FormSection>
              <FormSection title="Address">
                <FieldGrid>
                  <TextField control={form.control} name="address" label="Street" className="sm:col-span-2" />
                  <TextField control={form.control} name="city" label="City" />
                  <div className="grid grid-cols-2 gap-4">
                    <TextField control={form.control} name="state" label="State" />
                    <TextField control={form.control} name="postal_code" label="Postal code" />
                  </div>
                </FieldGrid>
              </FormSection>
              <FormSection title="How FlyFleet works for you">
                <FieldGrid>
                  <SelectField control={form.control} name="timezone" label="Time zone" options={timeZones(organization.timezone)} hint="Appointments, due dates and 'today' follow it" />
                  <TextField control={form.control} name="default_payment_terms_days" label="Default payment terms (days)" inputMode="numeric" hint="For new customers" />
                  <TextField control={form.control} name="load_number_prefix" label="Load number prefix" hint="L gives L-1001" />
                  <TextField control={form.control} name="invoice_number_prefix" label="Invoice number prefix" hint="INV gives INV-1001" />
                </FieldGrid>
                <p className="text-sm text-muted-foreground">Currency: {organization.base_currency}. It is set when the company is created.</p>
              </FormSection>
            </CardContent>
          </Card>
        </fieldset>
        {editable ? (
          <div className="flex justify-end">
            <SubmitButton pending={save.isPending}>Save settings</SubmitButton>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner or administrator can change these.</p>
        )}
      </form>
    </Form>
  );
}

export function CompanySettings() {
  const org = useOrg();
  const query = useQuery({ queryKey: [org.id, "organization"], queryFn: () => unwrap(api.GET("/api/v1/organization")) });
  return (
    <>
      <PageHeader title="Company settings" description="Who you are on paper, and how dates and numbers work in this company." />
      {query.isPending ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Loading settings">
          <Skeleton className="h-96" />
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <SettingsForm key={query.data.id} organization={query.data} />
      )}
    </>
  );
}
