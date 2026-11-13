"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { SEGMENT_LABELS } from "@/lib/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

type Setter = (label: string | null) => void;
const CrumbContext = createContext<{ label: string | null; setLabel: Setter }>({ label: null, setLabel: () => {} });

/** Lets a detail page name the record it shows ("L-1004", "Globex") in the breadcrumb trail. */
export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return <CrumbContext.Provider value={{ label, setLabel }}>{children}</CrumbContext.Provider>;
}

export function useBreadcrumbLabel(label: string | null | undefined) {
  const { setLabel } = useContext(CrumbContext);
  useEffect(() => {
    setLabel(label ?? null);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const { label } = useContext(CrumbContext);
  const [slug, ...segments] = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null; // a top-level page is its own title

  const crumbs = segments.map((segment, index) => ({
    href: `/${[slug, ...segments.slice(0, index + 1)].join("/")}`,
    text: UUID.test(segment) ? (label ?? "…") : (SEGMENT_LABELS[segment] ?? segment),
    // "settings" groups pages but is not a page itself.
    linked: index < segments.length - 1 && !["settings", "equipment", "finance"].includes(segment),
  }));

  return (
    <nav aria-label="Breadcrumb" className="no-print mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => (
          <li key={crumb.href} className="flex items-center gap-1">
            {index > 0 ? <ChevronRightIcon className="size-3.5" aria-hidden /> : null}
            {crumb.linked ? (
              <Link href={crumb.href} className="hover:text-foreground hover:underline">
                {crumb.text}
              </Link>
            ) : (
              <span aria-current={index === crumbs.length - 1 ? "page" : undefined} className={index === crumbs.length - 1 ? "text-foreground" : undefined}>
                {crumb.text}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
