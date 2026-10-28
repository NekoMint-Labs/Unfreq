# Retired product surfaces are removed, not kept as compatibility routes

## Context

Unfreq pivoted from an unsent-expression translation / voice / bottle / channel-radio direction to anonymous thought resonance. Older routes (`/api/voices`, `/api/bottles`, `/api/channels`, `/api/translate`, `/api/radio-report`, product `/api/ai/*`) and their DTOs still existed.

## Decision

The default Fastify app registers only current product routes. Retired modules are not re-registered and do not return compatibility or redirect-style responses — they 404 by route absence. Report and AI-review target types shrink to `USER | SIGNAL`. Historical tables/enums may remain in the database until a separate data-retirement task. `@/types/legacy` and `@/types/product` barrels are not recreated.

## Why

- A compatibility route keeps the retired product surface alive in review, tests, docs, and the security model, and invites new work against it.
- 404-by-absence is honest: clients cannot accidentally depend on a surface the product no longer supports, and the current route table is the product definition.
- Keeping data while removing API access lets a future data-retirement task run without a schema emergency.

## Revisit when

A retired surface is deliberately revived as product. Then create fresh explicit DTOs and a matching API contract first — never resurrect the old barrel or route as-is.
