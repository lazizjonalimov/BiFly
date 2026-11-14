"use client";

import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CompanySwitcher } from "@/components/layout/company-switcher";
import { GlobalSearch, QuickCreate } from "@/components/layout/global-search";
import { Notifications } from "@/components/layout/notifications";
import { LogoMark } from "@/components/layout/logo";
import { TerminalSelector } from "@/components/layout/terminal-selector";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalPreference } from "@/hooks/use-local-preference";
import { useCan, useOrg, useSession } from "@/lib/auth/session";
import { NAVIGATION, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "flyfleet-sidebar-collapsed";

function useVisibleNavigation() {
  const can = useCan();
  const { account } = useSession();
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => (item.accountOwner ? account.is_owner : !item.anyOf || can(...item.anyOf))),
  })).filter((group) => group.items.length > 0);
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const { slug } = useOrg();
  const pathname = usePathname();
  const href = `/${slug}/${item.path}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active && "bg-sidebar-accent text-white",
        collapsed && "justify-center px-0",
      )}
    >
      <item.icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
      <span className={cn(collapsed && "sr-only")}>{item.label}</span>
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const groups = useVisibleNavigation();
  const { slug } = useOrg();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link href={`/${slug}/dashboard`} onClick={onNavigate} className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <LogoMark className="size-7" />
        <span className={cn("text-base font-semibold tracking-tight text-white", collapsed && "sr-only")}>FlyFleet</span>
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className={cn("mb-1.5 px-2.5 text-[11px] font-medium tracking-wider text-sidebar-muted/70 uppercase", collapsed && "sr-only")}>{group.label}</p>
            <ul className="grid gap-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const org = useOrg();
  // A presentation preference only, so it lives in the browser rather than in the account.
  const [stored, setStored] = useLocalPreference(COLLAPSED_KEY, "0");
  const collapsed = stored === "1";
  const toggle = () => setStored(collapsed ? "0" : "1");
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md">
        Skip to content
      </a>
      <aside className={cn("no-print sticky top-0 hidden h-dvh shrink-0 transition-[width] duration-200 lg:block", collapsed ? "w-16" : "w-60")}>
        <Sidebar collapsed={collapsed} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 border-0 p-0 sm:max-w-64 [&>button]:text-sidebar-foreground">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:px-4">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <MenuIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
          <CompanySwitcher />
          <TerminalSelector />
          <div className="flex flex-1 justify-center px-2">
            <GlobalSearch />
          </div>
          <QuickCreate />
          <Notifications />
          <UserMenu />
        </header>
        {org.status === "archived" ? (
          <div role="status" className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm">
            <strong className="font-medium">{org.name} is archived.</strong> Its records can be viewed but not changed. The account owner can restore it from Companies.
          </div>
        ) : null}
        <main id="main" className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
