"use client";

import { ResourcePage } from "@/components/resource-page";
import { Expiry } from "@/components/expiry";
import { StatusBadge } from "@/components/ui";
import type { Driver } from "@/lib/types";

export default function DriversPage() {
  return (
    <ResourcePage<Driver>
      title="Drivers"
      subtitle="Qualification dates are checked when a driver is assigned to a load"
      endpoint="/drivers"
      noun="driver"
      writePerm="drivers:write"
      defaults={{ status: "active" }}
      columns={[
        { header: "Name", cell: (d) => <span className="font-medium text-slate-900">{d.first_name} {d.last_name}</span> },
        { header: "Phone", cell: (d) => d.phone ?? "—" },
        { header: "CDL", cell: (d) => (d.cdl_number ? `${d.cdl_state ?? ""} ${d.cdl_number}`.trim() : "—") },
        { header: "CDL expires", cell: (d) => <Expiry date={d.cdl_expiry} /> },
        { header: "Medical expires", cell: (d) => <Expiry date={d.medical_cert_expiry} /> },
        { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
      ]}
      fields={[
        { name: "first_name", label: "First name", required: true, half: true, maxLength: 80 },
        { name: "last_name", label: "Last name", required: true, half: true, maxLength: 80 },
        { name: "phone", label: "Phone", half: true, maxLength: 40 },
        { name: "email", label: "Email", type: "email", half: true },
        { name: "cdl_number", label: "CDL number", half: true, maxLength: 40 },
        { name: "cdl_state", label: "CDL state (2 letters)", half: true, maxLength: 2 },
        { name: "cdl_expiry", label: "CDL expiry", type: "date", half: true },
        { name: "medical_cert_expiry", label: "Medical certificate expiry", type: "date", half: true },
        { name: "status", label: "Status", type: "select", options: ["active", "inactive"], half: true },
      ]}
    />
  );
}
