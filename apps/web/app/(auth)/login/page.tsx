"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { session } from "@/lib/api";

type OrgChoice = { id: string; name: string; role: string };
type LoginResult = { requires_organization_selection?: boolean; organizations?: OrgChoice[] };

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgs, setOrgs] = useState<OrgChoice[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(organization_id?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await session<LoginResult>("login", { email, password, organization_id });
      if (r.requires_organization_selection && r.organizations) setOrgs(r.organizations);
      else {
        // Full reload on auth change: guarantees no cached data from a previous session survives.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        location.assign("/");
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (orgs) {
    return (
      <Card className="p-5">
        <h1 className="text-base font-semibold">Choose a company</h1>
        <p className="mt-1 text-sm text-slate-500">Your account belongs to more than one company.</p>
        <ul className="mt-4 space-y-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Button className="w-full justify-between" disabled={busy} onClick={() => signIn(o.id)}>
                <span>{o.name}</span>
                <span className="text-xs text-slate-500">{o.role.replace(/_/g, " ")}</span>
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h1 className="text-base font-semibold">Sign in</h1>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          signIn();
        }}
      >
        <Field label="Email">
          {(p) => <Input {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password">
          {(p) => (
            <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        New company?{" "}
        <Link href="/signup" className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
