# Roadmap

Status against the build order in the engineering instructions. "Done" means built, tested and working in
this repository. The web column is the screens; the API column is the rules behind them.

| # | Step | API | Web |
| --- | --- | --- | --- |
| 1 | Audit and foundation | Done: [audit](implementation-audit.md), [decisions](decisions) | Done: mandated stack, generated API types, session layer, unit and browser tests |
| 2 | Design system and application shell | n/a | Done: theme (light and dark), components, sidebar, breadcrumbs, user menu, company switcher, terminal selector, global search (Ctrl/⌘ K), quick create, shared table and form standards. Notifications not started |
| 3 | Sign-in and company switching | Done | Done: sign-up, sign-in, choose a company, switch, add with a copy, archive, restore |
| 4 | Customers | Done | Done: list, form, detail with contacts and addresses, archive and restore |
| 5 | Drivers and equipment | Done | Done: drivers with compliance, qualification file, documents and loads; trucks and trailers with their own pages, documents and loads; terminals |
| 6 | Loads | Done | Done: list, four-step booking wizard with drafts, load page with route, freight and charges, documents, activity, every lifecycle action, conflict-safe editing |
| 7 | Dispatch board and assignment | Done | Done: live board with counts, views and saved views, assignment panel with eligibility and reasons, reassign and unassign |
| 8 | Documents | Done | Done: documents center with filters, uploads on loads, drivers, equipment and customers, POD review through the load, compliance review |
| 9 | Safety and compliance | Done: status, expirations queue, blocking, inspections with defects | Done: safety page with summary, expirations queue and documents to review; inspections (list, record, detail) |
| 10 | Fleet and maintenance | Done: work orders with costs and lifecycle, out-of-service and return to service, summary, dashboard alerts, search, attachments | Done: maintenance page with summary, work orders and inspections, work order page with costs and documents, unit Maintenance tab, return to service |
| 11 | Finance | Done: invoices, payments, aging. Not started: expenses, fuel, driver settlements | Done: invoices (list with receivables, create from completed loads, draft editing with loads and adjustments, issue, void, print), payments (record with allocations, apply later, reverse), customer invoices tab, "invoice this load". Not started: expenses, fuel, settlements |
| 12 | Reports and administration | Done: dashboard, exceptions, search, four reports, CSV, audit log, role matrix | Done: dashboard, companies, team, terminals. Not started: company settings, role matrix, audit log, reports, search |

## What "Done" covers in the API

- **Multi-company profile.** Up to ten active companies per account; create by copying setup; archive and
  restore; switch.
- **Load lifecycle.** Twelve states, one transition function, immutable history, version checks.
- **Dispatch.** Eligibility with reasons, overlap detection, concurrency-safe assignment, reassignment.
- **Finance.** Draft, issue, void; payments with allocations and reversal; receivables aging.
- **Maintenance.** Work orders with costs, start, complete and cancel; inspections with defects; units kept
  off the road until nothing that took them off is still open.
- **Platform.** Row-level security on every table, role permissions, audit log, idempotency, error and
  list contracts, encrypted licence numbers.

## Next

1. **Finance, part two**: expenses, fuel, driver settlements.
2. **Reports and administration**: reports with export, company settings, role matrix, audit log.

## Deferred by decision

Deployment (AWS, Terraform, Cognito, S3) comes after the product is built. The driver mobile app and the
customer portal follow the web application.
