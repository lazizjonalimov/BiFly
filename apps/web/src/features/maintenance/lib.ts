"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";

export type WorkOrder = Schema<"WorkOrderDetail">;
export type WorkOrderItem = Schema<"WorkOrderListItem">;
export type Inspection = Schema<"InspectionOut">;
export type UnitRef = Schema<"UnitRef">;
export type CostLine = Schema<"CostLineOut">;

export const PRIORITIES = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
] as const;

export const WORK_ORDER_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const LINE_KINDS = [
  { value: "part", label: "Part" },
  { value: "labor", label: "Labour" },
  { value: "other", label: "Other" },
] as const;

export const INSPECTION_KINDS = [
  { value: "pre_trip", label: "Pre-trip" },
  { value: "post_trip", label: "Post-trip" },
  { value: "annual", label: "Annual" },
  { value: "roadside", label: "Roadside" },
  { value: "other", label: "Other" },
] as const;

export const RESULTS = [
  { value: "pass", label: "Passed" },
  { value: "defects", label: "Defects found" },
  { value: "out_of_service", label: "Out of service" },
] as const;

export const SEVERITIES = [
  { value: "minor", label: "Minor" },
  { value: "major", label: "Major" },
  { value: "out_of_service", label: "Out of service" },
] as const;

function labelFrom(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export const priorityLabel = (value: string) => labelFrom(PRIORITIES, value);
export const kindLabel = (value: string) => labelFrom(INSPECTION_KINDS, value);
export const resultLabel = (value: string) => labelFrom(RESULTS, value);
export const severityLabel = (value: string) => labelFrom(SEVERITIES, value);
export const lineKindLabel = (value: string) => labelFrom(LINE_KINDS, value);

/** Where a truck's or a trailer's own page is. */
export function unitPath(unit: Pick<UnitRef, "type" | "id">): [string, string] {
  return [unit.type === "vehicle" ? "equipment/trucks" : "equipment/trailers", unit.id];
}

export function workOrderKey(orgId: string, id: string) {
  return [orgId, "maintenance", "work-orders", "detail", id];
}

export function useWorkOrder(id: string) {
  const org = useOrg();
  return useQuery({
    queryKey: workOrderKey(org.id, id),
    queryFn: () => unwrap(api.GET("/api/v1/maintenance/work-orders/{work_order_id}", { params: { path: { work_order_id: id } } })),
  });
}

/**
 * Everything a maintenance change can move: the lists and summary, the unit (it may have come off or gone
 * back on the road), the dispatch board that reads unit availability, and the dashboard's alerts.
 */
export function invalidateMaintenance(queryClient: QueryClient, orgId: string) {
  for (const key of ["maintenance", "vehicles", "trailers", "dispatch", "dashboard", "safety"]) {
    void queryClient.invalidateQueries({ queryKey: [orgId, key] });
  }
}

export const CONFLICT_MESSAGE =
  "Someone else changed this work order while you were working, so your change was not saved. The latest version is shown now: check it and try again if it is still needed.";

/**
 * A change to a work order. The API answers with the whole work order, so the page shows the result at once.
 * When someone else changed it first, the latest version is fetched and the person is told.
 */
export function useWorkOrderMutation<TArgs>(id: string, request: (args: TArgs) => Promise<WorkOrder>, { success, quiet }: { success?: (wo: WorkOrder, args: TArgs) => string | null; quiet?: boolean } = {}) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (wo, args) => {
      queryClient.setQueryData(workOrderKey(org.id, id), wo);
      invalidateMaintenance(queryClient, org.id);
      const message = success?.(wo, args);
      if (message) toast.success(message);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        void queryClient.invalidateQueries({ queryKey: workOrderKey(org.id, id) });
        if (!quiet) toast.error(CONFLICT_MESSAGE);
      } else if (!quiet) {
        toast.error(errorMessage(error));
      }
    },
  });
}

export function useMaintenanceSummary(enabled = true) {
  const org = useOrg();
  return useQuery({
    queryKey: [org.id, "maintenance", "summary"],
    queryFn: () => unwrap(api.GET("/api/v1/maintenance/summary")),
    enabled,
  });
}
