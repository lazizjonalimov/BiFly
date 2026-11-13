import type { Metadata } from "next";
import { DriverDetail } from "@/features/drivers/driver-detail";

export const metadata: Metadata = { title: "Driver" };

export default async function DriverPage({ params }: PageProps<"/[orgSlug]/drivers/[driverId]">) {
  return <DriverDetail id={(await params).driverId} />;
}
