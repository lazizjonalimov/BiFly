"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3Icon, DownloadIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterSelect } from "@/components/data-table/data-table";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { findReport, type ReportName } from "@/features/reports/reports";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { formatDate, todayIn } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { PERIODS, periodRange } from "@/lib/format/periods";
import { formatNumber } from "@/lib/format/text";
import { cn } from "@/lib/utils";

type Report = Schema<"Report">;
type Column = Report["columns"][number];
const GROUPS = [
  { value: "customer", label: "By customer" },
  { value: "month", label: "By month" },
  { value: "terminal", label: "By terminal" },
];

function fetchReport(name: ReportName, query: { date_from?: string; date_to?: string; group_by?: "customer" | "month" | "terminal" }, signal: AbortSignal): Promise<Report> {
  switch (name) {
    case "revenue":
      return unwrap(api.GET("/api/v1/reports/revenue", { params: { query }, signal }));
    case "drivers":
      return unwrap(api.GET("/api/v1/reports/drivers", { params: { query: { date_from: query.date_from, date_to: query.date_to } }, signal }));
    case "trucks":
      return unwrap(api.GET("/api/v1/reports/trucks", { params: { query: { date_from: query.date_from, date_to: query.date_to } }, signal }));
    case "ar-aging":
      return unwrap(api.GET("/api/v1/reports/ar-aging", { signal }));
  }
}

/** One cell, written the way its column says: money, a count, a percentage or text. */
export function formatCell(value: unknown, column: Pick<Column, "kind">, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.kind === "money") return formatMoney(value as string, currency);
  if (column.kind === "number") return formatNumber(Number(value));
  if (column.kind === "percent") return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  return String(value);
}

/** A report the API worked out, as a table, for a chosen period, with a CSV download for those allowed. */
export function ReportView({ name }: { name: string }) {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const report = findReport(name);
  useBreadcrumbLabel(report?.title ?? null);

  const period = search.get("period") ?? "this_month";
  const custom = period === "custom";
  const preset = periodRange(custom ? "this_month" : period, todayIn(org.timezone));
  const from = custom ? (search.get("from") ?? preset.from) : preset.from;
  const to = custom ? (search.get("to") ?? preset.to) : preset.to;
  const groupBy = (search.get("group_by") ?? "customer") as "customer" | "month" | "terminal";
  const query = report?.dated ? { date_from: from, date_to: to, ...(name === "revenue" ? { group_by: groupBy } : {}) } : {};

  const result = useQuery({
    queryKey: [org.id, "reports", name, query],
    queryFn: ({ signal }) => fetchReport(name as ReportName, query, signal),
    enabled: !!report,
    placeholderData: keepPreviousData,
  });

  function set(values: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  if (!report) {
    return (
      <Card>
        <EmptyState icon={BarChart3Icon} title="No such report" description="Choose a report from the list." />
      </Card>
    );
  }

  const data = result.data;
  const csv = `/api/v1/reports/${name}?${new URLSearchParams({ ...(query as Record<string, string>), format: "csv" })}`;
  return (
    <>
      <PageHeader
        title={report.title}
        description={report.description}
        actions={
          can("reports.export") && data ? (
            <a href={csv} download className={buttonVariants({ variant: "outline" })}>
              <DownloadIcon /> Download CSV
            </a>
          ) : null
        }
      />
      {report.dated ? (
        <div className="mb-4 flex flex-wrap items-center gap-3" role="group" aria-label="Report period">
          <FilterSelect label="Period" value={period} onChange={(v) => set(v === "custom" ? { period: v, from, to } : { period: v === "this_month" ? null : v, from: null, to: null })} options={[...PERIODS, { value: "custom", label: "Choose dates" }]} />
          {custom ? (
            <>
              <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} className="h-9 w-40" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} className="h-9 w-40" />
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {formatDate(from)} to {formatDate(to)}
            </span>
          )}
          {name === "revenue" ? <FilterSelect label="Group" value={groupBy} onChange={(v) => set({ group_by: v === "customer" ? null : v })} options={GROUPS} /> : null}
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">As of today, {formatDate(todayIn(org.timezone))}.</p>
      )}
      <Card className={cn("min-w-0", result.isFetching && data && "opacity-70 transition-opacity")}>
        {result.isPending ? (
          <div className="grid gap-2 p-5" aria-busy="true" aria-label="Loading report">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : result.isError ? (
          <ErrorState error={result.error} onRetry={() => result.refetch()} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState icon={BarChart3Icon} title="Nothing in this period" description={report.dated ? "Try a longer period." : "Nothing is owed right now."} />
        ) : (
          <Table aria-label={report.title}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {data.columns.map((column) => (
                  <TableHead key={column.key} className={cn(column.kind !== "text" && "text-right")}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, index) => (
                <TableRow key={index}>
                  {data.columns.map((column, i) => (
                    <TableCell key={column.key} className={cn(column.kind !== "text" && "tabular text-right", i === 0 && "font-medium")}>
                      {formatCell(row[column.key], column, data.currency)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            {data.totals ? (
              <TableFooter>
                <TableRow className="font-semibold hover:bg-transparent">
                  {data.columns.map((column) => (
                    <TableCell key={column.key} className={cn(column.kind !== "text" && "tabular text-right")}>
                      {formatCell(data.totals?.[column.key], column, data.currency)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        )}
      </Card>
    </>
  );
}
