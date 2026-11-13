import type { Metadata } from "next";
import { LoadWizard } from "@/features/loads/load-wizard";

export const metadata: Metadata = { title: "New load" };

export default function NewLoadPage() {
  return <LoadWizard />;
}
