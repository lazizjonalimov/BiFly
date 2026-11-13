import type { Metadata } from "next";
import { Suspense } from "react";
import { Terminals } from "@/features/administration/terminals";

export const metadata: Metadata = { title: "Terminals" };

export default function TerminalsPage() {
  return (
    <Suspense>
      <Terminals />
    </Suspense>
  );
}
