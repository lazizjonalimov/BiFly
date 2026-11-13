import type { Schema } from "@/lib/api/types";
import { place } from "@/lib/format/text";

export type LoadListItem = Schema<"LoadListItem">;
export type LoadDetail = Schema<"LoadDetail">;
export type Stop = Schema<"StopOut">;

export const LOAD_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "planned", label: "Planned" },
  { value: "assigned", label: "Assigned" },
  { value: "dispatched", label: "Dispatched" },
  { value: "at_pickup", label: "At pickup" },
  { value: "in_transit", label: "In transit" },
  { value: "at_delivery", label: "At delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "pod_review", label: "POD review" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On hold" },
  { value: "cancelled", label: "Cancelled" },
];

export const CHARGE_TYPES = [
  { value: "detention", label: "Detention" },
  { value: "layover", label: "Layover" },
  { value: "lumper", label: "Lumper" },
  { value: "fuel_surcharge", label: "Fuel surcharge" },
  { value: "tarp", label: "Tarp" },
  { value: "extra_stop", label: "Extra stop" },
  { value: "tonu", label: "Truck ordered, not used" },
  { value: "other", label: "Other" },
];
export const chargeLabel = (type: string) => CHARGE_TYPES.find((c) => c.value === type)?.label ?? type;

/** The named views of the load list. Each is a filter the API applies; the counts come from the API too. */
export const VIEWS = [
  { value: "active", label: "All active", summary: "active" },
  { value: "unassigned", label: "Needs a driver", summary: "unassigned" },
  { value: "pickups_today", label: "Pickups today", summary: "pickups_today" },
  { value: "deliveries_today", label: "Deliveries today", summary: "deliveries_today" },
  { value: "at_risk", label: "At risk", summary: "at_risk" },
  { value: "in_transit", label: "On the road", summary: "in_transit" },
  { value: "missing_pod", label: "Missing POD", summary: "missing_pod" },
] as const;

export const RISK_TONE: Record<string, "danger" | "warning" | "info"> = { LATE_PICKUP: "danger", LATE_DELIVERY: "danger", UNASSIGNED_SOON: "warning", MISSING_POD: "info" };
export const RISK_LABEL: Record<string, string> = { LATE_PICKUP: "Late pickup", LATE_DELIVERY: "Late delivery", UNASSIGNED_SOON: "No driver yet", MISSING_POD: "Needs POD" };

export function route(load: Pick<LoadListItem, "origin_city" | "origin_state" | "destination_city" | "destination_state">): { from: string; to: string } {
  return { from: place(load.origin_city, load.origin_state), to: place(load.destination_city, load.destination_state) };
}

/** What each lifecycle action is called on a button, and what it asks before it runs. */
export const ACTIONS: Record<string, { label: string; verb: string; reason?: "required" | "optional"; destructive?: boolean; description?: string }> = {
  mark_ready: { label: "Mark ready", verb: "marked ready" },
  dispatch: { label: "Dispatch", verb: "dispatched", description: "The driver sees the load from this moment. Eligibility is checked again now." },
  arrive: { label: "Arrived", verb: "updated" },
  depart: { label: "Departed", verb: "updated" },
  approve_pod: { label: "Approve POD", verb: "completed", description: "The load is completed and can be invoiced." },
  reject_pod: { label: "Reject POD", verb: "sent back", reason: "required", destructive: true, description: "The load goes back to waiting for a proof of delivery." },
  hold: { label: "Put on hold", verb: "put on hold", reason: "required", description: "A held load keeps its driver and equipment." },
  release: { label: "Release hold", verb: "released" },
  cancel: { label: "Cancel load", verb: "cancelled", reason: "required", destructive: true, description: "The driver and equipment are freed. A cancelled load can't be reopened." },
};
