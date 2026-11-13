import type { Metadata } from "next";
import { DriversList } from "@/features/drivers/drivers-list";

export const metadata: Metadata = { title: "Drivers" };

export default function DriversPage() {
  return <DriversList />;
}
