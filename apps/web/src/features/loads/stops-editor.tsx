"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, MapPinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { z } from "zod";
import { FieldGrid, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";
import { fromLocalInput, timeZoneLabel, toLocalInput } from "@/lib/format/dates";
import { optionalState, optionalText, requiredText } from "@/lib/validation";
import { cn } from "@/lib/utils";

export const stopSchema = z
  .object({
    type: z.enum(["pickup", "delivery"]),
    name: optionalText(160),
    address: optionalText(300),
    city: requiredText("the city", 80),
    state: optionalState,
    postal_code: optionalText(20),
    appt_start: z.string(),
    appt_end: z.string(),
    contact_name: optionalText(120),
    contact_phone: optionalText(40),
    reference: optionalText(80),
    instructions: optionalText(1000),
  })
  .refine((s) => !s.appt_start || !s.appt_end || s.appt_end >= s.appt_start, { path: ["appt_end"], message: "The appointment can't end before it starts" });
export type StopValues = z.infer<typeof stopSchema>;
type StopsForm = { stops: StopValues[] };

export const blankStop = (type: StopValues["type"]): StopValues => ({ type, name: "", address: "", city: "", state: "", postal_code: "", appt_start: "", appt_end: "", contact_name: "", contact_phone: "", reference: "", instructions: "" });

export function stopFromApi(stop: Schema<"StopOut">, timeZone: string): StopValues {
  return {
    type: stop.type, name: stop.name ?? "", address: stop.address ?? "", city: stop.city, state: stop.state ?? "", postal_code: stop.postal_code ?? "",
    appt_start: toLocalInput(stop.appt_start, timeZone), appt_end: toLocalInput(stop.appt_end, timeZone),
    contact_name: stop.contact_name ?? "", contact_phone: stop.contact_phone ?? "", reference: stop.reference ?? "", instructions: stop.instructions ?? "",
  };
}

const blank = (value: string) => value.trim() || null;
export function stopToApi(stop: StopValues, timeZone: string): Schema<"StopIn"> {
  return {
    type: stop.type, name: blank(stop.name), address: blank(stop.address), city: stop.city.trim(), state: blank(stop.state.toUpperCase()), postal_code: blank(stop.postal_code),
    appt_start: stop.appt_start ? fromLocalInput(stop.appt_start, timeZone) : null, appt_end: stop.appt_end ? fromLocalInput(stop.appt_end, timeZone) : null,
    contact_name: blank(stop.contact_name), contact_phone: blank(stop.contact_phone), reference: blank(stop.reference), instructions: blank(stop.instructions),
  };
}

/** The rule a load must meet to be planned: it picks up first and delivers last. Drafts may be incomplete. */
export function routeProblem(stops: Pick<StopValues, "type">[]): string | null {
  if (stops.length < 2 || stops[0]?.type !== "pickup" || stops[stops.length - 1]?.type !== "delivery") return "A load needs at least one pickup, and must end with a delivery.";
  return null;
}

/**
 * The stops of a load, in order. A stop can be filled in from one of the customer's saved places, and
 * every time is entered in the company's time zone, whatever the computer's own clock is set to.
 */
export function StopsEditor({ customerId }: { customerId?: string }) {
  const org = useOrg();
  const { control, setValue } = useFormContext<StopsForm>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "stops" });

  const places = useQuery({
    queryKey: [org.id, "customers", "detail", customerId],
    queryFn: () => unwrap(api.GET("/api/v1/customers/{customer_id}", { params: { path: { customer_id: customerId! } } })),
    enabled: !!customerId,
    staleTime: 60_000,
    select: (customer) => customer.addresses.filter((a) => a.kind === "facility"),
  });

  function fillFromPlace(index: number, placeId: string) {
    const place = places.data?.find((p) => p.id === placeId);
    if (!place) return;
    const fill: Partial<StopValues> = { name: place.label, address: place.address ?? "", city: place.city, state: place.state ?? "", postal_code: place.postal_code ?? "", contact_name: place.contact_name ?? "", contact_phone: place.contact_phone ?? "", instructions: place.notes ?? "" };
    for (const [key, value] of Object.entries(fill)) setValue(`stops.${index}.${key as keyof StopValues}`, value as never, { shouldDirty: true, shouldValidate: key === "city" });
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Times are in {timeZoneLabel(org.timezone)}, the company&apos;s time zone.</p>
      {fields.map((field, index) => (
        <Card key={field.id} className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold", field.type === "pickup" ? "bg-info/12 text-info" : "bg-success/12 text-success")}>{index + 1}</span>
            <div className="w-36">
              <SelectField
                control={control}
                name={`stops.${index}.type`}
                label="Stop type"
                className="[&_label]:sr-only"
                options={[
                  { value: "pickup", label: "Pickup" },
                  { value: "delivery", label: "Delivery" },
                ]}
              />
            </div>
            {places.data?.length ? (
              <div className="w-56">
                <NativeSelect aria-label={`Fill stop ${index + 1} from a saved place`} value="" onChange={(e) => fillFromPlace(index, e.target.value)}>
                  <option value="">Use a saved place…</option>
                  {places.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}, {p.city}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move stop ${index + 1} up`}>
                <ArrowUpIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => move(index, index + 1)} disabled={index === fields.length - 1} aria-label={`Move stop ${index + 1} down`}>
                <ArrowDownIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => remove(index)} disabled={fields.length <= 1} aria-label={`Remove stop ${index + 1}`}>
                <Trash2Icon />
              </Button>
            </div>
          </div>
          <FieldGrid className="lg:grid-cols-4">
            <TextField control={control} name={`stops.${index}.name`} label="Place" placeholder="Shipper or receiver" className="lg:col-span-2" />
            <TextField control={control} name={`stops.${index}.address`} label="Street address" className="lg:col-span-2" />
            <TextField control={control} name={`stops.${index}.city`} label="City" required />
            <div className="grid grid-cols-2 gap-3">
              <TextField control={control} name={`stops.${index}.state`} label="State" maxLength={2} />
              <TextField control={control} name={`stops.${index}.postal_code`} label="ZIP" />
            </div>
            <TextField control={control} name={`stops.${index}.appt_start`} label="Appointment from" type="datetime-local" />
            <TextField control={control} name={`stops.${index}.appt_end`} label="Until" type="datetime-local" />
            <TextField control={control} name={`stops.${index}.contact_name`} label="Contact" />
            <TextField control={control} name={`stops.${index}.contact_phone`} label="Contact phone" type="tel" autoComplete="off" />
            <TextField control={control} name={`stops.${index}.reference`} label="Pickup or delivery number" className="lg:col-span-2" />
            <TextareaField control={control} name={`stops.${index}.instructions`} label="Instructions for the driver" rows={2} className="sm:col-span-2 lg:col-span-4" />
          </FieldGrid>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => append(blankStop("pickup"))}>
          <PlusIcon /> Add pickup
        </Button>
        <Button variant="outline" size="sm" onClick={() => append(blankStop("delivery"))}>
          <MapPinIcon /> Add delivery
        </Button>
      </div>
    </div>
  );
}
