"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AssignDialog } from "@/components/assign-dialog";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Loading, Select, StatusBadge } from "@/components/ui";
import { api, newKey } from "@/lib/api";
import { dateTime, label, money } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { Doc, Invoice, LoadDetail, Stop } from "@/lib/types";

export default function LoadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useMe();
  const [assigning, setAssigning] = useState(false);

  const load = useQuery({ queryKey: ["load", id], queryFn: () => api.get<LoadDetail>(`/loads/${id}`) });
  const refresh = () => qc.invalidateQueries();

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
  });
  const run = (fn: () => Promise<unknown>) => action.mutate(fn);

  if (load.isLoading) return <Loading />;
  if (load.error || !load.data) return <ErrorNote error={load.error ?? new Error("Load not found")} />;
  const l = load.data;
  const busy = action.isPending;

  const cancel = () => {
    const reason = window.prompt("Reason for cancelling this load?");
    if (reason?.trim()) run(() => api.post(`/loads/${l.id}/cancel`, { reason: reason.trim() }));
  };
  const invoice = () =>
    run(async () => {
      const inv = await api.post<Invoice>("/invoices", { load_id: l.id }, { idempotencyKey: `invoice-${l.id}-${l.events.length}` });
      router.push(`/invoices/${inv.id}`);
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/loads" className="text-sm text-slate-500 hover:text-slate-900">
            ← Loads
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{l.load_number}</h1>
            <StatusBadge status={l.status} />
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {l.customer_name} · {l.origin} → {l.destination}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {l.status === "pending" && can("dispatch:write") && (
            <Button variant="primary" onClick={() => setAssigning(true)}>
              Assign driver
            </Button>
          )}
          {l.status === "assigned" && can("dispatch:write") && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => run(() => api.post(`/dispatch/loads/${l.id}/dispatch`))}>
                Dispatch to driver
              </Button>
              <Button disabled={busy} onClick={() => run(() => api.delete(`/dispatch/assignments/${l.id}`))}>
                Unassign
              </Button>
            </>
          )}
          {l.status === "delivered" && can("loads:write") && (
            <Button
              variant="primary"
              disabled={busy || !l.has_pod}
              title={l.has_pod ? undefined : "Upload a POD first"}
              onClick={() => run(() => api.post(`/loads/${l.id}/confirm-delivery`))}
            >
              Confirm delivery
            </Button>
          )}
          {l.status === "completed" && can("invoices:write") && (
            <Button variant="primary" disabled={busy} onClick={invoice}>
              Create invoice
            </Button>
          )}
          {l.invoice_id && can("invoices:read") && (
            <Link href={`/invoices/${l.invoice_id}`}>
              <Button>View invoice</Button>
            </Link>
          )}
          {["pending", "assigned", "dispatched"].includes(l.status) && can("loads:write") && (
            <Button variant="danger" disabled={busy} onClick={cancel}>
              Cancel load
            </Button>
          )}
        </div>
      </div>

      <ErrorNote error={action.error} />
      {l.status === "delivered" && !l.has_pod && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The driver reported this load delivered. Upload the proof of delivery below to confirm it.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Stops" />
            <ol>
              {l.stops.map((s, i) => (
                <StopRow
                  key={s.id}
                  stop={s}
                  loadId={l.id}
                  canAct={can("loads:write") && ["dispatched", "in_transit"].includes(l.status) && (i === 0 || !!l.stops[i - 1].departed_at)}
                  onDone={refresh}
                />
              ))}
            </ol>
          </Card>
          <Documents loadId={l.id} canUpload={can("documents:write")} canRead={can("documents:read")} onChange={refresh} />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
              <Info label="Rate" value={money(l.customer_rate)} />
              <Info label="Equipment" value={label(l.equipment_type)} />
              <Info label="Commodity" value={l.commodity ?? "—"} />
              <Info label="Weight" value={l.weight_lbs ? `${l.weight_lbs.toLocaleString()} lbs` : "—"} />
              <Info label="Reference" value={l.reference ?? "—"} />
            </dl>
            {l.notes && <p className="border-t border-slate-100 px-4 py-3 text-sm whitespace-pre-wrap text-slate-600">{l.notes}</p>}
          </Card>
          <Card>
            <CardHeader title="Assignment" />
            {l.assignment ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
                <Info label="Driver" value={l.assignment.driver_name} />
                <Info label="Truck" value={l.assignment.vehicle_unit} />
                <Info label="Trailer" value={l.assignment.trailer_unit ?? "—"} />
              </dl>
            ) : (
              <Empty>Not assigned</Empty>
            )}
          </Card>
          <Card>
            <CardHeader title="History" />
            <ol className="divide-y divide-slate-100">
              {l.events.map((e) => (
                <li key={e.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={e.to_status} />
                    <time className="text-xs text-slate-500">{dateTime(e.created_at)}</time>
                  </div>
                  {e.note && <p className="mt-1 text-xs text-slate-600">{e.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <AssignDialog load={assigning ? l : null} onClose={() => setAssigning(false)} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function StopRow({ stop, loadId, canAct, onDone }: { stop: Stop; loadId: string; canAct: boolean; onDone: () => void }) {
  const [key, setKey] = useState(newKey);
  const next = !stop.arrived_at ? "arrived" : !stop.departed_at ? "departed" : null;
  const record = useMutation({
    mutationFn: () => api.post(`/loads/${loadId}/stops/${stop.id}/events`, { event: next }, { idempotencyKey: key }),
    onSuccess: () => {
      setKey(newKey()); // the next event on this stop is a new action
      onDone();
    },
  });
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge tone={stop.type === "pickup" ? "blue" : "green"}>{label(stop.type)}</Badge>
          <span className="text-sm font-medium text-slate-900">{stop.name ?? `${stop.city}${stop.state ? `, ${stop.state}` : ""}`}</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {[stop.address, stop.city, stop.state, stop.postal_code].filter(Boolean).join(", ")}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Appointment {dateTime(stop.appt_start)}
          {stop.arrived_at && ` · Arrived ${dateTime(stop.arrived_at)}`}
          {stop.departed_at && ` · Departed ${dateTime(stop.departed_at)}`}
        </p>
        {record.error && <p className="mt-1 text-xs text-red-600">{(record.error as Error).message}</p>}
      </div>
      {canAct && next && (
        <Button size="sm" disabled={record.isPending} onClick={() => record.mutate()}>
          Mark {next}
        </Button>
      )}
    </li>
  );
}

function Documents({ loadId, canUpload, canRead, onChange }: { loadId: string; canUpload: boolean; canRead: boolean; onChange: () => void }) {
  const [type, setType] = useState("pod");
  const input = useRef<HTMLInputElement>(null);
  const docs = useQuery({ queryKey: ["documents", loadId], queryFn: () => api.get<Doc[]>(`/loads/${loadId}/documents`), enabled: canRead });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      return api.upload(`/loads/${loadId}/documents`, form);
    },
    onSettled: () => {
      if (input.current) input.current.value = "";
    },
    onSuccess: onChange,
  });
  if (!canRead) return null;
  return (
    <Card>
      <CardHeader title="Documents" />
      {docs.data?.length ? (
        <ul className="divide-y divide-slate-100">
          {docs.data.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Badge>{d.type.toUpperCase()}</Badge>
                <span className="truncate">{d.filename}</span>
              </span>
              <a href={`/api/tms/documents/${d.id}/download`} className="shrink-0 font-medium text-brand-600 hover:underline">
                Download
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No documents yet</Empty>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <Select aria-label="Document type" className="max-w-52" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="pod">Proof of delivery</option>
            <option value="bol">Bill of lading</option>
            <option value="receipt">Receipt</option>
            <option value="other">Other</option>
          </Select>
          <input
            ref={input}
            type="file"
            aria-label="Choose a file to upload"
            accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
            disabled={upload.isPending}
            onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
            className="text-sm text-slate-600 file:mr-3 file:h-8 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium"
          />
          {upload.isPending && <span className="text-sm text-slate-500">Uploading…</span>}
          {upload.error && <span className="text-sm text-red-600">{(upload.error as Error).message}</span>}
        </div>
      )}
    </Card>
  );
}
