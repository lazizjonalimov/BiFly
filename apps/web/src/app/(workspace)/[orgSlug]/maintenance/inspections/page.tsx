import type { Metadata } from "next";
import { InspectionsList } from "@/features/maintenance/inspections-list";

export const metadata: Metadata = { title: "Inspections" };

export default function Page() {
  return <InspectionsList />;
}
