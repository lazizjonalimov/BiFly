"use client";

import { CircleAlertIcon, ShieldAlertIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Schema } from "@/lib/api/types";
import { formatDate } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

type Compliance = Schema<"Compliance">;

/** The compliance verdict the API worked out, with the reasons one hover (or focus) away. */
export function ComplianceBadge({ compliance }: { compliance: Compliance }) {
  if (compliance.issues.length === 0) return <StatusBadge status={compliance.status} />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full" aria-label={`${compliance.issues.map((i) => i.message).join(". ")}`}>
          <StatusBadge status={compliance.status} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="grid gap-0.5">
          {compliance.issues.map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** Spells out what stops a driver or unit from being dispatched, and what will soon. */
export function ComplianceAlert({ compliance, subject }: { compliance: Compliance; subject: string }) {
  const blocking = compliance.issues.filter((i) => i.severity === "blocking");
  const warnings = compliance.issues.filter((i) => i.severity === "warning");
  const missing = compliance.issues.filter((i) => i.severity === "info");
  if (compliance.issues.length === 0) return null;
  return (
    <div className="mb-5 grid gap-3">
      {blocking.length ? (
        <Alert variant="destructive">
          <ShieldAlertIcon />
          <AlertTitle>{subject} can&apos;t be dispatched</AlertTitle>
          <AlertDescription>{blocking.map((i) => i.message).join(". ")}.</AlertDescription>
        </Alert>
      ) : null}
      {warnings.length ? (
        <Alert variant="warning">
          <CircleAlertIcon />
          <AlertTitle>Needs attention soon</AlertTitle>
          <AlertDescription>{warnings.map((i) => i.message).join(". ")}.</AlertDescription>
        </Alert>
      ) : null}
      {missing.length && !blocking.length && !warnings.length ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Some dates are not on file</AlertTitle>
          <AlertDescription>{missing.map((i) => i.message).join(". ")}. Without them BiFly can&apos;t warn you before they expire.</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * What to say about whether a driver or unit can take work right now. "Available" is only said when it
 * really is: in service, not on a load, and with nothing expired.
 */
export function Availability({ status, compliance, currentLoad }: { status: string; compliance: Compliance; currentLoad: { load_number: string } | null | undefined }) {
  if (currentLoad) return <span className="font-medium">On {currentLoad.load_number}</span>;
  if (status !== "active") return <span className="text-muted-foreground">—</span>;
  if (compliance.status === "expired") return <span className="font-medium text-destructive">Blocked</span>;
  return <span className="text-muted-foreground">Available</span>;
}

/** An expiry date coloured by how close it is. `today` is the company's date, from the API's own verdict. */
export function ExpiryDate({ date, issues, codes }: { date: string | null | undefined; issues: Compliance["issues"]; codes: string[] }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const issue = issues.find((i) => codes.some((code) => i.code.startsWith(code)));
  return <span className={cn(issue?.severity === "blocking" && "font-medium text-destructive", issue?.severity === "warning" && "font-medium text-warning")}>{formatDate(date)}</span>;
}
