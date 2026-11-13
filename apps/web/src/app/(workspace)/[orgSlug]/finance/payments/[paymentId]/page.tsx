import type { Metadata } from "next";
import { PaymentDetail } from "@/features/finance/payment-detail";

export const metadata: Metadata = { title: "Payment" };

export default async function Page({ params }: PageProps<"/[orgSlug]/finance/payments/[paymentId]">) {
  return <PaymentDetail id={(await params).paymentId} />;
}
