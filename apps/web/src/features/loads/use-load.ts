"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { LoadDetail } from "@/features/loads/lib";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { useOrg } from "@/lib/auth/session";

export function loadKey(orgId: string, id: string) {
  return [orgId, "loads", "detail", id];
}

export function useLoad(id: string) {
  const org = useOrg();
  return useQuery({ queryKey: loadKey(org.id, id), queryFn: () => unwrap(api.GET("/api/v1/loads/{load_id}", { params: { path: { load_id: id } } })) });
}

/**
 * A change to a load. Every load endpoint answers with the whole load, so the screen shows the server's
 * result at once without a second request. When someone else changed the load first, the API refuses with
 * VERSION_CONFLICT: the latest version is fetched and the person is told, rather than their change being
 * lost or someone else's being overwritten.
 */
export function useLoadMutation<TArgs>(id: string, request: (args: TArgs) => Promise<LoadDetail>, { success, quiet }: { success?: (load: LoadDetail, args: TArgs) => string | null; quiet?: boolean } = {}) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState(false);
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: (load, args) => {
      setConflict(false);
      queryClient.setQueryData(loadKey(org.id, id), load);
      void queryClient.invalidateQueries({ queryKey: [org.id, "loads", "list"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "dispatch"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "dashboard"] });
      // Approving or rejecting a proof of delivery changes the document's review status too.
      void queryClient.invalidateQueries({ queryKey: [org.id, "documents"] });
      const message = success?.(load, args);
      if (message) toast.success(message);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        setConflict(true);
        void queryClient.invalidateQueries({ queryKey: loadKey(org.id, id) });
      } else if (!quiet) {
        toast.error(errorMessage(error));
      }
    },
  });
  return { ...mutation, conflict, clearConflict: () => setConflict(false) };
}

export const CONFLICT_MESSAGE =
  "Someone else changed this load while you were editing, so your change was not saved. Their version is shown here now: check it, and make your change again if it is still needed.";

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === "VERSION_CONFLICT";
}

/** Fetch the load as it is right now, skipping the cache: used to rebase a form after a conflict. */
export function useLatestLoad(id: string) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return () => queryClient.fetchQuery({ queryKey: loadKey(org.id, id), queryFn: () => unwrap(api.GET("/api/v1/loads/{load_id}", { params: { path: { load_id: id } } })), staleTime: 0 });
}

/** The stop the truck is at, or heading to next: the first one it hasn't left. */
export function currentStop(load: LoadDetail) {
  const index = load.stops.findIndex((s) => !s.departed_at);
  return index >= 0 ? { stop: load.stops[index]!, index } : null;
}
