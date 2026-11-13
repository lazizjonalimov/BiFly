import { redirect } from "next/navigation";

export default async function WorkspaceHome({ params }: PageProps<"/[orgSlug]">) {
  redirect(`/${(await params).orgSlug}/dashboard`);
}
