"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, Card, CardHeader, Empty, ErrorNote, Loading, PageHeader, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { day, label, money } from "@/lib/format";
import { useMe } from "@/lib/hooks";

type Operations = {
  loads_by_status: Record<string, number>;
  active_loads: number;
  unassigned_loads: number;
  awaiting_confirmation: number;
  ready_to_invoice: number;
  invoiced_total: string;
  receivables_outstanding: string;
  overdue_invoices: { count: number; total: string };
};
type Compliance = { items: { entity: string; id: string; label: string; credential: string; expires_on: string; expired: boolean }[] };

const PIPELINE = ["pending", "assigned", "dispatched", "in_transit", "delivered", "completed", "invoiced", "paid"];

export default function OverviewPage() {
  const { me, can } = useMe();
  const allowed = can("reports:read");
  const ops = useQuery({ queryKey: ["ops"], queryFn: () => api.get<Operations>("/reports/operations"), enabled: allowed });
  const comp = useQuery({ queryKey: ["compliance"], queryFn: () => api.get<Compliance>("/reports/compliance?days=30"), enabled: allowed });

  if (!allowed) {
    return (
      <>
        <PageHeader title={`Welcome, ${me?.full_name ?? ""}`} />
        <Card>
          <Empty>Use the menu to get to your work.</Empty>
        </Card>
      </>
    );
  }
  if (ops.isLoading) return <Loading />;
  if (ops.error || !ops.data) return <ErrorNote error={ops.error} />;
  const o = ops.data;
  const max = Math.max(1, ...PIPELINE.map((s) => o.loads_by_status[s] ?? 0));

  const tiles: { label: string; value: string | number; href: string; warn?: boolean; note?: string }[] = [
    { label: "Needs a driver", value: o.unassigned_loads, href: "/dispatch", warn: o.unassigned_loads > 0 },
    { label: "On the road", value: o.active_loads, href: "/dispatch" },
    { label: "Delivered — to confirm", value: o.awaiting_confirmation, href: "/loads", warn: o.awaiting_confirmation > 0 },
    { label: "Ready to invoice", value: o.ready_to_invoice, href: "/loads", warn: o.ready_to_invoice > 0 },
    { label: "Receivables outstanding", value: money(o.receivables_outstanding), href: "/invoices" },
    {
      label: "Overdue",
      value: money(o.overdue_invoices.total),
      href: "/invoices",
      warn: o.overdue_invoices.count > 0,
      note: `${o.overdue_invoices.count} invoice${o.overdue_invoices.count === 1 ? "" : "s"}`,
    },
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle={me?.organization_name} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 hover:border-slate-300">
            <div className="text-xs font-medium text-slate-500">{t.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${t.warn ? "text-amber-700" : "text-slate-900"}`}>{t.value}</div>
            {t.note && <div className="text-xs text-slate-500">{t.note}</div>}
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Loads by stage" />
          <ul className="space-y-2.5 p-4">
            {PIPELINE.map((s) => {
              const n = o.loads_by_status[s] ?? 0;
              return (
                <li key={s} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 text-sm">
                  <span className="text-slate-600">{label(s)}</span>
                  <span className="h-2 rounded-full bg-slate-100" aria-hidden>
                    <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="text-right font-medium tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Compliance — next 30 days" />
          {comp.isLoading ? (
            <Loading />
          ) : !comp.data?.items.length ? (
            <Empty>Nothing expiring in the next 30 days</Empty>
          ) : (
            <Table
              head={
                <>
                  <Th>Who / what</Th>
                  <Th>Credential</Th>
                  <Th>Expires</Th>
                </>
              }
            >
              {comp.data.items.map((c) => (
                <tr key={`${c.id}-${c.credential}`}>
                  <Td>
                    <span className="font-medium text-slate-900">{c.label}</span> <span className="text-xs text-slate-500">{c.entity}</span>
                  </Td>
                  <Td>{c.credential}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      {day(c.expires_on)}
                      <Badge tone={c.expired ? "red" : "amber"}>{c.expired ? "Expired" : "Expiring"}</Badge>
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
