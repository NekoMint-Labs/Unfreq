---
id: eng.verification
applies_to:
  - package.json
  - scripts/**
  - deploy/**
  - compose.yaml
  - Dockerfile.api
  - Dockerfile.web
  - playwright.config.ts
tags:
  - verification
  - deployment
---

# Verification and Deployment

## VERE-001 Layer checks

Root scripts are the contract (contracts are always built before API/Web work):

```bash
npm run contracts:typecheck   # or contracts:build
npm run api:check             # api:lint + api:typecheck + api:test + api:build
npm run web:check             # web:lint + web:typecheck + web:build
npm run check                 # contracts + api + web
```

- Run the narrowest layer check while working; run `npm run check` before finishing cross-layer work.
- `npm run e2e` is intentionally opt-in (slow Next dev cold start) — run it only on request or when a change cannot be verified below the browser layer. The Playwright harness runs a local mock API; both `NEXT_PUBLIC_API_BASE_URL` and `API_INTERNAL_BASE_URL` must point at it so SSR and browser see the same fixtures.
- `npm run deploy:test` runs the deployment-script tests. Deployment scripts are tested separately because Docker, Caddy, env-var, and shell problems are not caught by TypeScript checks.
- Deterministic component/unit tests live with the Web app; backend tests use Vitest with the API module layout.

## VERE-002 Deployment topology

```text
proxy      Caddy (internal reverse proxy, also on the external NPM network)
web        Next.js production server
api        Fastify API
postgres   pgvector/pgvector:pg16
redis      redis:7-alpine (appendonly)
```

- Caddy joins the internal `app` network and the external Nginx Proxy Manager network; Web, API, PostgreSQL, and Redis stay on the internal network only. Nginx Proxy Manager owns the public domain/certificate entry and proxies to `unfreq-proxy:80`.
- Volumes persist PostgreSQL, Redis, images, and audio — a migration must know exactly what to carry.
- The API container applies Drizzle migrations and serves audio/images; it must not write into the Web container's `public/`.

## VERE-003 Environment and secrets

- `deploy/prod.env.example` and `deploy/demo.env.example` are the templates; real env files are never committed.
- Provider keys (`AI_*`, `EMBEDDING_*`, `RERANKER_*`, `TTS_*`), `SESSION_SECRET`, `DATABASE_URL`, and `REDIS_URL` are server-side only. Admin provider-config APIs store keys write-only and return only `apiKeyLast4`/`keyState`.
- Feature behavior must degrade when a provider key is absent: deterministic fallbacks for expansion/fingerprint, keyword/tag matching without embeddings, `disabled` capability status in admin.

## VERE-004 Definition of done

- The changed layer's checks pass, contracts typecheck, and `npm run check` passes for cross-layer changes.
- Public API behavior changes update the relevant contract/DTO and both clients' typecheck.
- Visibility, auth, and moderation changes include route tests for the negative (non-owner/anonymous) path, not only the happy path.
- Optional SSR degradation and galaxy full-bleed are verified when touched.
