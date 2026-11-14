import type { Metadata } from "next";
import { CompanySettings } from "@/features/administration/company-settings";

export const metadata: Metadata = { title: "Company settings" };

export default function Page() {
  return <CompanySettings />;
}
