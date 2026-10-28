# Core Signal Chain Map

Short map of the current Unfreq signal path. Use this before changing signal,
galaxy, audio, resonance, or my-frequency behavior.

## Current Core Flow

```text
Home seed
  -> Web createSignal()
  -> POST /api/signals
  -> createPendingSignal()
  -> persist DRAFT signal with generation_status=RECEIVED
  -> navigate /signal/:id/transmitting
  -> background AI material generation
  -> generation_status EXPANDING -> MATCHING -> WRITING
  -> final status decision on the same row
  -> update to generation_status=COMPLETED and DRAFT preview or REVIEWING
  -> write initial galaxy position
  -> queue embedding write
  -> transmitting page redirects to /result/:id
  -> owner confirms publish
  -> update status=PUBLISHED
  -> result / galaxy / my-frequency public surfaces
```

`POST /api/signals` is the normal home path. It returns a stable signal id
before AI generation finishes. The row starts as `status=DRAFT` and
`generation_status=RECEIVED`; generation updates the same row until it reaches
`COMPLETED` or `FAILED`. Low/medium-risk completed rows stay as private owner
previews until `POST /api/signals/:id/publish` confirms publication. The old
`POST /api/signals/generate` path is not registered in the current product API.

## Frontend Entrypoints

- `apps/web/src/components/signals/HomeFrequencyEntry.tsx`
  - Takes the seed text, calls `createSignal()`, then routes to
    `/signal/:id/transmitting`.
- `apps/web/src/app/signal/[id]/transmitting/page.tsx`
  - Reads `GET /api/signals/:id` with cookies. Completed signals redirect to
    `/result/:id`; generating rows render the transmitting client.
- `apps/web/src/components/signals/SignalTransmittingClient.tsx`
  - Polls `GET /api/signals/:id`, renders `RECEIVED`, `EXPANDING`,
    `MATCHING`, `WRITING`, `FAILED`, and redirects on completion. Failed rows
    can be retried by creating a new signal with the same seed.
- `apps/web/src/lib/signal-data.ts`
  - Owns typed Web calls for normal signal create, detail, galaxy, audio,
    resonance, save, my signals, echo summary, saved signals, and monthly
    recaps.
- `apps/web/src/app/result/[id]/page.tsx`
  - Reads `GET /api/signals/:id` with cookies. Private owner previews render
    seed, expanded signal, and the confirm-publish action only. Published
    signals render seed, expanded signal, Top 3 same-frequency matches,
    playback, resonance, save, share card, and follow-up. Reviewing owner access
    renders only the saved seed and review status. Reviewing non-owner access
    renders a restricted "temporarily not public" state. Generating rows
    redirect back to the transmitting page.
- `apps/web/src/components/signals/SignalPublishButton.tsx`
  - Calls `publishSignal()` and refreshes the result page after the backend
    returns a `PUBLISHED` signal detail.
- `apps/web/src/app/galaxy/page.tsx`
  - Reads `GET /api/signals/galaxy?band=...` with cookies so `isMine` can be
    computed by the API.
- `apps/web/src/components/galaxy/GalaxyCanvas.tsx`
  - Renders the returned galaxy points, `matchIds`, filter bands, playback,
    resonance, and save actions. It does not compute embeddings or matches.
- `apps/web/src/app/me/page.tsx`
  - Reads `/api/me`, `/api/me/signals`, `/api/me/echo-summary`,
    `/api/me/saves`, and recap endpoints for the my-frequency ledger.
- `apps/web/src/app/api/og/[signalId]/route.tsx`
  - Reads public signal detail through `getSignal()` and renders a share PNG.
    Reviewing restricted signals do not get share images.

## Backend Routes

- `apps/api/src/app.ts`
  - Registers `signalRoutes` at `/api/signals`, `meRoutes` at `/api`,
    `monthlyRecapRoutes` at `/api/me/recaps`, plus current admin, report,
    image, theme-radio, auth, frequency, health, and diagnostic routes.
- `apps/api/src/modules/signals/routes.ts`
  - Validates request params/body/query and delegates to signal services.

Core signal routes:

```text
POST   /api/signals
POST   /api/signals/:id/publish
GET    /api/signals/:id
GET    /api/signals/:id/matches
GET    /api/signals/galaxy?band=<signal_primary_band>
GET    /api/signals/random
POST   /api/signals/:id/resonance
DELETE /api/signals/:id/resonance
POST   /api/signals/:id/save
DELETE /api/signals/:id/save
GET    /api/signals/:id/audio
POST   /api/signals/:id/audio
GET    /api/signals/:id/audio/:side
GET    /api/me/signals
GET    /api/me/echo-summary
POST   /api/me/echo-summary/seen
GET    /api/me/saves
GET    /api/me/recaps/latest
POST   /api/me/recaps
GET    /api/me/recaps/:yearMonth
```

## Backend Ownership

- `apps/api/src/modules/signals/service.ts`
  - Public export facade. Routes and admin code still import from this stable
    surface.
- `apps/api/src/modules/signals/service-creation.ts`
  - Owns `createPendingSignal()` for homepage emission and
    `createPublishedSignal()` for synchronous internal generation paths.
    Pending homepage emission writes a placeholder row first, then completes
    the same row in the process-local background runner. Low/medium-risk
    homepage completion resolves to a private `DRAFT` preview, not public
    `PUBLISHED`.
- `apps/api/src/modules/signals/service-publishing.ts`
  - Owns owner publish confirmation. It requires an active frequency, ownership,
    completed generation, and `DRAFT` or already `PUBLISHED` status.
