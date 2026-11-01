---
id: ai.content
applies_to:
  - apps/api/src/modules/ai/**
  - apps/api/src/config/**
  - apps/api/src/scripts/**
  - apps/api/src/modules/signals/service-creation.ts
tags:
  - ai
  - content
  - moderation
---

# AI Orchestration and Generated Content

## AI-001 Server-side orchestration

- The browser never calls an AI provider. Provider keys, prompts, schemas, fallbacks, and review policy live in `apps/api/src/modules/ai` and the signal creation service.
- The pipeline turns a seed into controlled tasks: `classification` (input type / expansion boundary), `fingerprint` (primary band, sub-feeling, core need, inner conflict), `expansion` (expanded signal), `review` (off-topic / templated / over-fabricated check), `matching`.
- AI output is structurally parsed and validated before storage — provider raw output never lands in `fingerprint_json` or `program_json`.
- AI is bounded to expression organizing and semantic extraction: not a free-form chatbot and not a psychological diagnosis system.

## AI-002 Expansion rules

- `expandedText` is an 80–180 Chinese-character concrete scene when provider output is available; it preserves the seed direction and adds concrete objects, visible action, and sensory detail.
- It must not become relationship advice, therapy, diagnosis, or risk scoring, and must not mention signal, frequency, resonance, FM, radio, galaxy, star map, strangers, being seen, being understood, healing, or the universe.
- Expansion input is only `seedText`, structured seed classification, and an optional rewrite instruction. It must not include fingerprint, frequency profile, risk labels, or product-world metadata.
- Provider failure returns a deterministic fallback in the same DTO shape.

## AI-003 Frequency profile normalization

- Fingerprint output normalizes to exactly one fixed `primaryBand` and one `subFeeling` from the closed enums. If the provider returns a valid pair that does not belong together, keep the primary band and choose the closest allowed sub-feeling under that band.
- **Baseline observation:** the A2 response mapper normalizes legacy or partial `signals.fingerprint_json` from DB columns via `normalizeSignalFrequencyProfile` / `getSignalResponseFingerprint`, returning a complete `fingerprint` DTO and `frequencyProfile`. This describes the old mapper and does not approve those complete objects in public responses.
- **Approved A3 target, pending subsequent implementation:** complete normalized analysis may remain in owner-private responses or explicitly authorized internal processing; never pass raw `fingerprint_json` through route schemas. Public responses must instead use per-shape allowlists of author-confirmed final text, FM display code, explicitly approved display tags and minimal functional metadata. Do not expose `seedText/rawInput`, complete fingerprint/profile, `coreNeed/innerConflict/emotionTone`, or internal `frequencyId/guestKey`, including through program, shareQuote, summaries, matching, Galaxy, Hall, OG, SSR/metadata or media. Semantic matching and Galaxy classification stay server-side; they do not require complete analysis to be public. See [A3 requirements](../../docs/data-lifecycle.md#决定-2作者点击发布时究竟同意公开哪些内容); this PR changes documentation only.
- `resonanceKeywords` are 1–3 semantic hints, never a formal tag taxonomy.
- Bands: `self_mirror`, `emotional_undercurrent`, `relationship_nebula`, `time_ring`, `meaning_deep_space`, `stagnant_orbit`, `era_cluster`.

## AI-004 Provider configuration

- Provider configs cover kinds `chat | embedding | tts | reranker`, with `provider`, `model`, `baseUrl`, `isEnabled`, `priority`, `source: database | environment`, `status`, `keyState`, `apiKeyLast4?`, `extraJson`.
- Admin API keys are **write-only**: forms may display `apiKeyLast4` and `keyState` but never receive the full key back.
- Rows with `source=environment` have no `id`; saving them creates a database backup row via `POST` rather than overwriting a database row. Environment rows may display `priority=1000`, but Web must never send that value back; the form submits a writable priority in `1..999`.
- Embedding dimensions/version map to `extraJson.dimensions` / `extraJson.version`; TTS voices map to `extraJson.voiceLeft` / `extraJson.voiceRight`.

## AI-005 Generated and seed content

- `signals.source` is `human | ai_generated | seed`; only human content may be labelled human. Generated/seed rows run the same fingerprint, program, match, audio, and embedding flow.
- `generateSignalContentWithFallback` creates 30–100 Chinese characters from a fixed persona; `scoreSignalQualityWithFallback` runs before insert. Score below 3 is discarded with at most 3 attempts per requested signal.
- Accepted AI signals are stored `PUBLISHED` with `source='ai_generated'`. Seed initialization uses `source='seed'` with a stricter threshold of 4 and skips existing raw inputs; seed data lives in a script/module, never in migrations.
- Admin generate `count` is optional and clamped to `1..10` (omitted → `5..10`); the generator cycles personas when count exceeds the persona count.
- Persona identity uses stable keys `ai-persona:<persona.id>`.

## AI-006 AI interactions and scheduling

- Publishing or generating a `PUBLISHED` signal schedules AI interactions: production starts after 5 minutes and spreads 2–5 resonances plus 1–2 echoes across a 24-hour window; development may use short delays.
- Echoes are 30–50 characters and only express resonance or empathy — they must not give advice.
- In-process timers must be cleared on Fastify `onClose` and skipped when `NODE_ENV=test`, and must live behind a replaceable scheduler module. Do **not** claim at-least-once delivery: a process restart may lose scheduled interactions until a durable worker replaces it.

## Non-goals

- No browser-side provider calls, no raw provider output stored or returned, no automatic publishing without quality scoring.
- No seed rows created inside migrations.
