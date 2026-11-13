import type { Metadata } from "next";
import { DispatchBoard } from "@/features/dispatch/board";

export const metadata: Metadata = { title: "Dispatch" };

export default function DispatchPage() {
  return <DispatchBoard />;
}
