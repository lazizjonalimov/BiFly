"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { TextField } from "@/components/forms/fields";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { postJson } from "@/lib/api/post";

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z.string().min(10, "Use at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The two passwords don't match" });
type Values = z.infer<typeof schema>;

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { current_password: "", new_password: "", confirm: "" } });
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close(next: boolean) {
    if (!next) {
      form.reset();
      setFormError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit({ current_password, new_password }: Values) {
    setPending(true);
    setFormError(null);
    try {
      await postJson("/api/auth/password", { current_password, new_password });
      toast.success("Password changed", { description: "Every other device has been signed out." });
      close(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Changing it signs you out everywhere else. You stay signed in here.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormError message={formError} />
            <TextField control={form.control} name="current_password" label="Current password" type="password" autoComplete="current-password" />
            <TextField control={form.control} name="new_password" label="New password" type="password" autoComplete="new-password" hint="At least 10 characters." />
            <TextField control={form.control} name="confirm" label="New password again" type="password" autoComplete="new-password" />
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Change password</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
