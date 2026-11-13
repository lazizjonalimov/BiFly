import type { Metadata } from "next";
import { CustomerDetail } from "@/features/customers/customer-detail";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/[orgSlug]/customers/[customerId]">) {
  return <CustomerDetail id={(await params).customerId} />;
}
