import { Building2Icon, LayoutDashboardIcon, UsersIcon, type LucideIcon } from "lucide-react";

export type NavItem = {
  label: string;
  /** Path inside the company workspace, e.g. "dashboard" -> /<company>/dashboard */
  path: string;
  icon: LucideIcon;
  /** Shown when the user's role has any of these. The API enforces the same permissions on every request. */
  anyOf?: string[];
  /** Shown only to the owner of the account (the profile that holds the companies). */
  accountOwner?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * The workspace's sections. Only screens that exist are listed here: a section appears in the sidebar when
 * it is built, never as a placeholder.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", path: "dashboard", icon: LayoutDashboardIcon, anyOf: ["dashboard.read"] }],
  },
  {
    label: "Directory",
    items: [{ label: "Customers", path: "customers", icon: UsersIcon, anyOf: ["customers.read"] }],
  },
  {
    label: "Administration",
    items: [{ label: "Companies", path: "settings/companies", icon: Building2Icon, accountOwner: true }],
  },
];

/** Page titles for breadcrumbs, by path segment. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  settings: "Settings",
  companies: "Companies",
  customers: "Customers",
};

/**
 * Where the list behind an API "resource" name lives, for links the API describes by resource (the
 * dashboard's exceptions, search results). A resource whose screen isn't built yet has no entry, and the
 * link is simply not offered.
 */
const RESOURCE_PATHS: Record<string, string> = { customers: "customers" };

export function resourcePath(resource: string): string | null {
  return RESOURCE_PATHS[resource] ?? null;
}
