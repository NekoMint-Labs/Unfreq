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

- Existing `primaryBand` / `subFeeling` enum values remain for storage compatibility. Provider output is still parsed against the closed options, including pair normalization; this does not establish psychological validity or resolve forced-choice classification quality.
- Optional `interpretation` metadata has version 1 and only the pairs `unknown/rules`, `unknown/unknown`, or `unverified/provider`. Missing or malformed legacy metadata fails closed to unknown. The service attaches actual execution attribution after parsing; model-supplied source or validation claims cannot certify the result.
- `canReferenceSignalInterpretation` permits attributed Provider output as unverified algorithm input. `canDisplaySignalInterpretation` is false for every current state; there is no verified display state. Author panels suppress psychological titles, labels, needs/conflicts, energy/openness percentages, and tags; personal frequency summaries do not aggregate them into personal claims.
- Owner-private signal responses retain the complete current `fingerprint` / `frequencyProfile` DTO shape. Unknown results project neutral text and empty labels/keywords through `normalizeSignalFrequencyProfile` / `getSignalResponseFingerprint`; enum compatibility is not permission to display or award similarity for shared defaults. Unverified Provider fields may remain algorithm inputs but cannot enable UI display. Response `resonanceKeywords` allow 0–3 hints; unknown results use an empty array.
- New publication previews contain the body, FM alias, and an empty tags array, omitting `primaryBand`. Existing `AUTHOR_CONFIRMED` snapshots, digests, versions, and whitelist projections remain unchanged, including previously confirmed labels. Public responses never expose the full private analysis.
- Bands: `self_mirror`, `emotional_undercurrent`, `relationship_nebula`, `time_ring`, `meaning_deep_space`, `stagnant_orbit`, `era_cluster`.
- New monthly-recap input uses the original expression, generated body, and observed resonance count, excluding fingerprint psychological labels. Rule fallback summaries are neutral. Recap cards and details identify automatic summaries as potentially inaccurate; saved text is retained. Existing recap records have no per-record Provider/rules provenance, so do not invent a specific actual source for historical summaries.
- These controls do not validate model-generated bodies/recaps or establish author approval. Real-model output, independent human evaluation, matching calibration, and fidelity remain pending. See [E4 follow-up and evidence limits](../../docs/implementation/e4-unknown-interpretation-20261101.md) and the [evaluation workflow](../../docs/faithfulness-evaluation.md).

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
