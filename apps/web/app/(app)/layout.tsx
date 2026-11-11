import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";

// The shell reads the URL and the signed-in user, so it renders at request time behind this boundary.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
