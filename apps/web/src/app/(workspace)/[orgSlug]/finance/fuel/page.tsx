import type { Metadata } from "next";
import { FuelPage } from "@/features/expenses/fuel-page";

export const metadata: Metadata = { title: "Fuel" };

export default function Page() {
  return <FuelPage />;
}
