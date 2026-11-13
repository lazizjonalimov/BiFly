import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomersList } from "@/features/customers/customers-list";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <Suspense>
      <CustomersList />
    </Suspense>
  );
}