- `apps/api/src/modules/ai/service.ts`
  - Provides fingerprint, intent analysis, expansion, review, generated content,
    and quality scoring wrappers.
- `apps/api/src/modules/ai/provider.ts`
  - Owns provider prompts and provider-call payloads.
- `apps/api/src/modules/signals/service-matching.ts`
  - Combines embedding recall and keyword/profile fallback matching.
- `apps/api/src/modules/signals/service-embedding.ts`
  - Builds embedding text, queues embedding writes, and writes initial/fallback
    finite galaxy positions.
- `apps/api/src/modules/signals/service-queries.ts`
  - Owns signal detail, match detail, galaxy response, random signal,
    my-frequency signals, saves, and echo summary reads.
- `apps/api/src/modules/signals/service-audio.ts`
  - Owns on-demand TTS state: `NOT_REQUESTED -> PENDING -> READY|FAILED`.
- `apps/api/src/modules/signals/service-interactions.ts`
  - Owns resonance, save, echo, and demo/persona interaction helpers.
- `apps/api/src/modules/signals/service-generated.ts`
  - Owns AI-generated seed library and scheduled/demo AI signal generation.
- `apps/api/src/modules/signals/repository.ts`
  - Owns Drizzle reads/writes for signals, embedding metadata, galaxy position,
    audio state, resonance, echoes, saves, my-frequency summaries, and recaps.
- `apps/api/src/modules/monthly-recaps/service.ts`
  - Generates and reads stored monthly recap summaries for `/me`.

## Data State

```text
seedText
  -> generationStatus
  -> expandedText
  -> fingerprint + frequencyProfile
  -> optional matches + matchSignalId
  -> completed private preview
  -> owner publish
  -> public signal row
  -> galaxyPosition
  -> embedding metadata/vector
  -> result/galaxy/my-frequency DTOs
```

Important persisted signal fields live in `signals`: `seed_text`,
`generation_status`, `generation_error`, `expanded_text`, `primary_band`,
`sub_feeling`, `resonance_keywords`,
`follow_up_question`, `parent_signal_id`, `match_signal_id`, `galaxy_position`,
`embedding`, `audio_status`, `resonance_count`, `source`, and `status`.

## Current vs Legacy Boundary

Current core surfaces are seed emission, result reading, same-frequency matches,
on-demand audio, resonance, saves, galaxy, share card, my frequency, recaps, and
theme-radio day hints.

Legacy product routes are not registered by default:

```text
/api/channels
/api/voices
/api/bottles
/api/translate
/api/radio-report
/api/ai
```

Legacy Web route shells, clients, component groups, and compatibility DTO
barrels have been removed from the default product surface:

```text
apps/web/src/app/channels
apps/web/src/app/voices
apps/web/src/app/bottles
apps/web/src/app/translate
apps/web/src/app/broadcast
apps/web/src/app/signal/new
apps/web/src/app/signals
apps/web/src/lib/channel-data.ts
apps/web/src/lib/bottle-data.ts
apps/web/src/lib/translate-data.ts
apps/web/src/lib/radio-report-data.ts
apps/web/src/types/legacy.ts
apps/web/src/types/product.ts
```

`apps/web/src/types/core.ts` is the current product DTO source. Historical
database tables and old enum values may still exist for migration continuity,
but they are outside the current runtime product boundary.

## Useful Checks

- Run `npm --workspace @unfreq/api run test -- src/modules/signals/service.test.ts src/modules/signals/routes.test.ts`.
- Run `npm run check` before completing cross-layer signal changes.
- Search logs for `signal.generation.queued`, `signal.generation.completed`,
  `signal.generation.failed`,
  `signal.expansion.failed`, `signal.expansion.review_failed`,
  `signal.embedding.write`, `signal.galaxy_position.write`,
  `signal.publish.confirm`, `signal.audio.request`, and `signal.audio.generate`.
- Check API errors for `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
  `AI_UNAVAILABLE`, `VALIDATION_ERROR`, and `CONFLICT`.

## Known Pitfalls

- Missing or guest session returns auth errors before AI work starts.
- Non-`ACTIVE` frequency cannot publish, resonate, save, or generate recaps.
- Core signal expansion must be model-backed. If provider expansion is
  unavailable or fails review after rewrite, the API surfaces `AI_UNAVAILABLE`.
- Signals with high-risk fingerprints complete as `REVIEWING`; the transmitting
  page then redirects to the result page, which renders either the owner review
  state or restricted non-owner state.
- Signals with low/medium-risk fingerprints complete as `DRAFT` plus
  `generation_status=COMPLETED`. Only the owner result page can read this
  preview. Public list, random, galaxy, match, save, resonance, and share-card
  paths must still filter it out until publish.
- Generating and failed rows are `DRAFT` plus `generation_status != COMPLETED`.
  Only the owner detail path can read them. Public list, random, galaxy, match,
  save, resonance, share-card, and `/me` history paths must not expose them.
- The current generation runner is process-local. A server restart during
  generation can leave a row in a non-terminal generation status until a future
  worker/recovery task handles it.
- Missing embedding must not hide a signal. Missing or invalid galaxy position
  gets a stable finite fallback and a best-effort write-back.
- Matching failures must not block normal signal creation. Result pages can read
  current matches through `GET /api/signals/:id/matches`.
- TTS is click-triggered only. Failed audio keeps text readable and marks
  `audio_status=FAILED`.
