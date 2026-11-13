import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may be old, or the record may belong to a company you are not signed in to.</p>
      <Button asChild>
        <Link href="/">Go to your workspace</Link>
      </Button>
    </main>
  );
}
