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

- Provider `expandedText` is 80–180 Chinese characters and preserves the Seed direction. Scene modes require concrete evidence; `aftertaste` and `clarify_thought` may preserve imagery or clarify a thought without inventing objects/sensory detail. Schema and review share the mode rules, and failed review enters the bounded rewrite/review path rather than being converted to a pass because of a high score.
- It must not become relationship advice, therapy, diagnosis, or risk scoring, and must not mention signal, frequency, resonance, FM, radio, galaxy, star map, strangers, being seen, being understood, healing, or the universe.
- Expansion input is only `seedText`, structured seed classification, and an optional rewrite instruction. It must not include fingerprint, frequency profile, risk labels, or product-world metadata.
- Provider failure returns a deterministic fallback in the same DTO shape.

## AI-003 Frequency profile normalization

- Fingerprint output normalizes to exactly one fixed `primaryBand` and one `subFeeling` from the closed enums. If the provider returns a valid pair that does not belong together, keep the primary band and choose the closest allowed sub-feeling under that band.
- Owner-private signal responses return a complete current `fingerprint` DTO and `frequencyProfile`, even when stored `signals.fingerprint_json` is legacy or partial — normalize from DB columns via `normalizeSignalFrequencyProfile` / `getSignalResponseFingerprint`; never pass raw `fingerprint_json` through the route schema. Public responses expose only the confirmed body, FM alias, and allowed labels, never this full analysis.
- `resonanceKeywords` are 1–3 semantic hints, never a formal tag taxonomy.
- Bands: `self_mirror`, `emotional_undercurrent`, `relationship_nebula`, `time_ring`, `meaning_deep_space`, `stagnant_orbit`, `era_cluster`.
- These fixed labels and fallback psychological fields are not validated psychological findings. E4's unknown/non-display path and real-model/human evaluation remain open; do not describe the current forced-choice normalization as a resolved fidelity issue. See [E4 limits](../../docs/implementation/e4-faithfulness-20261031.md).

## AI-004 Provider configuration

- Provider configs cover kinds `chat | embedding | tts | reranker`, with `provider`, `model`, `baseUrl`, `isEnabled`, `priority`, `source: database | environment`, `status`, `keyState`, `apiKeyLast4?`, `extraJson`.
- Admin API keys are **write-only**: forms may display `apiKeyLast4` and `keyState` but never receive the full key back.
- Rows with `source=environment` have no `id`; saving them creates a database backup row via `POST` rather than overwriting a database row. Environment rows may display `priority=1000`, but Web must never send that value back; the form submits a writable priority in `1..999`.
- Embedding dimensions/version map to `extraJson.dimensions` / `extraJson.version`; TTS voices map to `extraJson.voiceLeft` / `extraJson.voiceRight`.

## AI-005 Generated and seed content

- `signals.source` is `human | ai_generated | seed`. `human` means human-initiated and may contain AI-assisted expansion; system AI and seed content must retain their actual source. Internal generation runs fingerprint, expansion, matching, positioning, and embedding work, but does not itself prove public eligibility or initiate public audio playback.
- `generateSignalContentWithFallback` creates 30–100 Chinese characters from a fixed persona; `scoreSignalQualityWithFallback` runs before insert. Score below 3 is discarded with at most 3 attempts per requested signal.
- Internal AI generation still stores accepted rows with historical status `PUBLISHED` and `source='ai_generated'`; without an author, confirmation snapshot, and public version they remain nonpublic under C1. Seed initialization uses fixed script/module inputs, skips existing raw inputs, and assigns its fixed quality record; this is not independent human quality validation. Neither path may bulk-fill confirmation snapshots or claim public human participation.
- Admin generate `count` is optional and clamped to `1..10` (omitted → `5..10`); the generator cycles personas when count exceeds the persona count.
- Fixed personas are internal content-generation inputs. They do not establish registered FM accounts or evidence of real people interacting.

## AI-006 Internal interactions and daily scheduling

- `generateSignalInteractions` / `scheduleSignalInteractions` remain exported legacy helpers, but current publication, generation, routes, and `buildApp()` do not call them. Their timer code is frozen; do not claim automatic AI resonance/echoes are a connected product feature or invoke them to fabricate participation. Restoring them requires a separate product, provenance, lifecycle, and recovery decision.
- The separate daily system-AI scheduler is registered in `buildApp()` but disabled by default. Explicit enablement uses a configured business time zone, persistent one-batch-per-day claim, owner token, deadline, and signal/Provider-dispatch budgets; a claimed day's uncertain batch is not blindly repeated. It does not schedule the legacy interaction helper.
- Scheduler shutdown cancels and drains work before database closure. Local synthetic tests do not authorize a production enablement or paid Provider calls. See [F1 scheduler controls](../../docs/implementation/f1-identity-scheduler-20261031.md).

## Non-goals

- No browser-side provider calls, no raw provider output stored or returned, and no treating quality scoring or a stored `PUBLISHED` status as author confirmation.
- No seed rows created inside migrations.
