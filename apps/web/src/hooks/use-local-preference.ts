"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "flyfleet:preference";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/**
 * A small presentation preference kept in this browser (theme, collapsed sidebar). Not for anything that
 * matters to the business: those preferences are stored with the account by the API.
 *
 * Renders with `fallback` on the server and during hydration, then with the stored value.
 */
export function useLocalPreference(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = useCallback(
    (next: string) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        // Private browsing can refuse storage; the preference then lasts for this page only.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
