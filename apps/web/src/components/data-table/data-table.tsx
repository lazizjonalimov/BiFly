"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowData, type SortingState, type Updater, type VisibilityState } from "@tanstack/react-table";
import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsUpDownIcon, Columns3Icon, SearchIcon, XIcon, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedInput } from "@/hooks/use-debounced";
import type { ListState } from "@/hooks/use-list-state";
import { usePreference } from "@/hooks/use-preference";
import type { PageInfo } from "@/lib/api/types";
import { formatNumber } from "@/lib/format/text";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the type parameters are part of the interface being extended
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Name shown in the Columns menu, when the header isn't plain text. */
    label?: string;
    align?: "right";
    /** Extra classes for this column's cells (width, wrapping). */
    className?: string;
  }
}

type Props<T> = {
  /**
   * A column that can be sorted sets `enableSorting: true` and uses the API's sort key as its `id`.
   * Sorting, filtering and paging all happen in the database; this table never rearranges rows itself.
   */
  columns: ColumnDef<T, unknown>[];
  query: UseQueryResult<{ items: T[]; page: PageInfo }>;
  state: ListState;
  getRowId: (row: T) => string;
  /** Where a row leads. The whole row is clickable; the first cell should also contain a real link. */
  rowHref?: (row: T) => string;
  /** For rows that open a panel instead of a page. The first cell should contain a button that does the same. */
  onRowClick?: (row: T) => void;
  empty: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode };
  /** Remember which columns are shown, per user and company, under this name. */
  preferenceKey?: string;
  searchPlaceholder?: string;
  /** Filter controls, shown after the search box. */
  filters?: React.ReactNode;
  /** What this list is, for screen readers: "Customers". */
  label: string;
};

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") return <ArrowUpIcon className="size-3.5" />;
  if (direction === "desc") return <ArrowDownIcon className="size-3.5" />;
  return <ChevronsUpDownIcon className="size-3.5 opacity-50" />;
}

/**
 * The standard list: search, filters, sortable columns, a column chooser and cursor paging, with loading,
 * empty and error states. TanStack Table holds the table state; the address bar is where that state lives
 * (see useListState), and TanStack Query fetches whatever the address describes.
 */
export function DataTable<T>({ columns, query, state, getRowId, rowHref, onRowClick, empty, preferenceKey, searchPlaceholder = "Search", filters, label }: Props<T>) {
  const router = useRouter();
  const [search, setSearch] = useDebouncedInput(state.q, state.setQuery);
  const [hidden, setHidden] = usePreference<string[]>(`table.${preferenceKey ?? "unnamed"}.hidden`, []);

  // TanStack only treats a column as sortable if it can read a value from the row. Rows here are sorted by
  // the database, so sortable columns get an accessor that is never used for ordering.
  const tableColumns = useMemo(() => columns.map((column) => (column.enableSorting && !("accessorFn" in column) && !("accessorKey" in column) ? { ...column, accessorFn: () => null } : column)), [columns]);
  const sorting: SortingState = [{ id: state.sort.replace(/^-/, ""), desc: state.sort.startsWith("-") }];
  const columnVisibility: VisibilityState = Object.fromEntries(hidden.map((id) => [id, false]));

  // TanStack Table hands back functions that are new on every render; that is how it is designed to be used.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: query.data?.items ?? [],
    columns: tableColumns as ColumnDef<T, unknown>[],
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    defaultColumn: { enableSorting: false },
    state: { sorting, columnVisibility },
    onSortingChange: (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      state.setSort(first ? `${first.desc ? "-" : ""}${first.id}` : state.defaultSort);
    },
    onColumnVisibilityChange: (updater: Updater<VisibilityState>) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      if (preferenceKey) setHidden(Object.entries(next).filter(([, visible]) => !visible).map(([id]) => id));
    },
  });

  const page = query.data?.page;
  const rows = table.getRowModel().rows;
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const columnCount = table.getVisibleLeafColumns().length;
  const loadingFirst = query.isPending;
  const refreshing = query.isFetching && !query.isPending;

  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <div className="no-print flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} aria-label={`Search ${label.toLowerCase()}`} className="pl-8" />
        </div>
        {filters}
        {state.isFiltered ? (
          <Button variant="ghost" size="sm" onClick={state.reset}>
            <XIcon /> Clear
          </Button>
        ) : null}
        <div className="flex-1" />
        {preferenceKey && hideable.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3Icon /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {hideable.map((column) => (
                <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={(checked) => column.toggleVisibility(checked === true)} onSelect={(event) => event.preventDefault()}>
                  {column.columnDef.meta?.label ?? (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* A thin bar while a new page or filter loads, with the previous rows left in place. */}
      <div className={cn("h-0.5 bg-primary/70 transition-opacity", refreshing ? "animate-pulse opacity-100" : "opacity-0")} aria-hidden />

      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Table aria-label={label} aria-busy={query.isFetching}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();
                  const content = flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <TableHead key={header.id} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : sortable ? "none" : undefined} className={cn(header.column.columnDef.meta?.align === "right" && "text-right", header.column.columnDef.meta?.className)}>
                      {sortable ? (
                        <button type="button" onClick={header.column.getToggleSortingHandler()} className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground", direction && "text-foreground")}>
                          {content}
                          <SortIcon direction={direction} />
                        </button>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loadingFirst
              ? Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    {Array.from({ length: columnCount }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className={cn("h-4", j === 0 ? "w-32" : "w-20")} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row) => {
                  const href = rowHref?.(row.original);
                  return (
                    <TableRow
                      key={row.id}
                      className={cn((href || onRowClick) && "cursor-pointer")}
                      onClick={(event) => {
                        // Links, buttons and menus inside the row keep their own behaviour.
                        if ((!href && !onRowClick) || (event.target as HTMLElement).closest("a,button,input,[role=menu],[role=menuitem]")) return;
                        if (window.getSelection()?.toString()) return; // the user is selecting text, not clicking
                        if (href) router.push(href);
                        else onRowClick?.(row.original);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={cn(cell.column.columnDef.meta?.align === "right" && "tabular text-right", cell.column.columnDef.meta?.className)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      )}

      {!loadingFirst && !query.isError && rows.length === 0 ? (
        state.isFiltered ? (
          <EmptyState
            icon={SearchIcon}
            title="Nothing matches"
            description="Try a different search or clear the filters."
            action={
              <Button variant="outline" size="sm" onClick={state.reset}>
                Clear search and filters
              </Button>
            }
          />
        ) : (
          <EmptyState {...empty} />
        )
      ) : null}

      {page && (rows.length > 0 || state.hasPrevious) ? (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
          <p aria-live="polite">
            {page.total_count !== null && page.total_count !== undefined ? `${formatNumber(rows.length)} of ${formatNumber(page.total_count)}` : `${formatNumber(rows.length)} shown`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={state.previous} disabled={!state.hasPrevious || query.isFetching}>
              <ChevronLeftIcon /> Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => page.next_cursor && state.next(page.next_cursor)} disabled={!page.has_more || !page.next_cursor || query.isFetching}>
              Next <ChevronRightIcon />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A compact filter control for the table toolbar. */
export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cn("h-9 max-w-44 appearance-none rounded-md border border-input bg-card py-1 pr-7 pl-3 text-sm shadow-xs", value && value !== "all" && "border-primary/50 bg-primary/5 font-medium")}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronsUpDownIcon className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </label>
  );
}
