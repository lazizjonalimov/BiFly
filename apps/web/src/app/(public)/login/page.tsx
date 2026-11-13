import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";
import { getMe } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const me = await getMe();
  if (me) redirect(`/${me.organization.slug}/dashboard`);
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
