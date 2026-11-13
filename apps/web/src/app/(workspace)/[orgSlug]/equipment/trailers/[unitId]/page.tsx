import type { Metadata } from "next";
import { UnitDetail } from "@/features/equipment/unit-detail";

export const metadata: Metadata = { title: "Trailer" };

export default async function TrailerPage({ params }: PageProps<"/[orgSlug]/equipment/trailers/[unitId]">) {
  return <UnitDetail kind="trailer" id={(await params).unitId} />;
}
