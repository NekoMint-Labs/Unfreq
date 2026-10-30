---
id: signal.engagement
applies_to:
  - apps/api/src/modules/signals/**
  - apps/api/src/modules/monthly-recaps/**
  - apps/api/src/modules/theme-radio/**
  - packages/contracts/src/signals.ts
  - packages/contracts/src/theme-radio.ts
  - apps/web/src/app/galaxy/**
  - apps/web/src/app/me/**
  - apps/web/src/components/galaxy/**
  - apps/web/src/components/my-frequency/**
tags:
  - galaxy
  - resonance
  - recap
---

# Engagement: Resonance, Galaxy, and Memory

## ENG-001 Resonance

- `POST /api/signals/:id/resonance` and its compatibility alias `POST /api/signals/:id/resonate` create a resonance; `DELETE /api/signals/:id/resonance` removes it. All return `{ resonance: { hasResonated, resonanceCount } }`.
- The pair `(signal_id, actor_key)` is unique. Repeated create and repeated delete are idempotent and must not double-count; the count is updated inside a transaction with the unique actor record.
- When a session frequency exists the server uses it; otherwise `actor_key`/`guestKey` is required (400 `VALIDATION_ERROR` when missing).

## ENG-002 Save

- `POST` / `DELETE /api/signals/:id/save` return `{ save: { hasSaved } }`, require a frequency session, work only for `PUBLISHED` signals, and are idempotent on the unique `(frequency_id, signal_id)` pair.
- Saving never notifies the signal author. `GET /api/me/saves` is private to the frequency, ordered by save time, and filters to `PUBLISHED`.
- Save UI may optimistically reflect only the returned `hasSaved` and must show a failure state instead of inventing notifications.

## ENG-003 Galaxy

- `GET /api/signals/galaxy?band=<signal_primary_band>&focus=<signal_uuid>` returns `{ points, bandOptions, generatedAt, themeOptions, coverage }` and filters to confirmed, completed, non-withdrawn public points by the fixed primary band. `bandOptions` always contains the fixed seven primary bands. `focus` is optional, canonicalized and subject to the same visibility/filter conditions.
- The API samples at most 80 points using versioned `recent-band-v1`: eligible focus and latest own first, then recent expressions plus deterministic band diversity. `coverage` distinguishes validated total count from returned samples, echoes the effective filter, and includes only visible focus/latest-own IDs. Mobile renders at most 72 points and preserves selected/latest-own points; the optional list contains the same returned sample, never a larger private dataset.
- Coordinates must be finite numbers; the frontend may normalize them for camera framing but must not compute embedding or semantic layout. The galaxy route must not call AI/embedding/reranker providers just to draw links.
- `matchIds` reference published ids already present in the same response; clients ignore missing ids rather than fetching or computing matches locally.
- Positions are artistic, and distance does not measure semantic similarity. The visible legend distinguishes selectable public expressions from decorative background stars. Links represent rule candidates within the current sample, subject to rendering budgets and visual selection; they do not represent personal relationships. Band/own colors and mixed resonance/depth/decorative brightness or size must not imply a similarity score or ranking.
- The reading panel explains rule candidates using only IDs already in the returned sample. It deduplicates incoming and outgoing records and distinguishes candidate count from drawn link count; zero records remain an explicit zero, without invented reasons or percentages.
- The API may return an empty `points` array; the frontend must render a truthful empty state. Legacy `theme` queries map known display labels to confirmed primary bands; new clients use the public `primaryBand` and confirmed tags, never private `frequencyProfile`. `themeOptions` is for older clients only and must not drive new UI.
- `/galaxy` is a full-bleed 3D view.
- The same bounded public sample has an optional DOM list supporting keyboard selection and reading actions. Closing the native reading dialog restores its trigger (canvas/focus-link selections use the list toggle). The dialog has a labelled heading, contained Tab navigation and Escape handling; nested report dismissal preserves the reader.
- Disabling graphics, failed WebGL2 support checks and context loss keep the sample readable through the list. Reduced-motion preferences update live, disabling automatic rotation, twinkle, camera easing and reader translation while keeping direct controls. This does not change authorization, sampling or matching.

## ENG-004 Random tuning

`GET /api/signals/random` filters out the current frequency's own published signals when another published signal is available.

## ENG-005 Echo summary (return-visit)

- `GET /api/me/echo-summary` returns `{ frequencyId, newResonanceCount, totalResonanceCount, since?, topSignal? }`.
- If there is no persisted `lastSeenAt`, `since` is omitted and `newResonanceCount` must be `0` — never reuse `totalResonanceCount` as a fake new count.
- `POST /api/me/echo-summary/seen` advances the watermark after the summary is seen or dismissed. It must not create fake counts; a later `GET` counts only resonances after the new watermark.
- Frontend may compare `totalResonanceCount` with a browser-local previously-seen total for the same `frequencyId`, but that derived prompt is UI-local and must never be sent back as API truth.

## ENG-006 Monthly recap

- `GET /api/me/recaps/latest` returns `{ recap? }` (empty object when none); `GET /api/me/recaps/:yearMonth` returns 404 when missing; `POST /api/me/recaps` accepts optional `{ yearMonth }` and defaults to the previous UTC month.
- Generation requires at least 3 `PUBLISHED` signals owned by the frequency in that month and upserts by `(frequency_id, year_month)`.
- The AI recap returns 1–3 theme words and a summary under 100 chars; provider failure uses a deterministic fallback with no medical, psychological, personality, or exaggerated claims.
- `/me` treats a missing recap as a real empty state and never fabricates a report from local data.

## ENG-007 Theme radio

- `GET /api/theme-radio/current` returns `{ themeRadioDay? }`; selection filters `is_active=true`, `starts_at <= now`, and `ends_at IS NULL OR ends_at > now`, ordered by newest `starts_at`. Only admins can list/create theme radio days.
- Theme radio is a light galaxy hint (linking to `/galaxy?theme=<theme>`), not a hot-topic feed, ranking, or recommendation list. It must not create rankings or author notifications.

## ENG-008 Share card

- Share-card preview data derives from public signal detail: `{ signalId, imageUrl, frequencyCode, expandedText }`.
- The Web-owned endpoint `/api/og/:signalId` reuses the public detail contract, returns PNG for `PUBLISHED` signals, and returns 404 when the public detail is 404 or a preview/generation variant. Card images must not expose raw database ids beyond public signal ids already in routes.
