"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkIcon, BookmarkPlusIcon, PlusIcon, RadioTowerIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { AssignPanel } from "@/features/dispatch/assign-panel";
import { loadColumns } from "@/features/loads/columns";
import { VIEWS, type LoadListItem } from "@/features/loads/lib";
import { useListState } from "@/hooks/use-list-state";
import { useTerminals } from "@/hooks/use-options";
import { useTerminalPreference } from "@/hooks/use-terminal-preference";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useSession, useWorkspacePath } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format/text";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;
type Summary = Schema<"BoardSummary">;
type SavedView = Schema<"SavedViewOut">;

/** The counts across the top. Each one is also the button that shows exactly those loads. */
function SummaryStrip({ summary, view, status, onPick }: { summary?: Summary; view: string; status: string; onPick: (view: string, status: string) => void }) {
  const tiles = [...VIEWS.map((v) => ({ key: v.value, label: v.label, count: summary?.[v.summary as keyof Summary], view: v.value, status: "" })), { key: "on_hold", label: "On hold", count: summary?.on_hold, view: "", status: "on_hold" }];
  const urgent = new Set(["at_risk", "unassigned", "missing_pod"]);
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" role="group" aria-label="Board views">
      {tiles.map((tile) => {
        const active = tile.status ? status === tile.status : view === tile.view && !status;
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onPick(tile.view, tile.status)}
            aria-pressed={active}
            className={cn("rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:bg-accent", active && "border-primary bg-primary/5 ring-1 ring-primary")}
          >
            <span className="block text-xs font-medium text-muted-foreground">{tile.label}</span>
            {summary ? <span className={cn("tabular mt-0.5 block text-xl font-semibold", urgent.has(tile.key) && (tile.count ?? 0) > 0 && "text-destructive")}>{formatNumber(tile.count ?? 0)}</span> : <Skeleton className="mt-1.5 h-6 w-10" />}
          </button>
        );
      })}
    </div>
  );
}

