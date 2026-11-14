"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DriverPicker } from "@/features/maintenance/pickers";
import { invalidateSettlements, settlementKey } from "@/features/settlements/lib";
import { api, idempotencyKey, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useOrg, useWorkspacePath } from "@/lib/auth/session";
import { todayIn } from "@/lib/format/dates";

function daysBefore(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Start a driver's settlement for a period. The draft fills itself from the period's loads and expenses. */
export function NewSettlementDialog({ open, onOpenChange, driverId: initialDriver = "" }: { open: boolean; onOpenChange: (open: boolean) => void; driverId?: string }) {
  const org = useOrg();
  const router = useRouter();
  const path = useWorkspacePath();
  const queryClient = useQueryClient();
  const today = todayIn(org.timezone);
  const [driverId, setDriverId] = useState(initialDriver);
  const [start, setStart] = useState(daysBefore(today, 6));
  const [end, setEnd] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);

  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/settlements", { body: { driver_id: driverId, period_start: start, period_end: end, notes: notes.trim() || null }, params: { header: { "idempotency-key": key } } })),
    onSuccess: (st) => {
      queryClient.setQueryData(settlementKey(org.id, st.id), st);
      invalidateSettlements(queryClient, org.id);
      toast.success(`Draft settlement for ${st.driver.name} created`);
      onOpenChange(false);
      router.push(path("finance", "settlements", st.id));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "SETTLEMENT_DRAFT_EXISTS") {
        const existing = (e.details as { settlement_id?: string }).settlement_id;
        setError(e.message);
        if (existing) router.push(path("finance", "settlements", existing));
        return;
      }
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError(errorMessage(e));
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!driverId) problems.driver_id = "Choose the driver";
    if (!start) problems.period_start = "Choose the first day";
    if (!end) problems.period_end = "Choose the last day";
    else if (start && end < start) problems.period_end = "The period ends before it starts";
    setErrors(problems);
    setError(null);
    if (!Object.keys(problems).length) create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New driver settlement</DialogTitle>
            <DialogDescription>It includes the loads the driver delivered up to the last day that no settlement has paid yet, the charges on them payable to the driver, and their reimbursements and deductions.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="settlement-driver">Driver</Label>
            <DriverPicker id="settlement-driver" value={driverId} onChange={setDriverId} aria-invalid={!!errors.driver_id} />
            {errors.driver_id ? <p className="text-xs text-destructive">{errors.driver_id}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="settlement-start">From</Label>
              <Input id="settlement-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!errors.period_start} />
              {errors.period_start ? <p className="text-xs text-destructive">{errors.period_start}</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="settlement-end">To</Label>
              <Input id="settlement-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!errors.period_end} />
              {errors.period_end ? <p className="text-xs text-destructive">{errors.period_end}</p> : null}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="settlement-notes">Note on the statement</Label>
            <Textarea id="settlement-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />
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
