"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTerminalPreference } from "@/hooks/use-terminal-preference";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useOrg, useSession, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, timeZoneLabel } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber, plural } from "@/lib/format/text";
import { resourcePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Summary = Schema<"DashboardSummary">;
type Exception = Schema<"Exception_">;

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold tracking-tight", tone === "danger" && "text-destructive", tone === "warning" && "text-warning")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Blocks({ summary }: { summary: Summary }) {
  const { loads, fleet, safety, receivables, revenue } = summary;
  const change = revenue && Number(revenue.last_month) > 0 ? Math.round(((Number(revenue.this_month) - Number(revenue.last_month)) / Number(revenue.last_month)) * 100) : null;
  return (
    <div className="grid gap-6">
      {loads ? (
        <Section title="Operations">
          <Stat label="Active loads" value={formatNumber(loads.active)} hint={`${formatNumber(loads.in_transit)} on the road`} />
          <Stat label="Waiting for a driver" value={formatNumber(loads.unassigned)} tone={loads.unassigned ? "warning" : undefined} />
          <Stat label="Pickups today" value={formatNumber(loads.pickups_today)} hint={`${plural(loads.deliveries_today, "delivery", "deliveries")} today`} />
          <Stat label="At risk" value={formatNumber(loads.at_risk)} hint="Late, or picking up soon with no driver" tone={loads.at_risk ? "danger" : undefined} />
        </Section>
      ) : null}
      {receivables || revenue ? (
        <Section title="Money">
          {revenue ? (
            <Stat label="Delivered this month" value={formatMoney(revenue.this_month, revenue.currency)} hint={change === null ? plural(revenue.loads_delivered_this_month, "load") : `${change >= 0 ? "+" : ""}${change}% on last month`} />
          ) : null}
          {receivables ? (
            <>
              <Stat label="Owed by customers" value={formatMoney(receivables.open_balance, receivables.currency)} hint={plural(receivables.open_invoices, "open invoice")} />
              <Stat label="Overdue" value={formatMoney(receivables.overdue_balance, receivables.currency)} hint={plural(receivables.overdue_invoices, "invoice")} tone={receivables.overdue_invoices ? "danger" : undefined} />
              <Stat label="Ready to invoice" value={formatMoney(receivables.ready_to_invoice_amount, receivables.currency)} hint={plural(receivables.ready_to_invoice_loads, "completed load")} />
            </>
          ) : null}
        </Section>
      ) : null}
      {fleet || safety ? (
        <Section title="Fleet and safety">
          {fleet ? (
            <>
              <Stat label="Drivers on a load" value={`${formatNumber(fleet.drivers_on_load)} / ${formatNumber(fleet.drivers_active)}`} hint="of active drivers" />
              <Stat label="Trucks on a load" value={`${formatNumber(fleet.trucks_on_load)} / ${formatNumber(fleet.trucks_active)}`} hint={fleet.trucks_unavailable ? `${formatNumber(fleet.trucks_unavailable)} in the shop or out of service` : "of active trucks"} />
            </>
          ) : null}
          {safety ? (
            <>
              <Stat label="Can't be dispatched" value={formatNumber(safety.drivers_blocked + safety.units_blocked)} hint={`${plural(safety.drivers_blocked, "driver")}, ${plural(safety.units_blocked, "unit")}`} tone={safety.drivers_blocked + safety.units_blocked ? "danger" : undefined} />
              <Stat label="Expiring in 30 days" value={formatNumber(safety.expiring)} tone={safety.expiring ? "warning" : undefined} />
            </>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

const SEVERITY: Record<Exception["severity"], string> = { high: "bg-destructive", medium: "bg-warning", low: "bg-muted-foreground/50" };

function Exceptions() {
  const org = useOrg();
  const path = useWorkspacePath();
  const query = useQuery({ queryKey: [org.id, "dashboard", "exceptions"], queryFn: () => unwrap(api.GET("/api/v1/dashboard/exceptions")) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        {query.isPending ? (
          <div className="grid gap-2 p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} className="py-8" />
        ) : query.data.length === 0 ? (
          <EmptyState icon={CircleCheckIcon} title="Nothing needs you right now" description="Late loads, expired paperwork and overdue invoices will show up here." className="py-8" />
        ) : (
          <ul>
            {query.data.map((item) => {
              const target = resourcePath(item.resource);
              const body = (
                <>
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY[item.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      <span className="tabular">{formatNumber(item.count)}</span> · {item.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                  {target ? <ArrowRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
                </>
              );
              return (
                <li key={item.code}>
                  {target ? (
                    <Link href={`${path(target)}?${new URLSearchParams(item.params)}`} className="flex gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { user, organization } = useSession();
  const [terminal] = useTerminalPreference();
  const summary = useQuery({ queryKey: [organization.id, "dashboard", "summary", terminal], queryFn: () => unwrap(api.GET("/api/v1/dashboard/summary", { params: { query: { terminal_id: terminal || undefined } } })) });

  return (
    <>
      <PageHeader
        title={`Hello, ${user.full_name.split(" ")[0]}`}
        description={summary.data ? `${organization.name} · ${formatDate(summary.data.today)} · times shown in ${timeZoneLabel(summary.data.timezone)}` : organization.name}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {summary.isPending ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading figures">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : summary.isError ? (
            <Card>
              <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
            </Card>
          ) : (
            <Blocks summary={summary.data} />
          )}
        </div>
        <Exceptions />
      </div>
    </>
  );
}
