"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { applyApiErrors } from "@/components/forms/api-errors";
import { TextField } from "@/components/forms/fields";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Form } from "@/components/ui/form";
import { postJson } from "@/lib/api/post";
import type { OrgRef } from "@/lib/api/types";
import { hardNavigate } from "@/lib/hard-navigation";

const schema = z.object({
  organization_name: z.string().trim().min(2, "Enter your company's name").max(160),
  full_name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});
type Values = z.infer<typeof schema>;

/** The browser's time zone becomes the company's, so "today" means today where the company operates. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function SignupForm() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { organization_name: "", full_name: "", email: "", password: "" } });
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(values: Values) {
    setPending(true);
    setFormError(null);
    try {
      const reply = await postJson<{ organization: OrgRef }>("/api/auth/signup", { ...values, timezone: browserTimeZone() });
      hardNavigate(`/${reply.organization.slug}/dashboard`);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Start with one company. You can add up to nine more under the same profile.</p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 grid gap-4" noValidate>
          <FormError message={formError} />
          <TextField control={form.control} name="organization_name" label="Company name" autoComplete="organization" autoFocus />
          <TextField control={form.control} name="full_name" label="Your name" autoComplete="name" />
          <TextField control={form.control} name="email" label="Work email" type="email" autoComplete="username" />
          <TextField control={form.control} name="password" label="Password" type="password" autoComplete="new-password" hint="At least 10 characters. A short sentence works well." />
          <SubmitButton pending={pending} size="lg" className="mt-2">
            Create account
          </SubmitButton>
        </form>
      </Form>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
