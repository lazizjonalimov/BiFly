import type { Metadata } from "next";
import { Team } from "@/features/administration/team";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return <Team />;
}
