import type { Metadata } from "next";
import { InvoiceDetail } from "@/features/finance/invoice-detail";

export const metadata: Metadata = { title: "Invoice" };

export default async function Page({ params }: PageProps<"/[orgSlug]/finance/invoices/[invoiceId]">) {
  return <InvoiceDetail id={(await params).invoiceId} />;
}
