"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFieldArray, useForm, useFormContext, useWatch, type FieldPath, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { CheckboxField, FieldGrid, FormSection, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { EQUIPMENT_TYPES } from "@/features/equipment/unit-sheet";
import { CHARGE_TYPES, chargeLabel } from "@/features/loads/lib";
import { StopsEditor, blankStop, routeProblem, stopSchema, stopToApi } from "@/features/loads/stops-editor";
import { useTerminals } from "@/hooks/use-options";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDateTime, fromLocalInput } from "@/lib/format/dates";
import { formatMoney, multiplyMoney, sumMoney } from "@/lib/format/money";
import { formatNumber, humanize } from "@/lib/format/text";
import { cn } from "@/lib/utils";
import { intOrNull, optionalMoney, optionalText, requiredMoney, signedMoney, wholeNumber } from "@/lib/validation";

const itemSchema = z.object({
  description: z.string().trim().min(1, "Describe the freight").max(200),
  quantity: wholeNumber({ max: 1_000_000, label: "a quantity" }),
  unit: optionalText(30),
  weight_lbs: wholeNumber({ max: 1_000_000, label: "a weight" }),
});
const chargeSchema = z.object({
  type: z.enum(CHARGE_TYPES.map((c) => c.value) as [string, ...string[]]),
  description: optionalText(200),
  quantity: z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter a quantity like 1 or 2.5").refine((v) => Number(v) > 0, "Enter a quantity above zero"),
  rate: signedMoney,
  billable: z.boolean(),
  driver_payable: z.boolean(),
});

const schema = z.object({
  customer_id: z.string().min(1, "Choose the customer"),
  reference: optionalText(80),
  bol_number: optionalText(80),
  commodity: optionalText(200),
  equipment_type: z.enum(EQUIPMENT_TYPES.map((t) => t.value) as [string, ...string[]]),
  weight_lbs: wholeNumber({ max: 1_000_000, label: "a weight" }),
  miles: wholeNumber({ max: 50_000, label: "a distance" }),
  terminal_id: z.string(),
  instructions: optionalText(4000),
  items: z.array(itemSchema),
  stops: z.array(stopSchema).min(1, "Add at least one stop"),
  customer_rate: requiredMoney,
  charges: z.array(chargeSchema),
});
type Values = z.infer<typeof schema>;
// A draft may be saved before the route or the rate is known.
const draftSchema = schema.extend({ stops: z.array(stopSchema), customer_rate: optionalMoney });
const hasContent = (stop: Values["stops"][number]) => Object.entries(stop).some(([key, value]) => key !== "type" && String(value).trim() !== "");

type StepContext = { step: number };
const fullResolver = zodResolver(schema) as Resolver<Values>;

/** The full schema, with errors kept only for the steps up to the one in front of the user. */
const stepResolver: Resolver<Values, StepContext> = async (values, context, options) => {
  const result = await fullResolver(values, undefined, options);
  const step = context?.step ?? STEPS.length - 1;
  if (step >= STEPS.length - 1) return result;
  const allowed = new Set<string>(STEPS.slice(0, step + 1).flatMap((s) => s.fields));
  const errors = Object.fromEntries(Object.entries(result.errors).filter(([field]) => allowed.has(field)));
  return Object.keys(errors).length ? { values: {}, errors } : { values, errors: {} };
};

const STEPS = [
  { title: "Customer and freight", fields: ["customer_id", "reference", "bol_number", "commodity", "equipment_type", "weight_lbs", "miles", "terminal_id", "instructions", "items"] },
  { title: "Route", fields: ["stops"] },
  { title: "Rate", fields: ["customer_rate", "charges"] },
  { title: "Review", fields: [] },
] as const satisfies readonly { title: string; fields: readonly FieldPath<Values>[] }[];

const EMPTY: Values = {
  customer_id: "", reference: "", bol_number: "", commodity: "", equipment_type: "dry_van", weight_lbs: "", miles: "", terminal_id: "", instructions: "",
  items: [], stops: [blankStop("pickup"), blankStop("delivery")], customer_rate: "", charges: [],
};

