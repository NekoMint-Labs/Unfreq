# Account-required identity; guest creation is disabled

## Context

The original flow was guest-first: a browser-local device identity auto-created an `FM XX.XX` frequency and could name it / regenerate suggestions. That made the homepage look logged-in for anyone with an old cookie, and it left user-owned writes tied to throwaway identities.

## Decision

Require explicit registration or password login before user-owned writes. `POST /api/auth/register` creates a non-guest password frequency with a random FM; `POST /api/auth/frequency/login` restores it; `POST /api/auth/guest` returns 403; `POST /api/auth/frequency/save` and `/frequency/suggestions` are disabled; `POST /api/frequencies` is session-restore only. Legacy cookies pointing at `users.is_guest = true` are treated as unauthenticated.

## Why

- Ownership, moderation, and the "my frequency" surface need a stable identity the user can actually recover.
- Guest-first state made stale cookies look like a session, which is exactly the bug the disabled guest flow removes.
- Random FM plus password keeps the anonymous feel without the weak identity model.

## Revisit when

A genuinely frictionless first-use experience is required again. That must be a designed identity model with clear ownership and recovery semantics — not a silent auto-created guest that the rest of the product treats as a real account.
