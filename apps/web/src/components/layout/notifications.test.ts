import { describe, expect, it } from "vitest";
import { unseenCodes } from "@/components/layout/notifications";

describe("what counts as a new notification", () => {
  const alerts = [
    { code: "LOADS_AT_RISK", count: 4 },
    { code: "INVOICES_OVERDUE", count: 2 },
    { code: "DRIVERS_BLOCKED", count: 1 },
  ];

  it("is everything the first time", () => {
    expect(unseenCodes(alerts, {})).toEqual(new Set(["LOADS_AT_RISK", "INVOICES_OVERDUE", "DRIVERS_BLOCKED"]));
  });

  it("is an alert never seen, or one that grew; one that shrank or stayed is not news", () => {
    const seen = { LOADS_AT_RISK: 3, INVOICES_OVERDUE: 5, DRIVERS_BLOCKED: 1 };
    expect(unseenCodes(alerts, seen)).toEqual(new Set(["LOADS_AT_RISK"]));
    expect(unseenCodes([...alerts, { code: "WORK_ORDERS_URGENT", count: 1 }], seen)).toEqual(new Set(["LOADS_AT_RISK", "WORK_ORDERS_URGENT"]));
  });
});
