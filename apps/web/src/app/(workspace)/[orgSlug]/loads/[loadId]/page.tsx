import type { Metadata } from "next";
import { LoadDetailPage } from "@/features/loads/load-detail";

export const metadata: Metadata = { title: "Load" };

export default async function LoadPage({ params }: PageProps<"/[orgSlug]/loads/[loadId]">) {
  return <LoadDetailPage id={(await params).loadId} />;
}
