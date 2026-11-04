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

The ten cases check native FM login, an HttpOnly synthetic cookie surviving SSR
and reload, author/anonymous/non-author draft visibility, metadata and draft OG
exclusion, author publication, anonymous public reading, PNG signature and
1200x630 dimensions, share-link copying, and 390px Galaxy WebGL/filter navigation.
The mock enforces synthetic permissions to detect failures at the Web boundary;
its permission implementation is not evidence about real backend authorization.
Galaxy checks here do not establish keyboard accessibility, point-selection
usability, frame rate or physical-device performance.

Each case resets the mock's process-local publication and accepted-generation state
through a test-only loopback endpoint, so cases and retries do not depend on order.
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
The readiness regressions hold the real Next client scripts after the SSR document
commits. Login credentials and the home seed stay disabled until handlers are ready;
after release, they verify the submitted values and the existing session cookie.
The tests/deployment/caddy-web-proto.test.mjs regression separately runs the repository
Caddy configuration against synthetic Web/API upstreams on a disposable Linux runner.

The Web readiness workflow builds the actual Dockerfile.web runner with the
loopback synthetic API URL embedded at build time. The image-only Playwright
configuration reuses these same cases and starts the default image command from
its immutable iidfile. Its helper records image identity, checkout and owned
container cleanup; it does not use the maintenance stack's image verifier.
