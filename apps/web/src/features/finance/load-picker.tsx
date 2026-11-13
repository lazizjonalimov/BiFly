"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageIcon } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";
import { formatDay } from "@/lib/format/dates";
import { formatMoney, sumMoney } from "@/lib/format/money";
import { place } from "@/lib/format/text";

type LoadRow = { id: string; load_number: string; reference?: string | null; origin_city?: string | null; origin_state?: string | null; destination_city?: string | null; destination_state?: string | null; delivered_at?: string | null; revenue?: string | null; currency: string };

/**
 * Choose which of a customer's loads go on an invoice. Offered: completed loads that aren't on an invoice yet,
 * plus any already on this one (`current`), so a draft's loads can be added and taken off in one place.
 */
export function InvoiceLoadPicker({ customerId, selected, onChange, current = [] }: { customerId: string; selected: string[]; onChange: (ids: string[]) => void; current?: LoadRow[] }) {
  const org = useOrg();
  const query = useQuery({
    queryKey: [org.id, "loads", "list", "ready-to-invoice", customerId],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/loads", { params: { query: { view: "ready_to_invoice", customer_id: customerId, limit: 100 } }, signal })),
    enabled: !!customerId,
  });
  if (!customerId) return null;
  if (query.isPending) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const ready = query.data.items.filter((load) => !current.some((c) => c.id === load.id));
  const rows: LoadRow[] = [...current, ...ready];
  if (!rows.length) {
    return <EmptyState icon={PackageIcon} title="Nothing to invoice" description="A load can be invoiced once it is completed: delivered, with its proof of delivery approved." className="py-6" />;
  }
  const chosen = new Set(selected);
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  const all = rows.every((r) => chosen.has(r.id));
  const total = sumMoney(rows.filter((r) => chosen.has(r.id)).map((r) => r.revenue));
  return (
    <div className="grid gap-2">
      <div className="max-h-72 overflow-auto rounded-md border">
        <Table aria-label="Loads to invoice">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox checked={all} onCheckedChange={(v) => onChange(v === true ? rows.map((r) => r.id) : [])} aria-label="All loads" />
              </TableHead>
              <TableHead>Load</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Delivered</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((load) => (
              <TableRow key={load.id}>
                <TableCell>
                  <Checkbox checked={chosen.has(load.id)} onCheckedChange={(v) => toggle(load.id, v === true)} aria-label={`Invoice ${load.load_number}`} />
                </TableCell>
                <TableCell>
                  <span className="font-medium">{load.load_number}</span>
                  {load.reference ? <span className="block text-xs text-muted-foreground">Ref {load.reference}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {place(load.origin_city, load.origin_state)} to {place(load.destination_city, load.destination_state)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDay(load.delivered_at, org.timezone)}</TableCell>
                <TableCell className="tabular text-right">{formatMoney(load.revenue, load.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm">
        {selected.length} of {rows.length} chosen · <span className="tabular font-medium">{formatMoney(total, rows[0]?.currency ?? "USD")}</span>
      </p>
    </div>
  );
}
