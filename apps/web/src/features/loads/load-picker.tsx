"use client";

import { useQuery } from "@tanstack/react-query";
import { AsyncCombobox } from "@/components/forms/async-combobox";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";
import { place } from "@/lib/format/text";

/** Choose a load by its number or reference, searching on the server. */
export function LoadPicker({ value, onChange, placeholder = "No load", ...aria }: { value: string; onChange: (id: string) => void; placeholder?: string; id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  const org = useOrg();
  const chosen = useQuery({
    queryKey: [org.id, "loads", "detail", value],
    queryFn: () => unwrap(api.GET("/api/v1/loads/{load_id}", { params: { path: { load_id: value } } })),
    enabled: !!value,
    staleTime: 60_000,
  });
  return (
    <AsyncCombobox
      {...aria}
      value={value}
      selectedLabel={chosen.data?.load_number}
      onChange={(option) => onChange(option?.value ?? "")}
      queryKey={[org.id, "loads", "picker"]}
      placeholder={placeholder}
      emptyText="No load matches."
      search={async (q, signal) => {
        const page = await unwrap(api.GET("/api/v1/loads", { params: { query: { q: q || undefined, sort: "-created_at", limit: 20 } }, signal }));
        return page.items.map((load) => ({ value: load.id, label: load.load_number, hint: `${place(load.origin_city, load.origin_state)} to ${place(load.destination_city, load.destination_state)} · ${load.customer.name}` }));
      }}
    />
  );
}
