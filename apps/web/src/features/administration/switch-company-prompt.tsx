"use client";

import { ArrowRightIcon, Building2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/errors";
import { postJson } from "@/lib/api/post";
import type { OrgRef } from "@/lib/api/types";
import { hardNavigate } from "@/lib/hard-navigation";

/**
 * Shown when a link points into another of the user's companies. Switching is always the user's own choice,
 * made with a click: a link alone never changes which company's data is on screen.
 */
export function SwitchCompanyPrompt({ current, target }: { current: string; target: OrgRef }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await postJson("/api/auth/switch", { organization_id: target.id });
      hardNavigate(pathname + window.location.search);
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Building2Icon className="size-6" />
      </span>
      <div>
        <h1 className="text-xl font-semibold">This page belongs to {target.name}</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          You are working in {current}. Switch companies to open it. Each company keeps its own loads, drivers and books.
        </p>
      </div>
      <FormError message={error} />
      <form
        className="flex flex-wrap justify-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <Button variant="outline" asChild>
          <Link href="/">Stay in {current}</Link>
        </Button>
        <SubmitButton pending={pending}>
          Switch to {target.name} <ArrowRightIcon />
        </SubmitButton>
      </form>
    </main>
  );
}
