# Main isolated acceptance — 2026-11-06

Baseline: main `a831b2ea5f2c279471312e7e4d5816013068fe2b` after PR #32.
The follow-up changes cover the defects found during this acceptance. PR #28
remains independent; the scheduler stays disabled.

## Environment and boundaries

- Production-built Next Web, compiled real Fastify API, fresh migrated PostgreSQL
  and Redis. Test services bind to loopback and belong to unique Compose projects.
- API test mode supports local HTTP cookies. This does not establish acceptance
  of production HTTPS, a deployed reverse proxy, real credentials or real models.
- Start without any Provider: expansion remains failed after bounded retries,
  as designed. Fingerprint/analysis fallbacks do not imply offline prose generation.
- The successful generation path uses the repository's synthetic HTTP Provider
  on an ephemeral loopback port. The interactive session strips inherited service
  credentials and rejects API fetches to every other origin, including redirects.
  Embedding, reranker and remote TTS stay disabled. No paid Provider is enabled.
- Only disposable synthetic accounts, seeds and reports are used. No production
  service, historical record or retention policy is changed.

## Observed behavior

Agent-driven browser checks covered registration and frequency-code confirmation,
short-input rejection, private generation preview, explicit publication, anonymous
reading, copying the public link, login return-to, resonance, saved signals,
private report receipts, a second author's public discovery candidate, Galaxy
list reading and Escape focus restoration. Before publication and after withdrawal,
the independent reader receives 404. Public content excludes the private seed and
analysis fields. Synthetic text establishes workflow behavior only.

## Defects and regression coverage

1. The real administration UI could read its report queue but could not resolve
   a report across the Web/API origins. Its PATCH preflight only advertised
   `GET,HEAD,POST`, the CORS plugin default. Explicitly advertise the application's
   existing PUT/PATCH/DELETE methods while retaining the configured Web origin,
   credentials policy and route authentication. New app tests fail on the baseline
   for all three methods and preserve the unauthorized-mutation boundary. The real
   browser journey now submits a report, dismisses it through the actual admin UI,
   refreshes the reporter's receipt and checks that internal notes remain private.
2. Tailwind's margin reset placed the native report dialog at `(0,0)` on a
   390×844 viewport. Restore `margin: auto`. Browser regression checks the form and
   receipt geometry, viewport bounds and centering, including an 844×390 viewport,
   alongside the existing focus trap and Escape behavior. The new geometry check
   fails on the baseline with x=0.
3. Deployment documentation incorrectly suggested that an empty AI configuration
   provides local expansion. Clarify that expansion needs a working Provider and
   describe the loopback synthetic fixture boundary without changing that contract.

## Evidence

Local build/check logs, before-fix failures, screenshots and interactive session
manifests are under ignored `test-results/pilot-local/`. Managed integration
manifests, per-case cleanup evidence and real-browser traces are generated under
`test-results/integration/`. The follow-up PR records executed check results and
links its exact-head CI. Successful cleanup requires all owned children and Compose
resources to be gone; attempted cleanup alone is not a passing result.

Issue #7 now tracks exit conditions for the remaining postgres.js 4.0.0 two-file
lifecycle patch. The patch remains installed and Issue #7 remains open. This
acceptance does not establish its upstream retirement conditions.
