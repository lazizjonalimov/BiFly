import type { components } from "@/lib/api/schema";

/** Short names for the API's schemas. Always derived from the contract, never written by hand. */
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type Me = Schema<"MeOut">;
export type OrgRef = Schema<"OrgRef">;
export type PageInfo = Schema<"PageInfo">;
export type Page<T> = { items: T[]; page: PageInfo };
