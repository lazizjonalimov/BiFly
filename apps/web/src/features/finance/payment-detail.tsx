"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon, SplitIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/states";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocationEditor, allocationsToApi, checkAllocations, useOpenInvoices, type Allocations } from "@/features/finance/allocation-editor";
import { invalidateFinance, invoiceLabel, methodLabel, paymentKey, usePayment, type Payment } from "@/features/finance/lib";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";

function usePaymentMutation<TArgs>(id: string, request: (args: TArgs) => Promise<Payment>, success: (payment: Payment) => string) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (payment) => {
      queryClient.setQueryData(paymentKey(org.id, id), payment);
      invalidateFinance(queryClient, org.id);
      toast.success(success(payment));
    },
  });
}

/** Apply money still on the payment to the customer's open invoices. */
function ApplyDialog({ payment, onOpenChange }: { payment: Payment; onOpenChange: (open: boolean) => void }) {
  const [allocations, setAllocations] = useState<Allocations>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const open = useOpenInvoices(payment.customer.id);
  const apply = usePaymentMutation(payment.id, (body: ReturnType<typeof allocationsToApi>) => unwrap(api.POST("/api/v1/payments/{payment_id}/allocations", { params: { path: { payment_id: payment.id } }, body: { allocations: body } })), () => "Payment applied");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const balances = Object.fromEntries((open.data?.items ?? []).map((i) => [i.id, i.balance]));
    const checked = checkAllocations(allocations, balances, payment.unapplied, payment.currency);
    setRowErrors(checked.rows);
    const body = allocationsToApi(allocations);
    if (Object.keys(checked.rows).length || checked.total) return setError(checked.total ?? "Check the amounts");
    if (!body.length) return setError("Enter an amount against at least one invoice");
    apply.mutate(body, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => {
        if (e instanceof ApiError) {
          const rows: Record<string, string> = {};
          for (const [field, message] of Object.entries(e.fieldErrors)) {
            const match = /^allocations\.(\d+)\./.exec(field);
            const target = match ? body[Number(match[1])]?.invoice_id : undefined;
            if (target) rows[target] = message;
          }
          setRowErrors(rows);
        }
        setError(errorMessage(e));
      },
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !apply.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Apply to invoices</DialogTitle>
            <DialogDescription>
              {formatMoney(payment.unapplied, payment.currency)} of this payment isn&apos;t matched to an invoice yet.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <AllocationEditor customerId={payment.customer.id} available={payment.unapplied} value={allocations} onChange={setAllocations} errors={rowErrors} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={apply.isPending}>Apply</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDetail({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const query = usePayment(id);
  const [dialog, setDialog] = useState<"apply" | "reverse" | null>(null);
  const payment = query.data;
  useBreadcrumbLabel(payment ? `${payment.customer.name}, ${formatDate(payment.received_on)}` : null);
  const reverse = usePaymentMutation(id, (reason: string) => unwrap(api.POST("/api/v1/payments/{payment_id}/reverse", { params: { path: { payment_id: id } }, body: { reason } })), () => "Payment reversed. The invoices it paid are open again.");

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading payment">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !payment) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const recorded = payment.status === "recorded";
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Payment of {formatMoney(payment.amount, payment.currency)} <StatusBadge status={payment.status} />
          </span>
        }
        description={
          <span>
            {can("customers.read") ? (
              <Link href={path("customers", payment.customer.id)} className="hover:underline">
                {payment.customer.name}
              </Link>
            ) : (
              payment.customer.name
            )}{" "}
            · received {formatDate(payment.received_on)}
          </span>
        }
        actions={
          can("payments.record") && recorded ? (
            <>
              {Number(payment.unapplied) > 0 ? (
                <Button onClick={() => setDialog("apply")}>
                  <SplitIcon /> Apply to invoices
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setDialog("reverse")}>
                <RotateCcwIcon /> Reverse
              </Button>
            </>
          ) : null
        }
      />
      {payment.status === "reversed" ? (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          Reversed {formatDateTime(payment.reversed_at, org.timezone)}: {payment.reversal_reason}. The invoices it paid are owed again.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Applied to</CardTitle>
          </CardHeader>
          {payment.allocations.length === 0 ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">Not applied to any invoice.</p>
            </CardContent>
          ) : (
            <Table aria-label="Applied to">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payment.allocations.map((a) => (
                  <TableRow key={a.invoice_id}>
                    <TableCell>
                      {can("invoices.read") ? (
                        <Link href={path("finance", "invoices", a.invoice_id)} className="font-medium hover:underline">
                          {invoiceLabel(a)}
                        </Link>
                      ) : (
                        invoiceLabel(a)
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{formatMoney(a.amount, payment.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <CardContent className="grid gap-1 border-t pt-4 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Applied</span> <span className="tabular">{formatMoney(payment.applied, payment.currency)}</span>
            </p>
            <p className="flex justify-between font-semibold">
              <span>Unapplied</span> <span className="tabular">{formatMoney(payment.unapplied, payment.currency)}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList className="sm:grid-cols-1 lg:grid-cols-1">
              <Detail label="Received on">{formatDate(payment.received_on)}</Detail>
              <Detail label="Method">{methodLabel(payment.method)}</Detail>
              <Detail label="Reference">{payment.reference}</Detail>
              <Detail label="Recorded">
                {formatDateTime(payment.created_at, org.timezone)}
                {payment.recorded_by_name ? ` by ${payment.recorded_by_name}` : ""}
              </Detail>
              {payment.notes ? (
                <Detail label="Notes">
                  <span className="whitespace-pre-wrap">{payment.notes}</span>
                </Detail>
              ) : null}
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
      {dialog === "apply" ? <ApplyDialog payment={payment} onOpenChange={(open) => !open && setDialog(null)} /> : null}
      {dialog === "reverse" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Reverse this payment?"
          description="Use this when a payment bounced or was recorded by mistake. It is kept, marked reversed, and the invoices it paid are owed again."
          confirmLabel="Reverse payment"
          destructive
          reason={{ label: "Why", required: true, placeholder: "Check returned unpaid" }}
          onConfirm={(reason) => reverse.mutateAsync(reason)}
        />
      ) : null}
    </>
  );
}
