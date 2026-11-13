import type { Metadata } from "next";
import { WorkOrderDetail } from "@/features/maintenance/work-order-detail";

export const metadata: Metadata = { title: "Work order" };

export default async function Page({ params }: PageProps<"/[orgSlug]/maintenance/[workOrderId]">) {
  return <WorkOrderDetail id={(await params).workOrderId} />;
}
