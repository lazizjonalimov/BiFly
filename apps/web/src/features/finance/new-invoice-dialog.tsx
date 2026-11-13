"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { InvoiceLoadPicker } from "@/features/finance/load-picker";
import { invalidateFinance, invoiceKey } from "@/features/finance/lib";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";

/** Start a draft invoice: a customer and the completed loads to bill them for. Nothing is numbered until it is issued. */
export function NewInvoiceDialog({ open, onOpenChange, customerId: initialCustomer = "" }: { open: boolean; onOpenChange: (open: boolean) => void; customerId?: string }) {
  const org = useOrg();
  const router = useRouter();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [loadIds, setLoadIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);

  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/invoices", { body: { customer_id: customerId, load_ids: loadIds, notes: notes.trim() || null }, params: { header: { "idempotency-key": key } } })),
    onSuccess: (invoice) => {
      queryClient.setQueryData(invoiceKey(org.id, invoice.id), invoice);
      invalidateFinance(queryClient, org.id);
      toast.success("Draft invoice created");
      onOpenChange(false);
      router.push(path("finance", "invoices", invoice.id));
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fieldErrors)[0] ?? e.message) : errorMessage(e)),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!customerId) return setError("Choose the customer to bill");
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
            <DialogDescription>It starts as a draft: check it, add any adjustments, then issue it to give it a number.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-customer">Customer</Label>
            <CustomerPicker
              id="invoice-customer"
              value={customerId}
              onChange={(id) => {
                setCustomerId(id);
                setLoadIds([]);
              }}
            />
          </div>
          {customerId ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Loads</span>
              <InvoiceLoadPicker customerId={customerId} selected={loadIds} onChange={setLoadIds} />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="invoice-notes">Note on the invoice</Label>
            <Textarea id="invoice-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Thank you for your business" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={create.isPending}>Create draft</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
