"use client";

import { ResourcePage } from "@/components/resource-page";
import { StatusBadge } from "@/components/ui";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  return (
    <ResourcePage<Customer>
      title="Customers"
      subtitle="Shippers and brokers you haul for"
      endpoint="/customers"
      noun="customer"
      writePerm="customers:write"
      defaults={{ payment_terms_days: 30, status: "active" }}
      columns={[
        { header: "Name", cell: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
        { header: "Billing email", cell: (c) => c.billing_email ?? "—" },
        { header: "Phone", cell: (c) => c.phone ?? "—" },
        { header: "Terms", cell: (c) => `Net ${c.payment_terms_days}` },
        { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
      ]}
      fields={[
        { name: "name", label: "Company name", required: true, maxLength: 160 },
        { name: "billing_email", label: "Billing email", type: "email", half: true },
        { name: "phone", label: "Phone", half: true, maxLength: 40 },
        { name: "address", label: "Address", maxLength: 300 },
        { name: "payment_terms_days", label: "Payment terms (days)", type: "number", half: true, required: true },
        { name: "status", label: "Status", type: "select", options: ["active", "inactive"], half: true },
        { name: "notes", label: "Notes", type: "textarea", maxLength: 4000 },
      ]}
    />
  );
}
