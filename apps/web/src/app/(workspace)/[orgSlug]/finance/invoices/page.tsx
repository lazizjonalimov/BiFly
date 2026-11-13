import type { Metadata } from "next";
import { InvoicesList } from "@/features/finance/invoices-list";

export const metadata: Metadata = { title: "Invoices" };

export default function Page() {
  return <InvoicesList />;
}
