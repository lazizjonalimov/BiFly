"use client";

import { useEffect, useState } from "react";

/**
 * Text the user is typing, sent on after they pause. Follows `value` when it changes from outside (the
 * back button, "clear filters") without clobbering what is being typed.
 */
export function useDebouncedInput(value: string, onCommit: (value: string) => void, delay = 300): [string, (value: string) => void] {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }

  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onCommit(text), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the text being typed restarts the timer
  }, [text]);

  return [text, setText];
}
