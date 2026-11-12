# 0004. API contract conventions

**Status:** accepted (blueprint sections 8 and 20.9)

- **Errors:** `{"error": {"code", "message", "field_errors", "details", "request_id"}}`. Codes are stable
  upper-case identifiers such as `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `STATE_CONFLICT`,
  `ASSIGNMENT_CONFLICT`, `VERSION_CONFLICT`, `DUPLICATE_REFERENCE`, `RATE_LIMITED`. Field errors are keyed by
  field path.
- **Lists:** `{"items": [], "page": {"next_cursor", "has_more", "total_count"}, "meta": {"request_id",
  "generated_at"}}`. Cursors are opaque. `total_count` is computed only when asked for (`count=true`).
- **Sorting and filtering** happen in the database over the whole matching set. Each endpoint allowlists its
  sort keys (`sort=name`, `sort=-created_at`) and filters.
- **Concurrency:** contested records carry a `version`. Writes that depend on what the user saw send it back.
- **Idempotency:** creates and financial actions accept `Idempotency-Key`.
- **Money** travels as decimal strings with an ISO currency code. **Instants** are UTC ISO timestamps;
  **calendar dates** (expirations, due dates) are plain dates, evaluated in the company's time zone.
- The web application's types are generated from the API's OpenAPI document, never written by hand.
