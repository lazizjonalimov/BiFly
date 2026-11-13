import type { Metadata } from "next";
import { WorkOrdersList } from "@/features/maintenance/work-orders-list";

export const metadata: Metadata = { title: "Maintenance" };

export default function Page() {
  return <WorkOrdersList />;
}
