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
- Relationships: `users` is authoritative for authentication and permissions; `frequencies` is the same-UUID frequency mirror. Account, credential, and permission writes update the mirror in the same transaction; frequency-only activity fields remain on `frequencies`. `signals.author_id` records ownership; `signal_resonances` is unique on `(signal_id, actor_key)`, `signal_saves` on `(frequency_id, signal_id)`, and `monthly_recaps` on `(frequency_id, year_month)`.
- Public SQL first requires completed `PUBLISHED` rows, no withdrawal, a positive publication version, and an `AUTHOR_CONFIRMED` snapshot. Runtime projection validates the snapshot and its digest, exposes only its whitelist, and rechecks visibility/version after asynchronous work. A historical `PUBLISHED` value alone is never public eligibility.

## BEE-003 Validation and config

- Zod validates request bodies, params, and query at the route boundary; AI provider output is parsed as structured JSON against a schema before storage.
- Environment variables are parsed with Zod in `config`, which also exposes AI provider selection and capability status (`configured | degraded | disabled`).
- AI provider adapters live in `modules/ai`; only tasks with an explicit business fallback may return a validated local result. Main material/body generation requires an available chat Provider and reports a typed task failure when it cannot complete. Never substitute partial or fabricated body text, expose raw provider errors, or bypass a protection denial through fallback.
- Secrets (provider API keys) stay server-side and are never returned by admin APIs.

## BEE-004 Async work

- Managed signal generation uses the PostgreSQL-backed worker: claim, attempt identity, owner, lease, phase, and deadline fence progress and final writes. On restart the worker scans persisted tasks; legacy rows with NULL attempt metadata remain unmanaged. Recovery distinguishes work not dispatched from dispatched attempts with an uncertain outcome; it must not blindly repeat a Provider call. See [generation operations](../../docs/implementation/b1-generation-operations.md).
- The daily system-AI scheduler is disabled by default. When explicitly enabled, it uses a business time zone, a persistent single-day batch claim, and fixed signal/dispatch budgets. Scheduler, generation, and audio workers stop and drain in Fastify `preClose` while database connections remain available. Tests use explicit factories/configuration rather than assuming every timer runs under `NODE_ENV=test`.
- Redis holds login challenges, shared protection counters, and short-lived state. PostgreSQL owns the durable generation queue and dispatch/recovery decisions. Redis loss can invalidate challenges or reset usage counters; recovery must preserve those boundaries rather than silently treating the restored service as an unchanged budget window.

## BEE-005 Admin writes

Admin mutations write an `admin_actions` row (for example `targetType=SIGNAL`, `action=signal.status.update`, `details.status=<new status>`). UI-only hiding is never moderation. Report/AI-review target types are `USER | SIGNAL`.
