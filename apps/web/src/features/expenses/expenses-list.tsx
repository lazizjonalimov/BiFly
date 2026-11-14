"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon, PlusIcon, ReceiptTextIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentsPanel } from "@/features/documents/documents-panel";
import { ExpenseSheet } from "@/features/expenses/expense-sheet";
import { CATEGORIES, categoryLabel, invalidateExpenses, paidWithLabel, type Expense } from "@/features/expenses/lib";
import { FinanceTabs } from "@/features/finance/finance-tabs";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { formatNumber } from "@/lib/format/text";

const FILTERS = { category: "", driver_treatment: "" };
const dash = <span className="text-muted-foreground">—</span>;

function DriverEffect({ expense }: { expense: Expense }) {
  const path = useWorkspacePath();
  if (expense.driver_treatment === "none") return dash;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant={expense.driver_treatment === "reimburse" ? "info" : "warning"}>{expense.driver_treatment === "reimburse" ? "Reimburse" : "Deduct"}</Badge>
      {expense.settlement ? (
        <Link href={path("finance", "settlements", expense.settlement.id)} className="text-xs hover:underline">
          {expense.settlement.number ?? "Draft settlement"}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">Next settlement</span>
      )}
    </span>
  );
}

function attachedTo(expense: Expense): string | null {
  return [expense.vehicle?.name, expense.trailer?.name, expense.driver?.name, expense.load?.name].filter(Boolean).join(" · ") || null;
}

/** One expense: everything about it, its receipts, and what can still be done with it. */
function ExpenseDialog({ expense, onOpenChange, onEdit }: { expense: Expense; onOpenChange: (open: boolean) => void; onEdit: () => void }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/expenses/{expense_id}", { params: { path: { expense_id: expense.id } } })),
    onSuccess: () => {
      invalidateExpenses(queryClient, org.id);
      toast.success("Expense removed");
      onOpenChange(false);
    },
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {categoryLabel(expense.category)}, {formatMoney(expense.amount, expense.currency)}
          </DialogTitle>
          <DialogDescription>
            {formatDate(expense.incurred_on)}
            {expense.vendor ? ` · ${expense.vendor}` : ""}
          </DialogDescription>
        </DialogHeader>
        {expense.settlement && !expense.editable && can("expenses.manage") ? (
          <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
            Part of driver settlement{" "}
            <Link href={path("finance", "settlements", expense.settlement.id)} className="font-medium hover:underline">
              {expense.settlement.number}
            </Link>
            , so it can&apos;t be changed.
          </p>
        ) : null}
        <DescriptionList className="sm:grid-cols-2 lg:grid-cols-2">
          {expense.category === "fuel" ? (
            <>
              <Detail label="Gallons">{expense.gallons ? `${Number(expense.gallons)} gal ${expense.fuel_type ?? ""}` : null}</Detail>
              <Detail label="Price per gallon">{expense.price_per_gallon ? `$${expense.price_per_gallon}` : null}</Detail>
              <Detail label="State">{expense.jurisdiction}</Detail>
              <Detail label="Odometer">{expense.odometer !== null && expense.odometer !== undefined ? `${formatNumber(expense.odometer)} mi` : null}</Detail>
            </>
          ) : null}
          <Detail label="Paid with">{expense.paid_with ? paidWithLabel(expense.paid_with) : null}</Detail>
          <Detail label="Reference">{expense.reference}</Detail>
          <Detail label="Attached to">{attachedTo(expense)}</Detail>
          <Detail label="Driver pay">
            <DriverEffect expense={expense} />
          </Detail>
          {expense.description ? <Detail label="What for">{expense.description}</Detail> : null}
          {expense.notes ? (
            <Detail label="Notes" className="sm:col-span-2">
              <span className="whitespace-pre-wrap">{expense.notes}</span>
            </Detail>
          ) : null}
          <Detail label="Recorded by">{expense.created_by_name}</Detail>
        </DescriptionList>
        {can("documents.read") ? (
          <div className="rounded-md border">
            <DocumentsPanel entityType="expense" entityId={expense.id} types={["receipt", "other"]} emptyHint="Attach the receipt." />
          </div>
        ) : null}
        <DialogFooter>
          {expense.editable ? (
            <>
              <Button variant="outline" onClick={() => setRemoving(true)}>
                <Trash2Icon /> Remove
              </Button>
              <Button onClick={onEdit}>
                <PencilIcon /> Edit
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
        <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Remove this expense?" description="Its receipts stay in Documents. If it was on a draft settlement, the draft is recalculated." confirmLabel="Remove" destructive onConfirm={() => remove.mutateAsync()} />
      </DialogContent>
    </Dialog>
  );
}

function Tiles() {
  const org = useOrg();
  const summary = useQuery({ queryKey: [org.id, "expenses", "summary"], queryFn: () => unwrap(api.GET("/api/v1/expenses/summary")) });
  const s = summary.data;
  const fuel = s?.by_category.find((c) => c.category === "fuel");
  const tile = "rounded-lg border bg-card p-3 shadow-xs";
  const value = (text: React.ReactNode) => (s ? <span className="tabular mt-0.5 block text-xl font-semibold">{text}</span> : <Skeleton className="mt-1.5 h-6 w-20" />);
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Spending this month">
      <div className={tile}>
        <span className="block text-xs font-medium text-muted-foreground">Spent this month</span>
        {value(s ? formatMoney(s.total, s.currency) : null)}
      </div>
      <div className={tile}>
        <span className="block text-xs font-medium text-muted-foreground">Fuel this month</span>
        {value(s ? formatMoney(fuel?.amount ?? "0", s.currency) : null)}
      </div>
      <div className={tile}>
        <span className="block text-xs font-medium text-muted-foreground">To pay back to drivers</span>
        {value(s ? formatMoney(s.to_reimburse, s.currency) : null)}
      </div>
      <div className={tile}>
        <span className="block text-xs font-medium text-muted-foreground">To take from drivers&apos; pay</span>
        {value(s ? formatMoney(s.to_deduct, s.currency) : null)}
      </div>
    </div>
  );
}

