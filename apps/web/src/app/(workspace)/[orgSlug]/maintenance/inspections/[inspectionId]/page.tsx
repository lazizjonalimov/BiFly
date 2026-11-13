import type { Metadata } from "next";
import { InspectionDetail } from "@/features/maintenance/inspection-detail";

export const metadata: Metadata = { title: "Inspection" };

export default async function Page({ params }: PageProps<"/[orgSlug]/maintenance/inspections/[inspectionId]">) {
  return <InspectionDetail id={(await params).inspectionId} />;
}
