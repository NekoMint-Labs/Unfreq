# Production Next runtime regression

This suite runs the built Next application against a loopback-only synthetic API.
It complements the existing six development-mode tests; it does not test the real
Fastify API, PostgreSQL, Redis, production infrastructure or paid AI providers.

Run from the repository root in PowerShell after installing dependencies and the
Playwright Chromium browser:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:4200'
$env:API_INTERNAL_BASE_URL = 'http://127.0.0.1:4200'
$env:NEXT_TELEMETRY_DISABLED = '1'
npm run web:build
npx playwright test --config playwright.runtime.config.ts
```

The public API URL must be set **during the build** because Next embeds it in
client bundles. The runner uses Web port 3200 and API port 4200 by default. Set
`RUNTIME_WEB_PORT` and `RUNTIME_API_PORT` to override them, and update the build's
API URLs to match. The config always starts its own mock and production server;
it does not reuse an already running service. Do not run a Next dev server or
another build against `apps/web/.next` while this suite is active.

The cases check native FM login, an HttpOnly synthetic cookie surviving SSR
and reload, author/anonymous/non-author draft visibility, metadata and draft OG
exclusion, author publication, anonymous public reading, PNG signature and
1200x630 dimensions, share-link copying, and 390px Galaxy WebGL/filter navigation.
The mock enforces synthetic permissions to detect failures at the Web boundary;
its permission implementation is not evidence about real backend authorization.
Galaxy checks here do not establish keyboard accessibility, point-selection
usability, frame rate or physical-device performance.

Each case resets only the mock's process-local publication state through a test-only
loopback endpoint, so publication does not make cases or retries depend on order.
For denied HTML pages, the assertion accepts Next's documented streaming status
200 or non-streaming 404, and requires visible not-found UI, `noindex`, no OG
image and absence of both private markers. OG route responses still require 404.

The first case uses the actual login form and its native validation. A baseline
form error should be reported or repaired directly, not bypassed in the test.
All accounts, cookies and content in this directory are synthetic fixtures, and
publishing changes only the mock server's process-local state.

The C1 cases also cover withdrawal and fresh author confirmation before
republication, versioned OG URLs, revocation while a PNG is rendering, and an
already open public page refusing local speech after the API denies access.

C2 adds report submission, private status recovery after reload, login and
rate-limit feedback, native dialog focus containment/restoration and 390px
screenshots. The Galaxy report case clicks a real WebGL hit area: a test-only
loopback endpoint places a synthetic public point at scene origin so it stays
at canvas center during rotation. It also verifies that Escape closes only the
report dialog while the selected-signal reader stays open. These UI fixtures do
not establish real database authorization or shared Redis rate limiting; those
are covered separately by the managed API integration tests.

D1 adds a 520-expression synthetic fixture for bounded coverage metadata, latest
own selection at 390px, the 80-item sample list, persistent public focus links,
band rejection, desktop/mobile canvas sizing and screenshots. The mocked API
supplies coverage for these UI assertions; real 81/520-row counting, stable
sampling, confirmation/digest checks and privacy boundaries use isolated SQL
integration tests.

D2 checks the artistic-position legend, keyboard expansion, desktop and 390px
layout, and the association note after selecting a real canvas point. Unit tests
cover candidate counting; browser fixtures do not establish that users understand
the explanation. The production suite now has twelve cases. Full Galaxy keyboard
reading, focus lifecycle and reduced motion remain D3 work.
