"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/errors";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Operational data changes under you: show what was loaded at once, then check for newer.
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // Retrying can't fix "not allowed" or "not found"; only transient failures are worth another try.
        retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
      },
      // A mutation is never retried automatically: the user decides, with the server's answer in front of them.
      mutations: { retry: false },
    },
  });
}

/**
 * One query cache per browser tab. Switching company or signing out does a full page load, which throws this
 * cache away, so data from one company can never be shown inside another.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
