import type { Metadata } from "next";
import { LoadsList } from "@/features/loads/loads-list";

export const metadata: Metadata = { title: "Loads" };

export default function LoadsPage() {
  return <LoadsList />;
}
