import { Badge } from "@/components/ui";
import { day, expiryState } from "@/lib/format";

/** A credential date with an Expired / Expiring flag. */
export function Expiry({ date }: { date: string | null }) {
  const state = expiryState(date);
  return (
    <span className="inline-flex items-center gap-1.5">
      {day(date)}
      {state && <Badge tone={state === "expired" ? "red" : "amber"}>{state === "expired" ? "Expired" : "Expiring"}</Badge>}
    </span>
  );
}
