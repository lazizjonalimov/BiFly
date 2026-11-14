import { describe, expect, it } from "vitest";
import { describeAction } from "@/features/administration/audit-log";
import { formatCell } from "@/features/reports/report-view";

describe("report cells", () => {
  it("writes each kind of column its own way", () => {
    expect(formatCell("4300.5", { kind: "money" }, "USD")).toBe("$4,300.50");
    expect(formatCell(12500, { kind: "number" }, "USD")).toBe("12,500");
    expect(formatCell("92.456", { kind: "percent" }, "USD")).toBe("92.5%");
    expect(formatCell("Globex", { kind: "text" }, "USD")).toBe("Globex");
  });

  it("shows a dash for nothing, not a zero or a blank", () => {
    expect(formatCell(null, { kind: "money" }, "USD")).toBe("—");
    expect(formatCell(undefined, { kind: "text" }, "USD")).toBe("—");
    expect(formatCell("", { kind: "number" }, "USD")).toBe("—");
    expect(formatCell(0, { kind: "number" }, "USD")).toBe("0");
  });
});

describe("audit entries", () => {
  it("reads an action as a sentence", () => {
    expect(describeAction("load.status_changed")).toBe("Load status changed");
    expect(describeAction("work_order.created")).toBe("Work order created");
  });
});
