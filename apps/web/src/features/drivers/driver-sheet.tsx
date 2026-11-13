"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, FormSection, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useTerminals } from "@/hooks/use-options";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { blankToNull, optionalDate, optionalEmail, optionalState, optionalText, requiredText } from "@/lib/validation";

type Driver = Schema<"DriverRead">;

const schema = z.object({
  first_name: requiredText("the first name", 80),
  last_name: requiredText("the last name", 80),
  phone: optionalText(40),
  email: optionalEmail,
  employee_number: optionalText(30),
  driver_type: z.enum(["company", "owner_operator", "contractor"]),
  hire_date: optionalDate,
  terminal_id: z.string(),
  user_id: z.string(),
  cdl_number: optionalText(40),
  cdl_state: optionalState,
  cdl_class: z.enum(["", "A", "B", "C"]),
  cdl_expiry: optionalDate,
  medical_cert_expiry: optionalDate,
  pay_type: z.enum(["per_mile", "percent", "flat"]),
  pay_rate: z.string().trim().regex(/^\d{1,6}(\.\d{1,4})?$/, "Enter a number like 0.62"),
  status: z.enum(["active", "inactive", "terminated"]),
  notes: optionalText(4000),
});
type Values = z.infer<typeof schema>;

function defaults(driver?: Driver): Values {
  return {
    first_name: driver?.first_name ?? "",
    last_name: driver?.last_name ?? "",
    phone: driver?.phone ?? "",
    email: driver?.email ?? "",
    employee_number: driver?.employee_number ?? "",
    driver_type: (driver?.driver_type as Values["driver_type"]) ?? "company",
    hire_date: driver?.hire_date ?? "",
    terminal_id: driver?.terminal_id ?? "",
    user_id: driver?.user_id ?? "",
    cdl_number: driver?.cdl_number ?? "",
    cdl_state: driver?.cdl_state ?? "",
    cdl_class: (driver?.cdl_class as Values["cdl_class"]) ?? "",
    cdl_expiry: driver?.cdl_expiry ?? "",
    medical_cert_expiry: driver?.medical_cert_expiry ?? "",
    pay_type: (driver?.pay_type as Values["pay_type"]) ?? "per_mile",
    pay_rate: driver?.pay_rate ? String(Number(driver.pay_rate)) : "0",
    status: (driver?.status as Values["status"]) ?? "active",
    notes: driver?.notes ?? "",
  };
}

const PAY_HINTS: Record<Values["pay_type"], string> = {
  per_mile: "Dollars for each mile, for example 0.62",
  percent: "Percent of the load's revenue, for example 78",
  flat: "Dollars for each load, for example 350",
};

