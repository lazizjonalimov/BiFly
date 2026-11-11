"use client";

import { useState } from "react";
import { Expiry } from "@/components/expiry";
import { ResourceTable } from "@/components/resource-page";
import { PageHeader, StatusBadge } from "@/components/ui";
import { label } from "@/lib/format";
import type { Trailer, Vehicle } from "@/lib/types";

const STATUSES = ["active", "maintenance", "inactive"];
const TRAILER_TYPES = ["dry_van", "reefer", "flatbed", "step_deck", "box_truck", "tanker", "other"];

export default function FleetPage() {
  const [tab, setTab] = useState<"trucks" | "trailers">("trucks");
  return (
    <>
      <PageHeader title="Fleet" subtitle="Trucks and trailers, with insurance and registration tracking" />
      <div role="tablist" aria-label="Equipment" className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {(["trucks", "trailers"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${tab === t ? "bg-brand-600 text-white" : "text-slate-600 hover:text-slate-900"}`}
          >
            {label(t)}
          </button>
        ))}
      </div>
      {tab === "trucks" ? (
        <ResourceTable<Vehicle>
          endpoint="/vehicles"
          noun="truck"
          writePerm="fleet:write"
          defaults={{ status: "active" }}
          columns={[
            { header: "Unit", cell: (v) => <span className="font-medium text-slate-900">{v.unit_number}</span> },
            { header: "Vehicle", cell: (v) => [v.year, v.make, v.model].filter(Boolean).join(" ") || "—" },
            { header: "Plate", cell: (v) => v.plate ?? "—" },
            { header: "Insurance", cell: (v) => <Expiry date={v.insurance_expiry} /> },
            { header: "Registration", cell: (v) => <Expiry date={v.registration_expiry} /> },
            { header: "Status", cell: (v) => <StatusBadge status={v.status} /> },
          ]}
          fields={[
            { name: "unit_number", label: "Unit number", required: true, half: true, maxLength: 40 },
            { name: "status", label: "Status", type: "select", options: STATUSES, half: true },
            { name: "year", label: "Year", type: "number", half: true },
            { name: "make", label: "Make", half: true, maxLength: 60 },
            { name: "model", label: "Model", half: true, maxLength: 60 },
            { name: "plate", label: "Plate", half: true, maxLength: 20 },
            { name: "vin", label: "VIN", maxLength: 25 },
            { name: "insurance_expiry", label: "Insurance expiry", type: "date", half: true },
            { name: "registration_expiry", label: "Registration expiry", type: "date", half: true },
          ]}
        />
      ) : (
        <ResourceTable<Trailer>
          endpoint="/trailers"
          noun="trailer"
          writePerm="fleet:write"
          defaults={{ status: "active", type: "dry_van" }}
          columns={[
            { header: "Unit", cell: (t) => <span className="font-medium text-slate-900">{t.unit_number}</span> },
            { header: "Type", cell: (t) => label(t.type) },
            { header: "Plate", cell: (t) => t.plate ?? "—" },
            { header: "Insurance", cell: (t) => <Expiry date={t.insurance_expiry} /> },
            { header: "Registration", cell: (t) => <Expiry date={t.registration_expiry} /> },
            { header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
          ]}
          fields={[
            { name: "unit_number", label: "Unit number", required: true, half: true, maxLength: 40 },
            { name: "type", label: "Type", type: "select", options: TRAILER_TYPES, half: true },
            { name: "plate", label: "Plate", half: true, maxLength: 20 },
            { name: "status", label: "Status", type: "select", options: STATUSES, half: true },
            { name: "vin", label: "VIN", maxLength: 25 },
            { name: "insurance_expiry", label: "Insurance expiry", type: "date", half: true },
            { name: "registration_expiry", label: "Registration expiry", type: "date", half: true },
          ]}
        />
      )}
    </>
  );
}
