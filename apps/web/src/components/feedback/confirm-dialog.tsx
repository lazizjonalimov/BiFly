"use client";

import { useState } from "react";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, errorMessage } from "@/lib/api/errors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ask for a reason and pass it to onConfirm. With `required`, it can't be left empty. */
  reason?: { label: string; required?: boolean; placeholder?: string };
  /** Throw to keep the dialog open with the error shown. */
  onConfirm: (reason: string) => Promise<unknown>;
};

/**
 * The one way the app asks "are you sure?" before something destructive, financial or irreversible. The
 * action runs while the dialog is open, so a failure is explained right here rather than lost.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, reason, onConfirm }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setError(null);
      setText("");
    }
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason?.required && !text.trim()) {
      setError("Give a reason");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      setPending(false);
      setText("");
      onOpenChange(false);
    } catch (e) {
      setPending(false);
      setError(e instanceof ApiError ? (e.fieldErrors.reason ?? e.message) : errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          </DialogHeader>
          {reason ? (
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-reason">{reason.label}</Label>
              <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} maxLength={300} autoFocus />
            </div>
          ) : null}
          <FormError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <SubmitButton pending={pending} variant={destructive ? "destructive" : "default"}>
              {confirmLabel}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