/** Create a driver, or edit one when `driver` is given. */
export function DriverSheet({ open, onOpenChange, driver }: { open: boolean; onOpenChange: (open: boolean) => void; driver?: Driver }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const terminals = useTerminals();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: open ? defaults(driver) : undefined, defaultValues: defaults(driver) });
  const [formError, setFormError] = useState<string | null>(null);
  const payType = useWatch({ control: form.control, name: "pay_type" });
  const seesPay = can("drivers.sensitive.read");
  const seesTeam = can("users.manage");

  // Team members with the driver role, to link this driver to the sign-in they use on the road.
  const members = useQuery({
    queryKey: [org.id, "members"],
    queryFn: () => unwrap(api.GET("/api/v1/members")),
    enabled: open && seesTeam,
    staleTime: 60_000,
  });
  const signIns = (members.data ?? []).filter((m) => m.role === "driver" && m.active).map((m) => ({ value: m.user_id, label: `${m.full_name} (${m.email})` }));

  const save = useMutation({
    mutationFn: (values: Values) => {
      const { pay_type, pay_rate, user_id, ...rest } = values;
      const body = {
        ...blankToNull(rest),
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        driver_type: values.driver_type,
        status: values.status,
        cdl_class: values.cdl_class || null,
        cdl_state: values.cdl_state.trim().toUpperCase() || null,
        // Sent only by people who can see them, so someone who can't never overwrites them with blanks.
        ...(seesPay ? { pay_type, pay_rate } : {}),
        ...(seesTeam ? { user_id: user_id || null } : {}),
      };
      return driver
        ? unwrap(api.PATCH("/api/v1/drivers/{item_id}", { params: { path: { item_id: driver.id } }, body }))
        : unwrap(api.POST("/api/v1/drivers", { body: body as Schema<"DriverCreate"> }));
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: [org.id, "drivers"] });
      toast.success(driver ? "Driver saved" : `${saved.full_name} added`);
      form.reset(defaults(saved));
      onOpenChange(false);
      if (!driver) router.push(path("drivers", saved.id));
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(defaults(driver));
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title={driver ? `Edit ${driver.full_name}` : "New driver"}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={driver ? "Save changes" : "Add driver"}
    >
      <FormSection title="Driver">
        <FieldGrid>
          <TextField control={form.control} name="first_name" label="First name" required autoFocus />
          <TextField control={form.control} name="last_name" label="Last name" required />
          <TextField control={form.control} name="phone" label="Phone" type="tel" autoComplete="off" />
          <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" />
          <SelectField
            control={form.control}
            name="driver_type"
            label="Type"
            options={[
              { value: "company", label: "Company driver" },
              { value: "owner_operator", label: "Owner-operator" },
              { value: "contractor", label: "Contractor" },
            ]}
          />
          <TextField control={form.control} name="employee_number" label="Employee number" />
          <TextField control={form.control} name="hire_date" label="Hire date" type="date" />
          {terminals.options.length ? <SelectField control={form.control} name="terminal_id" label="Home terminal" placeholder="None" options={terminals.options} /> : null}
          {driver ? (
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive: not driving for now" },
                { value: "terminated", label: "Terminated" },
              ]}
            />
          ) : null}
        </FieldGrid>
      </FormSection>

      <FormSection title="Licence and medical card" description="An expired licence or medical card stops the driver from being assigned. The licence number is stored encrypted.">
        <FieldGrid>
          <TextField control={form.control} name="cdl_number" label="CDL number" autoComplete="off" />
          <div className="grid grid-cols-2 gap-4">
            <TextField control={form.control} name="cdl_state" label="State" maxLength={2} />
            <SelectField control={form.control} name="cdl_class" label="Class" placeholder="—" options={["A", "B", "C"].map((c) => ({ value: c, label: c }))} />
          </div>
          <TextField control={form.control} name="cdl_expiry" label="CDL expires" type="date" />
          <TextField control={form.control} name="medical_cert_expiry" label="Medical card expires" type="date" />
        </FieldGrid>
      </FormSection>

      {seesPay ? (
        <FormSection title="Pay" description="Used to work out what the driver earned on each load.">
          <FieldGrid>
            <SelectField
              control={form.control}
              name="pay_type"
              label="Paid"
              options={[
                { value: "per_mile", label: "Per mile" },
                { value: "percent", label: "Percent of revenue" },
                { value: "flat", label: "Flat amount per load" },
              ]}
            />
            <TextField control={form.control} name="pay_rate" label="Rate" inputMode="decimal" hint={PAY_HINTS[payType]} />
          </FieldGrid>
        </FormSection>
      ) : null}

      {seesTeam ? (
        <FormSection title="Sign-in" description="Link the driver to their own sign-in so they can see their loads and report progress.">
          <SelectField control={form.control} name="user_id" label="Team member" placeholder="Not linked" options={signIns} hint={signIns.length ? undefined : "No team member has the driver role yet. Add one under Team first."} />
        </FormSection>
      ) : null}

      <FormSection title="Notes">
        <TextareaField control={form.control} name="notes" label="Notes for your team" rows={3} />
      </FormSection>
    </EntitySheet>
  );
}
