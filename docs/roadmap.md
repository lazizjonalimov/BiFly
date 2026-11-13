# Roadmap

Status against the build order in the engineering instructions. "Done" means built, tested and working in
this repository. The web column is the screens; the API column is the rules behind them.

| # | Step | API | Web |
| --- | --- | --- | --- |
| 1 | Audit and foundation | Done: [audit](implementation-audit.md), [decisions](decisions) | Rebuild in progress |
| 2 | Design system and application shell | n/a | Not started |
| 3 | Sign-in and company switching | Done | Not started |
| 4 | Customers | Done | Not started |
| 5 | Drivers and equipment | Done | Not started |
| 6 | Loads | Done | Not started |
| 7 | Dispatch board and assignment | Done | Not started |
| 8 | Documents | Done | Not started |
| 9 | Safety and compliance | Done: status, expirations queue, blocking. Inspections not started | Not started |
| 10 | Fleet and maintenance | Not started (work orders, out-of-service flow) | Not started |
| 11 | Finance | Done: invoices, payments, aging. Not started: expenses, fuel, driver settlements | Not started |
| 12 | Reports and administration | Done: dashboard, exceptions, search, four reports, CSV, audit log, role matrix | Not started |

## What "Done" covers in the API

- **Multi-company profile.** Up to ten active companies per account; create by copying setup; archive and
  restore; switch.
- **Load lifecycle.** Twelve states, one transition function, immutable history, version checks.
- **Dispatch.** Eligibility with reasons, overlap detection, concurrency-safe assignment, reassignment.
- **Finance.** Draft, issue, void; payments with allocations and reversal; receivables aging.
- **Platform.** Row-level security on every table, role permissions, audit log, idempotency, error and
  list contracts, encrypted licence numbers.

## Next

1. **Web foundation**: Next.js with shadcn/ui, TanStack Table and Query, React Hook Form and Zod, types
   generated from the API contract, the workspace shell and company switcher.
2. **Screens in the order above**, each with its end-to-end journey.
3. **Maintenance**: work orders, inspections, out-of-service and return to service.
4. **Finance, part two**: expenses, fuel, driver settlements.

## Deferred by decision

Deployment (AWS, Terraform, Cognito, S3) comes after the product is built. The driver mobile app and the
customer portal follow the web application.
