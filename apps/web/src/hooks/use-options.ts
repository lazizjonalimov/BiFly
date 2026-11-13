"use client";

import { useQuery } from "@tanstack/react-query";
import type { Option } from "@/components/forms/fields";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";

/** Active terminals, for pickers and filters. A company with none simply has no terminal controls. */
export function useTerminals() {
  const org = useOrg();
  const query = useQuery({
    queryKey: [org.id, "terminals", "options"],
    queryFn: () => unwrap(api.GET("/api/v1/terminals", { params: { query: { status: "active", sort: "name", limit: 100 } } })),
    staleTime: 60_000,
  });
  const terminals = query.data?.items ?? [];
  const options: Option[] = terminals.map((t) => ({ value: t.id, label: t.code ? `${t.name} (${t.code})` : t.name }));
  const nameOf = (id: string | null | undefined) => (id ? (terminals.find((t) => t.id === id)?.name ?? "—") : "—");
  return { terminals, options, nameOf, isPending: query.isPending };
}
