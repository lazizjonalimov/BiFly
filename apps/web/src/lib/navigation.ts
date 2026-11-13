import { Building2Icon, ContainerIcon, FileTextIcon, IdCardIcon, LayoutDashboardIcon, PackageIcon, RadioTowerIcon, ShieldCheckIcon, TruckIcon, UserCogIcon, UsersIcon, WarehouseIcon, type LucideIcon } from "lucide-react";

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
    label: "Operations",
    items: [
      { label: "Dispatch", path: "dispatch", icon: RadioTowerIcon, anyOf: ["dispatch.read"] },
      { label: "Loads", path: "loads", icon: PackageIcon, anyOf: ["loads.read"] },
    ],
  },
  {
    label: "Directory",
    items: [
      { label: "Customers", path: "customers", icon: UsersIcon, anyOf: ["customers.read"] },
      { label: "Drivers", path: "drivers", icon: IdCardIcon, anyOf: ["drivers.read"] },
      { label: "Trucks", path: "equipment/trucks", icon: TruckIcon, anyOf: ["equipment.read"] },
      { label: "Trailers", path: "equipment/trailers", icon: ContainerIcon, anyOf: ["equipment.read"] },
    ],
  },
  {
    label: "Safety and paperwork",
    items: [
      { label: "Safety", path: "safety", icon: ShieldCheckIcon, anyOf: ["safety.read"] },
      { label: "Documents", path: "documents", icon: FileTextIcon, anyOf: ["documents.read"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Team", path: "settings/team", icon: UserCogIcon, anyOf: ["users.manage"] },
      { label: "Terminals", path: "settings/terminals", icon: WarehouseIcon, anyOf: ["organization.manage"] },
      { label: "Companies", path: "settings/companies", icon: Building2Icon, accountOwner: true },
    ],
  },
];

/** Page titles for breadcrumbs, by path segment. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  settings: "Settings",
  companies: "Companies",
  customers: "Customers",
  drivers: "Drivers",
  equipment: "Equipment",
  trucks: "Trucks",
  trailers: "Trailers",
  team: "Team",
  terminals: "Terminals",
  loads: "Loads",
  new: "New load",
  dispatch: "Dispatch",
  safety: "Safety",
  documents: "Documents",
};

/**
 * Where the list behind an API "resource" name lives, for links the API describes by resource (the
 * dashboard's exceptions, search results). A resource whose screen isn't built yet has no entry, and the
 * link is simply not offered.
 */
const RESOURCE_PATHS: Record<string, string> = { loads: "loads", customers: "customers", drivers: "drivers", vehicles: "equipment/trucks", trailers: "equipment/trailers", safety: "safety", documents: "documents" };

export function resourcePath(resource: string): string | null {
  return RESOURCE_PATHS[resource] ?? null;
}
