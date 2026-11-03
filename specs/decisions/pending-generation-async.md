# Signal emission returns a pending id before AI finishes

## Context

Expansion, review, embedding, and matching can each take seconds. A homepage submit that waits for the whole chain makes refresh, navigation, and flaky networks feel broken, and the user has no stable handle on the work in progress.

## Decision

`POST /api/signals` creates a `DRAFT` row with `generationStatus="RECEIVED"`, returns `SignalGenerationDetail` with a stable id immediately, and schedules generation on the same row through `EXPANDING → MATCHING → WRITING → COMPLETED` (or `FAILED`). Web navigates to `/signal/:id/transmitting` and polls `GET /api/signals/:id`. Completion leads to a private owner preview; only owner publish exposes the signal publicly.

## Why

- Persisted status survives refresh and link reopening, so the flow is recoverable without client-local state.
- A stable id lets the client poll without blocking the response. Matching can return an empty result; main body generation still needs an available chat Provider. Missing configuration is a task failure, not a promise of local fallback text.
- Keeping generation and publish separate means low/medium-risk content is never public by accident, and high-risk content can enter `REVIEWING` safely.

## Current recovery implementation

The worker runs inside the API process, but its queue authority is already persisted in PostgreSQL. Newly admitted tasks carry an attempt count and next-attempt time; claims use an owner, attempt identifier, lease, and deadline. Progress and final writes are conditional on that fence. A periodic scan can recover eligible work after restart; wake-up only accelerates a scan and is not the durable queue.

Undispatched work can be retried within its configured bound. A persisted dispatch marker with an uncertain outcome is settled conservatively without automatically replaying paid generation. PostgreSQL owns these recovery decisions; Redis supplies shared protection budgets and is not the durable generation queue. Keep the same signal id, persisted status, and publication contract if the worker is later moved to a separate process.

See [generation operations](../../docs/implementation/b1-generation-operations.md) for configuration, legacy NULL tasks, retry and shutdown limits, and the [local whole-stack record](../../docs/implementation/local-stack-20261103.md) for the observed missing-Provider failure. These local results do not prove production recovery or remote cancellation.
