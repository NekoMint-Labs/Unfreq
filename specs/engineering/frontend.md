---
id: eng.frontend
applies_to:
  - apps/web/src/**
  - apps/web/eslint.config.mjs
  - apps/web/next-env.d.ts
tags:
  - frontend
  - nextjs
  - typescript
---

# Frontend Architecture and Conventions

## FEE-001 Structure and language

```text
apps/web/src/app          App Router pages (entry, login, signal, result, galaxy, me, admin, offline, api)
apps/web/src/components   product components (signals, galaxy, radio, my-frequency, admin, layout, pwa)
apps/web/src/lib          API calls and frontend utilities (api-client, response validators, signal-data)
apps/web/src/styles       global styles
apps/web/public           PWA icons and static assets
```

- Keep core navigation focused on **entry, galaxy, my frequency**; result pages are reached from signal actions.
- Use current Unfreq terms consistently. No like/comment/post/user/profile copy, and no voice/bottle/channel-hall/risk-radar/translation copy in new core UI.
- No card-heavy feed as a replacement for `/galaxy`; no hot list, ranking, follower, or recommendation UI; no fake activity counts or primary actions known to fail just to make an empty state feel alive; no autoplay audio; playback is click/tap initiated.

## FEE-002 API client and runtime validation

- All backend calls go through `apiClient`; no direct AI provider calls, no database imports, no frontend-only moderation decisions.
- `apiClient` validates the envelope (`{ data, meta.requestId }`) first. A `validate` option then checks `payload.data`, not the envelope, and a failure throws `ApiClientError` with `code="INVALID_RESPONSE"`, the HTTP status, `requestId` when available, and `details.path`.
- Validators import DTO types from `@unfreq/contracts` and reuse exported contract constants (for example `signalPrimaryBands`); they live at the Web API boundary so components receive typed data, not `unknown`.
- Network failure before an HTTP response becomes `ApiClientError` with `code="NETWORK_ERROR"` and `status: 0`.
- Backend error codes/messages are preserved unchanged for non-2xx responses.

## FEE-003 Type organization

- Shared API DTOs come from `@unfreq/contracts` (root export or subpaths). Frontend-only view models live near components or under `types/` and must not redefine API DTOs.
- Never import Drizzle table types into React components. No `any` for API responses, no unchecked assertions (`payload.data as T`) for core session/signal/galaxy/resonance/save/echo helpers, and no stringly-typed status/audio-status/source or frequency-code formatting outside shared helpers.
- Required enums: `SignalStatus: DRAFT|PUBLISHED|REVIEWING|HIDDEN|DELETED`; `SignalGenerationStatus: RECEIVED|EXPANDING|MATCHING|WRITING|COMPLETED|FAILED`; `SignalAudioStatus: NOT_REQUESTED|PENDING|READY|FAILED`; `SignalSource: human|seed|ai_generated`.
- `@/types/legacy` and `@/types/product` are retired; do not recreate those barrels.

## FEE-004 Visibility branching

Result pages must branch on `visibility` before reading detail fields:

- `GENERATION_OWNER` → redirect to `/signal/:id/transmitting` (or render generation status there).
- `PREVIEW_OWNER` → show seed/expanded text and a publish action only; hide matches, playback, resonance, save, and share-card UI until publish returns a `PUBLISHED` `SignalDetail`.
- `REVIEW_RESTRICTED` → restricted result, no seed/expanded/fingerprint/matches/audio/resonance/save/share fields.
- `SignalDetail` → the normal public result.

Server-rendered result pages must forward the request cookie to the API so the owner is not treated as anonymous.

## FEE-005 SSR resilience

- Load route-critical data first; if it fails, render a controlled state or rethrow per the route contract.
- Load optional sections (signal history, echo summary, recap, saved signals) with `Promise.allSettled` and degrade each independently to a truthful empty/unavailable state. Never make fallback data look like real server data.
- Only network/timeout failures before an HTTP response may render an unavailable state (`isApiUnavailableError`); 400/403/404/500 keep their route-specific behavior, and unknown errors rethrow to the error boundary.
- Optional SSR data keeps variables typed `T | undefined`; do not pass possibly-unassigned `let` values into components.
- Empty states state the missing object, one truthful reason, and a next action that can succeed now.

## FEE-006 Tooling conventions

- **Next ESLint flat config**: import `eslint-config-next/core-web-vitals` and `/typescript` directly in `eslint.config.mjs`; wrapping with `FlatCompat` can cause circular config errors on ESLint 9.
- **`next-env.d.ts` is generated**: keep the baseline `import "./.next/types/routes.d.ts";` and do not commit incidental `.next/dev/types/routes.d.ts` drift from local dev or Playwright runs.
- **Service worker**: precache `/offline` only; normal GET assets and RSC/script chunks are network-first with cache fallback, so stale app files cannot keep an old auth UI (including legacy auto-guest flows) alive after release.
- **Admin tables are server-paginated**: signal governance and seed-library tables call the admin API whenever `limit`, `cursor`, `q`, `source`, or `status` changes (default page size 50, max 100); search is a query parameter, not an in-memory filter over one page; `nextCursor` is opaque and sent back unchanged.
- **Inline action feedback** stays local to the triggering action: errors use `role="alert"`, pending/success use `role="status"` with polite announcements; prefer a small local helper over global toast infrastructure.
- **Galaxy**: desktop and mobile visual checks are required; verify the canvas is full-bleed on mobile (`.radio-main-galaxy`, `.galaxy-stage`, canvas left 0 / width = viewport, no horizontal scroll).

## FEE-007 Testing

- Default local verification: `npm run web:lint`, `npm run web:typecheck`, and `npm --workspace @unfreq/web run test`.
- With the current Vitest-only Web test stack, prefer extracting deterministic component state helpers (labels, disabled states, error copy) into the component directory with `*.test.ts` before adding a DOM test dependency.
- Do not run `npm run e2e` by default; it is opt-in. The E2E harness runs Playwright against Next dev plus a local mock API, and the web server must point at the mock API with **both** `NEXT_PUBLIC_API_BASE_URL` and `API_INTERNAL_BASE_URL` so SSR and browser requests see the same fixtures. Mock fixtures must stay aligned with the Web runtime validators.
