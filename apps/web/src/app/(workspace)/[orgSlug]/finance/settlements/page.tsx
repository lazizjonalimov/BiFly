import type { Metadata } from "next";
import { SettlementsList } from "@/features/settlements/settlements-list";

export const metadata: Metadata = { title: "Driver pay" };

export default function Page() {
  return <SettlementsList />;
}
