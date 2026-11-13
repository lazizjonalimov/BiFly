/**
 * Money arrives from the API as a decimal string ("1234.50") and is shown, never recalculated, here.
 * The few sums the screen needs before saving (a preview total) are done in whole cents, not floating point.
 */

/** "1234.5" -> 123450. Returns null for anything that isn't a plain decimal amount. */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/** 123450 -> "1234.50" */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Add decimal strings exactly. Unparseable parts count as zero. */
export function sumMoney(values: Array<string | number | null | undefined>): string {
  return fromCents(values.reduce<number>((total, v) => total + (toCents(v) ?? 0), 0));
}

/** quantity x rate, rounded half up to cents, the way the API does it. */
export function multiplyMoney(quantity: string | number, rate: string | number): string | null {
  const q = Number(quantity);
  const r = toCents(rate);
  if (!Number.isFinite(q) || r === null) return null;
  // Work in hundredths of a quantity so 2.5 x 60.00 is exact.
  const hundredths = Math.round(q * 100);
  const product = hundredths * r; // in ten-thousandths of a currency unit
  const rounded = Math.sign(product) * Math.round(Math.abs(product) / 100);
  return fromCents(rounded);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "1234.5", "USD" -> "$1,234.50". A missing amount shows as a dash. */
export function formatMoney(value: string | number | null | undefined, currency = "USD"): string {
  const cents = toCents(value);
  if (cents === null) return "—";
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}
