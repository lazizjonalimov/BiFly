"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { ApiError, session } from "@/lib/api";

export default function SignupPage() {
  const [form, setForm] = useState({ organization_name: "", full_name: "", email: "", password: "", dot_number: "", mc_number: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = error instanceof ApiError ? error.fields : {};
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session("signup", { ...form, dot_number: form.dot_number || null, mc_number: form.mc_number || null });
      // Full reload on auth change: guarantees no cached data from a previous session survives.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign("/");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h1 className="text-base font-semibold">Create your company account</h1>
      <p className="mt-1 text-sm text-slate-500">You&apos;ll be the owner and can invite your team afterwards.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <Field label="Company name" error={fields.organization_name}>
          {(p) => <Input {...p} required value={form.organization_name} onChange={set("organization_name")} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="USDOT # (optional)" error={fields.dot_number}>
            {(p) => <Input {...p} value={form.dot_number} onChange={set("dot_number")} />}
          </Field>
          <Field label="MC # (optional)" error={fields.mc_number}>
            {(p) => <Input {...p} value={form.mc_number} onChange={set("mc_number")} />}
          </Field>
        </div>
        <Field label="Your name" error={fields.full_name}>
          {(p) => <Input {...p} required autoComplete="name" value={form.full_name} onChange={set("full_name")} />}
        </Field>
        <Field label="Work email" error={fields.email}>
          {(p) => <Input {...p} type="email" required autoComplete="username" value={form.email} onChange={set("email")} />}
        </Field>
        <Field label="Password" error={fields.password} hint="At least 10 characters">
          {(p) => <Input {...p} type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set("password")} />}
        </Field>
        {!(error instanceof ApiError && error.details) && <ErrorNote error={error} />}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
