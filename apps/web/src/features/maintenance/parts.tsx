"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { invalidateMaintenance, priorityLabel, type UnitRef } from "@/features/maintenance/lib";
import { api, unwrap } from "@/lib/api/client";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/** Work orders and inspections are two lists of one section; these links move between them. */
export function MaintenanceTabs({ current }: { current: "work-orders" | "inspections" }) {
  const path = useWorkspacePath();
  const can = useCan();
  const tabs = [
    { key: "work-orders", label: "Work orders", href: path("maintenance"), shown: can("maintenance.read") },
    { key: "inspections", label: "Inspections", href: path("maintenance", "inspections"), shown: can("maintenance.read") || can("safety.read") },
  ].filter((tab) => tab.shown);
  return (
    <nav aria-label="Maintenance" className="mb-4 inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={current === tab.key ? "page" : undefined} className={cn("inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors hover:text-foreground", current === tab.key && "bg-background text-foreground shadow-xs")}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

const PRIORITY_TONES = { urgent: "danger", high: "warning", normal: "neutral", low: "neutral" } as const;

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal" || priority === "low") return <span className="text-sm text-muted-foreground">{priorityLabel(priority)}</span>;
  return <Badge variant={PRIORITY_TONES[priority as keyof typeof PRIORITY_TONES] ?? "neutral"}>{priorityLabel(priority)}</Badge>;
}

/**
 * Put a unit back on the road. The API refuses while a work order that took it off is open or an
 * out-of-service defect hasn't been repaired, and says which; the dialog shows that answer as it is.
 */
export function ReturnToService({ unit, variant = "default" }: { unit: Pick<UnitRef, "type" | "id" | "name" | "status">; variant?: "default" | "outline" }) {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: (notes: string) => unwrap(api.POST("/api/v1/maintenance/return-to-service", { body: { unit_type: unit.type, unit_id: unit.id, notes: notes || null } })),
    onSuccess: (saved) => {
      invalidateMaintenance(queryClient, org.id);
      toast.success(`${saved.name} is back in service`);
    },
  });
  if (!can("maintenance.manage") || (unit.status !== "in_maintenance" && unit.status !== "out_of_service")) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <CircleCheckIcon /> Return to service
      </Button>
      {open ? (
        <ConfirmDialog
          open
          onOpenChange={setOpen}
          title={`Return ${unit.name} to service?`}
          description="It becomes available to dispatch again. This is refused while a work order that took it off the road is open, or a defect that put it out of service hasn't been repaired."
          confirmLabel="Return to service"
          reason={{ label: "Note (optional)", placeholder: "Who signed it off, and anything the next driver should know" }}
          onConfirm={(notes) => run.mutateAsync(notes)}
        />
      ) : null}
    </>
  );
}
