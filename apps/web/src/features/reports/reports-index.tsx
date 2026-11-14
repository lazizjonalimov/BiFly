"use client";

import { BarChart3Icon, ChevronRightIcon, FuelIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { REPORTS } from "@/features/reports/reports";
import { useCan, useWorkspacePath } from "@/lib/auth/session";

/** The reports this role can run. */
export function ReportsIndex() {
  const can = useCan();
  const path = useWorkspacePath();
  const reports = REPORTS.filter((r) => r.needs.every((permission) => can(permission)));
  const extras = can("expenses.read") ? [{ href: path("finance", "fuel"), title: "Fuel", description: "Fuel by state for the fuel-tax return, and by truck with miles per gallon.", icon: FuelIcon }] : [];
  return (
    <>
      <PageHeader title="Reports" description="Worked out from your records when you open them, for the period you choose. Download any of them as CSV." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...reports.map((r) => ({ href: path("reports", r.name), title: r.title, description: r.description, icon: BarChart3Icon })), ...extras].map((item) => (
          <Link key={item.href} href={item.href} className="group flex items-start gap-3 rounded-lg border bg-card p-4 shadow-xs transition-colors hover:bg-accent">
            <item.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{item.description}</span>
            </span>
            <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </Link>
        ))}
      </div>
    </>
  );
}
