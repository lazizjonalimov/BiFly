"use client";

import { ChevronDownIcon, MapPinCheckIcon, MapPinIcon, SendIcon, TruckIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AssignPanel } from "@/features/dispatch/assign-panel";
import { ACTIONS, type LoadDetail } from "@/features/loads/lib";
import { currentStop, useLoadMutation } from "@/features/loads/use-load";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";
import { fromLocalInput, timeZoneLabel } from "@/lib/format/dates";
import { place } from "@/lib/format/text";

type Action = Schema<"TransitionIn">["action"];

/** Arriving at or leaving a stop: when it happened (now, unless told otherwise) and an optional note. */
function StopEventDialog({ load, action, open, onOpenChange, run }: { load: LoadDetail; action: "arrive" | "depart"; open: boolean; onOpenChange: (open: boolean) => void; run: (args: { action: Action; reason?: string; stop_id?: string; occurred_at?: string | null }) => Promise<unknown> }) {
  const org = useOrg();
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const target = currentStop(load);
  if (!target) return null;
  const { stop, index } = target;
  const where = [stop.name, place(stop.city, stop.state)].filter(Boolean).join(", ");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await run({ action, stop_id: stop.id, reason: note.trim() || undefined, occurred_at: when ? fromLocalInput(when, org.timezone) : null });
      setPending(false);
      setWhen("");
      setNote("");
      onOpenChange(false);
    } catch (e) {
      setPending(false);
      setError(e instanceof ApiError ? (e.fieldErrors.occurred_at ?? e.message) : errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {action === "arrive" ? "Arrived at" : "Departed from"} stop {index + 1}
            </DialogTitle>
            <DialogDescription>
              {stop.type === "pickup" ? "Pickup" : "Delivery"}: {where}
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="event-time">When ({timeZoneLabel(org.timezone)})</Label>
            <Input id="event-time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leave empty for now. Fill it in when recording it later.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="event-note">Note</Label>
            <Textarea id="event-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>{action === "arrive" ? "Record arrival" : "Record departure"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The buttons for what can happen to this load next. They come from `allowed_actions`, which the API
 * works out from the load's state and the person's role, so nothing is offered that would be refused.
 */
export function LoadActions({ load }: { load: LoadDetail }) {
  const [confirming, setConfirming] = useState<Action | "unassign" | null>(null);
  const [stopEvent, setStopEvent] = useState<"arrive" | "depart" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const allowed = new Set(load.allowed_actions);

  const transition = useLoadMutation(
    load.id,
    (args: { action: Action; reason?: string; stop_id?: string; occurred_at?: string | null }) =>
      unwrap(api.POST("/api/v1/loads/{load_id}/transitions", { params: { path: { load_id: load.id } }, body: { version: load.version, ...args } })),
    { success: (saved, args) => `${saved.load_number} ${ACTIONS[args.action]?.verb ?? "updated"}`, quiet: true },
  );
  const release = useLoadMutation(
    load.id,
    (reason: string) => unwrap(api.POST("/api/v1/dispatch/assignments/{assignment_id}/release", { params: { path: { assignment_id: load.assignment!.id } }, body: { version: load.version, reason: reason || null } })),
    { success: (saved) => `${saved.load_number} is back to planned`, quiet: true },
  );

  const stop = currentStop(load);
  const primary: React.ReactNode[] = [];
  // One-click actions explain a refusal in a toast; the others explain it in their dialog.
  const now = (action: Action) => transition.mutate({ action }, { onError: (error) => toast.error(errorMessage(error)) });
  if (allowed.has("mark_ready")) primary.push(<Button key="ready" onClick={() => now("mark_ready")} disabled={transition.isPending}>Mark ready</Button>);
  if (allowed.has("assign")) primary.push(<Button key="assign" onClick={() => setAssigning(true)}><UserPlusIcon /> Assign</Button>);
  if (allowed.has("dispatch")) primary.push(<Button key="dispatch" onClick={() => setConfirming("dispatch")}><SendIcon /> Dispatch</Button>);
  if (allowed.has("arrive") && stop) primary.push(<Button key="arrive" onClick={() => setStopEvent("arrive")}><MapPinIcon /> Arrived at stop {stop.index + 1}</Button>);
  if (allowed.has("depart") && stop) primary.push(<Button key="depart" onClick={() => setStopEvent("depart")}><MapPinCheckIcon /> Departed stop {stop.index + 1}</Button>);
  if (allowed.has("approve_pod")) primary.push(<Button key="approve" onClick={() => setConfirming("approve_pod")}>Approve POD</Button>);
  if (allowed.has("release")) primary.push(<Button key="release" variant="outline" onClick={() => now("release")} disabled={transition.isPending}>Release hold</Button>);

  const more: { key: string; label: string; icon?: React.ReactNode; onSelect: () => void; destructive?: boolean }[] = [];
  if (allowed.has("reassign")) more.push({ key: "reassign", label: "Change driver or equipment", icon: <UsersIcon />, onSelect: () => setAssigning(true) });
  if (allowed.has("unassign")) more.push({ key: "unassign", label: "Unassign", icon: <UserMinusIcon />, onSelect: () => setConfirming("unassign") });
  if (allowed.has("reject_pod")) more.push({ key: "reject", label: "Reject POD", onSelect: () => setConfirming("reject_pod") });
  if (allowed.has("hold")) more.push({ key: "hold", label: "Put on hold", onSelect: () => setConfirming("hold") });
  if (allowed.has("cancel")) more.push({ key: "cancel", label: "Cancel load", onSelect: () => setConfirming("cancel"), destructive: true });

  const info = confirming && confirming !== "unassign" ? ACTIONS[confirming] : null;
  return (
    <>
      {primary}
      {more.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              More <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {more.map((item, index) => (
              <div key={item.key}>
                {item.destructive && index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={item.onSelect} variant={item.destructive ? "destructive" : undefined}>
                  {item.icon ?? <TruckIcon />} {item.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {info && confirming && confirming !== "unassign" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`${info.label}: ${load.load_number}?`}
          description={info.description ?? ""}
          confirmLabel={info.label}
          destructive={info.destructive}
          reason={info.reason ? { label: "Reason", required: info.reason === "required", placeholder: confirming === "reject_pod" ? "What is wrong with it, so it can be fixed" : undefined } : undefined}
          onConfirm={(reason) => transition.mutateAsync({ action: confirming, reason: reason || undefined })}
        />
      ) : null}
      {confirming === "unassign" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`Unassign ${load.load_number}?`}
          description={`${load.assignment?.driver.name} and the equipment are freed, and the load goes back to planned.`}
          confirmLabel="Unassign"
          reason={{ label: "Reason (optional)" }}
          onConfirm={(reason) => release.mutateAsync(reason)}
        />
      ) : null}
      {stopEvent ? <StopEventDialog load={load} action={stopEvent} open onOpenChange={(open) => !open && setStopEvent(null)} run={(args) => transition.mutateAsync(args)} /> : null}
      {assigning ? <AssignPanel key={`${load.id}-${load.version}`} load={load} open onOpenChange={setAssigning} /> : null}
    </>
  );
}
