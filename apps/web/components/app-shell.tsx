"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { PasswordDialog } from "@/components/password-dialog";
import { Button, Loading } from "@/components/ui";
import { session } from "@/lib/api";
import { label } from "@/lib/format";
import { useMe } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Overview", perm: "reports:read" },
  { href: "/dispatch", label: "Dispatch board", perm: "loads:read" },
  { href: "/loads", label: "Loads", perm: "loads:read" },
  { href: "/customers", label: "Customers", perm: "customers:read" },
  { href: "/drivers", label: "Drivers", perm: "drivers:read" },
  { href: "/fleet", label: "Fleet", perm: "fleet:read" },
  { href: "/invoices", label: "Invoices", perm: "invoices:read" },
  { href: "/team", label: "Team", perm: "users:manage" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, can, isLoading } = useMe();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  async function signOut() {
    await session("logout").catch(() => {});
    // Full reload on auth change: guarantees no cached data from a previous session survives.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.assign("/login");
  }

  const links = NAV.filter((n) => can(n.perm));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="font-semibold">Carrier TMS</span>
        <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="main-nav">
          Menu
        </Button>
      </header>

      <aside
        id="main-nav"
        className={`${open ? "block" : "hidden"} border-b border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0`}
      >
        <div className="hidden items-center gap-2.5 px-4 py-4 md:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">TMS</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{me?.organization_name ?? "Carrier TMS"}</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 px-2 py-2">
          {links.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                isActive(n.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {me && (
          <div className="border-t border-slate-200 px-4 py-3">
            <div className="truncate text-sm font-medium text-slate-900">{me.full_name}</div>
            <div className="truncate text-xs text-slate-500">{label(me.role)}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => setChangingPassword(true)}>
                Password
              </Button>
              <Button size="sm" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </div>
        )}
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">
          {isLoading ? (
            <Loading />
          ) : me?.role === "driver" ? (
            <DriverNotice />
          ) : (
            <Suspense fallback={<Loading />}>{children}</Suspense>
          )}
        </div>
      </main>
      <PasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </div>
  );
}

function DriverNotice() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Driver accounts use the mobile app</h1>
      <p className="mt-1 text-sm text-slate-600">
        This web portal is for office staff. Your assignments, stop updates and document uploads are in the driver app.
      </p>
    </div>
  );
}
