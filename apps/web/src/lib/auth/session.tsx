"use client";

import { createContext, useCallback, useContext } from "react";
import type { Me } from "@/lib/api/types";

const SessionContext = createContext<Me | null>(null);

/** Makes the signed-in user and their active company available to client components in the workspace. */
export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used inside the workspace");
  return me;
}

/** The active company. Its id is part of every query key, so cached data is always partitioned by company. */
export function useOrg() {
  return useSession().organization;
}

/**
 * Whether the user's role includes a permission. This only decides what to show: the API checks every
 * request again, so hiding a button is never what protects the data.
 */
export function useCan() {
  const { permissions } = useSession();
  return useCallback((...anyOf: string[]) => anyOf.some((p) => permissions.includes(p)), [permissions]);
}

/** A path inside the active company's workspace: workspacePath("loads", id) -> "/acme-1a2b/loads/<id>". */
export function useWorkspacePath() {
  const { slug } = useOrg();
  return useCallback((...parts: string[]) => `/${slug}/${parts.join("/")}`, [slug]);
}
