import { CheckIcon } from "lucide-react";
import { Logo } from "@/components/layout/logo";

const POINTS = [
  "Run up to ten companies from one profile, and switch in a click",
  "Dispatch with eligibility checks that stop a double-booked driver",
  "From proof of delivery to a paid invoice without retyping anything",
];

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Logo />
        <div className="max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-white">The operating system for your trucking company.</p>
          <ul className="mt-8 grid gap-4 text-sm">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-3">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-sidebar-primary" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">Your data is isolated per company at the database level.</p>
      </aside>
      <main className="flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
