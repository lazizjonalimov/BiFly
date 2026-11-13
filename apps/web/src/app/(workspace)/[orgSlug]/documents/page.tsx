import type { Metadata } from "next";
import { DocumentsCenter } from "@/features/documents/documents-center";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return <DocumentsCenter />;
}