function Steps({ current, onGo }: { current: number; onGo: (step: number) => void }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
      {STEPS.map((step, index) => (
        <li key={step.title}>
          <button
            type="button"
            onClick={() => index < current && onGo(index)}
            disabled={index > current}
            aria-current={index === current ? "step" : undefined}
            className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", index === current ? "border-primary bg-primary/10 font-medium text-primary" : index < current ? "bg-card hover:bg-accent" : "text-muted-foreground")}
          >
            <span className={cn("flex size-5 items-center justify-center rounded-full text-xs", index < current ? "bg-primary text-primary-foreground" : "bg-muted")}>{index < current ? <CheckIcon className="size-3" /> : index + 1}</span>
            {step.title}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Items() {
  const form = useFormContextValues();
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  return (
    <FormSection title="What is on the truck" description="Optional. Lines of freight, for the paperwork.">
      {fields.map((field, index) => (
        <div key={field.id} className="grid grid-cols-[1fr_auto] items-end gap-2">
          <FieldGrid className="lg:grid-cols-4">
            <TextField control={form.control} name={`items.${index}.description`} label="Description" className="lg:col-span-2" />
            <TextField control={form.control} name={`items.${index}.quantity`} label="Quantity" inputMode="numeric" />
            <TextField control={form.control} name={`items.${index}.unit`} label="Unit" placeholder="pallets" />
          </FieldGrid>
          <Button variant="ghost" size="icon-sm" onClick={() => remove(index)} aria-label={`Remove freight line ${index + 1}`}>
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={() => append({ description: "", quantity: "", unit: "", weight_lbs: "" })}>
          <PlusIcon /> Add a line of freight
        </Button>
      </div>
    </FormSection>
  );
}

function Charges() {
  const form = useFormContextValues();
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "charges" });
  const charges = useWatch({ control: form.control, name: "charges" });
  return (
    <FormSection title="Extra charges" description="Detention, lumper, fuel surcharge and the like. Use a negative rate for a deduction.">
      {fields.map((field, index) => (
        <Card key={field.id} className="p-4">
          <div className="grid grid-cols-[1fr_auto] items-start gap-2">
            <FieldGrid className="lg:grid-cols-4">
              <SelectField control={form.control} name={`charges.${index}.type`} label="Charge" options={CHARGE_TYPES} />
              <TextField control={form.control} name={`charges.${index}.description`} label="Note" />
              <TextField control={form.control} name={`charges.${index}.rate`} label="Rate" inputMode="decimal" />
              <TextField control={form.control} name={`charges.${index}.quantity`} label="Quantity" inputMode="decimal" />
              <CheckboxField control={form.control} name={`charges.${index}.billable`} label="Bill the customer" className="lg:col-span-2" />
              <CheckboxField control={form.control} name={`charges.${index}.driver_payable`} label="Pay the driver" className="lg:col-span-2" />
            </FieldGrid>
            <div className="grid justify-items-end gap-2">
              <Button variant="ghost" size="icon-sm" onClick={() => remove(index)} aria-label={`Remove charge ${index + 1}`}>
                <Trash2Icon />
              </Button>
              <span className="tabular text-sm font-medium">{formatMoney(multiplyMoney(charges?.[index]?.quantity ?? "", charges?.[index]?.rate ?? ""))}</span>
            </div>
          </div>
        </Card>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={() => append({ type: "detention", description: "", quantity: "1", rate: "", billable: true, driver_payable: false })}>
          <PlusIcon /> Add a charge
        </Button>
      </div>
    </FormSection>
  );
}

// The wizard's sections share its form through context.
function useFormContextValues() {
  return useFormContext<Values>();
}

/** Totals as the API will work them out: the rate plus billable charges, in exact cents. */
function totals(values: Values) {
  const billable = values.charges.filter((c) => c.billable).map((c) => multiplyMoney(c.quantity, c.rate));
  const charges = sumMoney(billable);
  return { charges, revenue: sumMoney([values.customer_rate || "0", charges]) };
}

function Review({ values, customerName, terminalName }: { values: Values; customerName: string; terminalName: string }) {
  const org = useOrg();
  const { charges, revenue } = totals(values);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="grid gap-2 text-sm">
          <h3 className="font-semibold">Customer and freight</h3>
          <p>{customerName}</p>
          <p className="text-muted-foreground">
            {[values.reference ? `Ref ${values.reference}` : null, values.bol_number ? `BOL ${values.bol_number}` : null, humanize(values.equipment_type), values.commodity || null, values.weight_lbs ? `${formatNumber(Number(values.weight_lbs))} lb` : null, values.miles ? `${formatNumber(Number(values.miles))} mi` : null, values.terminal_id ? terminalName : null].filter(Boolean).join(" · ")}
          </p>
          {values.instructions ? <p className="whitespace-pre-wrap">{values.instructions}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-2 text-sm">
          <h3 className="font-semibold">Rate</h3>
          <p className="flex justify-between">
            <span>Line haul</span> <span className="tabular">{formatMoney(values.customer_rate || "0", org.base_currency)}</span>
          </p>
          {values.charges.map((c, i) => (
            <p key={i} className={cn("flex justify-between", !c.billable && "text-muted-foreground")}>
              <span>
                {chargeLabel(c.type)}
                {c.billable ? "" : " (not billed)"}
              </span>
              <span className="tabular">{formatMoney(multiplyMoney(c.quantity, c.rate), org.base_currency)}</span>
            </p>
          ))}
          <p className="flex justify-between border-t pt-2 font-semibold">
            <span>Revenue</span> <span className="tabular">{formatMoney(revenue, org.base_currency)}</span>
          </p>
          {charges !== "0.00" ? <p className="text-xs text-muted-foreground">Includes {formatMoney(charges, org.base_currency)} of billable charges</p> : null}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardContent className="text-sm">
          <h3 className="mb-3 font-semibold">Route</h3>
          <ol className="grid gap-3">
            {values.stops.map((stop, i) => (
              <li key={i} className="flex gap-3">
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", stop.type === "pickup" ? "bg-info/12 text-info" : "bg-success/12 text-success")}>{i + 1}</span>
                <div>
                  <p className="font-medium">
                    {stop.type === "pickup" ? "Pickup" : "Delivery"}: {[stop.name, [stop.city, stop.state.toUpperCase()].filter(Boolean).join(", ")].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-muted-foreground">{stop.appt_start ? `${formatDateTime(fromLocalInput(stop.appt_start, org.timezone), org.timezone)}${stop.appt_end ? ` to ${formatDateTime(fromLocalInput(stop.appt_end, org.timezone), org.timezone)}` : ""}` : "No appointment yet"}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Booking a load, in four steps. Each step is checked before the next; the API checks everything again when
 * the load is saved. A draft can be saved at any point and finished later.
 */
export function LoadWizard() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const terminals = useTerminals();
  const [step, setStep] = useState(0);
  // Validation covers the steps reached so far: nothing is flagged in a step the user hasn't got to.
  // Fields are not checked as they lose focus: a message vanishing on blur shifts the page under the pointer
  // and swallows the click on Next. Errors appear when Next is pressed and then update as the user types.
  const form = useForm<Values, StepContext>({ resolver: stepResolver, context: { step }, defaultValues: EMPTY });
  const [formError, setFormError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  // One key for this booking. A retry after a lost response is recognised by the API and not booked twice.
  const [key] = useState(idempotencyKey);
  const customerId = useWatch({ control: form.control, name: "customer_id" });
  const dirty = form.formState.isDirty;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const create = useMutation({
    mutationFn: ({ values, status }: { values: Values; status: "draft" | "planned" }) =>
      unwrap(
        api.POST("/api/v1/loads", {
          params: { header: { "idempotency-key": key } },
          body: {
            customer_id: values.customer_id,
            status,
            terminal_id: values.terminal_id || null,
            reference: values.reference.trim() || null,
            bol_number: values.bol_number.trim() || null,
            commodity: values.commodity.trim() || null,
            equipment_type: values.equipment_type as "dry_van",
            weight_lbs: intOrNull(values.weight_lbs),
            miles: intOrNull(values.miles),
            instructions: values.instructions.trim() || null,
            customer_rate: values.customer_rate || "0",
            items: values.items.map((i) => ({ description: i.description.trim(), quantity: intOrNull(i.quantity), unit: i.unit.trim() || null, weight_lbs: intOrNull(i.weight_lbs) })),
            stops: values.stops.map((s) => stopToApi(s, org.timezone)),
            charges: values.charges.map((c) => ({ type: c.type as "other", description: c.description.trim() || null, quantity: c.quantity, rate: c.rate, billable: c.billable, driver_payable: c.driver_payable })),
          },
        }),
      ),
    onSuccess: (load, { status }) => {
      void queryClient.invalidateQueries({ queryKey: [org.id] });
      toast.success(status === "draft" ? `Draft ${load.load_number} saved` : `Load ${load.load_number} booked`);
      form.reset(EMPTY); // clean, so leaving doesn't warn about unsaved changes
      router.push(path("loads", load.id));
    },
    onError: (error) => {
      const message = applyApiErrors(form, error);
      setFormError(message);
      // Send the user to the first step that has a problem.
      const errors = form.formState.errors;
      const first = STEPS.findIndex((s) => s.fields.some((f) => f in errors));
      if (first >= 0) setStep(first);
    },
  });

  function next() {
    setFormError(null);
    void form.handleSubmit((values) => {
      if (step === 1) {
        const problem = routeProblem(values.stops);
        if (problem) return setFormError(problem);
      }
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    })();
  }

  function showFirstProblem() {
    const errors = form.formState.errors;
    const first = STEPS.findIndex((s) => s.fields.some((f) => f in errors));
    if (first >= 0) setStep(first);
    setFormError("Some fields need attention");
  }

  function submit(status: "draft" | "planned") {
    setFormError(null);
    if (status === "planned") {
      void form.handleSubmit((values) => {
        const problem = routeProblem(values.stops);
        if (problem) {
          setStep(1);
          return setFormError(problem);
        }
        create.mutate({ values, status });
      }, showFirstProblem)();
      return;
    }
    // A draft keeps only the stops that have something in them, and needs no complete route.
    form.clearErrors();
    form.setValue("stops", form.getValues("stops").filter(hasContent), { shouldDirty: true });
    const parsed = draftSchema.safeParse(form.getValues());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) form.setError(issue.path.join(".") as FieldPath<Values>, { type: "validate", message: issue.message });
      return showFirstProblem();
    }
    create.mutate({ values: parsed.data, status });
  }

  const values = form.getValues();
  const canRates = can("loads.rates.read");
  return (
    <>
      <PageHeader
        title="New load"
        description="Book a load for a customer. Save a draft at any point if you don't have everything yet."
        actions={
          <Button variant="ghost" asChild>
            <Link href={path("loads")}>Cancel</Link>
          </Button>
        }
      />
      <Steps current={step} onGo={setStep} />
      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step < STEPS.length - 1) next();
            else submit("planned");
          }}
          className="grid max-w-5xl gap-6"
          noValidate
        >
          <FormError message={formError} />

          <div hidden={step !== 0} className="grid gap-6">
            <Card>
              <CardContent className="grid gap-6">
                <FormSection title="Customer">
                  <FieldGrid>
                    <FormField
                      control={form.control}
                      name="customer_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Customer <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <CustomerPicker
                              value={field.value}
                              onChange={(id, name) => {
                                field.onChange(id);
                                setCustomerName(name ?? "");
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <TextField control={form.control} name="reference" label="Customer's reference" hint="PO or order number" />
                  </FieldGrid>
                </FormSection>
                <FormSection title="Freight">
                  <FieldGrid className="lg:grid-cols-3">
                    <SelectField control={form.control} name="equipment_type" label="Equipment" options={EQUIPMENT_TYPES} />
                    <TextField control={form.control} name="commodity" label="Commodity" />
                    <TextField control={form.control} name="bol_number" label="BOL number" />
                    <TextField control={form.control} name="weight_lbs" label="Weight (lb)" inputMode="numeric" />
                    <TextField control={form.control} name="miles" label="Miles" inputMode="numeric" />
                    {terminals.options.length ? <SelectField control={form.control} name="terminal_id" label="Terminal" placeholder="None" options={terminals.options} /> : null}
                    <TextareaField control={form.control} name="instructions" label="Instructions for the driver" rows={3} className="sm:col-span-2 lg:col-span-3" />
                  </FieldGrid>
                </FormSection>
                <Items />
              </CardContent>
            </Card>
          </div>

          <div hidden={step !== 1}>
            <StopsEditor customerId={customerId || undefined} />
          </div>

          <div hidden={step !== 2}>
            <Card>
              <CardContent className="grid gap-6">
                <FormSection title="Rate" description="What the customer pays for the haul, before extra charges.">
                  <FieldGrid>
                    <TextField control={form.control} name="customer_rate" label={`Line haul (${org.base_currency})`} inputMode="decimal" required={canRates} />
                  </FieldGrid>
                </FormSection>
                <Charges />
              </CardContent>
            </Card>
          </div>

          {step === 3 ? <Review values={values} customerName={customerName} terminalName={terminals.nameOf(values.terminal_id)} /> : null}

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {step > 0 ? (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={create.isPending}>
                <ArrowLeftIcon /> Back
              </Button>
            ) : null}
            <div className="flex-1" />
            <SubmitButton type="button" variant="outline" pending={create.isPending && create.variables?.status === "draft"} disabled={create.isPending} onClick={() => submit("draft")}>
              Save as draft
            </SubmitButton>
            {step < STEPS.length - 1 ? (
              <Button type="submit">
                Next <ArrowRightIcon />
              </Button>
            ) : (
              <SubmitButton pending={create.isPending && create.variables?.status === "planned"} disabled={create.isPending}>
                Book load
              </SubmitButton>
            )}
          </div>
        </form>
      </Form>
    </>
  );
}
