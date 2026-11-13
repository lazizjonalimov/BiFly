import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth/server";

// The address bar root sends you to the company you last worked in.
export default async function Home() {
  const me = await getMe();
  redirect(me ? `/${me.organization.slug}/dashboard` : "/login");
}
