# Galaxy Interaction Debug Playbook

## Entry Points

- Page: `apps/web/src/app/galaxy/page.tsx`
- Canvas: `apps/web/src/components/galaxy/GalaxyCanvas.tsx`
- API client: `apps/web/src/lib/signal-data.ts`
- API route: `apps/api/src/modules/signals/routes.ts`
- Signal service: `apps/api/src/modules/signals/service.ts`
- Signal repository: `apps/api/src/modules/signals/repository.ts`

## Routes

- `GET /api/signals/galaxy`
- `GET /api/signals/galaxy?band=<signal_primary_band>`
- `GET /api/signals/:id`

## State Flow

```text
/galaxy page -> getSignalGalaxy()
  -> GET /api/signals/galaxy
  -> getSignalGalaxy()
  -> listPublishedGalaxySignals()
  -> buildStableGalaxyPosition()
  -> GalaxyCanvas points
```

## Useful Checks

- Run `npm --workspace @unfreq/api run test -- signals/service.test.ts signals/routes.test.ts`.
- Run `npm --workspace @unfreq/web run typecheck` after UI changes.
- Search logs for `signal.galaxy_position.write` and `signal.galaxy_position.write failed`.
- Use admin overview for `overview.galaxy.missingCoordinates` when points are missing.
- Verify `points`, `themeOptions`, `bandOptions`, and `selectedBand` in the API response.

## Common Failure Signs

- API returns an empty `points` array while published signals exist.
- Admin overview shows nonzero `galaxy.missingCoordinates`.
- Browser shows galaxy unavailable after the client timeout.
- `matchIds` references IDs that are not present in returned `points`.

## Known Pitfalls

- `getSignalGalaxy()` returns only published visible signals.
- Missing or invalid `galaxyPosition` is repaired with a stable derived coordinate and queued write.
- Band filters use fixed `signal_primary_band` values.
- The web client uses a short `2200ms` timeout for galaxy data, so slow API work can look like an empty or unavailable galaxy.
