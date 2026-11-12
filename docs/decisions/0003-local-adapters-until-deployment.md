# 0003. Local adapters until deployment

**Status:** accepted (owner decision: build the product fully, deploy afterwards)

The blueprint names AWS services for identity, files and background work. Until the deployment phase the same
seams are implemented with local adapters, so the whole product runs and is testable on one machine.

| Blueprint | Now | Seam to swap later |
| --- | --- | --- |
| Cognito OIDC, MFA, refresh tokens | Local accounts, Argon2 passwords, short signed tokens with revocation | `app/core/security.py`, `get_principal` |
| S3 with presigned URLs | Local volume behind the storage interface; uploads follow the same intent, upload, complete contract | `app/core/storage.py` |
| SQS workers, EventBridge | Work is done in the request, or computed when read (for example expirations) | Outbox table and worker, when notifications arrive |
| SES, SMS, Mapbox, ELD | Not connected | Provider adapters |
| PostGIS, Redis | Not used | Add with mapping and caching needs |

Nothing here changes the API contract the web and mobile apps depend on.
