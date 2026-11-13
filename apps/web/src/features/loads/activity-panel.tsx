"use client";

import { ArrowRightIcon, CircleAlertIcon, MessageSquareIcon, NavigationIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { statusLabel } from "@/components/status-badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LoadDetail } from "@/features/loads/lib";
import { useLoadMutation } from "@/features/loads/use-load";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useCan, useOrg } from "@/lib/auth/session";
import { formatDateTime, fromLocalInput, timeZoneLabel } from "@/lib/format/dates";
import { place } from "@/lib/format/text";
import { cn } from "@/lib/utils";

const EVENT_LABELS: Record<string, string> = {
  created: "Load created", mark_ready: "Marked ready", assign: "Assigned", unassign: "Unassigned", reassign: "Driver or equipment changed",
  dispatch: "Dispatched", arrive: "Arrived", depart: "Departed", pod_uploaded: "Proof of delivery received", approve_pod: "Proof of delivery approved",
  reject_pod: "Proof of delivery sent back", hold: "Put on hold", release: "Hold released", cancel: "Cancelled",
};

type Entry = { id: string; at: string; kind: "event" | "note" | "tracking"; title: React.ReactNode; body?: string | null; who?: string | null; tone?: "danger" };

function entries(load: LoadDetail): Entry[] {
  const list: Entry[] = [
    ...load.events.map((e) => ({
      id: `e-${e.id}`, at: e.created_at, kind: "event" as const, who: e.actor_name, body: e.note,
      title: (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{EVENT_LABELS[e.action] ?? statusLabel(e.action)}</span>
          {e.from_status && e.from_status !== e.to_status ? (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              {statusLabel(e.from_status)} <ArrowRightIcon className="size-3" /> {statusLabel(e.to_status)}
            </span>
          ) : null}
        </span>
      ),
    })),
    ...load.notes.map((n) => ({ id: `n-${n.id}`, at: n.created_at, kind: "note" as const, who: n.author_name, body: n.body, title: "Note" })),
    ...load.tracking.map((t) => ({
      id: `t-${t.id}`, at: t.occurred_at, kind: "tracking" as const, who: t.actor_name ?? (t.source === "driver" ? "Driver" : null), body: t.note,
      tone: t.kind === "exception" ? ("danger" as const) : undefined,
      title: `${t.kind === "exception" ? "Problem reported" : "Check call"}${t.city ? `: ${place(t.city, t.state)}` : ""}${t.source === "driver" ? " (from the driver)" : ""}`,
    })),
  ];
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

const ICONS = { event: RefreshCwIcon, note: MessageSquareIcon, tracking: NavigationIcon };

function NoteForm({ load }: { load: LoadDetail }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useLoadMutation(load.id, (text: string) => unwrap(api.POST("/api/v1/loads/{load_id}/notes", { params: { path: { load_id: load.id } }, body: { body: text } })), { success: () => "Note added", quiet: true });
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return setError("Write the note first");
        setError(null);
        save.mutate(body.trim(), { onSuccess: () => setBody(""), onError: (e) => setError(errorMessage(e)) });
      }}
    >
      <Label htmlFor="note-body" className="sr-only">
        Note
      </Label>
      <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team: a call with the customer, a change of plan" maxLength={4000} rows={2} />
      <FormError message={error} />
      <div>
        <SubmitButton size="sm" pending={save.isPending}>
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}

function CheckCallForm({ load }: { load: LoadDetail }) {
  const org = useOrg();
  const [kind, setKind] = useState<"check_call" | "exception">("check_call");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useLoadMutation(
    load.id,
    () => unwrap(api.POST("/api/v1/loads/{load_id}/tracking", { params: { path: { load_id: load.id } }, body: { kind, city: city.trim() || null, state: state.trim().toUpperCase() || null, note: note.trim() || null, occurred_at: when ? fromLocalInput(when, org.timezone) : null } })),
    { success: () => (kind === "exception" ? "Problem recorded" : "Check call recorded"), quiet: true },
  );
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate(undefined, {
          onSuccess: () => {
            setCity("");
            setState("");
            setNote("");
            setWhen("");
          },
          onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : errorMessage(e)),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_5rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="cc-kind">Type</Label>
          <NativeSelect id="cc-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="check_call">Check call</option>
            <option value="exception">Problem</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cc-city">Where is the truck</Label>
          <Input id="cc-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" maxLength={80} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cc-state">State</Label>
          <Input id="cc-state" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="cc-note">Note</Label>
          <Input id="cc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "exception" ? "What went wrong, and the new estimate" : "Rolling, on time"} maxLength={500} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cc-when">When ({timeZoneLabel(org.timezone)})</Label>
          <Input id="cc-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      </div>
      <FormError message={error} />
      <div>
        <SubmitButton size="sm" pending={save.isPending}>
          Record {kind === "exception" ? "problem" : "check call"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Everything that has happened to the load, newest first, and where to add to it. */
export function ActivityPanel({ load }: { load: LoadDetail }) {
  const org = useOrg();
  const can = useCan();
  const items = entries(load);
  const tracking = can("loads.update") && !["draft", "completed", "cancelled"].includes(load.status);
  return (
    <div className="grid gap-5 p-5">
      {can("loads.update") ? (
        <Tabs defaultValue="note" className="gap-3">
          <TabsList>
            <TabsTrigger value="note">Add a note</TabsTrigger>
            {tracking ? <TabsTrigger value="tracking">Record a check call</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="note">
            <NoteForm load={load} />
          </TabsContent>
          {tracking ? (
            <TabsContent value="tracking">
              <CheckCallForm load={load} />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}
      <ol className="grid gap-4" aria-label="Activity">
        {items.map((item) => {
          const Icon = item.tone === "danger" ? CircleAlertIcon : ICONS[item.kind];
          return (
            <li key={item.id} className="flex gap-3">
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", item.tone === "danger" && "bg-destructive/10 text-destructive")}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{item.title}</div>
                {item.body ? <p className="text-sm whitespace-pre-wrap">{item.body}</p> : null}
                <p className="text-xs text-muted-foreground">{[formatDateTime(item.at, org.timezone), item.who].filter(Boolean).join(" · ")}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
