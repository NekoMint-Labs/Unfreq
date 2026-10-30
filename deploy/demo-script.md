# Demo Script

## Demo Data

`deploy/demo-seed.sql` is a legacy fixture containing fixed frequency labels, 20 signals marked published, several echoes, and one pending report. Its field set has not been verified against the current schema. It has no current publication confirmation snapshots; a published status alone does not make these rows public.

The historical import command is retained for reference. Do not use it as the setup step for a current public demo:

```bash
docker compose exec -T postgres psql -U postgres -d unfreq < deploy/demo-seed.sql
```

The SQL uses fixed rows and conflict updates, but it does not record author confirmation. For a current demo, register a synthetic frequency in the app, submit a synthetic expression, review the exact public preview, and explicitly confirm publication. Do not bulk-fill confirmation snapshots for legacy rows.

## AI Modes

Local demo works without external AI credentials. Keep `AI_BASE_URL=` and `AI_MODEL=local-fallback`; the API generates deterministic signal fingerprints and radio programs.

A provider demo needs separately authorized credentials, usage limits, and validation. Configure `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` in `.env` and follow the deployment procedure for the API container. Local fallback or synthetic browser tests do not verify provider quality.

## Demo Inputs

Use one of these on the homepage signal composer:

- `凌晨两点还在改汇报，脑子里全是明天会不会出错。`
- `我把想发出去的晚安删掉了，还是有点想念。`
- `今天一个人吃饭，旁边很热闹，我却像被静音了。`
- `收到好消息以后没有立刻开心，先想到自己终于撑过来了。`
- `跑完步以后焦虑还在，但它终于没有占满整个身体。`

## 8-Minute Path

1. Open `/login` on the configured public domain.
2. Set a password and record the assigned `FM XX.XX`; FM and password are the only login credentials.
3. Return to the homepage, submit one demo input, and show the controlled generation state.
4. On the author's result surface, show the private generated result. Review the public preview and explicitly confirm publication before opening the public version in an anonymous session; it contains only the confirmed body, FM alias, and allowed tags.
5. If playback is available, demonstrate it and identify the actual playback source shown by the app.
6. Open `/galaxy` and its legend. Selectable stars are confirmed public expressions; background stars are decorative. Positions are artistic, so distance does not measure semantic similarity. Links show rule candidates from this sample after visual selection, not personal relationships. Explain total, returned, and drawn counts, then open an expression's association note. Candidate count is not drawn link count or a probability; brightness and size also mix resonance, depth, and decoration.
7. Open `/me` to show my frequency, signal dots, and return-visit resonance summary.
8. Open `/offline` or toggle browser offline mode after first load to show the fallback page.

## Demo Accounts

These are legacy fixture labels. They do not provision working password credentials or prove current admin access; register a synthetic FM frequency and password through the current app:

- `demo.host@xinghe.local` -> `FM-10.01`, admin role.
- `demo.midnight@xinghe.local` -> `FM-12.18`.
- `demo.unsent@xinghe.local` -> `FM-19.27`.
- `demo.echo@xinghe.local` -> `FM-22.05`.
- `demo.signal@xinghe.local` -> `FM-27.51`.

Server deployment keeps `AUTH_LOGIN_CODE_RESPONSE=disabled` and `AUTH_LOGIN_DELIVERY_MODE=disabled`. Use a registered frequency/password for demos; email-code login stays unavailable until a production mail transport is implemented. Production rejects `local-log`, including private server demos.