/** What the company spent: fuel, tolls, lumpers, advances and the rest, with receipts. */
export function ExpensesList() {
  const org = useOrg();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const state = useListState({ defaultSort: "-incurred_on", filters: FILTERS });
  const [sheet, setSheet] = useState<{ expense?: Expense } | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);
  const wantsNew = search.get("new") === "1";
  // A link to one expense (from Documents, say) opens it over the list.
  const linkedId = search.get("expense");
  const linked = useQuery({
    queryKey: [org.id, "expenses", "detail", linkedId],
    queryFn: () => unwrap(api.GET("/api/v1/expenses/{expense_id}", { params: { path: { expense_id: linkedId! } } })),
    enabled: !!linkedId,
  });
  const shown = viewing ?? (linkedId ? (linked.data ?? null) : null);
  const closeShown = () => {
    setViewing(null);
    if (linkedId) {
      const params = new URLSearchParams(search.toString());
      params.delete("expense");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  };

  const query = useQuery({
    queryKey: [org.id, "expenses", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/expenses", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<Expense, unknown>[] = [
    { id: "incurred_on", header: "Date", enableSorting: true, enableHiding: false, cell: ({ row }) => <span className="whitespace-nowrap font-medium">{formatDate(row.original.incurred_on)}</span> },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => (
        <span className="grid">
          {categoryLabel(row.original.category)}
          {row.original.category === "fuel" && row.original.gallons ? (
            <span className="text-xs text-muted-foreground">
              {Number(row.original.gallons)} gal · {row.original.jurisdiction}
            </span>
          ) : null}
        </span>
      ),
    },
    { id: "vendor", header: "Vendor", cell: ({ row }) => row.original.vendor ?? row.original.description ?? dash },
    { id: "attached", header: "Attached to", cell: ({ row }) => attachedTo(row.original) ?? dash },
    { id: "driver_pay", header: "Driver pay", cell: ({ row }) => <DriverEffect expense={row.original} /> },
    { id: "amount", header: "Amount", enableSorting: true, meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{formatMoney(row.original.amount, row.original.currency)}</span> },
  ];

  const closeNew = () => {
    setSheet(null);
    if (wantsNew) {
      const params = new URLSearchParams(search.toString());
      params.delete("new");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  };

  return (
    <>
      <PageHeader
        title="Finance"
        description="Fuel, tolls, lumpers, advances and every other cost, with what each one means for drivers' pay."
        actions={
          can("expenses.manage") ? (
            <Button onClick={() => setSheet({})}>
              <PlusIcon /> Record expense
            </Button>
          ) : null
        }
      />
      <FinanceTabs current="expenses" />
      <Tiles />
      <DataTable
        label="Expenses"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        onRowClick={(row) => setViewing(row)}
        preferenceKey="finance.expenses"
        searchPlaceholder="Search by vendor, description or reference"
        filters={
          <>
            <FilterSelect label="Category" value={state.filters.category ?? ""} onChange={(v) => state.setFilter("category", v)} options={[{ value: "", label: "Any category" }, ...CATEGORIES]} />
            <FilterSelect
              label="Driver pay"
              value={state.filters.driver_treatment ?? ""}
              onChange={(v) => state.setFilter("driver_treatment", v)}
              options={[
                { value: "", label: "Any effect on pay" },
                { value: "reimburse", label: "Reimbursements" },
                { value: "deduct", label: "Deductions" },
                { value: "none", label: "Company costs" },
              ]}
            />
          </>
        }
        empty={{ icon: ReceiptTextIcon, title: "No expenses recorded", description: can("expenses.manage") ? "Record fuel, tolls, lumpers and advances as they happen, with the receipt." : "Expenses appear here once they are recorded." }}
      />
      {shown ? (
        <ExpenseDialog
          expense={shown}
          onOpenChange={(open) => !open && closeShown()}
          onEdit={() => {
            setSheet({ expense: shown });
            closeShown();
          }}
        />
      ) : null}
      {sheet || (wantsNew && can("expenses.manage")) ? <ExpenseSheet open expense={sheet?.expense} onOpenChange={(open) => !open && closeNew()} /> : null}
    </>
  );
}
