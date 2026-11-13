"use client";

import { useQuery } from "@tanstack/react-query";
import { AsyncCombobox } from "@/components/forms/async-combobox";
import { statusLabel } from "@/components/status-badge";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export type UnitType = "vehicle" | "trailer";
type Aria = { id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

/**
 * Choose a truck or a trailer: which kind first, then the unit itself, searched on the server. Retired units
 * are offered too, marked as such; the API explains why it won't take one.
 */
export function UnitPicker({ type, value, onTypeChange, onChange, disabled, ...aria }: { type: UnitType; value: string; onTypeChange: (type: UnitType) => void; onChange: (id: string) => void; disabled?: boolean } & Aria) {
  const org = useOrg();
  const resource = type === "vehicle" ? "vehicles" : "trailers";
  const chosen = useQuery({
    queryKey: [org.id, resource, "detail", value],
    queryFn: () => (type === "vehicle" ? unwrap(api.GET("/api/v1/vehicles/{item_id}", { params: { path: { item_id: value } } })) : unwrap(api.GET("/api/v1/trailers/{item_id}", { params: { path: { item_id: value } } }))),
    enabled: !!value,
    staleTime: 60_000,
  });
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label="Kind of unit" className="inline-flex w-fit rounded-md border p-0.5">
        {(["vehicle", "trailer"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={type === kind}
            disabled={disabled}
            onClick={() => {
              if (kind === type) return;
              onTypeChange(kind);
              onChange("");
            }}
            className={cn("rounded px-3 py-1 text-sm", type === kind ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {kind === "vehicle" ? "Truck" : "Trailer"}
          </button>
        ))}
      </div>
      <AsyncCombobox
        {...aria}
        value={value}
        disabled={disabled}
        selectedLabel={chosen.data ? `${type === "vehicle" ? "Truck" : "Trailer"} ${chosen.data.unit_number}` : undefined}
        onChange={(option) => onChange(option?.value ?? "")}
        queryKey={[org.id, resource, "picker"]}
        placeholder={type === "vehicle" ? "Choose a truck" : "Choose a trailer"}
        emptyText={`No ${type === "vehicle" ? "truck" : "trailer"} matches.`}
        search={async (q, signal) => {
          const query = { q: q || undefined, sort: "unit_number", limit: 20 };
          const page = type === "vehicle" ? await unwrap(api.GET("/api/v1/vehicles", { params: { query }, signal })) : await unwrap(api.GET("/api/v1/trailers", { params: { query }, signal }));
          return page.items.map((u) => ({ value: u.id, label: `${type === "vehicle" ? "Truck" : "Trailer"} ${u.unit_number}`, hint: [statusLabel(u.status), [u.year, u.make].filter(Boolean).join(" ")].filter(Boolean).join(" · ") }));
        }}
      />
    </div>
  );
}

/** Choose a driver (optional on an inspection). */
export function DriverPicker({ value, onChange, ...aria }: { value: string; onChange: (id: string) => void } & Aria) {
  const org = useOrg();
  const chosen = useQuery({
    queryKey: [org.id, "drivers", "detail", value],
    queryFn: () => unwrap(api.GET("/api/v1/drivers/{item_id}", { params: { path: { item_id: value } } })),
    enabled: !!value,
    staleTime: 60_000,
  });
  return (
    <AsyncCombobox
      {...aria}
      value={value}
      selectedLabel={chosen.data ? `${chosen.data.first_name} ${chosen.data.last_name}` : undefined}
      onChange={(option) => onChange(option?.value ?? "")}
      queryKey={[org.id, "drivers", "picker"]}
      placeholder="No driver"
      emptyText="No driver matches."
      search={async (q, signal) => {
        const page = await unwrap(api.GET("/api/v1/drivers", { params: { query: { q: q || undefined, sort: "name", limit: 20 } }, signal }));
        return page.items.map((d) => ({ value: d.id, label: `${d.first_name} ${d.last_name}`, hint: d.employee_number ?? undefined }));
      }}
    />
  );
}
