"use client";

import { useQuery } from "@tanstack/react-query";
import { AsyncCombobox } from "@/components/forms/async-combobox";
import { api, unwrap } from "@/lib/api/client";
import { useOrg } from "@/lib/auth/session";
import { place } from "@/lib/format/text";

/** Choose an active customer, searching on the server. Shows the chosen one's name even before searching. */
export function CustomerPicker({ value, onChange, placeholder = "Choose a customer", ...aria }: { value: string; onChange: (id: string, name: string | null) => void; placeholder?: string; id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  const org = useOrg();
  const chosen = useQuery({
    queryKey: [org.id, "customers", "detail", value],
    queryFn: () => unwrap(api.GET("/api/v1/customers/{customer_id}", { params: { path: { customer_id: value } } })),
    enabled: !!value,
    staleTime: 60_000,
  });
  return (
    <AsyncCombobox
      {...aria}
      value={value}
      selectedLabel={chosen.data?.name}
      onChange={(option) => onChange(option?.value ?? "", option?.label ?? null)}
      queryKey={[org.id, "customers", "picker"]}
      placeholder={placeholder}
      emptyText="No customer matches. Add it under Customers first."
      search={async (q, signal) => {
        const page = await unwrap(api.GET("/api/v1/customers", { params: { query: { q: q || undefined, status: "active", sort: "name", limit: 20 } }, signal }));
        return page.items.map((c) => ({ value: c.id, label: c.name, hint: [c.code, place(c.billing_city, c.billing_state) === "—" ? null : place(c.billing_city, c.billing_state)].filter(Boolean).join(" · ") || undefined }));
      }}
    />
  );
}
