import type { Metadata } from "next";
import { UnitDetail } from "@/features/equipment/unit-detail";

export const metadata: Metadata = { title: "Truck" };

export default async function TruckPage({ params }: PageProps<"/[orgSlug]/equipment/trucks/[unitId]">) {
  return <UnitDetail kind="truck" id={(await params).unitId} />;
}
