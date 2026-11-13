import { cn } from "@/lib/utils";

/** The BiFly mark: two wings. Drawn inline so it follows the current text colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 21.5c5.5 0 9-2.6 10.5-9.5 1.2 3.4.6 6.3-1.4 8.3 2.6-.3 4.9-1.7 6.9-4.3-.6 5.2-4.2 8-9.900 8-2.600 0-4.700-.8-6.100-2.500z" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">BiFly</span>
    </span>
  );
}
