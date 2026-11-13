import { describe, expect, it } from "vitest";
import { formatDate, formatDay, fromLocalInput, relativeDays, timeZoneLabel, toLocalInput } from "@/lib/format/dates";

describe("dates", () => {
  it("shows a calendar date exactly as written, whatever the time zone", () => {
    expect(formatDate("2026-03-10")).toBe("Mar 10, 2026");
    expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("10/03/2026")).toBe("—");
  });

  it("shows an instant in the company's time zone, not the browser's", () => {
    // 03:30 UTC on the 11th is still the 10th in Chicago.
    expect(formatDay("2026-03-11T03:30:00Z", "America/Chicago")).toBe("Mar 10, 2026");
    expect(formatDay("2026-03-11T03:30:00Z", "UTC")).toBe("Mar 11, 2026");
    expect(formatDay("2026-03-11T03:30:00Z", "Asia/Tokyo")).toBe("Mar 11, 2026");
  });

  it("converts an instant to company wall-clock time for an input, and back", () => {
    expect(toLocalInput("2026-01-15T20:00:00Z", "America/Chicago")).toBe("2026-01-15T14:00");
    expect(fromLocalInput("2026-01-15T14:00", "America/Chicago")).toBe("2026-01-15T20:00:00.000Z");
    // Summer time: Chicago is five hours behind UTC rather than six.
    expect(toLocalInput("2026-07-15T19:00:00Z", "America/Chicago")).toBe("2026-07-15T14:00");
    expect(fromLocalInput("2026-07-15T14:00", "America/Chicago")).toBe("2026-07-15T19:00:00.000Z");
    expect(fromLocalInput("2026-03-10T09:30", "UTC")).toBe("2026-03-10T09:30:00.000Z");
    expect(fromLocalInput("2026-03-10T09:30", "Asia/Kolkata")).toBe("2026-03-10T04:00:00.000Z");
  });

  it("round-trips every hour across a daylight-saving change", () => {
    for (let hour = 0; hour < 48; hour++) {
      const instant = new Date(Date.UTC(2026, 2, 8, hour)).toISOString(); // US clocks change on 8 March 2026
      const local = toLocalInput(instant, "America/New_York");
      expect(toLocalInput(fromLocalInput(local, "America/New_York"), "America/New_York")).toBe(local);
    }
  });

  it("rejects input that is not a date and time", () => {
    expect(fromLocalInput("", "UTC")).toBeNull();
    expect(fromLocalInput("2026-03-10", "UTC")).toBeNull();
    expect(toLocalInput("nonsense", "UTC")).toBe("");
  });

  it("labels the zone and describes distance in days", () => {
    expect(timeZoneLabel("UTC")).toBe("UTC");
    expect(timeZoneLabel("America/Chicago", new Date("2026-01-15T12:00:00Z"))).toBe("CST");
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(1)).toBe("in 1 day");
    expect(relativeDays(-12)).toBe("12 days ago");
    expect(relativeDays(null)).toBe("");
  });
});
