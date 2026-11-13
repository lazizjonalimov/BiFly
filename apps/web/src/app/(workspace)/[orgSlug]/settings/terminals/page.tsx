import type { Metadata } from "next";
import { Terminals } from "@/features/administration/terminals";

export const metadata: Metadata = { title: "Terminals" };

export default function TerminalsPage() {
  return <Terminals />;
}
