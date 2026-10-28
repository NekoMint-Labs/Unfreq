---
id: platform.api
applies_to:
  - apps/api/src/app.ts
  - apps/api/src/shared/**
  - apps/api/src/modules/frontend-diagnostics/**
  - apps/api/src/modules/images/**
  - packages/contracts/src/api.ts
  - apps/web/src/lib/api-client.ts
tags:
  - api
  - contracts
  - images
---

# Platform API Foundation

## PLAT-001 Envelope and error codes

- Success: `{ data: {...}, meta: { requestId } }`. Error: `{ error: { code, message, details? }, meta: { requestId } }`.
- Shared codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `AI_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).
- Every client feature must be reachable through the Fastify JSON API. Next.js server actions/helpers may call API helpers internally but must never be the only implementation path — Android must be able to do the same thing over HTTP.
- Raw binary responses are the single exception to JSON (image bytes, audio bytes); their error responses still use the JSON envelope.

## PLAT-002 Shared contract package

- Public DTOs live in `packages/contracts/src/*.ts` with subpaths `@unfreq/contracts/api|auth|signals|admin|theme-radio` plus the root export.
- `apps/api` public response types import from or re-export `@unfreq/contracts`; `apps/web` imports API/domain DTOs from the contracts package, never from hand-copied app-local files.
- `apps/web/src/types/core.ts` may hold frontend-only view types but must not redefine API DTOs. Backend-internal records (`Date`, nullable DB fields, storage keys, raw JSON columns, Drizzle table types) stay in `apps/api`.
- API runtime validation stays in `apps/api` Zod schemas; the contracts package is types, not a validator.
- Package runtime exports point at `packages/contracts/dist/*`, so any command that runs API/Web build, dev, start, or e2e must build contracts first. Root scripts do this automatically.

## PLAT-003 Retired legacy boundary

- `buildApp()` registers only current product routes: auth, frequencies, `/api/me`, frontend diagnostics, reports, signals, monthly recaps, theme radio, images, admin.
- Retired modules must not be reintroduced as default registrations: `/api/channels/*`, `/api/voices/*`, `/api/bottles/*`, `/api/translate/*`, `/api/radio-report/*`, product `/api/ai/*`. Requests to them return 404 by route absence, not by a compatibility response.
- `ReportTargetType` and `AdminAiReviewTargetType` are `USER | SIGNAL` only; retired types (`VOICE`, `BOTTLE`, `BOTTLE_ECHO`, old `ECHO`) are rejected with `400 VALIDATION_ERROR`.
- Historical tables/enums may remain unreachable; admin overview/moderation must compute metrics from signals, frequencies, reports, AI reviews, and admin actions.

## PLAT-004 Frontend diagnostics

- `POST /api/frontend-diagnostics/errors` is unauthenticated and accepts only `source`, `route` (path only, no query string or absolute URL), `name`, `message`, `correlationId`, optional `requestId`, optional `digest`. Valid diagnostics return `202 { accepted, correlationId }`.
- Extra fields (cookies, authorization headers, emails, user content, stack traces) are rejected with `400 VALIDATION_ERROR`. Diagnostics are logged for incident review, not stored as product data, and client-side send failure is swallowed after a local dev warning.

## PLAT-005 Image hosting

- `POST /api/images` takes `{ contentBase64, mimeType, altText? }` and returns `{ image: { id, url: "/api/images/<id>", mimeType, sizeBytes, altText?, createdAt } }`. `GET /api/images/:id` returns raw bytes with `Content-Type`, `Content-Length`, and immutable cache headers.
- Supported MIME types are `image/gif`, `image/jpeg`, `image/png`, `image/webp`; the declared MIME must match the image signature. Limits: `IMAGE_MAX_BYTES=2097152`, `IMAGE_STORAGE_DIR=storage/images`.
- Missing session 401; muted/banned 403; bad base64, unsupported MIME, signature mismatch, or oversize 400; daily `IMAGE_UPLOAD` limit 429 (and remove the staged file); unknown id 404.
- The frontend never writes to local storage or assumes a third-party host URL format.

## Non-goals

- No GraphQL, no Next.js-only API surface, no compatibility routes for retired products, no storing diagnostics as product data.
