# Demo Script

## Demo Data

`deploy/demo-seed.sql` seeds fixed demo frequencies, 20 published same-frequency signals, several signal echoes, and one pending signal report for admin review.

```bash
docker compose exec -T postgres psql -U postgres -d unfreq < deploy/demo-seed.sql
```

The seed file is idempotent. Re-importing it updates the fixed demo rows without duplicating them.

## AI Modes

Local demo works without external AI credentials. Keep `AI_BASE_URL=` and `AI_MODEL=local-fallback`; the API generates deterministic signal fingerprints and radio programs.

Provider demo also works. Set `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` in `.env`, then restart the API container.

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
4. On the result surface, show seed, expanded signal, same-frequency matches, resonance, and on-demand playback.
5. Click playback and let browser TTS read the expanded signal.
6. Open `/galaxy` to show published and seeded signals in the 3D star field.
7. Open `/me` to show my frequency, signal dots, and return-visit resonance summary.
8. Open `/offline` or toggle browser offline mode after first load to show the fallback page.

## Demo Accounts

These email identities are available for demo login and admin flows:

- `demo.host@xinghe.local` -> `FM-10.01`, admin role.
- `demo.midnight@xinghe.local` -> `FM-12.18`.
- `demo.unsent@xinghe.local` -> `FM-19.27`.
- `demo.echo@xinghe.local` -> `FM-22.05`.
- `demo.signal@xinghe.local` -> `FM-27.51`.

Server deployment keeps `AUTH_LOGIN_CODE_RESPONSE=disabled`. If login delivery is not configured yet, read the API container logs for the `local-log` code during private demos.
