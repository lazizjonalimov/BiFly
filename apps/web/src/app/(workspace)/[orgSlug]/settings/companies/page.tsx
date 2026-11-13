import type { Metadata } from "next";
import { Companies } from "@/features/administration/companies";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return <Companies />;
}
