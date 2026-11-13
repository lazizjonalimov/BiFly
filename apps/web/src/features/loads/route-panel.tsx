"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ClockIcon, PencilIcon, PhoneIcon, RouteIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, TextField, TextareaField } from "@/components/forms/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LoadDetail, Stop } from "@/features/loads/lib";
import { StopsEditor, routeProblem, stopFromApi, stopSchema, stopToApi } from "@/features/loads/stops-editor";
import { CONFLICT_MESSAGE, isVersionConflict, useLatestLoad, useLoadMutation } from "@/features/loads/use-load";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";
import { formatDateTime, fromLocalInput, timeZoneLabel, toLocalInput } from "@/lib/format/dates";
import { place } from "@/lib/format/text";
import { optionalText } from "@/lib/validation";
import { cn } from "@/lib/utils";

const routeSchema = z.object({ stops: z.array(stopSchema).min(1, "Add at least one stop") });
type RouteValues = z.infer<typeof routeSchema>;

/** Rebuild the whole route: add, remove and reorder stops. Allowed until the load is dispatched. */
function RouteSheet({ load, open, onOpenChange }: { load: LoadDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const org = useOrg();
  const latest = useLatestLoad(load.id);
  const form = useForm<RouteValues>({ resolver: zodResolver(routeSchema), defaultValues: { stops: load.stops.map((s) => stopFromApi(s, org.timezone)) } });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useLoadMutation(load.id, (values: RouteValues) => unwrap(api.PUT("/api/v1/loads/{load_id}/stops", { params: { path: { load_id: load.id } }, body: { version: load.version, stops: values.stops.map((s) => stopToApi(s, org.timezone)) } })), {
    success: () => "Route saved",
    quiet: true,
  });
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={`Route of ${load.load_number}`}
      description="Stops can be added, removed and reordered until the load is dispatched."
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        const problem = load.status === "draft" ? null : routeProblem(values.stops);
        if (problem) return setFormError(problem);
        save.mutate(values, {
          onSuccess: () => onOpenChange(false),
          onError: async (error) => {
            if (!isVersionConflict(error)) return setFormError(applyApiErrors(form, error));
            const fresh = await latest();
            form.reset({ stops: fresh.stops.map((s) => stopFromApi(s, org.timezone)) });
            setFormError(CONFLICT_MESSAGE);
          },
        });
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel="Save route"
    >
      <StopsEditor customerId={load.customer.id} />
    </EntitySheet>
  );
}

const scheduleSchema = z
  .object({ appt_start: z.string(), appt_end: z.string(), contact_name: optionalText(120), contact_phone: optionalText(40), reference: optionalText(80), instructions: optionalText(1000) })
  .refine((s) => !s.appt_start || !s.appt_end || s.appt_end >= s.appt_start, { path: ["appt_end"], message: "The appointment can't end before it starts" });
type ScheduleValues = z.infer<typeof scheduleSchema>;

/** Move one stop's appointment or change who to ask for. Allowed until the truck has left that stop. */
function scheduleValues(stop: Stop, timeZone: string): ScheduleValues {
  return { appt_start: toLocalInput(stop.appt_start, timeZone), appt_end: toLocalInput(stop.appt_end, timeZone), contact_name: stop.contact_name ?? "", contact_phone: stop.contact_phone ?? "", reference: stop.reference ?? "", instructions: stop.instructions ?? "" };
}

function ScheduleSheet({ load, stop, index, onOpenChange }: { load: LoadDetail; stop: Stop; index: number; onOpenChange: (open: boolean) => void }) {
  const org = useOrg();
  const latest = useLatestLoad(load.id);
  const form = useForm<ScheduleValues>({ resolver: zodResolver(scheduleSchema), defaultValues: scheduleValues(stop, org.timezone) });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useLoadMutation(
    load.id,
    (v: ScheduleValues) =>
      unwrap(
        api.PATCH("/api/v1/loads/{load_id}/stops/{stop_id}", {
          params: { path: { load_id: load.id, stop_id: stop.id } },
          body: {
            version: load.version,
            appt_start: v.appt_start ? fromLocalInput(v.appt_start, org.timezone) : null,
            appt_end: v.appt_end ? fromLocalInput(v.appt_end, org.timezone) : null,
            contact_name: v.contact_name.trim() || null,
            contact_phone: v.contact_phone.trim() || null,
            reference: v.reference.trim() || null,
            instructions: v.instructions.trim() || null,
          },
        }),
      ),
    { success: () => `Stop ${index + 1} updated`, quiet: true },
  );
  return (
    <EntitySheet
      open
      onOpenChange={onOpenChange}
      title={`Stop ${index + 1}: ${place(stop.city, stop.state)}`}
      description={`Times are in ${timeZoneLabel(org.timezone)}.`}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values, {
          onSuccess: () => onOpenChange(false),
          onError: async (error) => {
            if (!isVersionConflict(error)) return setFormError(applyApiErrors(form, error));
            const fresh = (await latest()).stops.find((s) => s.id === stop.id);
            if (fresh) form.reset(scheduleValues(fresh, org.timezone));
            setFormError(CONFLICT_MESSAGE);
          },
        });
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel="Save"
    >
      <FieldGrid>
        <TextField control={form.control} name="appt_start" label="Appointment from" type="datetime-local" />
        <TextField control={form.control} name="appt_end" label="Until" type="datetime-local" />
        <TextField control={form.control} name="contact_name" label="Contact" />
        <TextField control={form.control} name="contact_phone" label="Contact phone" type="tel" autoComplete="off" />
        <TextField control={form.control} name="reference" label="Pickup or delivery number" className="sm:col-span-2" />
        <TextareaField control={form.control} name="instructions" label="Instructions for the driver" rows={3} className="sm:col-span-2" />
      </FieldGrid>
    </EntitySheet>
  );
}

