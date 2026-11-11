"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { fromLocalInput, label } from "@/lib/format";
import { useList } from "@/lib/hooks";
import type { Customer, LoadDetail } from "@/lib/types";

const EQUIPMENT = ["dry_van", "reefer", "flatbed", "step_deck", "box_truck", "tanker", "other"];

type StopForm = { key: number; type: "pickup" | "delivery"; name: string; address: string; city: string; state: string; postal_code: string; appt_start: string };
let nextKey = 1;
const blankStop = (type: "pickup" | "delivery"): StopForm => ({ key: nextKey++, type, name: "", address: "", city: "", state: "", postal_code: "", appt_start: "" });

export default function NewLoadPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const customers = useList<Customer>("/customers?status=active");
  const [form, setForm] = useState({ customer_id: "", reference: "", commodity: "", equipment_type: "dry_van", weight_lbs: "", customer_rate: "", notes: "" });
  const [stops, setStops] = useState<StopForm[]>(() => [blankStop("pickup"), blankStop("delivery")]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const setStop = (key: number, patch: Partial<StopForm>) => setStops(stops.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const create = useMutation({
    mutationFn: () =>
      api.post<LoadDetail>("/loads", {
        customer_id: form.customer_id,
        reference: form.reference || null,
        commodity: form.commodity || null,
        equipment_type: form.equipment_type,
        weight_lbs: form.weight_lbs ? Number(form.weight_lbs) : null,
        customer_rate: form.customer_rate || "0",
        notes: form.notes || null,
        stops: stops.map((s) => ({
          type: s.type,
          name: s.name || null,
          address: s.address || null,
          city: s.city,
          state: s.state || null,
          postal_code: s.postal_code || null,
          appt_start: fromLocalInput(s.appt_start),
        })),
      }),
    onSuccess: (load) => {
      qc.invalidateQueries({ queryKey: ["list"] });
      router.push(`/loads/${load.id}`);
    },
  });
  const fe = create.error instanceof ApiError ? create.error.fields : {};

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="space-y-5"
    >
      <PageHeader title="New load" />
      <Card>
        <CardHeader title="Order" />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Customer" error={fe.customer_id} className="sm:col-span-2">
            {(p) => (
              <Select {...p} required value={form.customer_id} onChange={set("customer_id")}>
                <option value="">Select a customer…</option>
                {customers.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {customers.data?.items.length === 0 && (
            <p className="text-sm text-slate-500 sm:col-span-2">
              You have no customers yet.{" "}
              <Link href="/customers" className="font-medium text-brand-600 hover:underline">
                Add one first
              </Link>
              .
            </p>
          )}
          <Field label="Customer reference / PO" error={fe.reference}>
            {(p) => <Input {...p} maxLength={80} value={form.reference} onChange={set("reference")} />}
          </Field>
          <Field label="Rate (USD)" error={fe.customer_rate}>
            {(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={form.customer_rate} onChange={set("customer_rate")} />}
          </Field>
          <Field label="Commodity" error={fe.commodity}>
            {(p) => <Input {...p} maxLength={200} value={form.commodity} onChange={set("commodity")} />}
          </Field>
          <Field label="Weight (lbs)" error={fe.weight_lbs}>
            {(p) => <Input {...p} type="number" min="0" step="1" value={form.weight_lbs} onChange={set("weight_lbs")} />}
          </Field>
          <Field label="Equipment" error={fe.equipment_type}>
            {(p) => (
              <Select {...p} value={form.equipment_type} onChange={set("equipment_type")}>
                {EQUIPMENT.map((e) => (
                  <option key={e} value={e}>
                    {label(e)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => <Textarea {...p} maxLength={4000} value={form.notes} onChange={set("notes")} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Stops"
          action={
            <Button size="sm" onClick={() => setStops([...stops.slice(0, -1), blankStop("delivery"), stops[stops.length - 1]])}>
              Add stop
            </Button>
          }
        />
        <ol className="divide-y divide-slate-100">
          {stops.map((s, i) => {
            const fixed = i === 0 || i === stops.length - 1; // first is always a pickup, last always a delivery
            return (
              <li key={s.key} className="grid gap-3 p-4 sm:grid-cols-6">
                <div className="flex items-center justify-between sm:col-span-6">
                  <span className="text-sm font-semibold text-slate-900">
                    Stop {i + 1} · {label(s.type)}
                  </span>
                  {!fixed && (
                    <Button size="sm" variant="ghost" onClick={() => setStops(stops.filter((x) => x.key !== s.key))}>
                      Remove
                    </Button>
                  )}
                </div>
                {!fixed && (
                  <Field label="Type" className="sm:col-span-2">
                    {(p) => (
                      <Select {...p} value={s.type} onChange={(e) => setStop(s.key, { type: e.target.value as StopForm["type"] })}>
                        <option value="pickup">Pickup</option>
                        <option value="delivery">Delivery</option>
                      </Select>
                    )}
                  </Field>
                )}
                <Field label="Location name" className={fixed ? "sm:col-span-3" : "sm:col-span-4"}>
                  {(p) => <Input {...p} maxLength={160} value={s.name} onChange={(e) => setStop(s.key, { name: e.target.value })} />}
                </Field>
                <Field label="Appointment" className={fixed ? "sm:col-span-3" : "sm:col-span-2"}>
                  {(p) => <Input {...p} type="datetime-local" value={s.appt_start} onChange={(e) => setStop(s.key, { appt_start: e.target.value })} />}
                </Field>
                <Field label="Street address" className={fixed ? "sm:col-span-6" : "sm:col-span-4"}>
                  {(p) => <Input {...p} maxLength={300} value={s.address} onChange={(e) => setStop(s.key, { address: e.target.value })} />}
                </Field>
                <Field label="City" className="sm:col-span-3">
                  {(p) => <Input {...p} required maxLength={80} value={s.city} onChange={(e) => setStop(s.key, { city: e.target.value })} />}
                </Field>
                <Field label="State" className="sm:col-span-1">
                  {(p) => <Input {...p} maxLength={40} value={s.state} onChange={(e) => setStop(s.key, { state: e.target.value })} />}
                </Field>
                <Field label="ZIP" className="sm:col-span-2">
                  {(p) => <Input {...p} maxLength={20} value={s.postal_code} onChange={(e) => setStop(s.key, { postal_code: e.target.value })} />}
                </Field>
              </li>
            );
          })}
        </ol>
      </Card>

      <ErrorNote error={create.error} />
      <div className="flex justify-end gap-2">
        <Link href="/loads">
          <Button>Cancel</Button>
        </Link>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create load"}
        </Button>
      </div>
    </form>
  );
}
