import type { Metadata } from "next";
import { SafetyPage } from "@/features/safety/safety-page";

export const metadata: Metadata = { title: "Safety" };

export default function Page() {
  return <SafetyPage />;
}
