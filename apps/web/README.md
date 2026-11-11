# Web portal

The office-staff web application: Next.js (App Router), TypeScript, Tailwind CSS and TanStack Query.
Setup and run instructions are in the [repository README](../../README.md).

## How it talks to the API

The browser never calls the TMS API directly and never holds the API token.

- `app/api/session/*` signs in, signs up, signs out and changes passwords. On success it stores the API token
  in an `httpOnly` cookie.
- `app/api/tms/[...path]` forwards every other call to `TMS_API_URL/api/v1/…`, attaching that token.
- `proxy.ts` sends signed-out visitors to `/login`. It is a convenience redirect only; the API authorizes every
  request.
- `lib/api.ts` is the client used by pages. It throws `ApiError` with field-level messages for forms.

## Layout

```
app/(auth)/        sign-in and sign-up
app/(app)/         the signed-in application: overview, dispatch board, loads, customers, drivers, fleet,
                   invoices, team
components/        UI primitives (ui.tsx), the app shell, and shared pieces such as the assign dialog and the
                   generic master-data page (resource-page.tsx)
lib/               API client, types mirroring the API, formatting helpers
e2e/               Playwright end-to-end test
```

## Conventions

- Pages are client components that load data with TanStack Query. After any change, invalidate queries rather
  than patching cached data by hand.
- Hide what a role can't use with `useMe().can("permission")`, but treat that as presentation. The API is what
  enforces permissions.
- Give each user action that must not happen twice (assign, record a payment, create an invoice) an
  `idempotencyKey`, created once per action and reused on retry.
- Signing in or out does a full page load on purpose, so nothing cached from one session survives into the next.
- This Next.js version differs from older ones in places. Check the bundled docs in
  `node_modules/next/dist/docs/` before using an unfamiliar API (see `AGENTS.md`).
