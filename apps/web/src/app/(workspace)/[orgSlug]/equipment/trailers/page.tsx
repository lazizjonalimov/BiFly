import type { Metadata } from "next";
import { Suspense } from "react";
import { UnitsList } from "@/features/equipment/units-list";

export const metadata: Metadata = { title: "Trailers" };

export default function TrailersPage() {
  return (
    <Suspense>
      <UnitsList kind="trailer" />
    </Suspense>
  );
}
