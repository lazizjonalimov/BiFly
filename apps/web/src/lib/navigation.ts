import { BanknoteIcon, BarChart3Icon, Building2Icon, BuildingIcon, ContainerIcon, FileTextIcon, FuelIcon, HandCoinsIcon, IdCardIcon, KeyRoundIcon, LayoutDashboardIcon, PackageIcon, RadioTowerIcon, ReceiptIcon, ReceiptTextIcon, ScrollTextIcon, ShieldCheckIcon, TruckIcon, UserCogIcon, UsersIcon, WarehouseIcon, WrenchIcon, type LucideIcon } from "lucide-react";

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
    items: [
      { label: "Dashboard", path: "dashboard", icon: LayoutDashboardIcon, anyOf: ["dashboard.read"] },
      { label: "Reports", path: "reports", icon: BarChart3Icon, anyOf: ["reports.read"] },
    ],
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
    label: "Safety and fleet",
    items: [
      { label: "Safety", path: "safety", icon: ShieldCheckIcon, anyOf: ["safety.read"] },
      { label: "Maintenance", path: "maintenance", icon: WrenchIcon, anyOf: ["maintenance.read"] },
      { label: "Documents", path: "documents", icon: FileTextIcon, anyOf: ["documents.read"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", path: "finance/invoices", icon: ReceiptIcon, anyOf: ["invoices.read"] },
      { label: "Payments", path: "finance/payments", icon: BanknoteIcon, anyOf: ["payments.read"] },
      { label: "Expenses", path: "finance/expenses", icon: ReceiptTextIcon, anyOf: ["expenses.read"] },
      { label: "Fuel", path: "finance/fuel", icon: FuelIcon, anyOf: ["expenses.read"] },
      { label: "Driver pay", path: "finance/settlements", icon: HandCoinsIcon, anyOf: ["settlements.read"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Company settings", path: "settings/company", icon: BuildingIcon, anyOf: ["organization.manage"] },
      { label: "Team", path: "settings/team", icon: UserCogIcon, anyOf: ["users.manage"] },
      { label: "Roles", path: "settings/roles", icon: KeyRoundIcon, anyOf: ["users.manage"] },
      { label: "Audit log", path: "settings/audit-log", icon: ScrollTextIcon, anyOf: ["audit.read"] },
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
  maintenance: "Maintenance",
  inspections: "Inspections",
  finance: "Finance",
  invoices: "Invoices",
  payments: "Payments",
  expenses: "Expenses",
  fuel: "Fuel",
  settlements: "Driver pay",
  reports: "Reports",
  company: "Company settings",
  roles: "Roles",
  "audit-log": "Audit log",
};

/**
 * Where the list behind an API "resource" name lives, for links the API describes by resource (the
 * dashboard's exceptions, search results). A resource whose screen isn't built yet has no entry, and the
 * link is simply not offered.
 */
const RESOURCE_PATHS: Record<string, string> = { loads: "loads", customers: "customers", drivers: "drivers", vehicles: "equipment/trucks", trailers: "equipment/trailers", safety: "safety", documents: "documents", maintenance: "maintenance", invoices: "finance/invoices", payments: "finance/payments", expenses: "finance/expenses", settlements: "finance/settlements" };

export function resourcePath(resource: string): string | null {
  return RESOURCE_PATHS[resource] ?? null;
}
