"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/api";
import type { Me } from "@/lib/types";

export function useMe() {
  const q = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me"), staleTime: 60_000 });
  const can = (permission: string) => !!q.data?.permissions.includes(permission);
  return { me: q.data, can, isLoading: q.isLoading };
}

/** First page of a list endpoint (up to 200 rows) — for pickers and compact tables. */
export function useList<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["list", path],
    queryFn: () => api.get<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}limit=200`),
    enabled,
  });
}
