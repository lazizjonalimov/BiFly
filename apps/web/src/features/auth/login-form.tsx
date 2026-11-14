"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2Icon, ChevronRightIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { TextField } from "@/components/forms/fields";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Form } from "@/components/ui/form";
import { postJson } from "@/lib/api/post";
import type { OrgRef } from "@/lib/api/types";
import { humanize } from "@/lib/format/text";
import { hardNavigate } from "@/lib/hard-navigation";
import { safeNext } from "@/lib/safe-redirect";

const schema = z.object({
  email: z.email("Enter your email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

type SessionReply = { organization: OrgRef | null; organizations: OrgRef[]; requires_organization_selection: boolean };

export function LoginForm() {
  const search = useSearchParams();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Set when the person belongs to several companies and has to say which one to open.
  const [choices, setChoices] = useState<OrgRef[] | null>(null);

  async function signIn(values: Values, organizationId?: string) {
    setPending(true);
    setFormError(null);
    try {
      const reply = await postJson<SessionReply>("/api/auth/login", { ...values, ...(organizationId ? { organization_id: organizationId } : {}) });
      if (reply.requires_organization_selection || !reply.organization) {
        setChoices(reply.organizations);
        setPending(false);
        return;
      }
      hardNavigate(safeNext(search.get("next"), `/${reply.organization.slug}/dashboard`));
    } catch (error) {
      setFormError(applyApiErrors(form, error));
      setChoices(null);
      setPending(false);
    }
  }

  if (choices) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Choose a company</h1>
        <p className="mt-1 text-sm text-muted-foreground">You can switch at any time from the top of the screen.</p>
        <ul className="mt-6 grid gap-2">
          {choices.map((org) => (
            <li key={org.id}>
              <button type="button" disabled={pending} onClick={() => signIn(form.getValues(), org.id)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent disabled:opacity-60">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Building2Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{org.name}</span>
                  <span className="block text-xs text-muted-foreground">{humanize(org.role)}</span>
                </span>
                {org.status === "archived" ? <Badge variant="warning">Archived</Badge> : null}
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => setChoices(null)}>
          Sign in as someone else
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back to FlyFleet.</p>
      {search.get("reason") === "expired" ? (
        <Alert variant="info" className="mt-6">
          <InfoIcon />
          <AlertDescription className="text-foreground">Your session ended. Sign in again to pick up where you left off.</AlertDescription>
        </Alert>
      ) : null}
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => signIn(values))} className="mt-6 grid gap-4" noValidate>
          <FormError message={formError} />
          <TextField control={form.control} name="email" label="Email" type="email" autoComplete="username" autoFocus />
          <TextField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" />
          <SubmitButton pending={pending} size="lg" className="mt-2">
            Sign in
          </SubmitButton>
        </form>
      </Form>
      <p className="mt-6 text-sm text-muted-foreground">
        New to FlyFleet?{" "}
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
