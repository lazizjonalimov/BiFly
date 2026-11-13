import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { humanize } from "@/lib/format/text";

/**
 * One place decides how every status looks and reads, so "In transit" is the same colour on the board, in a
 * list and on a detail page. Colour is never the only signal: the label always says what it is.
 */
const TONES: Record<string, BadgeVariant> = {
  // records
  active: "success", archived: "neutral", inactive: "neutral", terminated: "danger",
  // equipment
  in_maintenance: "warning", out_of_service: "danger", retired: "neutral", available: "success", assigned: "default",
  // compliance
  ok: "success", expiring: "warning", expired: "danger", incomplete: "neutral", missing: "neutral",
  // loads
  draft: "neutral", planned: "info", dispatched: "default", at_pickup: "warning", in_transit: "warning", at_delivery: "warning",
  delivered: "success", pod_review: "info", completed: "success", on_hold: "danger", cancelled: "neutral",
  // money
  unbilled: "neutral", invoiced: "info", paid: "success", issued: "info", void: "neutral", overdue: "danger",
  recorded: "success", reversed: "neutral",
  // documents
  pending: "warning", approved: "success", rejected: "danger", not_required: "neutral",
};

const LABELS: Record<string, string> = {
  ok: "Compliant", expiring: "Expiring soon", incomplete: "Dates missing", pod_review: "POD review", not_required: "No review needed",
  in_maintenance: "In the shop", at_pickup: "At pickup", at_delivery: "At delivery", owner_operator: "Owner-operator",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? humanize(status);
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={TONES[status] ?? "neutral"} className={className}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}
