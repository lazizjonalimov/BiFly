/**
 * Named reporting periods, worked out on the company's calendar (pass the company's today, from todayIn).
 * Quarters are calendar quarters, which are also the fuel-tax quarters.
 */

export const PERIODS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "year_to_date", label: "Year to date" },
];

export const FUEL_PERIODS = PERIODS.filter((p) => p.value !== "year_to_date");

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function periodRange(period: string, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  if (period === "last_month") {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
  }
  if (period === "year_to_date") return { from: iso(y, 1, 1), to: today };
  const quarterStart = Math.floor((m - 1) / 3) * 3 + 1;
  if (period === "this_quarter") return { from: iso(y, quarterStart, 1), to: today };
  if (period === "last_quarter") {
    const [qy, qm] = quarterStart === 1 ? [y - 1, 10] : [y, quarterStart - 3];
    return { from: iso(qy, qm, 1), to: iso(qy, qm + 2, lastDay(qy, qm + 2)) };
  }
  return { from: iso(y, m, 1), to: today };
}