function SaveViewDialog({ open, onOpenChange, params }: { open: boolean; onOpenChange: (open: boolean) => void; params: Record<string, string> }) {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/saved-views", { body: { resource: "dispatch", name: name.trim(), params, shared } })),
    onSuccess: (view) => {
      toast.success(`View "${view.name}" saved`);
      void queryClient.invalidateQueries({ queryKey: [org.id, "saved-views", "dispatch"] });
      setName("");
      setShared(false);
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return setError("Name the view");
            setError(null);
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>Keeps the current filters, search and sort, to come back to in one click.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Chicago reefers this week" autoFocus />
          </div>
          {can("organization.manage") ? (
            <div className="flex items-center gap-2.5">
              <Checkbox id="view-shared" checked={shared} onCheckedChange={(v) => setShared(v === true)} />
              <Label htmlFor="view-shared" className="font-normal">
                Share with everyone in the company
              </Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <SubmitButton pending={save.isPending}>Save view</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SavedViews({ current }: { current: Record<string, string> }) {
  const org = useOrg();
  const { user } = useSession();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const views = useQuery({ queryKey: [org.id, "saved-views", "dispatch"], queryFn: () => unwrap(api.GET("/api/v1/saved-views", { params: { query: { resource: "dispatch" } } })) });
  const remove = useMutation({
    mutationFn: (view: SavedView) => unwrap(api.DELETE("/api/v1/saved-views/{view_id}", { params: { path: { view_id: view.id } } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [org.id, "saved-views", "dispatch"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  function apply(view: SavedView) {
    const params = new URLSearchParams(Object.entries(view.params).map(([k, v]) => [k, String(v)]));
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <BookmarkIcon /> Saved views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.data?.length ? (
            views.data.map((view) => (
              <DropdownMenuItem key={view.id} onSelect={() => apply(view)}>
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
                {view.shared ? <span className="text-xs text-muted-foreground">Shared</span> : null}
                {view.owner_user_id === user.id || (view.shared && can("organization.manage")) ? (
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-destructive/10"
                    aria-label={`Delete view ${view.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      remove.mutate(view);
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">None yet.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>
            <BookmarkPlusIcon /> Save the current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveViewDialog open={saving} onOpenChange={setSaving} params={current} />
    </>
  );
}

/**
 * The dispatcher's working screen: what needs a driver, what is late, what is on the road. Everything is
 * filtered, sorted and paged by the API, and it refreshes itself every 30 seconds.
 */
export function DispatchBoard() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const search = useSearchParams();
  const terminals = useTerminals();
  const [myTerminal] = useTerminalPreference();
  // The board starts at the terminal chosen in the top bar; "Any terminal" overrides it for this view.
  const filters = useMemo(() => ({ view: "active", status: "", terminal_id: myTerminal, customer_id: "", pickup_from: "", pickup_to: "" }), [myTerminal]);
  const state = useListState({ defaultSort: "pickup_at", filters });
  const [assigning, setAssigning] = useState<LoadListItem | null>(null);
  const terminalId = state.filters.terminal_id && state.filters.terminal_id !== "all" ? state.filters.terminal_id : undefined;

  const board = useQuery({
    queryKey: [org.id, "dispatch", "board", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/dispatch/board", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const summary = useQuery({
    queryKey: [org.id, "dispatch", "summary", terminalId ?? null],
    queryFn: () => unwrap(api.GET("/api/v1/dispatch/summary", { params: { query: { terminal_id: terminalId } } })),
    refetchInterval: REFRESH_MS,
  });

  const columns = loadColumns({ href: (load) => path("loads", load.id), timezone: org.timezone, showRates: can("loads.rates.read"), onAssign: can("dispatch.assign") ? setAssigning : undefined });
  const current = Object.fromEntries([...search.entries()].filter(([key]) => key !== "cursor"));
  const updated = board.dataUpdatedAt ? new Intl.DateTimeFormat("en-US", { timeZone: org.timezone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(board.dataUpdatedAt) : null;

  return (
    <>
      <PageHeader
        title="Dispatch"
        description={
          <span className="flex items-center gap-1.5">
            <RadioTowerIcon className={cn("size-3.5", board.isFetching ? "animate-pulse text-primary" : "text-success")} aria-hidden />
            Live: refreshes every 30 seconds{updated ? `, last at ${updated}` : ""}.
          </span>
        }
        actions={
          <>
            <SavedViews current={current} />
            {can("loads.create") ? (
              <Button asChild>
                <Link href={path("loads", "new")}>
                  <PlusIcon /> New load
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <SummaryStrip summary={summary.data} view={state.filters.view ?? ""} status={state.filters.status ?? ""} onPick={(view, status) => state.setFilters({ view: view || "all", status })} />
      <DataTable
        label="Dispatch board"
        columns={columns}
        query={board}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("loads", row.id)}
        preferenceKey="dispatch"
        searchPlaceholder="Load, reference, customer, city"
        filters={
          <>
            {terminals.options.length ? <FilterSelect label="Terminal" value={state.filters.terminal_id || "all"} onChange={(value) => state.setFilter("terminal_id", value === "all" ? "all" : value)} options={[{ value: "all", label: "Any terminal" }, ...terminals.options]} /> : null}
            {can("customers.read") ? (
              <div className="w-52">
                <CustomerPicker value={state.filters.customer_id ?? ""} onChange={(id) => state.setFilter("customer_id", id)} placeholder="Any customer" />
              </div>
            ) : null}
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Pickup
              <Input type="date" aria-label="Pickup from" value={state.filters.pickup_from ?? ""} onChange={(e) => state.setFilter("pickup_from", e.target.value)} className="h-9 w-36" />
              to
              <Input type="date" aria-label="Pickup to" value={state.filters.pickup_to ?? ""} onChange={(e) => state.setFilter("pickup_to", e.target.value)} className="h-9 w-36" />
            </label>
          </>
        }
        empty={{ icon: RadioTowerIcon, title: "Nothing here", description: "No loads match this view. Pick another view above, or book a load." }}
      />
      {assigning ? <AssignPanel key={`${assigning.id}-${assigning.version}`} load={assigning} open onOpenChange={(open) => !open && setAssigning(null)} /> : null}
    </>
  );
}
