"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BanknoteIcon, ListChecksIcon, PencilIcon, PlusIcon, PrinterIcon, SendIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceLoadPicker } from "@/features/finance/load-picker";
import { invalidateFinance, invoiceLabel, methodLabel, useInvoice, useInvoiceMutation, type Invoice } from "@/features/finance/lib";
import { PaymentSheet } from "@/features/finance/payment-sheet";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatMoney, multiplyMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/text";
import { cn } from "@/lib/utils";

type Party = Schema<"Party">;
const AMOUNT = /^-?\d{1,10}(\.\d{1,2})?$/;

function PartyBlock({ title, party }: { title: string; party: Party }) {
  const cityLine = [party.city, [party.state, party.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return (
    <div className="text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-1 font-semibold">{party.name}</p>
      {party.address ? <p>{party.address}</p> : null}
      {cityLine ? <p>{cityLine}</p> : null}
      {party.phone ? <p>{party.phone}</p> : null}
      {party.email ? <p>{party.email}</p> : null}
      {party.dot_number || party.mc_number ? <p className="text-muted-foreground">{[party.dot_number ? `DOT ${party.dot_number}` : null, party.mc_number].filter(Boolean).join(" · ")}</p> : null}
    </div>
  );
}

/** Notes and due date, while the invoice is a draft. */
function EditDialog({ invoice, onOpenChange }: { invoice: Invoice; onOpenChange: (open: boolean) => void }) {
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [due, setDue] = useState(invoice.due_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useInvoiceMutation(invoice.id, () => unwrap(api.PATCH("/api/v1/invoices/{invoice_id}", { params: { path: { invoice_id: invoice.id } }, body: { notes: notes.trim() || null, due_date: due || null } })), { success: () => "Invoice saved", quiet: true });
  return (
    <Dialog open onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => setError(errorMessage(e)) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit draft</DialogTitle>
            <DialogDescription>Leave the due date empty to use the customer&apos;s payment terms from the day it is issued.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-due">Due date</Label>
            <Input id="invoice-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-notes-edit">Note on the invoice</Label>
            <Textarea id="invoice-notes-edit" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
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

/** Add or take off loads while the invoice is a draft. */
function LoadsDialog({ invoice, onOpenChange }: { invoice: Invoice; onOpenChange: (open: boolean) => void }) {
  const loadIds = [...new Set(invoice.lines.filter((l) => l.load_id).map((l) => l.load_id!))];
  const current = loadIds.map((id) => {
    const lines = invoice.lines.filter((l) => l.load_id === id);
    const revenue = lines.reduce((sum, l) => sum + Number(l.amount), 0).toFixed(2);
    return { id, load_number: lines[0]?.load_number ?? "Load", revenue, currency: invoice.currency };
  });
  const [selected, setSelected] = useState(loadIds);
  const [error, setError] = useState<string | null>(null);
  const save = useInvoiceMutation(invoice.id, () => unwrap(api.PUT("/api/v1/invoices/{invoice_id}/loads", { params: { path: { invoice_id: invoice.id } }, body: { load_ids: selected } })), { success: () => "Loads updated", quiet: true });
  return (
    <Dialog open onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => setError(errorMessage(e)) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Loads on this invoice</DialogTitle>
            <DialogDescription>{invoice.customer.name}&apos;s completed loads that aren&apos;t on another invoice.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <InvoiceLoadPicker customerId={invoice.customer.id} selected={selected} onChange={setSelected} current={current} />
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

/** A line that isn't a load: a discount (negative) or an extra charge. */
function AdjustmentDialog({ invoice, onOpenChange }: { invoice: Invoice; onOpenChange: (open: boolean) => void }) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useInvoiceMutation(invoice.id, () => unwrap(api.POST("/api/v1/invoices/{invoice_id}/lines", { params: { path: { invoice_id: invoice.id } }, body: { description: description.trim(), quantity, unit_price: price.trim() } })), { success: () => "Line added", quiet: true });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!description.trim()) problems.description = "Say what it is for";
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(quantity.trim()) || Number(quantity) <= 0) problems.quantity = "Enter a quantity above zero";
    if (!AMOUNT.test(price.trim())) problems.unit_price = "Enter an amount like 75.00, or -50.00 for a discount";
    setErrors(problems);
    setError(null);
    if (Object.keys(problems).length) return;
    save.mutate(undefined, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => {
        if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
        setError(errorMessage(e));
      },
    });
  }
  const amount = multiplyMoney(quantity || "0", price || "0");
  return (
    <Dialog open onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add a line</DialogTitle>
            <DialogDescription>A discount (use a negative price) or a charge that isn&apos;t part of a load.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="adjustment-description">Description</Label>
            <Input id="adjustment-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} aria-invalid={!!errors.description} autoFocus />
            {errors.description ? <p className="text-xs text-destructive">{errors.description}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="adjustment-quantity">Quantity</Label>
              <Input id="adjustment-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" aria-invalid={!!errors.quantity} />
              {errors.quantity ? <p className="text-xs text-destructive">{errors.quantity}</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adjustment-price">Unit price ({invoice.currency})</Label>
              <Input id="adjustment-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-invalid={!!errors.unit_price} />
              {errors.unit_price ? <p className="text-xs text-destructive">{errors.unit_price}</p> : null}
            </div>
          </div>
          <p className="text-sm">
            Amount: <strong className="tabular">{formatMoney(amount, invoice.currency)}</strong>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={save.isPending}>Add line</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Lines({ invoice }: { invoice: Invoice }) {
  const can = useCan();
  const path = useWorkspacePath();
  const draft = invoice.status === "draft" && invoice.allowed_actions.includes("edit");
  const remove = useInvoiceMutation(invoice.id, (lineId: string) => unwrap(api.DELETE("/api/v1/invoices/{invoice_id}/lines/{line_id}", { params: { path: { invoice_id: invoice.id, line_id: lineId } } })), { success: () => "Line removed" });
  if (!invoice.lines.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing on this invoice yet. Add loads or a line.</p>;
  }
  return (
    <Table aria-label="Invoice lines">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Load</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          {draft ? <TableHead className="no-print w-10" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoice.lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell className="whitespace-nowrap">
              {line.load_id && line.load_number ? (
                can("loads.read") ? (
                  <Link href={path("loads", line.load_id)} className="hover:underline">
                    {line.load_number}
                  </Link>
                ) : (
                  line.load_number
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>{line.description}</TableCell>
            <TableCell className="tabular text-right">{Number(line.quantity)}</TableCell>
            <TableCell className="tabular text-right">{formatMoney(line.unit_price, invoice.currency)}</TableCell>
            <TableCell className="tabular text-right">{formatMoney(line.amount, invoice.currency)}</TableCell>
            {draft ? (
              <TableCell className="no-print text-right">
                {line.kind === "adjustment" ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(line.id)} disabled={remove.isPending} aria-label={`Remove ${line.description}`}>
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
          <TableCell colSpan={4} className="text-right font-semibold">
            Total
          </TableCell>
          <TableCell className="tabular text-right font-semibold">{formatMoney(invoice.total, invoice.currency)}</TableCell>
          {draft ? <TableCell className="no-print" /> : null}
        </TableRow>
        {invoice.status !== "draft" && invoice.status !== "void" ? (
          <>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="text-right">
                Paid
              </TableCell>
              <TableCell className="tabular text-right">{formatMoney(invoice.paid, invoice.currency)}</TableCell>
              {draft ? <TableCell className="no-print" /> : null}
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="text-right font-semibold">
                Balance due
              </TableCell>
              <TableCell className="tabular text-right font-semibold">{formatMoney(invoice.balance, invoice.currency)}</TableCell>
              {draft ? <TableCell className="no-print" /> : null}
            </TableRow>
          </>
        ) : null}
      </TableFooter>
    </Table>
  );
}

type Dialogs = "edit" | "loads" | "adjust" | "issue" | "delete" | "void" | "pay" | null;

export function InvoiceDetail({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useInvoice(id);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const invoice = query.data;
  useBreadcrumbLabel(invoice ? invoiceLabel(invoice) : null);

  const issue = useInvoiceMutation(id, () => unwrap(api.POST("/api/v1/invoices/{invoice_id}/issue", { params: { path: { invoice_id: id } } })), { success: (inv) => `Invoice ${inv.invoice_number} issued`, quiet: true });
  const voidIt = useInvoiceMutation(id, (reason: string) => unwrap(api.POST("/api/v1/invoices/{invoice_id}/void", { params: { path: { invoice_id: id } }, body: { reason } })), { success: (inv) => `Invoice ${inv.invoice_number} voided`, quiet: true });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/invoices/{invoice_id}", { params: { path: { invoice_id: id } } })),
    onSuccess: () => {
      invalidateFinance(queryClient, org.id);
      toast.success("Draft deleted");
      router.push(path("finance", "invoices"));
    },
  });

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading invoice">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError || !invoice) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const allowed = new Set(invoice.allowed_actions);
  const draft = invoice.status === "draft";
  return (
    <>
      <PageHeader
        className="no-print"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className={cn(draft && "italic")}>{invoiceLabel(invoice)}</span> <StatusBadge status={invoice.status} />
            {invoice.is_overdue ? <Badge variant="danger">{plural(invoice.days_overdue, "day")} late</Badge> : null}
          </span>
        }
        description={
          <span>
            {can("customers.read") ? (
              <Link href={path("customers", invoice.customer.id)} className="hover:underline">
                {invoice.customer.name}
              </Link>
            ) : (
              invoice.customer.name
            )}{" "}
            · {formatMoney(invoice.total, invoice.currency)}
          </span>
        }
        actions={
          <>
            {allowed.has("edit") ? (
              <>
                <Button variant="outline" onClick={() => setDialog("loads")}>
                  <ListChecksIcon /> Loads
                </Button>
                <Button variant="outline" onClick={() => setDialog("adjust")}>
                  <PlusIcon /> Add line
                </Button>
                <Button variant="outline" onClick={() => setDialog("edit")}>
                  <PencilIcon /> Edit
                </Button>
              </>
            ) : null}
            {allowed.has("delete") ? (
              <Button variant="outline" onClick={() => setDialog("delete")}>
                <Trash2Icon /> Delete draft
              </Button>
            ) : null}
            {allowed.has("issue") ? (
              <Button onClick={() => setDialog("issue")}>
                <SendIcon /> Issue invoice
              </Button>
            ) : null}
            {allowed.has("record_payment") ? (
              <Button onClick={() => setDialog("pay")}>
                <BanknoteIcon /> Record payment
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
      {invoice.status === "void" ? (
        <p className="no-print mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          Voided {formatDateTime(invoice.voided_at, org.timezone)}: {invoice.void_reason}. Its loads can be invoiced again.
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] print:block">
        <Card className="min-w-0 print:border-0 print:shadow-none">
          <CardContent className="grid gap-6 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <PartyBlock title="From" party={invoice.seller} />
              <div className="text-sm sm:text-right">
                <p className="text-2xl font-semibold tracking-tight">{draft ? "Draft invoice" : "Invoice"}</p>
                {invoice.invoice_number ? <p className="tabular font-medium">{invoice.invoice_number}</p> : null}
                <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5">
                  <dt className="text-muted-foreground">Issued</dt>
                  <dd>{invoice.issue_date ? formatDate(invoice.issue_date) : "Not yet"}</dd>
                  <dt className="text-muted-foreground">Due</dt>
                  <dd>{invoice.due_date ? formatDate(invoice.due_date) : invoice.payment_terms_days !== null && invoice.payment_terms_days !== undefined ? `${invoice.payment_terms_days} days after issue` : "—"}</dd>
                  {invoice.payment_terms_days !== null && invoice.payment_terms_days !== undefined ? (
                    <>
                      <dt className="text-muted-foreground">Terms</dt>
                      <dd>Net {invoice.payment_terms_days}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>
            <PartyBlock title="Bill to" party={invoice.bill_to} />
            <Lines invoice={invoice} />
            {invoice.notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{invoice.notes}</p> : null}
          </CardContent>
        </Card>
        <div className="no-print grid content-start gap-4">
          {can("payments.read") && !draft ? (
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {invoice.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing received yet.</p>
                ) : (
                  <ul className="grid gap-2 text-sm">
                    {invoice.payments.map((payment) => (
                      <li key={payment.payment_id} className="flex items-start justify-between gap-2">
                        <span>
                          <Link href={path("finance", "payments", payment.payment_id)} className="font-medium hover:underline">
                            {formatDate(payment.received_on)}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {methodLabel(payment.method)}
                            {payment.reference ? ` · ${payment.reference}` : ""}
                            {payment.status === "reversed" ? " · reversed" : ""}
                          </span>
                        </span>
                        <span className={cn("tabular", payment.status === "reversed" && "text-muted-foreground line-through")}>{formatMoney(payment.amount, invoice.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              <p>
                <span className="text-muted-foreground">Created</span> {formatDateTime(invoice.created_at, org.timezone)}
              </p>
              {invoice.issued_at ? (
                <p>
                  <span className="text-muted-foreground">Issued</span> {formatDateTime(invoice.issued_at, org.timezone)}
                  {invoice.issued_by_name ? ` by ${invoice.issued_by_name}` : ""}
                </p>
              ) : null}
              {invoice.voided_at ? (
                <p>
                  <span className="text-muted-foreground">Voided</span> {formatDateTime(invoice.voided_at, org.timezone)}
                </p>
              ) : null}
              {draft ? <p className="text-muted-foreground">A draft follows its loads: change a load&apos;s rate or charges and this invoice changes with it.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === "edit" ? <EditDialog invoice={invoice} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "loads" ? <LoadsDialog invoice={invoice} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "adjust" ? <AdjustmentDialog invoice={invoice} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "pay" ? <PaymentSheet open invoice={invoice} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "issue" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Issue this invoice to ${invoice.customer.name}?`}
          description={`It gets its number and is fixed: ${formatMoney(invoice.total, invoice.currency)}, due ${invoice.due_date ? formatDate(invoice.due_date) : `in ${invoice.payment_terms_days ?? 0} days`}. To correct it later you void it and issue a new one.`}
          confirmLabel="Issue invoice"
          onConfirm={() => issue.mutateAsync(undefined)}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog open onOpenChange={(open) => !open && setDialog(null)} title="Delete this draft?" description="Its loads become ready to invoice again." confirmLabel="Delete draft" destructive onConfirm={() => remove.mutateAsync()} />
      ) : null}
      {dialog === "void" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Void ${invoice.invoice_number}?`}
          description="The invoice is kept, marked void, and no longer owed. Its loads can be invoiced again."
          confirmLabel="Void invoice"
          destructive
          reason={{ label: "Why", required: true, placeholder: "Wrong rate; replaced by a corrected invoice" }}
          onConfirm={(reason) => voidIt.mutateAsync(reason)}
        />
      ) : null}
    </>
  );
}
