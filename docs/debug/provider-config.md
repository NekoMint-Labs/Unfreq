# Provider Config Debug Playbook

## Entry Points

- Web surface: `apps/web/src/components/admin/AdminDashboard.tsx`
- Web provider UI: `apps/web/src/components/admin/ProviderConfigSection.tsx`
- Web provider helpers: `apps/web/src/components/admin/provider-config-workflow.ts`
- Web data loader: `apps/web/src/lib/admin-data.ts`
- API routes: `apps/api/src/modules/admin/routes.ts`
- Admin service: `apps/api/src/modules/admin/service.ts`
- Provider config service: `apps/api/src/modules/ai/provider-config.ts`
- DB table: `apps/api/src/db/schema.ts` (`provider_configs`)

## Routes

- `GET /api/admin/provider-configs`
- `PUT /api/admin/provider-configs/:kind`
- `POST /api/admin/provider-configs/:kind`
- `PUT /api/admin/provider-configs/:kind/:id`
- `DELETE /api/admin/provider-configs/:kind/:id`

## State Flow

```text
AdminDashboard -> admin-data -> /api/admin/provider-configs
  -> admin/routes -> admin/service
  -> provider-config service -> provider_configs
  -> admin_actions audit log
```

## Useful Checks

- Run `npm --workspace @unfreq/api run test -- admin/routes.test.ts provider-config.test.ts`.
- Run `npm --workspace @unfreq/web run test -- provider-config-workflow.test.ts` if frontend test tooling is available.
- Search logs for `admin.provider_config.create`, `admin.provider_config.update`, or `admin.provider_config.delete`.
- Check returned `source`, `status`, `keyState`, `priority`, and `isEnabled`.

## Common Failure Signs

- UI shows `keyState=missing` even after save.
- Config row is `disabled` because `baseUrl`, `provider`, or `model` is empty.
- Provider calls still use environment config after a database backup was added.
- Admin action exists but provider config list does not show the expected row.

## Known Pitfalls

- Stored keys can be unreadable when `PROVIDER_CONFIG_SECRET` changes. Chat config resolution skips that row and keeps environment fallback.
- Empty environment chat config should not block later database configs.
- API key values must stay server-side. UI should only show `apiKeyLast4` and `keyState`.
- `PUT /provider-configs/:kind` saves the primary config for a kind; `POST` adds a backup row.
