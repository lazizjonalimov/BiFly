"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheckIcon, BanknoteIcon, PlusIcon, PrinterIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/states";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAY_METHODS, invalidateSettlements, methodLabel, payTermsText, settlementLabel, useSettlement, useSettlementMutation, type Settlement } from "@/features/settlements/lib";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayIn } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { cn } from "@/lib/utils";

type Line = Settlement["lines"][number];
const SECTIONS: { title: string; kinds: Line["kind"][] }[] = [
  { title: "Earnings", kinds: ["load_pay", "accessorial", "adjustment"] },
  { title: "Reimbursements", kinds: ["reimbursement"] },
  { title: "Deductions", kinds: ["deduction"] },
];

function AddLineDialog({ settlement, onOpenChange }: { settlement: Settlement; onOpenChange: (open: boolean) => void }) {
  const [kind, setKind] = useState<"adjustment" | "deduction" | "reimbursement">("adjustment");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const add = useSettlementMutation(settlement.id, () => unwrap(api.POST("/api/v1/settlements/{settlement_id}/lines", { params: { path: { settlement_id: settlement.id } }, body: { kind, description: description.trim(), amount: amount.trim(), version: settlement.version } })), { success: () => "Line added", quiet: true });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!description.trim()) problems.description = "Say what it is for";
    const pattern = kind === "adjustment" ? /^-?\d{1,10}(\.\d{1,2})?$/ : /^\d{1,10}(\.\d{1,2})?$/;
    if (!pattern.test(amount.trim()) || Number(amount) === 0) problems.amount = kind === "adjustment" ? "Enter an amount like 50.00, or -25.00 to reduce pay" : "Enter an amount like 50.00";
    setErrors(problems);
    setError(null);
    if (Object.keys(problems).length) return;
    add.mutate(undefined, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => {
        if (e instanceof ApiError) setErrors(e.fieldErrors);
        setError(errorMessage(e));
      },
    });
  }
  return (
    <Dialog open onOpenChange={(next) => !add.isPending && onOpenChange(next)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add a line</DialogTitle>
            <DialogDescription>A bonus or correction, a deduction such as an insurance share, or a reimbursement not recorded as an expense. It stays when the draft is recalculated.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="line-kind">Kind</Label>
            <NativeSelect id="line-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="adjustment">Adjustment (bonus or correction)</option>
              <option value="deduction">Deduction</option>
              <option value="reimbursement">Reimbursement</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="line-description">Description</Label>
            <Input id="line-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} aria-invalid={!!errors.description} />
            {errors.description ? <p className="text-xs text-destructive">{errors.description}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="line-amount">Amount ({settlement.currency})</Label>
            <Input id="line-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-invalid={!!errors.amount} />
            {errors.amount ? <p className="text-xs text-destructive">{errors.amount}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={add.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={add.isPending}>Add line</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ settlement, onOpenChange }: { settlement: Settlement; onOpenChange: (open: boolean) => void }) {
  const org = useOrg();
  const [paidOn, setPaidOn] = useState(todayIn(org.timezone));
  const [method, setMethod] = useState("direct_deposit");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pay = useSettlementMutation(settlement.id, () => unwrap(api.POST("/api/v1/settlements/{settlement_id}/pay", { params: { path: { settlement_id: settlement.id } }, body: { version: settlement.version, paid_on: paidOn, method: method as Settlement["paid_method"] & string, reference: reference.trim() || null } })), { success: (st) => `${st.number} marked paid`, quiet: true });
  return (
    <Dialog open onOpenChange={(next) => !pay.isPending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            pay.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => setError(e instanceof ApiError ? (e.fieldErrors.paid_on ?? e.message) : errorMessage(e)) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Mark {settlement.number} paid</DialogTitle>
            <DialogDescription>
              {formatMoney(settlement.net_pay, settlement.currency)} to {settlement.driver.name}. Record how and when it was paid.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="paid-on">Paid on</Label>
              <Input id="paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="paid-method">Method</Label>
              <NativeSelect id="paid-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="paid-reference">Reference</Label>
            <Input id="paid-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="Check or transfer number" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={pay.isPending}>Mark paid</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PeriodDialog({ settlement, onOpenChange }: { settlement: Settlement; onOpenChange: (open: boolean) => void }) {
  const [start, setStart] = useState(settlement.period_start);
  const [end, setEnd] = useState(settlement.period_end);
  const [notes, setNotes] = useState(settlement.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useSettlementMutation(settlement.id, () => unwrap(api.PATCH("/api/v1/settlements/{settlement_id}", { params: { path: { settlement_id: settlement.id } }, body: { version: settlement.version, period_start: start, period_end: end, notes: notes.trim() || null } })), { success: () => "Settlement saved", quiet: true });
  return (
    <Dialog open onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (end < start) return setError("The period ends before it starts");
            save.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => setError(errorMessage(e)) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit draft</DialogTitle>
            <DialogDescription>Changing the period recalculates the draft.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-start">From</Label>
              <Input id="edit-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-end">To</Label>
              <Input id="edit-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-notes">Note on the statement</Label>
            <Input id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={save.isPending}>Save</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Statement({ settlement }: { settlement: Settlement }) {
  const can = useCan();
  const path = useWorkspacePath();
  const draft = settlement.allowed_actions.includes("add_line");
  const remove = useSettlementMutation(settlement.id, (line: Line) => unwrap(api.DELETE("/api/v1/settlements/{settlement_id}/lines/{line_id}", { params: { path: { settlement_id: settlement.id, line_id: line.id }, query: { version: settlement.version } } })), { success: () => "Line removed" });
  const totals: Record<string, string> = { Earnings: settlement.earnings, Reimbursements: settlement.reimbursements, Deductions: `-${settlement.deductions}` };
  return (
    <div className="grid gap-6">
      {SECTIONS.map((section) => {
        const lines = settlement.lines.filter((l) => section.kinds.includes(l.kind));
        if (!lines.length && section.title !== "Earnings") return null;
        return (
          <section key={section.title}>
            <h3 className="mb-2 text-sm font-semibold">{section.title}</h3>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No delivered loads in this period that haven&apos;t been paid.</p>
            ) : (
              <Table aria-label={section.title}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    {draft ? <TableHead className="no-print w-10" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {line.load && can("loads.read") ? (
                          <Link href={path("loads", line.load.id)} className="hover:underline">
                            {line.description}
                          </Link>
                        ) : (
                          line.description
                        )}
                        {line.manual ? <span className="ml-2 text-xs text-muted-foreground">(entered by hand)</span> : null}
                      </TableCell>
                      <TableCell className="tabular text-right">{Number(line.quantity).toLocaleString("en-US")}</TableCell>
                      <TableCell className="tabular text-right">{line.rate}</TableCell>
                      <TableCell className={cn("tabular text-right", Number(line.amount) < 0 && "text-destructive")}>{formatMoney(line.amount, settlement.currency)}</TableCell>
                      {draft ? (
                        <TableCell className="no-print text-right">
                          {line.manual ? (
                            <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(line)} disabled={remove.isPending} aria-label={`Remove ${line.description}`}>
                              <Trash2Icon />
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="text-right font-semibold">
                      {section.title}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">{formatMoney(totals[section.title], settlement.currency)}</TableCell>
                    {draft ? <TableCell className="no-print" /> : null}
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </section>
        );
      })}
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-3">
        <span className="font-semibold">Net pay</span>
        <span className="tabular text-xl font-semibold">{formatMoney(settlement.net_pay, settlement.currency)}</span>
      </div>
    </div>
  );
}

type Dialogs = "line" | "pay" | "void" | "approve" | "delete" | "edit" | null;

export function SettlementDetail({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useSettlement(id);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const settlement = query.data;
  useBreadcrumbLabel(settlement ? `${settlementLabel(settlement)}, ${settlement.driver.name}` : null);

  const recalc = useSettlementMutation(id, () => unwrap(api.POST("/api/v1/settlements/{settlement_id}/recalculate", { params: { path: { settlement_id: id } }, body: { version: settlement!.version } })), { success: () => "Recalculated from the latest loads and expenses" });
  const approve = useSettlementMutation(id, () => unwrap(api.POST("/api/v1/settlements/{settlement_id}/approve", { params: { path: { settlement_id: id } }, body: { version: settlement!.version } })), { success: (st) => `Settlement ${st.number} approved`, quiet: true });
  const voidIt = useSettlementMutation(id, (reason: string) => unwrap(api.POST("/api/v1/settlements/{settlement_id}/void", { params: { path: { settlement_id: id } }, body: { version: settlement!.version, reason } })), { success: (st) => `${st.number} voided`, quiet: true });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/settlements/{settlement_id}", { params: { path: { settlement_id: id } } })),
    onSuccess: () => {
      invalidateSettlements(queryClient, org.id);
      toast.success("Draft deleted");
      router.push(path("finance", "settlements"));
    },
  });

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading settlement">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError || !settlement) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const allowed = new Set(settlement.allowed_actions);
  const draft = settlement.status === "draft";
  return (
    <>
      <PageHeader
        className="no-print"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className={cn(draft && "italic")}>{settlementLabel(settlement)}</span> <StatusBadge status={settlement.status} />
          </span>
        }
        description={
          <span>
            {can("drivers.read") ? (
              <Link href={path("drivers", settlement.driver.id)} className="hover:underline">
                {settlement.driver.name}
              </Link>
            ) : (
              settlement.driver.name
            )}{" "}
            · {formatDate(settlement.period_start)} to {formatDate(settlement.period_end)}
          </span>
        }
        actions={
          <>
            {allowed.has("recalculate") ? (
              <Button variant="outline" onClick={() => recalc.mutate(undefined)} disabled={recalc.isPending}>
                <RefreshCwIcon /> Recalculate
              </Button>
            ) : null}
            {allowed.has("add_line") ? (
              <Button variant="outline" onClick={() => setDialog("line")}>
                <PlusIcon /> Add line
              </Button>
            ) : null}
            {allowed.has("edit") ? (
              <Button variant="outline" onClick={() => setDialog("edit")}>
                Edit
              </Button>
            ) : null}
            {allowed.has("delete") ? (
              <Button variant="outline" onClick={() => setDialog("delete")}>
                <Trash2Icon /> Delete draft
              </Button>
            ) : null}
            {allowed.has("approve") ? (
              <Button onClick={() => setDialog("approve")}>
                <BadgeCheckIcon /> Approve
              </Button>
            ) : null}
            {allowed.has("pay") ? (
              <Button onClick={() => setDialog("pay")}>
                <BanknoteIcon /> Mark paid
              </Button>
            ) : null}
            {allowed.has("void") ? (
              <Button variant="outline" onClick={() => setDialog("void")}>
                <XIcon /> Void
              </Button>
            ) : null}
            {!draft ? (
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon /> Print
              </Button>
            ) : null}
          </>
        }
      />
      {settlement.status === "void" ? (
        <p className="no-print mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          Voided {formatDateTime(settlement.voided_at, org.timezone)}: {settlement.void_reason}. Its loads and expenses can go on another settlement.
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] print:block">
        <Card className="min-w-0 print:border-0 print:shadow-none">
          <CardContent className="grid gap-6 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="text-sm">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pay statement for</p>
                <p className="mt-1 text-lg font-semibold">{settlement.driver.name}</p>
                <p className="text-muted-foreground">Pay terms: {payTermsText(settlement.pay_terms, settlement.currency)}</p>
              </div>
              <div className="text-sm sm:text-right">
                <p className="text-2xl font-semibold tracking-tight">{draft ? "Draft settlement" : "Settlement"}</p>
                {settlement.number ? <p className="tabular font-medium">{settlement.number}</p> : null}
                <p>
                  {formatDate(settlement.period_start)} to {formatDate(settlement.period_end)}
                </p>
                {settlement.paid_on ? (
                  <p className="text-muted-foreground">
                    Paid {formatDate(settlement.paid_on)} by {methodLabel(settlement.paid_method)}
                    {settlement.paid_reference ? ` (${settlement.paid_reference})` : ""}
                  </p>
                ) : null}
              </div>
            </div>
            <Statement settlement={settlement} />
            {settlement.notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{settlement.notes}</p> : null}
          </CardContent>
        </Card>
        <div className="no-print grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              <p>
                <span className="text-muted-foreground">Created</span> {formatDateTime(settlement.created_at, org.timezone)}
                {settlement.created_by_name ? ` by ${settlement.created_by_name}` : ""}
              </p>
              {settlement.calculated_at ? (
                <p>
                  <span className="text-muted-foreground">Last calculated</span> {formatDateTime(settlement.calculated_at, org.timezone)}
                </p>
              ) : null}
              {settlement.approved_at ? (
                <p>
                  <span className="text-muted-foreground">Approved</span> {formatDateTime(settlement.approved_at, org.timezone)}
                  {settlement.approved_by_name ? ` by ${settlement.approved_by_name}` : ""}
                </p>
              ) : null}
              {draft ? <p className="text-muted-foreground">A draft is rebuilt from its loads and expenses when you recalculate, change its period, or approve it. Lines entered by hand stay.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === "line" ? <AddLineDialog settlement={settlement} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "pay" ? <PayDialog settlement={settlement} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "edit" ? <PeriodDialog settlement={settlement} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "approve" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Approve this settlement for ${settlement.driver.name}?`}
          description="It is recalculated one last time from the loads and expenses, numbered, and fixed. To correct it afterwards you void it and start another."
          confirmLabel="Approve"
          onConfirm={() => approve.mutateAsync(undefined)}
        />
      ) : null}
      {dialog === "delete" ? <ConfirmDialog open onOpenChange={(open) => !open && setDialog(null)} title="Delete this draft?" description="Its loads and expenses go back to waiting for a settlement." confirmLabel="Delete draft" destructive onConfirm={() => remove.mutateAsync()} /> : null}
      {dialog === "void" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Void ${settlement.number}?`}
          description="It is kept, marked void, and nothing is owed on it. Its loads and expenses can go on another settlement."
          confirmLabel="Void settlement"
          destructive
          reason={{ label: "Why", required: true, placeholder: "Wrong pay rate; recalculating" }}
          onConfirm={(reason) => voidIt.mutateAsync(reason)}
        />
      ) : null}
    </>
  );
}
