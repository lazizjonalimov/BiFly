/** The reports the API offers, and what a role needs to run each one. The API checks the same again. */
export type ReportName = "revenue" | "drivers" | "trucks" | "ar-aging";

export const REPORTS: { name: ReportName; title: string; description: string; dated: boolean; needs: string[] }[] = [
  { name: "revenue", title: "Revenue", description: "Revenue from delivered loads, by customer, month or terminal, with revenue per mile.", dated: true, needs: ["reports.read", "loads.rates.read"] },
  { name: "drivers", title: "Driver performance", description: "Loads delivered, miles and on-time delivery for each driver.", dated: true, needs: ["reports.read"] },
  { name: "trucks", title: "Truck performance", description: "Loads delivered and miles for each truck.", dated: true, needs: ["reports.read"] },
  { name: "ar-aging", title: "Receivables aging", description: "What each customer owes, by how long it has been due.", dated: false, needs: ["reports.read", "invoices.read"] },
];

export function findReport(name: string) {
  return REPORTS.find((r) => r.name === name) ?? null;
}
