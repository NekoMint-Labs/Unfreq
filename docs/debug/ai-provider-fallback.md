# AI Provider Fallback Debug Playbook

## Entry Points

- Provider adapter: `apps/api/src/modules/ai/provider.ts`
- AI orchestration: `apps/api/src/modules/ai/service.ts`
- Provider config resolver: `apps/api/src/modules/ai/provider-config.ts`
- Signal caller: `apps/api/src/modules/signals/service.ts`
- Error logging: `apps/api/src/shared/error-handler.ts`
- Backend engineering spec: `specs/engineering/backend.md`

## Routes

- Signal path that calls AI through `POST /api/signals`
- Admin observation route: `GET /api/admin/ai-reviews`

## State Flow

```text
AI service call -> callProvider()
  -> resolveChatProviderConfigs()
  -> profile selection
  -> provider HTTP call
  -> parse provider JSON
  -> fallback or AI_UNAVAILABLE
```

## Useful Checks

- Run `npm --workspace @unfreq/api run test -- provider.test.ts provider-config.test.ts ai/service.test.ts signals/service.test.ts`.
- Search logs for `failureBoundary`, `failureFallbackBoundary`, `failureKind`, `failureType`, `failureTimeoutMs`, and `failureStatusCode`.
- Check `provider_configs` ordering by `kind`, `priority`, and `created_at`.
- Check `ai_reviews.status`: `SUCCEEDED` means provider result passed validation; `FALLBACK` means business fallback was recorded.

## Common Failure Signs

- `failureBoundary=provider_config_resolution` and `failureKind=config_missing`.
- `failureBoundary=provider_call` with `failureKind=http_error`, `timeout`, `invalid_json`, or `invalid_response`.
- `failureFallbackBoundary=provider_fallback` with `failureProviderAttemptCount` greater than 1.
- `ai_reviews.status=FALLBACK` increases while provider error logs also appear.

## Known Pitfalls

- Fast judgment calls use the `fast` profile and 10s timeout. Creative generation uses the `default` profile and 20s timeout for `signal-expansion`.
- `config_missing` means all candidate configs were empty, disabled, unreadable, or profile-filtered away.
- `provider_call` failures include HTTP, network, timeout, invalid JSON, and invalid response cases.
- `provider_fallback` means every selected provider candidate failed. It does not mean local text fallback was accepted.
- Logs must not include API keys, raw seed text, expanded text, or provider payloads.
