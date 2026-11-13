"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, Loader2Icon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { LoadListItem } from "@/features/loads/lib";
import { route } from "@/features/loads/lib";
import { useDebouncedInput } from "@/hooks/use-debounced";
import { useTerminals } from "@/hooks/use-options";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

type Candidate = Schema<"Candidate">;
type Reason = Schema<"Reason">;
type LoadDetail = Schema<"LoadDetail">;

const ROLLING = ["dispatched", "at_pickup", "in_transit", "at_delivery"];

function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="mt-1 grid gap-0.5">
      {reasons.map((r, i) => (
        <li key={`${r.code}-${i}`} className={cn("flex items-start gap-1.5 text-xs", r.severity === "blocking" ? "text-destructive" : "text-warning")}>
          {r.severity === "blocking" ? <ShieldAlertIcon className="mt-px size-3.5 shrink-0" /> : <CircleAlertIcon className="mt-px size-3.5 shrink-0" />}
          {r.message}
        </li>
      ))}
    </ul>
  );
}

function CandidateList({ legend, name, candidates, value, onChange, optional, currentId }: { legend: string; name: string; candidates: Candidate[]; value: string; onChange: (id: string) => void; optional?: boolean; currentId?: string | null }) {
  const terminals = useTerminals();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      {candidates.length === 0 ? <p className="text-sm text-muted-foreground">None match.</p> : null}
      <div className="grid gap-1.5">
        {optional ? (
          <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", value === "" && "border-primary bg-primary/5")}>
            <input type="radio" name={name} checked={value === ""} onChange={() => onChange("")} className="accent-(--primary)" />
            No trailer
          </label>
        ) : null}
        {candidates.map((c) => (
          <label key={c.id} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2", c.eligible ? "cursor-pointer" : "cursor-not-allowed bg-muted/40", value === c.id && "border-primary bg-primary/5")}>
            <input type="radio" name={name} value={c.id} checked={value === c.id} disabled={!c.eligible && c.id !== currentId} onChange={() => onChange(c.id)} className="mt-1 accent-(--primary)" aria-describedby={`${name}-${c.id}-why`} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {c.name}
                {c.id === currentId ? <Badge variant="default">Current</Badge> : null}
                {!c.eligible ? <Badge variant="danger">Blocked</Badge> : null}
              </span>
              <span id={`${name}-${c.id}-why`} className="block text-xs text-muted-foreground">
                {[c.detail, c.terminal_id ? terminals.nameOf(c.terminal_id) : null, c.current_load ? `On ${c.current_load.load_number}` : null].filter(Boolean).join(" · ")}
              </span>
              <ReasonList reasons={c.reasons} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Choose who and what hauls a load. Every option shows whether it can take the load and why not, from the
 * same rules the API applies when the assignment is saved; the API checks again inside that transaction,
 * so two dispatchers can never book the same driver for overlapping work.
 */
export function AssignPanel({ load, open, onOpenChange, onDone }: { load: LoadListItem; open: boolean; onOpenChange: (open: boolean) => void; onDone?: (load: LoadDetail) => void }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const current = load.assignment;
  const reassigning = !!current && current.status === "active";
  const [driverId, setDriverId] = useState(current?.driver.id ?? "");
  const [vehicleId, setVehicleId] = useState(current?.vehicle.id ?? "");
  const [trailerId, setTrailerId] = useState(current?.trailer?.id ?? "");
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [typed, setTyped] = useDebouncedInput(q, setQ, 250);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Reason[]>([]);
  const [key, setKey] = useState(idempotencyKey);
  const rolling = ROLLING.includes(load.status);

  const eligible = useQuery({
    queryKey: [org.id, "dispatch", "eligible", load.id, q],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/dispatch/eligible-resources", { params: { query: { load_id: load.id, q: q || undefined } }, signal })),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => {
      const note = reason.trim() || null;
      if (reassigning && current) {
        return unwrap(
          api.PATCH("/api/v1/dispatch/assignments/{assignment_id}", {
            params: { path: { assignment_id: current.id } },
            body: { driver_id: driverId, vehicle_id: vehicleId, trailer_id: trailerId || null, version: load.version, reason: note },
          }),
        );
      }
      return unwrap(
        api.POST("/api/v1/dispatch/assignments", {
          params: { header: { "idempotency-key": key } },
          body: { load_id: load.id, driver_id: driverId, vehicle_id: vehicleId, trailer_id: trailerId || null, version: load.version, reason: note },
        }),
      );
    },
    onSuccess: (saved) => {
      toast.success(reassigning ? `${saved.load_number} reassigned` : `${saved.load_number} assigned to ${saved.assignment?.driver.name}`);
      queryClient.setQueryData([org.id, "loads", "detail", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: [org.id, "loads", "list"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "dispatch"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "drivers"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "dashboard"] });
      setKey(idempotencyKey());
      onDone?.(saved);
      // Not close(): inside this callback the request still counts as in flight, which close() refuses.
      reset();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "ASSIGNMENT_CONFLICT") {
        // Something changed since the list was shown (another dispatcher, an expired card): show why, refresh.
        setBlocking(((e.details.reasons as Reason[] | undefined) ?? []).filter((r) => r.severity === "blocking"));
        setError(e.message);
        void eligible.refetch();
      } else if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        setError("Someone else changed this load while you were choosing. Close this panel to see the latest, then try again.");
        void queryClient.invalidateQueries({ queryKey: [org.id, "loads"] });
        void queryClient.invalidateQueries({ queryKey: [org.id, "dispatch"] });
      } else {
        setError(e instanceof ApiError ? (e.fieldErrors.reason ?? e.message) : errorMessage(e));
      }
    },
  });

  function reset() {
    setError(null);
    setBlocking([]);
    setReason("");
    setQ("");
  }

  function close(next: boolean) {
    if (save.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  const data = eligible.data;
  const needsTrailer = data?.needs_trailer ?? true;
  const unchanged = reassigning && current && current.driver.id === driverId && current.vehicle.id === vehicleId && (current.trailer?.id ?? "") === trailerId;
  const ready = driverId && vehicleId && (!needsTrailer || trailerId || reassigning) && !unchanged && (!rolling || reason.trim());
  const { from, to } = route(load);

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {reassigning ? "Reassign" : "Assign"} {load.load_number}
          </SheetTitle>
          <SheetDescription>
            {from} to {to} · picks up {formatDateTime(load.pickup_at, org.timezone)}
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setBlocking([]);
            save.mutate();
          }}
        >
          <SheetBody className="grid content-start gap-5">
            <FormError message={error} />
            {blocking.length ? <ReasonList reasons={blocking} /> : null}
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search drivers and units" aria-label="Search drivers and units" className="pl-8" />
            </div>
            {eligible.isPending ? (
              <div className="grid gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : eligible.isError ? (
              <FormError message={errorMessage(eligible.error)} />
            ) : data ? (
              <>
                <CandidateList legend="Driver" name="driver" candidates={data.drivers} value={driverId} onChange={setDriverId} currentId={current?.driver.id} />
                <CandidateList legend="Truck" name="vehicle" candidates={data.vehicles} value={vehicleId} onChange={setVehicleId} currentId={current?.vehicle.id} />
                <CandidateList legend="Trailer" name="trailer" candidates={data.trailers} value={trailerId} onChange={setTrailerId} optional={!needsTrailer || reassigning} currentId={current?.trailer?.id} />
              </>
            ) : null}
            {reassigning ? (
              <div className="grid gap-1.5">
                <Label htmlFor="assign-reason">Why the change{rolling ? " (required while the load is under way)" : ""}</Label>
                <Textarea id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="For example: driver out of hours" />
              </div>
            ) : null}
          </SheetBody>
          <SheetFooter>
            {eligible.isFetching && !eligible.isPending ? <Loader2Icon className="mr-auto size-4 animate-spin text-muted-foreground" aria-label="Checking availability" /> : null}
            <Button variant="outline" onClick={() => close(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={save.isPending} disabled={!ready}>
              {reassigning ? "Reassign" : "Assign"}
            </SubmitButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
