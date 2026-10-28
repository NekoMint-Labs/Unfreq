---
id: eng.backend
applies_to:
  - apps/api/src/**
  - apps/api/package.json
tags:
  - backend
  - fastify
  - drizzle
---

# Backend Architecture

## BEE-001 Module layout

`apps/api` is a Fastify JSON API, split by business module:

```text
apps/api/src/config       environment parsing (Zod)
apps/api/src/db           Drizzle schema, migrations, database client, vector helpers
apps/api/src/modules      business modules (auth, signals, ai, admin, images, reports, monthly-recaps, theme-radio, frontend-diagnostics, health)
apps/api/src/plugins      Fastify plugins (auth, logger, redis, cors)
apps/api/src/shared       shared helpers and the AppError type
```

- Each module owns its `routes.ts`, `service.ts`, `repository.ts`, `schemas.ts`, and `types.ts`; routes stay thin (validate → call service/repository → serialize).
- `signals` is the core module (seed intake, AI generation, matching, publish, resonance, saves, galaxy, audio). `ai` owns provider adapters, prompts, and structured generation. `auth` owns FM identity and sessions.
- `buildApp()` (`app.ts`) registers only current product routes; see `platform.api` for the retired-route boundary.
- Errors are `AppError` with the shared codes; routes return the shared envelope through the `sendData` helper.

## BEE-002 Data layer

- PostgreSQL via Drizzle: `apps/api/src/db/schema.ts` (tables), `db/migrations` (checked-in Drizzle migrations), `db/vector.ts` (pgvector handling). Migrations are applied by the API container on deploy.
- Repositories take an explicit DB client, use parameterized Drizzle query builders, and never expose raw row types across the API boundary.
- Schema types are backend-internal: `Date`, nullable columns, storage keys, and raw JSON columns must not leak into `packages/contracts` or UI props.
- Relationships: `frequencies` (canonical identity) with the legacy `users` mirror still used by parts of auth/admin; `signals` owned by `signals.author_id` during the migration; `signal_resonances` unique on `(signal_id, actor_key)`; `signal_saves` unique on `(frequency_id, signal_id)`; `monthly_recaps` upserted by `(frequency_id, year_month)`; `theme_radio_days` filtered by active window.
- Hidden/deleted/draft visibility filtering happens in SQL, not by filtering fetched rows in application code.

## BEE-003 Validation and config

- Zod validates request bodies, params, and query at the route boundary; AI provider output is parsed as structured JSON against a schema before storage.
- Environment variables are parsed with Zod in `config`, which also exposes AI provider selection and capability status (`configured | degraded | disabled`).
- AI provider adapters live in `modules/ai`; a provider failure must return a deterministic fallback rather than a raw error or partial object.
- Secrets (provider API keys) stay server-side and are never returned by admin APIs.

## BEE-004 Async work

- Signal generation status is persisted in the database; the current runner is process-local scheduling. Page refresh and link reopening recover from persisted status, but a process restart may lose in-flight work — a durable worker/queue (for example BullMQ over the existing Redis) is the intended upgrade, not a silent assumption of delivery.
- In-process timers must be cleared on Fastify `onClose` and skipped under `NODE_ENV=test`, and must stay inside a replaceable scheduler module.
- Redis holds session, cache, and queue state only — primary data must survive Redis loss.

## BEE-005 Admin writes

Admin mutations write an `admin_actions` row (for example `targetType=SIGNAL`, `action=signal.status.update`, `details.status=<new status>`). UI-only hiding is never moderation. Report/AI-review target types are `USER | SIGNAL`.
