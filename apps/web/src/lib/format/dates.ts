/**
 * Two different things, kept apart:
 *  - an instant ("2026-03-10T14:00:00Z"): shown in the company's time zone;
 *  - a calendar date ("2026-03-10", a due date or an expiry): shown as written, never shifted by a time zone.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", options);
    cache.set(key, f);
  }
  return f;
}

/** "Mar 10, 2:00 PM" in the company's time zone. */
export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return formatter(`dt:${timeZone}:${sameYear}`, {
    timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** "Mar 10, 2026" for an instant, in the company's time zone. */
export function formatDay(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return formatter(`d:${timeZone}`, { timeZone, month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** "Mar 10, 2026" for a calendar date. No time zone is involved. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "—";
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatter("date", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(utc);
}

/** The short name of a time zone right now, for labelling times: "CST", "GMT+1". */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const part = formatter(`tz:${timeZone}`, { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/**
 * An instant as the value of an <input type="datetime-local"> showing the company's wall clock time, and back.
 * The browser's own time zone is never involved: a dispatcher travelling still sees and enters company time.
 */
export function toLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    formatter(`in:${timeZone}`, { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromLocalInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  // Start from the same wall clock time in UTC, then correct by the zone's offset at that moment. Two passes
  // settle the cases around a daylight-saving change.
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const shown = toLocalInput(new Date(guess).toISOString(), timeZone);
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(shown);
    if (!m) return null;
    const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    guess += Date.UTC(year, month - 1, day, hour, minute) - asUtc;
  }
  return new Date(guess).toISOString();
}

/** "in 3 days", "2 days ago", "today" for a calendar date relative to the company's today. */
export function relativeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  if (days === 0) return "today";
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}
