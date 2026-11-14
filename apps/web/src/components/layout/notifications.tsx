"use client";

import { useQuery } from "@tanstack/react-query";
import { BellIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePreference } from "@/hooks/use-preference";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format/text";
import { resourcePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Alert = Schema<"Exception_">;
type Seen = Record<string, number>;

const SEVERITY: Record<string, string> = { high: "bg-destructive", medium: "bg-warning", low: "bg-muted-foreground" };

/**
 * Alerts that are new since the person last looked: ones they haven't seen at all, or whose count has grown
 * (a fourth late load after three). A count that went down is not news.
 */
export function unseenCodes(alerts: Pick<Alert, "code" | "count">[], seen: Seen): Set<string> {
  return new Set(alerts.filter((a) => a.count > (seen[a.code] ?? 0)).map((a) => a.code));
}

/**
 * The bell in the header. It lists what needs someone now, worked out live by the API for this person's role
 * (the same list as the dashboard's), refreshes every minute, and counts what is new since it was last opened.
 */
export function Notifications() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const enabled = can("dashboard.read");
  const query = useQuery({ queryKey: [org.id, "dashboard", "exceptions"], queryFn: () => unwrap(api.GET("/api/v1/dashboard/exceptions")), enabled, refetchInterval: 60_000 });
  const [seen, setSeen, { ready }] = usePreference<Seen>("notifications.seen", {});
  const [open, setOpen] = useState(false);
  // What was new when the list was opened stays marked while it is open, even though opening it marks it seen.
  const [freshWhenOpened, setFreshWhenOpened] = useState<Set<string>>(new Set());
  if (!enabled) return null;

  const alerts = query.data ?? [];
  const fresh = ready ? unseenCodes(alerts, seen) : new Set<string>();

  function toggle(next: boolean) {
    setOpen(next);
    if (next) {
      setFreshWhenOpened(fresh);
      if (query.data) setSeen(Object.fromEntries(query.data.map((a) => [a.code, a.count])));
    }
  }

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={fresh.size ? `Notifications, ${fresh.size} new` : "Notifications"}>
          <BellIcon />
          {fresh.size ? (
            <span aria-hidden className="tabular absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {fresh.size}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Needs attention</p>
          <Link href={path("dashboard")} onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">
            Dashboard
          </Link>
        </div>
        {query.isPending ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Checking…</p>
        ) : query.isError ? (
          <p className="px-4 py-6 text-center text-sm text-destructive">Couldn&apos;t check. It will try again in a minute.</p>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <CircleCheckIcon className="size-6 text-success" aria-hidden />
            <p className="text-sm font-medium">Nothing needs you right now</p>
            <p className="text-xs text-muted-foreground">Late loads, expired paperwork, overdue invoices and urgent repairs show up here.</p>
          </div>
        ) : (
          <ul aria-label="Alerts" className="max-h-[70dvh] overflow-y-auto py-1">
            {alerts.map((alert) => {
              const target = resourcePath(alert.resource);
              const body = (
                <>
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY[alert.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span>
                        <span className="tabular">{formatNumber(alert.count)}</span> · {alert.title}
                      </span>
                      {freshWhenOpened.has(alert.code) ? <Badge variant="info">New</Badge> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">{alert.detail}</span>
                  </span>
                </>
              );
              return (
                <li key={alert.code}>
                  {target ? (
                    <Link href={`${path(target)}?${new URLSearchParams(alert.params)}`} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-2.5 hover:bg-muted">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-4 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
