"use client";

import Link from "next/link";
import { useCan, useWorkspacePath } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

type Tab = "invoices" | "payments" | "expenses" | "fuel" | "settlements";

/** The finance section's lists; these links move between them, showing only what the role may see. */
export function FinanceTabs({ current }: { current: Tab }) {
  const path = useWorkspacePath();
  const can = useCan();
  const tabs = [
    { key: "invoices", label: "Invoices", shown: can("invoices.read") },
    { key: "payments", label: "Payments", shown: can("payments.read") },
    { key: "expenses", label: "Expenses", shown: can("expenses.read") },
    { key: "fuel", label: "Fuel", shown: can("expenses.read") },
    { key: "settlements", label: "Driver pay", shown: can("settlements.read") },
  ].filter((tab) => tab.shown);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Finance" className="mb-4 max-w-full overflow-x-auto">
      <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
        {tabs.map((tab) => (
          <Link key={tab.key} href={path("finance", tab.key)} aria-current={current === tab.key ? "page" : undefined} className={cn("inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground", current === tab.key && "bg-background text-foreground shadow-xs")}>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
