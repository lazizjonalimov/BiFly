"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";

/** The value that means "no filter" for a filter that has a default (e.g. status: active). */
export const ALL = "all";

export type ListOptions = {
  defaultSort: string;
  /**
   * The filters this list understands and the value each takes when the address doesn't mention it.
   * Must be a stable object (declare it outside the component).
   */
  filters?: Record<string, string>;
};

/**
 * A list's search text, sort, filters and page live in the address bar. That makes every view of a list
 * something you can bookmark, share, reload and go back to, and it is the single source of truth: the
 * table and the request are both derived from it.
 */
export function useListState({ defaultSort, filters: defaults = {} }: ListOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // Cursors of the pages before this one, so "Previous" works with cursor paging.
  const trail = useRef<(string | null)[]>([]);

  const q = search.get("q") ?? "";
  const sort = search.get("sort") ?? defaultSort;
  const cursor = search.get("cursor");
  const filters = useMemo(() => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, search.get(key) ?? fallback])), [search, defaults]);

  const write = useCallback(
    (change: (params: URLSearchParams) => void, keepPage = false) => {
      const params = new URLSearchParams(search.toString());
      change(params);
      if (!keepPage) {
        params.delete("cursor");
        trail.current = [];
      }
      const text = params.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  const put = (params: URLSearchParams, key: string, value: string, fallback: string) => {
    if (value === fallback) params.delete(key);
    else params.set(key, value || ALL);
  };

  /** What to send to the API: empty and "all" filters are left out. */
  const apiParams = useMemo(() => {
    const active = Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ALL));
    return { ...active, ...(q ? { q } : {}), sort, ...(cursor ? { cursor } : {}) };
  }, [filters, q, sort, cursor]);

  return {
    q,
    sort,
    defaultSort,
    cursor,
    filters,
    apiParams,
    isFiltered: q !== "" || Object.entries(filters).some(([key, value]) => value !== defaults[key]),
    hasPrevious: cursor !== null,
    setQuery: (value: string) => write((p) => (value ? p.set("q", value) : p.delete("q"))),
    setSort: (value: string) => write((p) => (value === defaultSort ? p.delete("sort") : p.set("sort", value))),
    setFilter: (key: string, value: string) => write((p) => put(p, key, value, defaults[key] ?? "")),
    setFilters: (values: Record<string, string>) => write((p) => Object.entries(values).forEach(([key, value]) => put(p, key, value, defaults[key] ?? ""))),
    reset: () => write((p) => ["q", "sort", ...Object.keys(defaults)].forEach((key) => p.delete(key))),
    next: (nextCursor: string) => {
      trail.current.push(cursor);
      write((p) => p.set("cursor", nextCursor), true);
    },
    previous: () => {
      // After a reload the trail is gone; the first page is then the only place "back" can mean.
      const back = trail.current.pop() ?? null;
      write((p) => (back ? p.set("cursor", back) : p.delete("cursor")), true);
    },
  };
}

export type ListState = ReturnType<typeof useListState>;
