"use client";

import { usePreference } from "@/hooks/use-preference";

/**
 * The terminal this person works from, chosen in the top bar. It is where the dispatch board and the
 * dashboard start; anyone can still look at every terminal. Stored with the account, per company.
 */
export function useTerminalPreference() {
  return usePreference<string>("workspace.terminal", "");
}
