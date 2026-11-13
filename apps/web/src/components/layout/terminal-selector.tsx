"use client";

import { WarehouseIcon } from "lucide-react";
import { useTerminals } from "@/hooks/use-options";
import { useTerminalPreference } from "@/hooks/use-terminal-preference";

/** Shown only to companies with more than one terminal: one yard needs no choosing. */
export function TerminalSelector() {
  const { terminals } = useTerminals();
  const [terminal, setTerminal] = useTerminalPreference();
  if (terminals.length < 2) return null;
  return (
    <label className="relative hidden items-center md:flex">
      <span className="sr-only">Your terminal</span>
      <WarehouseIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden />
      <select value={terminal} onChange={(e) => setTerminal(e.target.value)} className="h-9 max-w-48 appearance-none rounded-md border bg-card pr-3 pl-8 text-sm shadow-xs">
        <option value="">All terminals</option>
        {terminals.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
