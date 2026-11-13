"use client";

import { useEffect, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Props<T extends FieldValues> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  form: UseFormReturn<T>;
  onSubmit: (values: T) => void;
  pending: boolean;
  formError?: string | null;
  submitLabel?: string;
  children: React.ReactNode;
};

/**
 * The side panel records are created and edited in. Saving is always explicit (Save or Cancel), the button
 * can't be pressed twice, and closing with unsaved changes asks first instead of silently losing them.
 */
export function EntitySheet<T extends FieldValues>({ open, onOpenChange, title, description, form, onSubmit, pending, formError, submitLabel = "Save", children }: Props<T>) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const dirty = form.formState.isDirty;

  // Closing the tab or reloading with unsaved changes gets the browser's own warning.
  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);

  function requestClose(next: boolean) {
    if (next) return onOpenChange(true);
    if (pending) return;
    if (dirty && !confirmingDiscard) return setConfirmingDiscard(true);
    setConfirmingDiscard(false);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="grid content-start gap-6">
              <FormError message={formError} />
              {children}
            </SheetBody>
            <SheetFooter>
              {confirmingDiscard ? (
                <>
                  <p role="alert" className="mr-auto text-sm font-medium">
                    Discard your changes?
                  </p>
                  <Button variant="outline" onClick={() => setConfirmingDiscard(false)}>
                    Keep editing
                  </Button>
                  <Button variant="destructive" onClick={() => requestClose(false)}>
                    Discard
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => requestClose(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
                </>
              )}
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
