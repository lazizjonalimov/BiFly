"use client";

import { CircleAlertIcon, InboxIcon, RotateCwIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

/** Nothing to show, and what to do about it. */
export function EmptyState({ icon: Icon = InboxIcon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Loading failed. Says what happened in plain words and offers the one useful next step. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlertIcon className="size-5" />
      </span>
      <p className="text-sm font-medium">{forbidden ? "You don't have access to this" : "This couldn't be loaded"}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{forbidden ? "Your role doesn't include it. An administrator can change that." : errorMessage(error)}</p>
      {requestId && !forbidden ? <p className="font-mono text-xs text-muted-foreground">Reference: {requestId}</p> : null}
      {onRetry && !forbidden ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCwIcon /> Try again
        </Button>
      ) : null}
    </div>
  );
}
