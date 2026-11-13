"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";

/**
 * A setting that belongs to this user in this company (which columns a table shows, the terminal they work
 * from). Stored by the API, so it follows the user to another computer.
 */
export function usePreference<T>(key: string, fallback: T): [T, (value: T) => void, { ready: boolean }] {
  const org = useOrg();
  const queryClient = useQueryClient();
  const queryKey = [org.id, "preferences"];
  const query = useQuery({ queryKey, queryFn: () => unwrap(api.GET("/api/v1/preferences")), staleTime: 5 * 60_000 });
  const stored = query.data?.[key];

  const set = useCallback(
    (value: T) => {
      // Shown at once; a failed save only means the choice isn't remembered next time.
      queryClient.setQueryData<Record<string, unknown>>(queryKey, (current) => ({ ...(current ?? {}), [key]: value }));
      void api.PUT("/api/v1/preferences/{key}", { params: { path: { key } }, body: { value } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from org.id
    [queryClient, org.id, key],
  );

  return [(stored === undefined ? fallback : (stored as T)), set, { ready: !query.isPending }];
}
