# 0001. One profile, up to ten companies

**Status:** accepted (owner request, 2026-11-12)

## Context

Carriers often run several legal entities, each with its own operating authority. When one entity stops
operating, work has to continue under another without re-entering everything.

## Decision

- An **account** is the owner's profile. It owns **companies** (organizations). A new sign-up creates an
  account with its first company.
- An account may have at most **10 active companies** (`accounts.max_companies`, enforced by the API).
  Archived companies stay readable and do not count.
- Only the account owner creates or archives companies, and is made owner of each one.
- Each company is a **separate tenant**: its own loads, invoices, payments, settlements, driver files,
  equipment, customers and team. Row-level security keeps them apart exactly as it does two unrelated
  carriers. This is deliberate: invoices, driver qualification files, insurance and registrations belong to a
  legal entity and must not blur across entities.
- **Switching** is one click for anyone who belongs to more than one company: the API re-verifies membership
  and issues a new session for the chosen company; the browser discards all cached data.
- **Speed without shared books:** when creating a company, the owner can copy the team, customers, drivers,
  trucks and trailers from an existing company in the same account. Loads and financial records are never
  copied.

## Consequences

- Master data copied to a second company is an independent copy. A later change in one company does not
  change the other. A re-sync tool can be added if that proves painful.
- Reports are per company. A consolidated view across an account's companies is a possible later addition.

## Alternative considered

Sharing drivers, equipment and customers across an account's companies, with only loads and invoices tagged
by company. Rejected for now: it weakens isolation between legal entities and makes per-entity compliance
records ambiguous.
