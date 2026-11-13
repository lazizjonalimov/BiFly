import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/features/auth/signup-form";
import { getMe } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage() {
  const me = await getMe();
  if (me) redirect(`/${me.organization.slug}/dashboard`);
  return <SignupForm />;
}
