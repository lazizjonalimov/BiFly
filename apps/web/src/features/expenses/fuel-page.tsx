"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FuelIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterSelect } from "@/components/data-table/data-table";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import { api, unwrap } from "@/lib/api/client";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, todayIn } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber } from "@/lib/format/text";

const PERIODS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
];

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The calendar range a period means on the company's calendar. Quarters are the fuel-tax quarters. */
export function periodRange(period: string, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  if (period === "last_month") {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
  }
  const quarterStart = Math.floor((m - 1) / 3) * 3 + 1;
  if (period === "this_quarter") return { from: iso(y, quarterStart, 1), to: today };
  if (period === "last_quarter") {
    const [qy, qm] = quarterStart === 1 ? [y - 1, 10] : [y, quarterStart - 3];
    return { from: iso(qy, qm, 1), to: iso(qy, qm + 2, lastDay(qy, qm + 2)) };
  }
  return { from: iso(y, m, 1), to: today };
}

function gallons(value: string | null | undefined): string {
  return value ? `${formatNumber(Number(value))} gal` : "—";
}

/** Fuel bought, by state for the fuel-tax return and by truck with miles per gallon. */
export function FuelPage() {
  const org = useOrg();
  const path = useWorkspacePath();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const period = search.get("period") ?? "this_month";
  const range = periodRange(period, todayIn(org.timezone));
  const query = useQuery({
    queryKey: [org.id, "expenses", "fuel-summary", range],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/expenses/fuel-summary", { params: { query: { date_from: range.from, date_to: range.to } }, signal })),
    placeholderData: keepPreviousData,
  });
  const f = query.data;

  return (
    <>
      <PageHeader title="Finance" description="Fuel by state for the fuel-tax return, and by truck with miles per gallon." />
      <FinanceTabs current="fuel" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect label="Period" value={period} onChange={(v) => router.replace(v === "this_month" ? pathname : `${pathname}?period=${v}`, { scroll: false })} options={PERIODS} />
        <span className="text-sm text-muted-foreground">
          {formatDate(range.from)} to {formatDate(range.to)}
        </span>
      </div>
      {query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Fuel totals">
            {[
              { label: "Gallons", value: f ? gallons(f.gallons) : null },
              { label: "Spent", value: f ? formatMoney(f.amount, f.currency) : null },
              { label: "Average price", value: f ? (f.price_per_gallon ? `$${f.price_per_gallon} / gal` : "—") : null },
              { label: "Fill-ups", value: f ? formatNumber(f.purchases) : null },
            ].map((tile) => (
              <div key={tile.label} className="rounded-lg border bg-card p-3 shadow-xs">
                <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
                {tile.value !== null ? <span className="tabular mt-0.5 block text-xl font-semibold">{tile.value}</span> : <Skeleton className="mt-1.5 h-6 w-20" />}
              </div>
            ))}
          </div>
          {f && f.purchases === 0 ? (
            <Card>
              <EmptyState icon={FuelIcon} title="No fuel recorded in this period" description="Record fuel under Expenses, with the gallons and the state it was bought in." action={<Link href={`${path("finance", "expenses")}?new=1`} className="text-sm font-medium text-primary hover:underline">Record fuel</Link>} />
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>By state</CardTitle>
                </CardHeader>
                {f ? (
                  <Table aria-label="Fuel by state">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>State</TableHead>
                        <TableHead className="text-right">Fill-ups</TableHead>
                        <TableHead className="text-right">Gallons</TableHead>
                        <TableHead className="text-right">Spent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {f.by_jurisdiction.map((row) => (
                        <TableRow key={row.jurisdiction}>
                          <TableCell className="font-medium">{row.jurisdiction}</TableCell>
                          <TableCell className="tabular text-right">{row.purchases}</TableCell>
                          <TableCell className="tabular text-right">{gallons(row.gallons)}</TableCell>
                          <TableCell className="tabular text-right">{formatMoney(row.amount, f.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-semibold hover:bg-transparent">
                        <TableCell>Total</TableCell>
                        <TableCell className="tabular text-right">{f.purchases}</TableCell>
                        <TableCell className="tabular text-right">{gallons(f.gallons)}</TableCell>
                        <TableCell className="tabular text-right">{formatMoney(f.amount, f.currency)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                ) : (
                  <Skeleton className="m-5 h-32" />
                )}
              </Card>
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>By truck</CardTitle>
                </CardHeader>
                {f ? (
                  f.by_truck.length ? (
                    <Table aria-label="Fuel by truck">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Truck</TableHead>
                          <TableHead className="text-right">Gallons</TableHead>
                          <TableHead className="text-right">Spent</TableHead>
                          <TableHead className="text-right">Loaded miles</TableHead>
                          <TableHead className="text-right">MPG</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {f.by_truck.map((row) => (
                          <TableRow key={row.vehicle.id}>
                            <TableCell>
                              <Link href={path("equipment/trucks", row.vehicle.id)} className="font-medium hover:underline">
                                {row.vehicle.name}
                              </Link>
                            </TableCell>
                            <TableCell className="tabular text-right">{gallons(row.gallons)}</TableCell>
                            <TableCell className="tabular text-right">{formatMoney(row.amount, f.currency)}</TableCell>
                            <TableCell className="tabular text-right">{formatNumber(row.miles)}</TableCell>
                            <TableCell className="tabular text-right">{row.mpg ? Number(row.mpg).toFixed(1) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="px-5 pb-5 text-sm text-muted-foreground">No fuel in this period was tied to a truck.</p>
                  )
                ) : (
                  <Skeleton className="m-5 h-32" />
                )}
                <p className="px-5 pb-4 text-xs text-muted-foreground">Miles are the loaded miles of the loads each truck delivered in the period.</p>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