/** The stops in order, with what has happened at each: the core of a load's page. */
export function RoutePanel({ load }: { load: LoadDetail }) {
  const org = useOrg();
  const [editingRoute, setEditingRoute] = useState(false);
  const [editingStop, setEditingStop] = useState<number | null>(null);
  const firstOpen = load.stops.findIndex((s) => !s.departed_at);

  return (
    <div className="p-5">
      {load.editable.stops ? (
        <div className="mb-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setEditingRoute(true)}>
            <RouteIcon /> Edit route
          </Button>
        </div>
      ) : null}
      {load.stops.length === 0 ? <p className="text-sm text-muted-foreground">No stops yet. A draft can be saved without a route; add one before marking it ready.</p> : null}
      <ol className="relative grid gap-0">
        {load.stops.map((stop, index) => {
          const done = !!stop.departed_at;
          const here = index === firstOpen && !!stop.arrived_at;
          const last = index === load.stops.length - 1;
          return (
            <li key={stop.id} className="relative flex gap-4 pb-6 last:pb-0">
              {!last ? <span aria-hidden className={cn("absolute top-8 bottom-0 left-[15px] w-0.5", done ? "bg-success/50" : "bg-border")} /> : null}
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold", done ? "border-success bg-success text-white" : here ? "border-warning bg-warning/15 text-warning" : stop.type === "pickup" ? "border-info/40 bg-card text-info" : "border-success/40 bg-card text-success")}>
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {stop.type === "pickup" ? "Pickup" : "Delivery"}: {[stop.name, place(stop.city, stop.state)].filter(Boolean).join(", ")}
                  {here ? <Badge variant="warning">Truck is here</Badge> : null}
                  {done ? <Badge variant="success">Done</Badge> : null}
                </p>
                {stop.address ? <p className="text-sm text-muted-foreground">{[stop.address, stop.postal_code].filter(Boolean).join(", ")}</p> : null}
                <p className="mt-1 flex items-center gap-1.5 text-sm">
                  <ClockIcon className="size-3.5 text-muted-foreground" />
                  {stop.appt_start || stop.appt_end ? (
                    <span>
                      {formatDateTime(stop.appt_start ?? stop.appt_end, org.timezone)}
                      {stop.appt_start && stop.appt_end ? ` to ${formatDateTime(stop.appt_end, org.timezone)}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No appointment</span>
                  )}
                </p>
                {stop.arrived_at || stop.departed_at ? (
                  <p className="text-sm text-muted-foreground">
                    {stop.arrived_at ? `Arrived ${formatDateTime(stop.arrived_at, org.timezone)}` : ""}
                    {stop.departed_at ? ` · Left ${formatDateTime(stop.departed_at, org.timezone)}` : ""}
                  </p>
                ) : null}
                {stop.contact_name || stop.contact_phone ? (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <PhoneIcon className="size-3.5" /> {[stop.contact_name, stop.contact_phone].filter(Boolean).join(", ")}
                  </p>
                ) : null}
                {stop.reference ? <p className="text-sm text-muted-foreground">Ref {stop.reference}</p> : null}
                {stop.instructions ? <p className="mt-1 text-sm whitespace-pre-wrap">{stop.instructions}</p> : null}
                {load.editable.schedule && !done && !load.editable.stops ? (
                  <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => setEditingStop(index)}>
                    <PencilIcon /> Change appointment
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {editingRoute ? <RouteSheet load={load} open onOpenChange={setEditingRoute} /> : null}
      {editingStop !== null && load.stops[editingStop] ? <ScheduleSheet load={load} stop={load.stops[editingStop]!} index={editingStop} onOpenChange={(open) => !open && setEditingStop(null)} /> : null}
    </div>
  );
}
