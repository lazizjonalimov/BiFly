# Roadmap

Status against the build order in the engineering instructions. "Done" means built, tested and working in
this repository. The web column is the screens; the API column is the rules behind them.

| # | Step | API | Web |
| --- | --- | --- | --- |
| 1 | Audit and foundation | Done: [audit](implementation-audit.md), [decisions](decisions) | Done: mandated stack, generated API types, session layer, unit and browser tests |
| 2 | Design system and application shell | n/a | Done: theme (light and dark), components, sidebar, user menu, breadcrumbs. Table standard, search and notifications arrive with the first lists |
| 3 | Sign-in and company switching | Done | Done: sign-up, sign-in, choose a company, switch, add with a copy, archive, restore |
| 4 | Customers | Done | Done: list, form, detail with contacts and addresses, archive and restore |
| 5 | Drivers and equipment | Done | Done: drivers with compliance and qualification file, trucks, trailers, terminals. Detail pages for units arrive with documents and maintenance |
| 6 | Loads | Done | Not started |
| 7 | Dispatch board and assignment | Done | Not started |
| 8 | Documents | Done | Not started |
| 9 | Safety and compliance | Done: status, expirations queue, blocking. Inspections not started | Not started |
| 10 | Fleet and maintenance | Not started (work orders, out-of-service flow) | Not started |
| 11 | Finance | Done: invoices, payments, aging. Not started: expenses, fuel, driver settlements | Not started |
| 12 | Reports and administration | Done: dashboard, exceptions, search, four reports, CSV, audit log, role matrix | Done: dashboard, companies, team, terminals. Not started: company settings, role matrix, audit log, reports, search |

## What "Done" covers in the API

- **Multi-company profile.** Up to ten active companies per account; create by copying setup; archive and
  restore; switch.
- **Load lifecycle.** Twelve states, one transition function, immutable history, version checks.
- **Dispatch.** Eligibility with reasons, overlap detection, concurrency-safe assignment, reassignment.
- **Finance.** Draft, issue, void; payments with allocations and reversal; receivables aging.
- **Platform.** Row-level security on every table, role permissions, audit log, idempotency, error and
  list contracts, encrypted licence numbers.

## Next

1. **Loads and the dispatch board**, with global search and the terminal selector in the top bar.
2. **Documents and safety**, then finance and reports, then the remaining administration screens.
3. **Maintenance**: work orders, inspections, out-of-service and return to service.
4. **Finance, part two**: expenses, fuel, driver settlements.

## Deferred by decision

Deployment (AWS, Terraform, Cognito, S3) comes after the product is built. The driver mobile app and the
customer portal follow the web application.
