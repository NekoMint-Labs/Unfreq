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
- New pending rows are managed by the PostgreSQL-backed generation worker. Persistent claim/attempt/owner/lease/deadline checks support restart recovery and reject late writes. Dispatched attempts with an uncertain result are not blindly replayed; historical NULL-attempt pending rows remain outside automatic management. See [generation operations](../../docs/implementation/b1-generation-operations.md).

## SIG-002 Risk, preview, and publish

- After completion: low/medium risk stays `DRAFT` as a private owner preview; high risk becomes `REVIEWING`.
- `GET /api/signals/:id/publication-preview` gives the authenticated active owner the current `{ content, digest, version }`. The candidate contains only the body, FM alias, and preview-visible labels; raw Seed and full analysis remain private.
- Owner publish is `POST /api/signals/:id/publish` with `{ expectedVersion, digest }` → `200 { signal: OwnerSignalDetail }`. A transaction rechecks the authenticated owner, account/moderation/generation state, version, and exact current preview before recording an `AUTHOR_CONFIRMED` snapshot. Reconfirming the same current snapshot can be a no-op; a stale digest/version conflicts. Legacy `PUBLISHED` and withdrawn rows require fresh explicit confirmation and cannot bypass moderation.
- Publish without session → 401; non-active frequency → 403; missing/non-owned → 404; stale preview/version, unfinished generation, or restricted state → 409 `CONFLICT`.
- `POST /api/signals/:id/withdraw` with `{ expectedVersion }` is available to an active or muted owner. It advances the publication version, removes public eligibility, and returns `{ withdrawal: { id, withdrawn: true, publicationVersion } }`. It retains owner-private content and history; it is not physical deletion. Republish requires a fresh preview and explicit confirmation.
- Generation failure keeps `status="DRAFT"`, sets `generationStatus="FAILED"`, shows the owner a generic failure, and lets them create a new signal with the same seed. Failed rows are not public.

## SIG-003 Detail visibility

`GET /api/signals/:id` returns different shapes by owner and status:

| Row state | Owner | Non-owner / anonymous |
| --- | --- | --- |
| Generating | `SignalGenerationDetail` (200) | 404 `NOT_FOUND` |
| Completed private, withdrawn, or unconfirmed row | `OwnerSignalDetail`, `visibility=PRIVATE_OWNER` (200) | 404 `NOT_FOUND` |
| Confirmed, completed, non-withdrawn `PUBLISHED` | `OwnerSignalDetail` (200) | `PublicSignalDetail`, `visibility=PUBLIC` (200) |
| `REVIEWING`, with or without withdrawal | `OwnerSignalDetail` after completion; generation detail while unfinished (200) | 404 `NOT_FOUND`, with no existence/review metadata |
| `HIDDEN` / `DELETED` / unknown | 404 `NOT_FOUND` | 404 `NOT_FOUND` |

- Owner match is by `authorId ?? frequencyId` against the authenticated non-banned frequency. Owner responses include current publication actions; unfinished responses remain generation details. Every reviewing row is invisible to non-owners.
- **Historical observation:** the A2 baseline returned `ReviewingSignalRestrictedDetail` (200) with id, review status, `REVIEW_RESTRICTED` and timestamps. This is not the approved target; the legacy DTO/client compatibility branch does not authorize continued public exposure.
- REVIEWING is 404 for anonymous visitors and every non-owner, without target id, status, timestamps, existence or review metadata. Owners may see their own review status. Administrators use appropriately authorized internal interfaces; their role does not bypass ordinary public-detail restrictions. The [C1 supplemental fix](../../docs/implementation/c1-reviewing-20261101.md) records local route validation and remaining verification limits; it is separate from docs-only PR #3 and does not establish production deployment.
- Public result, Hall/random, match, galaxy, save, resonance, audio, metadata, and share-card surfaces require current public eligibility and use only the confirmed snapshot whitelist. Neither raw Seed nor full fingerprint/program is part of `PublicSignalDetail`. Version/visibility is rechecked after asynchronous work; stale artifacts cannot restore withdrawn content.
- Each public response shape must allow only author-confirmed final text, FM display code, explicitly approved display tags, and minimal functional metadata. Original `seedText/rawInput`, complete analysis/fingerprint/frequency profile, sensitive inferred attributes, and internal `frequencyId/guestKey` must not escape via program, shareQuote, summaries, matching, discovery, SSR/metadata or media. Semantic matching and Galaxy classification stay server-side. See [A3 public-response rules](../../docs/data-lifecycle.md#决定-2作者点击发布时究竟同意公开哪些内容); E4's newer preview restrictions and historical confirmed snapshots retain their separate contracts.
- Web result pages must forward the incoming cookie when server-rendering `/result/:id`, otherwise the owner is treated as anonymous.

## SIG-004 Matching and embedding

- Same-frequency matching is optional during creation; a matching failure degrades to an empty `matches` array and no `matchSignalId` after completion — it must never abort creation.
- Matching merges semantic and rule candidates, isolates vectors by the recorded embedding space, and uses the normalized score contract. Incomplete/invalid reranker batches fall back as a whole. Candidates must be currently confirmed public, human-initiated, and owned; the originating author, current visitor, system AI, and seed/demo candidates are excluded. Weak results remain empty rather than being filled with examples. See [E2](../../docs/implementation/e2-rerank-scores-20261030.md) and [E3](../../docs/implementation/e3-match-recall-20261030.md).
- The compatibility source enum still includes `PUBLISHED | SEEDED | FALLBACK`; current public discovery emits only eligible `PUBLISHED` matches. Enum membership is not permission to restore seeded discovery.
- Creation/explicit write jobs can persist embeddings after completion; pending placeholders must not be embedded. Public GET matching uses the confirmed body and an existing compatible vector when available, performs no Provider dispatch or backfill, and rechecks candidate publication versions before returning.
- Embedding/reranker failure degrades to eligible rule candidates or an empty result; it does not authorize fake matches or publicize private rows.

## SIG-005 Audio

- `audioStatus`: `NOT_REQUESTED → PENDING → READY | FAILED`. Audio is never required for signal creation.
- `GET /api/signals/:id/audio` is read-only and must not start TTS. `POST /api/signals/:id/audio` starts or reuses TTS for `expandedText` (not `seedText` unless an explicit fallback reason is stored).
- Playback must be click/tap initiated — never autoplay. TTS provider failure returns `audio.status="FAILED"` and leaves the text usable.
- Audio files are stored and served by the API service; the API container must not write into the Web `public/` directory.

## Non-goals

- No synchronous wait for AI completion before responding to emission.
- No public exposure of `DRAFT`, `REVIEWING`, `HIDDEN`, `DELETED`, generating, or preview rows.
- No risk-radar, translation, or program DTOs from `POST /api/signals`.
