"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, Empty, ErrorNote, Field, Input, Loading, Modal, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ApiError, api, newKey } from "@/lib/api";
import { day, label, money } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { Invoice } from "@/lib/types";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useMe();
  const [paying, setPaying] = useState(false);
  const inv = useQuery({ queryKey: ["invoice", id], queryFn: () => api.get<Invoice>(`/invoices/${id}`) });
  const voidIt = useMutation({ mutationFn: () => api.post(`/invoices/${id}/void`), onSuccess: () => qc.invalidateQueries() });

  if (inv.isLoading) return <Loading />;
  if (inv.error || !inv.data) return <ErrorNote error={inv.error ?? new Error("Invoice not found")} />;
  const i = inv.data;
  const open = i.status === "sent";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-slate-500 hover:text-slate-900">
            ← Invoices
          </Link>
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{i.invoice_number}</h1>
            <StatusBadge status={i.overdue ? "overdue" : i.status} />
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {i.customer_name} · Load{" "}
            <Link href={`/loads/${i.load_id}`} className="text-brand-600 hover:underline">
              {i.load_number}
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          {open && can("payments:write") && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              Record payment
            </Button>
          )}
          {open && can("invoices:write") && i.payments.length === 0 && (
            <Button
              variant="danger"
              disabled={voidIt.isPending}
              onClick={() => window.confirm("Void this invoice? The load returns to Completed and can be invoiced again.") && voidIt.mutate()}
            >
              Void
            </Button>
          )}
        </div>
      </div>
      <ErrorNote error={voidIt.error} />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Issued", day(i.issued_date)],
          ["Due", day(i.due_date)],
          ["Total", money(i.total)],
          ["Balance due", money(i.status === "void" ? 0 : i.balance)],
        ].map(([k, v]) => (
          <Card key={k} className="px-4 py-3">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{v}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Line items" />
        <Table
          head={
            <>
              <Th>Description</Th>
              <Th right>Qty</Th>
              <Th right>Unit price</Th>
              <Th right>Amount</Th>
            </>
          }
        >
          {i.lines.map((l, n) => (
            <tr key={n}>
              <Td>{l.description}</Td>
              <Td right>{Number(l.quantity)}</Td>
              <Td right>{money(l.unit_price)}</Td>
              <Td right>{money(l.amount)}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <CardHeader title="Payments" />
        {i.payments.length === 0 ? (
          <Empty>No payments recorded</Empty>
        ) : (
          <Table
            head={
              <>
                <Th>Date</Th>
                <Th>Method</Th>
                <Th>Reference</Th>
                <Th right>Amount</Th>
              </>
            }
          >
            {i.payments.map((p) => (
              <tr key={p.id}>
                <Td>{day(p.paid_on)}</Td>
                <Td>{p.method ? label(p.method) : "—"}</Td>
                <Td>{p.reference ?? "—"}</Td>
                <Td right>{money(p.amount)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={paying} onClose={() => setPaying(false)} title="Record payment">
        {paying && <PaymentForm invoice={i} onDone={() => (qc.invalidateQueries(), setPaying(false))} onCancel={() => setPaying(false)} />}
      </Modal>
    </div>
  );
}

function PaymentForm({ invoice, onDone, onCancel }: { invoice: Invoice; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(invoice.balance);
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [method, setMethod] = useState("ach");
  const [reference, setReference] = useState("");
  const [key] = useState(newKey); // retries of this one payment can never post twice
  const pay = useMutation({
    mutationFn: () =>
      api.post(`/invoices/${invoice.id}/payments`, { amount, paid_on: paidOn, method, reference: reference || null }, { idempotencyKey: key }),
    onSuccess: onDone,
  });
  const fe = pay.error instanceof ApiError ? pay.error.fields : {};
  return (
    <form
      className="grid grid-cols-2 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
    >
      <Field label="Amount (USD)" error={fe.amount} hint={`Balance due ${money(invoice.balance)}`}>
        {(p) => <Input {...p} type="number" required min="0.01" step="0.01" max={invoice.balance} value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Date received" error={fe.paid_on}>
        {(p) => <Input {...p} type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
      </Field>
      <Field label="Method">
        {(p) => (
          <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)}>
            {["ach", "check", "wire", "card", "cash", "other"].map((m) => (
              <option key={m} value={m}>
                {m === "ach" ? "ACH" : label(m)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Reference / check #">
        {(p) => <Input {...p} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />}
      </Field>
      <div className="col-span-2">
        <ErrorNote error={Object.keys(fe).length ? null : pay.error} />
      </div>
      <div className="col-span-2 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pay.isPending}>
          {pay.isPending ? "Saving…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
