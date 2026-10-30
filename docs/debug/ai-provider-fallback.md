# AI Provider Fallback Debug Playbook

E1 起，`ai_reviews.execution_json` 记录 transport 返回的实际来源和尝试轨迹；`provider/model` 不再从配置首项推测。`FALLBACK` 的最终来源是 `local-rules`，先前的 Provider 调用与可用用量仍留在 attempts。旧记录没有 execution 时，其原有 provider/model 不能作为已验证的实际血缘。费用缺失记为 unknown。

向量查询必须携带新的完整空间元数据，旧向量继续保留但不自动加入新空间。缺失向量回填默认只预览当前确认公开范围；迁移、索引和费用核算边界见 [E1 实施与操作记录](../implementation/e1-provider-lineage-20261030.md)。

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
