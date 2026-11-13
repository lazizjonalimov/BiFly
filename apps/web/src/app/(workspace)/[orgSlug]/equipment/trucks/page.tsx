import type { Metadata } from "next";
import { Suspense } from "react";
import { UnitsList } from "@/features/equipment/units-list";

export const metadata: Metadata = { title: "Trucks" };

export default function TrucksPage() {
  return (
    <Suspense>
      <UnitsList kind="truck" />
    </Suspense>
  );
}
