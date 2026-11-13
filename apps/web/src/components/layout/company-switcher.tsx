"use client";

import { Building2Icon, CheckIcon, ChevronsUpDownIcon, Loader2Icon, PlusIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/lib/api/errors";
import { postJson } from "@/lib/api/post";
import type { OrgRef } from "@/lib/api/types";
import { useSession } from "@/lib/auth/session";
import { humanize } from "@/lib/format/text";
import { hardNavigate } from "@/lib/hard-navigation";

/**
 * Move this browser to another company. The server re-checks membership and issues a session for the chosen
 * company; the full page load that follows throws away everything cached for the one being left.
 */
export async function switchCompany(organizationId: string, path = "dashboard"): Promise<void> {
  const reply = await postJson<{ organization: OrgRef }>("/api/auth/switch", { organization_id: organizationId });
  hardNavigate(`/${reply.organization.slug}/${path}`);
}

export function CompanySwitcher() {
  const { organization, memberships, account } = useSession();
  const [switching, setSwitching] = useState<string | null>(null);

  async function choose(org: OrgRef) {
    if (org.id === organization.id || switching) return;
    setSwitching(org.id);
    try {
      await switchCompany(org.id);
    } catch (error) {
      toast.error(errorMessage(error));
      setSwitching(null);
    }
  }

  const active = memberships.filter((m) => m.status === "active");
  const archived = memberships.filter((m) => m.status !== "active");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 max-w-[16rem] min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 text-sm font-medium shadow-xs transition-colors hover:bg-accent" aria-label={`Company: ${organization.name}. Switch company`}>
        <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{organization.name}</span>
        {switching ? <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Your companies</DropdownMenuLabel>
        {[...active, ...archived].map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => choose(org)} disabled={switching !== null && switching !== org.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{org.name}</span>
              <span className="block text-xs text-muted-foreground">{humanize(org.role)}</span>
            </span>
            {org.status !== "active" ? <Badge variant="warning">Archived</Badge> : null}
            {org.id === organization.id ? <CheckIcon className="!text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        {account.is_owner ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/${organization.slug}/settings/companies?new=1`}>
                <PlusIcon /> Add a company
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/${organization.slug}/settings/companies`}>
                <SettingsIcon /> Manage companies
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
