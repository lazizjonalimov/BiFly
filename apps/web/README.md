# BiFly web application

Next.js (App Router), React, TypeScript in strict mode, Tailwind CSS, shadcn/ui components on Radix,
TanStack Query and Table, React Hook Form with Zod. Setup and run instructions are in the
[repository README](../../README.md).

## How it talks to the API

The browser never calls the API directly and never holds the API token.

- `src/app/api/auth/*` signs in, signs up, switches company, changes the password and signs out. The API's
  token goes into an `httpOnly` cookie; the browser is told only which company it is now in.
- `src/app/api/v1/[...path]` forwards every other call to `BIFLY_API_URL/api/v1/...`, attaching that token.
  The API endpoints that answer with a token are deliberately not reachable through it.
- `src/proxy.ts` sends signed-out visitors to sign-in (a convenience only; the API authorizes every request)
  and sets the content security policy and frame protection on every page.
- Writes are accepted only from the app's own pages. The check uses the browser's `Sec-Fetch-Site` header,
  so it keeps working behind load balancers and tunnels that rewrite `Host`.
- The API decides everything again for itself. Hiding a button is presentation, never protection.

## Types come from the API contract

`src/lib/api/schema.d.ts` is generated from `backend/openapi.json`, which the API writes
(`make types`). Paths, parameters, request bodies and responses are all checked by the compiler, and CI
fails if either file is out of date. Nothing about the API's shape is typed by hand.

## Layout

```
src/app/(public)/              sign-in and sign-up
src/app/(workspace)/[orgSlug]/ everything inside one company; the layout verifies the session and the company
src/app/api/                   the session routes and the API pass-through
src/components/ui/             shadcn/ui components (source lives here, as shadcn intends)
src/components/layout/         shell: sidebar, company switcher, user menu, breadcrumbs, page header
src/components/forms/          form fields wired for labels, hints and errors; API error mapping
src/components/feedback/       empty, error and confirmation states
src/features/<area>/           the screens of one area, with their own forms and queries
src/lib/                       API client, session, formatting (money, dates, time zones), navigation
tests/e2e/                     Playwright journeys against the real stack
```

## Rules the code follows

- **One company at a time.** The active company's id is part of every query key. Switching company or
  signing out is a full page load, so nothing cached for one company can appear in another.
- **Money is never floating point.** Amounts arrive as decimal strings and are formatted, not recalculated.
- **Times are the company's.** Instants are shown in the company's time zone, calendar dates as written.
- **Forms** validate with Zod for immediate feedback; the API validates again and its field errors are
  shown under the same fields. Submit buttons disable while a request is in flight.
- **A screen is added to the sidebar when it is built**, never as a placeholder.

## Commands

```bash
npm run dev          # http://localhost:3000, needs the API on :8000
npm run lint
npm run typecheck
npm test             # unit tests (Vitest)
npm run e2e          # browser journeys (Playwright); needs the API and a built app running
npm run api:types    # regenerate types after the API contract changes
```

## Components

The shadcn component registry is not fetched at build time: component source is checked in under
`src/components/ui`, in shadcn's standard layout with `components.json`, so `npx shadcn add <name>` works
for adding more.
