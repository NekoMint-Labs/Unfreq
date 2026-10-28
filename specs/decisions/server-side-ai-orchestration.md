# AI is orchestrated server-side with validated output and fallbacks

## Context

The product's core value is turning a one-line seed into a structured micro-monologue plus a frequency fingerprint. Provider keys, prompts, and moderation policy are sensitive, and AI calls can fail or return malformed output.

## Decision

The backend owns all AI work (`apps/api/src/modules/ai`, called from the signal creation service). The browser never calls a provider. Output is parsed as structured JSON against a schema before storage, and any provider failure returns a deterministic fallback in the same DTO shape. AI is bounded to expression organizing and semantic extraction — not a chatbot, not diagnosis.

## Why

- Provider keys and prompt control must not reach the browser or a mobile client.
- Structured validation prevents raw provider text from being stored or published, and keeps the DTO stable when a provider misbehaves.
- Deterministic fallbacks let local demos and degraded deployments keep the whole loop working (`npm run check`, no AI key needed).

## Revisit when

A provider capability genuinely cannot be expressed as a bounded, validated task. Even then it must keep server-side keys, schema-validated output, and a fallback path — an unbounded passthrough would change the product's trust model.
