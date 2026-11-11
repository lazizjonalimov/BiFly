"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { ApiError, session } from "@/lib/api";

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Change password">
      {open && <PasswordForm onClose={onClose} />}
    </Modal>
  );
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useMutation({
    mutationFn: () => session("password", { current_password: current, new_password: next }),
  });
  const mismatch = confirm !== "" && confirm !== next;
  const fields = change.error instanceof ApiError ? change.error.fields : {};
  const wrongCurrent = change.error instanceof ApiError && change.error.code === "wrong_password";

  if (change.isSuccess) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-slate-700">
          Your password has been changed. Any other devices that were signed in with the old password have been signed out.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch) change.mutate();
      }}
    >
      <Field label="Current password" error={wrongCurrent ? "That isn't your current password" : fields.current_password}>
        {(p) => <Input {...p} type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="New password" error={fields.new_password} hint="At least 10 characters">
        {(p) => <Input {...p} type="password" required minLength={10} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <Field label="Confirm new password" error={mismatch ? "The passwords don't match" : undefined}>
        {(p) => <Input {...p} type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      {!wrongCurrent && Object.keys(fields).length === 0 && <ErrorNote error={change.error} />}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={change.isPending || mismatch}>
          {change.isPending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
