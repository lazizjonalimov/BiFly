import type { Metadata } from "next";
import { ReportView } from "@/features/reports/report-view";

export const metadata: Metadata = { title: "Report" };

export default async function Page({ params }: PageProps<"/[orgSlug]/reports/[report]">) {
  return <ReportView name={(await params).report} />;
}
