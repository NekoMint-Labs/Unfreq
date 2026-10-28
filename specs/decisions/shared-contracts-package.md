# Shared DTOs live in packages/contracts

## Context

Web and a future Android Kotlin client must consume the same Fastify JSON API. Without a shared type source, each client hand-copies response shapes and drifts when the API changes a field.

## Decision

All public API DTOs live in `packages/contracts/src/*.ts` with subpath exports (`@unfreq/contracts/api|auth|signals|admin|theme-radio`). `apps/api` imports/re-exports them; `apps/web` imports them instead of app-local copies. Runtime validation stays in `apps/api` Zod schemas and in Web response validators — the package is types, not a validator. Backend-internal row types stay in `apps/api`. Root scripts build contracts before any API/Web build, dev, start, or e2e command.

## Why

- One field is defined once, so an API shape change fails typecheck in every consumer instead of silently shipping.
- Keeping validation out of the package avoids coupling runtime validation to the type build and avoids duplicating Zod schemas in the frontend.
- Backend row types include `Date`, nullable columns, and raw JSON that must never become a public contract.

## Revisit when

The Android client needs generated cross-language artifacts or the package grows large enough that a single build/consumption model is a bottleneck. Any change must keep the "public DTOs defined once, validated at each runtime boundary" property.
