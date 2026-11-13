import type { Metadata } from "next";
import { UnitsList } from "@/features/equipment/units-list";

export const metadata: Metadata = { title: "Trucks" };

export default function TrucksPage() {
  return <UnitsList kind="truck" />;
}
