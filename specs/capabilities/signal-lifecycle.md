---
id: signal.lifecycle
applies_to:
  - apps/api/src/modules/signals/**
  - packages/contracts/src/signals.ts
  - apps/web/src/app/signal/**
  - apps/web/src/app/result/**
  - apps/web/src/lib/signal-data.ts
tags:
  - signals
  - generation
  - publish
---

# Signal Lifecycle

## SIG-001 Pending emission

- `POST /api/signals` (body `{ seedText, parentSignalId? }`) is the normal product emission API and returns `201 { signal: SignalGenerationDetail }` with a stable id before AI generation finishes.
- It creates a `signals` row with `status="DRAFT"` and `generationStatus="RECEIVED"`, then schedules generation for the same row. The background path moves the same row through `EXPANDING → MATCHING → WRITING → COMPLETED`, with `FAILED` terminal on failure.
- `seedText` is trimmed, 5–200 chars. `parentSignalId` is optional and must point to a signal visible to the current frequency.
- `POST /api/signals/generate` is not registered; it returns `404` through route absence.
- The current runner is process-local: persisted status survives refresh and link reopening, but cross-process restart recovery needs an explicit worker/queue task.

## SIG-002 Risk, preview, and publish

- After completion: low/medium risk stays `DRAFT` as a private owner preview; high risk becomes `REVIEWING`.
- Owner publish is `POST /api/signals/:id/publish` → `200 { signal: SignalDetail }`. It publishes only a completed `DRAFT` owned by the current active frequency; publishing an already-`PUBLISHED` owned signal is idempotent.
- Publish without session → 401; non-active frequency → 403; missing/non-owned → 404; before completion or `REVIEWING` → 409 `CONFLICT`.
- Generation failure keeps `status="DRAFT"`, sets `generationStatus="FAILED"`, shows the owner a generic failure, and lets them create a new signal with the same seed. Failed rows are not public.

## SIG-003 Detail visibility

`GET /api/signals/:id` returns different shapes by owner and status:

| Row state | Owner | Non-owner / anonymous |
| --- | --- | --- |
| Generating | `SignalGenerationDetail` (200) | 404 `NOT_FOUND` |
| Completed `DRAFT` (preview) | `SignalPreviewDetail` (200) | 404 `NOT_FOUND` |
| `PUBLISHED` | `SignalDetail` (200) | `SignalDetail` (200) |
| `REVIEWING` | `SignalDetail` (200) | `ReviewingSignalRestrictedDetail` (200) |
| `HIDDEN` / `DELETED` / unknown | 404 `NOT_FOUND` | 404 `NOT_FOUND` |

- Owner match is by `frequencyId`/`authorId` against the authenticated frequency.
- `ReviewingSignalRestrictedDetail` carries only `id`, `status: REVIEWING`, `visibility: REVIEW_RESTRICTED`, and timestamps. It must not include `seedText`, `expandedText`, `rawInput`, `fingerprint`, `program`, matches, audio, save, resonance, or share-card content.
- Reviewing is **not** 404: clients must be able to show a stable "temporarily not public" state.
- Public result, random, match, galaxy, save, resonance, and share-card surfaces treat generating rows and private previews as invisible.
- Web result pages must forward the incoming cookie when server-rendering `/result/:id`, otherwise the owner is treated as anonymous.

## SIG-004 Matching and embedding

- Same-frequency matching is optional during creation; a matching failure degrades to an empty `matches` array and no `matchSignalId` after completion — it must never abort creation.
- Matching uses the `expandedText` embedding, stores embedding metadata with the vector, isolates recall by `embedding_version`, and blends embedding similarity with the fixed frequency profile. Reranker disabled/failure keeps embedding-distance ordering.
- `source` on match DTOs is `PUBLISHED`, `SEEDED`, or `FALLBACK`; seeded matches may be shown but must never be stored as human signals or as `matchSignalId`.
- Embedding writes are queued once after completion. Pending placeholder text must not be embedded; completed previews may have embeddings, but public match reads still filter to `PUBLISHED`.
- Embedding/reranker provider failure keeps signal creation successful (keyword/seed fallback).

## SIG-005 Audio

- `audioStatus`: `NOT_REQUESTED → PENDING → READY | FAILED`. Audio is never required for signal creation.
- `GET /api/signals/:id/audio` is read-only and must not start TTS. `POST /api/signals/:id/audio` starts or reuses TTS for `expandedText` (not `seedText` unless an explicit fallback reason is stored).
- Playback must be click/tap initiated — never autoplay. TTS provider failure returns `audio.status="FAILED"` and leaves the text usable.
- Audio files are stored and served by the API service; the API container must not write into the Web `public/` directory.

## Non-goals

- No synchronous wait for AI completion before responding to emission.
- No public exposure of `DRAFT`, `HIDDEN`, `DELETED`, generating, or preview rows.
- No risk-radar, translation, or program DTOs from `POST /api/signals`.
