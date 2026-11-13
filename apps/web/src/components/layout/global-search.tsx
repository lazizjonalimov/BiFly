"use client";

import { useQuery } from "@tanstack/react-query";
import { BanknoteIcon, ClipboardCheckIcon, ContainerIcon, FileTextIcon, IdCardIcon, Loader2Icon, PackageIcon, PlusIcon, ReceiptIcon, SearchIcon, TruckIcon, UsersIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useDebouncedInput } from "@/hooks/use-debounced";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";

type Result = Schema<"SearchResult">;

const KINDS: Record<Result["type"], { label: string; icon: LucideIcon }> = {
  load: { label: "Loads", icon: PackageIcon },
  customer: { label: "Customers", icon: UsersIcon },
  driver: { label: "Drivers", icon: IdCardIcon },
  vehicle: { label: "Trucks", icon: TruckIcon },
  trailer: { label: "Trailers", icon: ContainerIcon },
  invoice: { label: "Invoices", icon: FileTextIcon },
  work_order: { label: "Work orders", icon: WrenchIcon },
};

/** Where each kind of search result opens. */
function resultPath(result: Result): string[] {
  switch (result.type) {
    case "load":
      return ["loads", result.id];
    case "customer":
      return ["customers", result.id];
    case "driver":
      return ["drivers", result.id];
    case "invoice":
      return ["finance", "invoices", result.id];
    case "vehicle":
      return [`equipment/trucks?q=${encodeURIComponent(result.title.replace(/^Truck /, ""))}`];
    case "trailer":
      return [`equipment/trailers?q=${encodeURIComponent(result.title.replace(/^Trailer /, ""))}`];
    case "work_order":
      return ["maintenance", result.id];
  }
}

/** What can be created from anywhere, for those whose role allows it. */
export function useQuickCreate() {
  const can = useCan();
  return [
    { label: "Load", path: ["loads", "new"], icon: PackageIcon, allowed: can("loads.create") },
    { label: "Customer", path: ["customers?new=1"], icon: UsersIcon, allowed: can("customers.manage") },
    { label: "Driver", path: ["drivers?new=1"], icon: IdCardIcon, allowed: can("drivers.manage") },
    { label: "Truck", path: ["equipment/trucks?new=1"], icon: TruckIcon, allowed: can("equipment.manage") },
    { label: "Trailer", path: ["equipment/trailers?new=1"], icon: ContainerIcon, allowed: can("equipment.manage") },
    { label: "Work order", path: ["maintenance?new=1"], icon: WrenchIcon, allowed: can("maintenance.manage") },
    { label: "Invoice", path: ["finance/invoices?new=1"], icon: ReceiptIcon, allowed: can("invoices.create") },
    { label: "Payment", path: ["finance/payments?new=1"], icon: BanknoteIcon, allowed: can("payments.record") },
    { label: "Inspection", path: ["maintenance/inspections?new=1"], icon: ClipboardCheckIcon, allowed: can("safety.manage") || can("maintenance.manage") },
  ].filter((item) => item.allowed);
}

export function QuickCreate() {
  const router = useRouter();
  const path = useWorkspacePath();
  const items = useQuickCreate();
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9">
          <PlusIcon /> <span className="hidden sm:inline">New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={() => router.push(path(...item.path))}>
            <item.icon /> {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Find any record by number or name: a load number, a customer, a driver, a truck. Opens with Ctrl+K
 * (⌘K on a Mac). Only kinds of record the person's role may see are searched; the API decides that.
 */
export function GlobalSearch() {
  const org = useOrg();
  const router = useRouter();
  const path = useWorkspacePath();
  const create = useQuickCreate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useDebouncedInput(query, setQuery, 200);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the platform is only known in the browser
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const search = query.trim().length >= 2;
  const results = useQuery({
    queryKey: [org.id, "search", query.trim()],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/search", { params: { query: { q: query.trim() } }, signal })),
    enabled: open && search,
    staleTime: 15_000,
  });

  function go(parts: string[]) {
    setOpen(false);
    setTyped("");
    setQuery("");
    router.push(path(...parts));
  }

  const grouped = (results.data ?? []).reduce<Record<string, Result[]>>((acc, r) => ((acc[r.type] ??= []).push(r), acc), {});
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-full max-w-xs items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent" aria-label="Search everything">
        <SearchIcon className="size-4" />
        <span className="hidden flex-1 text-left sm:inline">Search loads, customers, drivers…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] lg:inline">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-xl [&>button]:hidden">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Find a load, customer, driver, truck or trailer by number or name</DialogDescription>
          <Command shouldFilter={false} label="Search">
            <CommandInput value={typed} onValueChange={setTyped} placeholder="Load number, reference, customer, driver, unit…" autoFocus />
            <CommandList>
              {!search ? (
                create.length ? (
                  <CommandGroup heading="Create">
                    {create.map((item) => (
                      <CommandItem key={item.label} value={`create-${item.label}`} onSelect={() => go(item.path)}>
                        <item.icon /> New {item.label.toLowerCase()}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Type at least two characters.</p>
                )
              ) : results.isPending ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" /> Searching
                </div>
              ) : (
                <>
                  <CommandEmpty>Nothing found for “{query.trim()}”.</CommandEmpty>
                  {Object.entries(grouped).map(([type, items]) => {
                    const kind = KINDS[type as Result["type"]];
                    return (
                      <CommandGroup key={type} heading={kind.label}>
                        {items.map((item) => (
                          <CommandItem key={`${type}-${item.id}`} value={`${type}-${item.id}`} onSelect={() => go(resultPath(item))}>
                            <kind.icon />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{item.title}</span>
                              {item.subtitle ? <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span> : null}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    );
                  })}
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
