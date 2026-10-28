# Signal emission returns a pending id before AI finishes

## Context

Expansion, review, embedding, and matching can each take seconds. A homepage submit that waits for the whole chain makes refresh, navigation, and flaky networks feel broken, and the user has no stable handle on the work in progress.

## Decision

`POST /api/signals` creates a `DRAFT` row with `generationStatus="RECEIVED"`, returns `SignalGenerationDetail` with a stable id immediately, and schedules generation on the same row through `EXPANDING → MATCHING → WRITING → COMPLETED` (or `FAILED`). Web navigates to `/signal/:id/transmitting` and polls `GET /api/signals/:id`. Completion leads to a private owner preview; only owner publish exposes the signal publicly.

## Why

- Persisted status survives refresh and link reopening, so the flow is recoverable without client-local state.
- A stable id lets the client poll and lets the backend retry/degrade (empty matches, fallback text) without blocking the response.
- Keeping generation and publish separate means low/medium-risk content is never public by accident, and high-risk content can enter `REVIEWING` safely.

## Revisit when

The in-process runner becomes a real operational problem (lost work on restart, or timing needs that exceed a single process). The intended upgrade is a durable worker/queue over the existing Redis, keeping the same persisted status and DTO contract — do not change the client-visible lifecycle to work around an in-process limitation.
