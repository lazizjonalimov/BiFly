import type { Metadata } from "next";
import { Suspense } from "react";
import { Companies } from "@/features/administration/companies";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return (
    <Suspense>
      <Companies />
    </Suspense>
  );
}
