import type { Metadata } from "next";
import { UnitsList } from "@/features/equipment/units-list";

export const metadata: Metadata = { title: "Trailers" };

export default function TrailersPage() {
  return <UnitsList kind="trailer" />;
}
