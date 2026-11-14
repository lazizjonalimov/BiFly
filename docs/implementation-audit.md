# Implementation audit (Sprint 0)

Audit of the repository at commit `3388a68` against the FlyFleet web blueprint (sections 1–20.19) and the
architecture plan. It answers: what exists, what is partial, what is missing, what is wrong, and in what order
to build the rest.

## Summary

The backend foundation is sound and matches the blueprint's hardest requirements: tenant isolation by
PostgreSQL row-level security, an explicit load state machine, immutable history, idempotency, audit. One
complete load-to-paid-invoice workflow works and is tested (29 API tests, 3 browser tests, CI green).

The web application works but was built on a lighter stack than the blueprint mandates, and covers only the
first workflow. Most of the blueprint's screens do not exist yet.

## Completed

| Area | State |
| --- | --- |
| Tenant isolation | RLS forced on every table, restricted runtime role, composite foreign keys, ORM-level filter, startup guard, pooled-connection test |
| Identity | Sign-up (creates company), sign-in, password change with token revocation, per-request membership check |
| Authorization | Role to permission map enforced on every endpoint |
| Loads | Create with ordered stops, edit, cancel, stop arrive/depart events, status history |
| Dispatch | Assignment with compliance and equipment checks, unassign, dispatch, board |
| Documents | Upload and download on a load, POD required to confirm delivery |
| Finance | Invoice from a completed load, partial and full payments, void, receivables totals |
| Platform | Idempotency keys, audit log, request ids, cursor pagination, OpenAPI |
| Driver API | Own assignments, stop events safe to retry, document upload |
| Delivery | Docker images and Compose, CI (lint, tests, browser tests), demo seeder |

## Partially completed

| Area | Gap against the blueprint |
| --- | --- |
| Multi-company | A user can belong to several companies and choose one at sign-in. No account that owns companies, no limit, no in-app switcher, no way to add a company |
| Load lifecycle | Simpler states than the blueprint proposes; billing states are mixed into the load status; no draft, hold or POD review; several transition endpoints instead of one |
| API contract | Error and list envelopes differ from sections 8 and 20.9; no server-side sorting; no version-based concurrency |
| Dispatch | No eligible-resources endpoint with reason codes, no saved views, overlap check ignores time windows |
| Customers, drivers, equipment | Single flat records. No contacts, addresses, qualifications, documents or detail pages |
| Documents | Tied to a load only. No library, links to other records, review lifecycle or upload-intent contract |
| Finance | One line per invoice, no draft or issue step, no allocations, expenses, fuel or settlements |
| Reports | Two summary endpoints. No report pages or exports |
| Roles | Fixed in code; one role per member. No role matrix screen |

## Missing

- **Web stack required by the blueprint:** shadcn/ui, Lucide, TanStack Table, React Hook Form, Zod, generated
  API types, `src/` feature folders, routes under an organization slug, server components with a server-only
  data layer, unit tests.
- **Workspace shell:** grouped sidebar, organization switcher, terminal selector, global search, quick-create,
  notifications, breadcrumbs.
- **Screens:** role-aware dashboard, safety and expirations, document center, maintenance work orders,
  inspections, payments, expenses, fuel, settlements, reports, settings (organization, terminals, roles, audit).
- **Data:** accounts, terminals, user preferences and saved views, customer contacts and addresses, driver
  qualifications, equipment documents, inspections, work orders, load items, accessorials, notes, tracking
  events, document links and reviews, payment allocations, expenses, fuel, settlements.
- **Deliberately deferred until deployment** (see ADR 0003): Cognito and MFA, S3, SQS workers, Redis, PostGIS,
  email and SMS, maps, ELD, Terraform. Customer portal, platform operator area and the driver phone app follow
  the web application.

## Technical problems

1. All pages are client components with hand-written types; there is no server-rendered session check
   beyond a cookie-presence redirect.
2. Lists return at most 200 rows to pickers and sort only by creation time.
3. The dispatch board is a five-column kanban, not the filterable server-side grid the blueprint specifies.
4. Product naming still says "Carrier TMS" in code, images and docs.
5. No unit tests on the web side.

## Security concerns

None that weaken tenant isolation. Open items, all already documented:

1. Local password sign-in without MFA or email recovery (ADR 0003).
2. Login throttling is per process.
3. Uploaded files are type and size checked but not malware scanned.
4. No time-limited, audited support access (no platform access exists at all, which is the safe default).

## Recommended order

This follows the blueprint's sprint sequence (20.15) and build order (17):

1. Backend contract alignment and FlyFleet naming.
2. Multi-company profile (accounts, limit, switch, copy).
3. Load lifecycle per blueprint, eligibility, concurrency.
4. Web foundation on the mandated stack, with the workspace shell.
5. Master data depth: customers, drivers, trucks, trailers, terminals.
6. Loads and dispatch board screens.
7. Documents and safety.
8. Fleet maintenance.
9. Finance.
10. Dashboard, reports, exports, administration.

Each step lands as a tested, working increment on `main`.
