# Roadmap

Status of the implementation plan. "Done" means built, tested, and working end to end in this repository.

## Phase 1 — Technical foundation

| Item | Status |
| --- | --- |
| Monorepo, FastAPI backend, Next.js web app | Done |
| PostgreSQL schema and migrations | Done |
| Multi-tenancy with row-level security | Done |
| Authentication, roles and permissions | Done (local accounts; Cognito and MFA not started) |
| Docker images and local Docker Compose | Done |
| AWS staging environment, Terraform | Not started |
| Expo driver app scaffold | Not started |

## Phase 2 — Master data

| Item | Status |
| --- | --- |
| Companies and users | Done |
| Customers | Done (single record; separate contacts and addresses not started) |
| Drivers with CDL and medical tracking | Done |
| Trucks and trailers with insurance and registration tracking | Done |
| Documents | Done for load documents (driver and equipment documents not started) |
| Compliance reminders | Report done; automatic notifications not started |
| Maintenance records, inspections | Not started |

## Phase 3 — Loads and dispatch

| Item | Status |
| --- | --- |
| Load creation with pickup and delivery stops | Done |
| Dispatch board | Done |
| Driver, truck and trailer assignment | Done |
| Load status history | Done |
| BOL and POD management | Done |

## Phase 4 — Mobile and customer portals

| Item | Status |
| --- | --- |
| Driver API: assignments, stop events, document upload, offline-safe retries | Done |
| iOS and Android driver app | Not started |
| Push notifications | Not started |
| Customer portal and shipment tracking | Not started |

## Phase 5 — Financial management

| Item | Status |
| --- | --- |
| Customer invoices and payments | Done (one line-haul line per invoice) |
| Receivables and overdue reporting | Done |
| Expenses and fuel | Not started |
| Driver settlements | Not started |
| Profitability per load, accounting exports | Not started |

## Phases 6 and 7 — Integrations, hardening, SaaS launch

Not started: maps and mileage, ELD and telematics, email and SMS, EDI, subscription billing, tenant
administration, performance testing, external security review.

## Suggested next steps

In order, each one building on what exists:

1. **Deploy a staging environment** (Terraform: RDS, ECS Fargate, S3, CloudFront/WAF) and write the S3 storage
   adapter. Everything after this benefits from a real environment.
2. **Replace local sign-in with Cognito**, adding MFA, password reset and an invitation flow.
3. **Build the driver app** on the existing driver API (assignments, stop events, POD capture, offline queue).
4. **Add a background worker** for expiry reminders and notifications (email first, then SMS).
5. **Deepen finance**: accessorial charges, expenses and fuel, driver settlements, per-load profitability.
6. **Mapping**: PostGIS, geocoded stops, mileage, and a map on the dispatch board.
