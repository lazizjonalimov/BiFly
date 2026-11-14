import type { Metadata } from "next";
import { SettlementDetail } from "@/features/settlements/settlement-detail";

export const metadata: Metadata = { title: "Settlement" };

export default async function Page({ params }: PageProps<"/[orgSlug]/finance/settlements/[settlementId]">) {
  return <SettlementDetail id={(await params).settlementId} />;
}
