"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { CustomerSheet } from "@/features/customers/customer-sheet";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg, useWorkspacePath } from "@/lib/auth/session";
import { formatDay } from "@/lib/format/dates";
import { place } from "@/lib/format/text";

type Customer = Schema<"CustomerRead">;

const FILTERS = { status: "active" };
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All customers" },
];

export function CustomersList() {
  const org = useOrg();
  const can = useCan();
  const path = useWorkspacePath();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const state = useListState({ defaultSort: "name", filters: FILTERS });
  const [creating, setCreating] = useState(false);
  // Quick-create links arrive with ?new=1.
  const wantsNew = search.get("new") === "1";

  const query = useQuery({
    queryKey: [org.id, "customers", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/customers", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const columns: ColumnDef<Customer, unknown>[] = [
    {
      id: "name",
      header: "Customer",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <Link href={path("customers", row.original.id)} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { id: "code", header: "Code", cell: ({ row }) => row.original.code ?? <span className="text-muted-foreground">—</span> },
    { id: "billing_email", header: "Billing email", cell: ({ row }) => row.original.billing_email ?? <span className="text-muted-foreground">—</span> },
    { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? <span className="text-muted-foreground">—</span> },
    { id: "location", header: "Billing city", cell: ({ row }) => place(row.original.billing_city, row.original.billing_state) },
    { id: "terms", header: "Terms", cell: ({ row }) => `Net ${row.original.payment_terms_days}` },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: "created_at", header: "Added", enableSorting: true, cell: ({ row }) => formatDay(row.original.created_at, org.timezone) },
  ];

  const canManage = can("customers.manage");
  return (
    <>
      <PageHeader
        title="Customers"
        description="The shippers and brokers you haul for."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New customer
            </Button>
          ) : null
        }
      />
      <DataTable
        label="Customers"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        rowHref={(row) => path("customers", row.id)}
        preferenceKey="customers"
        searchPlaceholder="Search name, code or email"
        filters={<FilterSelect label="Status" value={state.filters.status ?? "active"} onChange={(value) => state.setFilter("status", value)} options={STATUS_OPTIONS} />}
        empty={{
          icon: UsersIcon,
          title: "No customers yet",
          description: "Add the companies you haul for. You need one before you can book a load.",
          action: canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New customer
            </Button>
          ) : undefined,
        }}
      />
      <CustomerSheet
        open={creating || (wantsNew && canManage)}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open && wantsNew) router.replace(pathname);
        }}
      />
    </>
  );
}
