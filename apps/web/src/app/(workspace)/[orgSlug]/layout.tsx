import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs";
import { SwitchCompanyPrompt } from "@/features/administration/switch-company-prompt";
import { getMe } from "@/lib/auth/server";
import { SessionProvider } from "@/lib/auth/session";

/**
 * Everything inside a company's workspace. The session is checked with the API before anything renders, and
 * the company in the address must be the one the session is for: a link into another of your companies asks
 * you to switch, and a link into a company you don't belong to is simply not found.
 */
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/[orgSlug]">) {
  const { orgSlug } = await params;
  const me = await getMe();
  if (!me) redirect("/login");

  if (me.organization.slug !== orgSlug) {
    const other = me.memberships.find((m) => m.slug === orgSlug);
    if (!other) notFound();
    return <SwitchCompanyPrompt current={me.organization.name} target={other} />;
  }

  return (
    <SessionProvider me={me}>
      <BreadcrumbProvider>
        <AppShell>{children}</AppShell>
      </BreadcrumbProvider>
    </SessionProvider>
  );
}
