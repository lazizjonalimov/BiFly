import type { Metadata } from "next";
import { RoleMatrix } from "@/features/administration/role-matrix";

export const metadata: Metadata = { title: "Roles" };

export default function Page() {
  return <RoleMatrix />;
}
