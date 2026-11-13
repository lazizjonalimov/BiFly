"use client";

import Link from "next/link";
import { useCan, useWorkspacePath } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/** Invoices and payments are two lists of one section; these links move between them. */
export function FinanceTabs({ current }: { current: "invoices" | "payments" }) {
  const path = useWorkspacePath();
  const can = useCan();
  const tabs = [
    { key: "invoices", label: "Invoices", href: path("finance", "invoices"), shown: can("invoices.read") },
    { key: "payments", label: "Payments", href: path("finance", "payments"), shown: can("payments.read") },
  ].filter((tab) => tab.shown);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Finance" className="mb-4 inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={current === tab.key ? "page" : undefined} className={cn("inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors hover:text-foreground", current === tab.key && "bg-background text-foreground shadow-xs")}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
