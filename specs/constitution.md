# Unfreq Constitution

Repo-wide rules already established by the code, contracts, and explicit decisions.

## Product boundary

- Unfreq is anonymous thought resonance: `seed → pending signal → AI micro-monologue → private preview → owner publish → same-frequency matches → resonance → galaxy`.
- It is **not** a psychological diagnosis tool, a traditional forum, or a general chatbot. AI is an expression-organizing and semantic-extraction tool with server-side orchestration, structured output, and fallbacks.
- Product language is `frequency` / `seed` / `signal` / `resonance` / `galaxy`. Visible UI must not use 用户 / 帖子 / 评论 / 点赞 / 版块 / 个人主页, and new core UI must not use voice / bottle / channel-hall / risk-radar / translation copy.
- No likes, comments, follows, private messages, hot rankings, or feed-style community APIs in the core loop.

## Architecture

- `apps/web` (Next.js App Router) + `apps/api` (Fastify JSON API) + `packages/contracts` (shared DTOs) in one npm-workspace repository. Web is the first client; Android must be able to reuse the same JSON API, so no feature may exist only as a Next.js server action or a database write path.
- PostgreSQL (Drizzle + pgvector) is the primary store; Redis holds session, cache, and queue state only — losing Redis must not destroy primary data.
- Deployment is Docker Compose with Caddy as the internal reverse proxy behind Nginx Proxy Manager.

## Contracts and visibility

- Public DTOs live only in `@unfreq/contracts`; `apps/api` re-exports them and `apps/web` imports them. Backend Zod schemas remain the runtime validation boundary; the contracts package is types, not validation.
- Only `PUBLISHED` signals are public. Generating, private-preview, reviewing-restricted, hidden, and deleted rows are never exposed to strangers, and visibility filtering happens in SQL/API, never only in the frontend.
- The shared API envelope is `{ data, meta: { requestId } }` for success and `{ error: { code, message, details? }, meta: { requestId } }` for failure.
- Retired product APIs (channels, voices, bottles, translate, radio-report, product AI endpoints) must not be re-registered as compatibility routes. Historical database tables may remain until a separate data-retirement task.

## Identity

- Explicit account registration or password login is required for user-owned writes. Guest creation is disabled (`POST /api/auth/guest` → 403), frequency naming is disabled, and `POST /api/frequencies` is a session-restore endpoint only.
- Web uses the HttpOnly `unfreq_session` cookie (`SameSite=Lax`, `Path=/`, `Secure` in production); Android may send the returned `sessionToken` as `Authorization: Bearer`.

## Verification

- Layer checks: `npm run contracts:typecheck`, `npm run api:check` (lint + typecheck + test + build), `npm run web:check` (lint + typecheck + build), and the aggregate `npm run check`.
- `npm run e2e` is intentionally opt-in (slow Next dev cold start); run it only on request or when a change cannot be verified below the browser layer. `npm run deploy:test` covers deployment scripts.
- Never commit secrets; provider API keys stay server-side and are write-only from the admin UI.
