const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (v: string | number | null | undefined) => usd.format(Number(v ?? 0));

export const label = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Calendar date (YYYY-MM-DD) without timezone shifting. */
export function day(v: string | null | undefined): string {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Value for <input type="datetime-local"> from an ISO string, in local time. */
export function toLocalInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** "expired" | "soon" (within 30 days) | null */
export function expiryState(v: string | null | undefined): "expired" | "soon" | null {
  if (!v) return null;
  const days = (new Date(v + "T00:00:00").getTime() - Date.now()) / 864e5;
  return days < 0 ? "expired" : days <= 30 ? "soon" : null;
}
