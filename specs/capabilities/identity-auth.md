---
id: identity.auth
applies_to:
  - apps/api/src/modules/auth/**
  - apps/api/src/plugins/auth.ts
  - packages/contracts/src/auth.ts
  - apps/web/src/app/login/**
  - apps/web/src/app/me/**
tags:
  - auth
  - identity
  - session
---

# Identity and Authentication

## ID-001 Account-required model

- The current product requires explicit account registration or password login before user-owned writes.
- `POST /api/auth/register` creates a non-guest password frequency with a random `FM XX.XX` and sets `unfreq_session`.
- `POST /api/auth/frequency/login` restores a password-backed FM account.
- `POST /api/auth/guest` is disabled and returns `403 FORBIDDEN`; it must not create a user.
- `POST /api/auth/frequency/save` and `POST /api/auth/frequency/suggestions` are disabled (`403`) — frequency naming is off.
- `POST /api/frequencies` is a session-restore endpoint only: it returns the current frequency for a valid non-guest session and `401 UNAUTHORIZED` otherwise. It must never create a frequency without a valid non-guest session.
- `GET /api/me` returns a frequency only for a valid non-guest session.

## ID-002 Session contract

- Cookie `unfreq_session`, flags `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=<ttl>`, plus `Secure` in production.
- Token format `v1.<base64url-payload>.<hmac-signature>`. Validation must re-read the user row so role/status changes take effect immediately.
- Invalid, expired, banned, or guest-backed tokens are treated as unauthenticated (`401`). Legacy cookies pointing at `users.is_guest = true` must not restore a frequency.
- Web uses the cookie; Android may send the returned `sessionToken` as `Authorization: Bearer <sessionToken>`.

## ID-003 Email challenge login (secondary path)

- `POST /api/auth/login` normalizes the email, writes a short-lived Redis challenge, and does not create a user. `POST /api/auth/login/verify` consumes the challenge, reuses the existing frequency identity, and returns the session.
- `delivery.code` is only included when `AUTH_LOGIN_CODE_RESPONSE=enabled` (local/demo); production hides it.
- Internal challenge storage keys and email hashes are never returned to clients.
- Errors: invalid body 400; missing/expired challenge or wrong code 401; FM code space exhausted 409; cooldown or too many attempts 429.

## ID-004 Frequency identity DTO

```text
FrequencyIdentity:
  id, code ("FM 78.23", zero-padded), rawCode?, frequencyName?,
  isGuest?, role: ADMIN|USER, status: ACTIVE|MUTED|BANNED,
  lastSeenAt?, createdAt
```

- Display format is `FM XX.XX` with both numeric groups zero-padded. New core clients read `code` first; `freqCode` may appear as a compatibility alias during the legacy auth migration.
- Session continuity is carried by the cookie; clients must not require `sessionToken` in the JSON body.
- Do not require email in new first-use flows; the FM code is the public identity.

## ID-005 Canonical vs legacy tables

`frequencies` is the canonical identity table; the legacy `users` mirror still backs parts of auth and admin. Admin frequency status changes must update **both** `frequencies.status` and `users.status` until the auth migration completes. Signal ownership is keyed by `signals.author_id` during that migration.

## Non-goals

- No guest-first flow, no frequency naming/suggestions, no user accounts beyond the single FM identity.
- No returning internal challenge keys, email hashes, or raw session material.
