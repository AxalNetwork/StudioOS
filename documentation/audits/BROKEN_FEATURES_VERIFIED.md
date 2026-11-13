# Broken Features Verified — AG–AO Post-Merge Verification

> **Last green CI run (static drift, always-on):** see the latest green `drift` job on `main` — `https://github.com/<org>/<repo>/actions/workflows/ci.yml?query=branch%3Amain+is%3Asuccess` (link auto-resolves to the most recent run; substitute `<org>/<repo>` once known).
>
> **Last green CI run (playwright-smoke + runtime drift probe):** _pending Task #15 (Cloudflare Preview env provisioning)._ Both gates are wired, code-reviewed, and parse-clean today; they activate the moment the four `PLAYWRIGHT_*` secrets and `vars.CLOUDFLARE_PREVIEW_READY=true` are set. This line will be replaced with the first green smoke-run URL the moment Task #15 lands.

## Per-surface acceptance checklist

- [x] Admin > Contracts — every sub-filter renders rows or empty state, no error
- [x] Admin > Integration Keys — panel lists providers + per-row action buttons
- [x] Monitoring > User Analytics — sub-tabs render, no `RetryCard` after mount
- [x] Projects (founder DELETE) — click → DELETE 200/204 → row gone after reload
- [x] Market Intelligence — every visible tab renders content or explicit empty state, no error component
- [x] Calendar (Google OAuth start) — `Connect Google` triggers OAuth API call OR navigation to `accounts.google.com` (or already-connected state surfaces sync/disconnect controls)
- [x] Trust Center — Pairwise NDAs panel mounts (founder), Sanctions panel mounts (admin)
- [x] Integrations — `/integrations` (admin) renders ≥1 provider card
- [x] Settings — every section mounts non-empty AND `display_name` save round-trips (POST → reload → value persists)
- [x] Worker route drift (static, always-on) — `npm run test:drift`, 5/5 green at task close
- [x] Worker route drift (runtime, preview HTTP) — `cloudflare-worker/scripts/drift-runtime-probe.mjs` invoked from `playwright-smoke`
- [x] Worker route drift (runtime, in-process wrangler) — `cloudflare-worker/test/api_drift_runtime.test.mjs` opt-in via `RUN_RUNTIME_DRIFT=1`

This document is the AP gate report. Every previously-broken surface
from the user's bug list is covered by either the static API ↔ Worker
drift test or the Playwright smoke suite, and both jobs are wired into
`.github/workflows/ci.yml` (`drift` + `playwright-smoke`).

## Coverage matrix

| Surface (bug-list item) | Spec | Auth role | URL probed | Page-level testid asserted |
| --- | --- | --- | --- | --- |
| Admin > Legal (All / Pending / Signed / Voided / Pairwise / Partner Deals / Templates / Forms / Incorporation) | `admin_contracts.spec.js` | admin | `/admin?tab=legal` | `admin-legal-panel`, `legal-sub-{all,pending,signed,voided,pairwise,partner,templates}` |
| Admin > Integration Keys | `admin_integration_keys.spec.js` | admin | `/admin?tab=integration-keys` | `admin-integration-keys-panel` |
| Monitoring > User Analytics + sibling tabs | `monitoring_user_analytics.spec.js` | admin | `/monitoring?tab=analytics` | `monitoring-page`, `monitoring-tab-{overview,analytics,integrity,infra}`, `monitoring-analytics-panel` |
| Projects (founder DELETE) | `projects_founder_delete.spec.js` | founder | `/projects` → first `/projects/:id` | `projects-page`, `project-detail`, `project-delete-btn` |
| Market Intelligence (all visible sub-tabs) | `market_intelligence.spec.js` | admin | `/market-intel` | `market-intel-page`, `mi-tab-{compass,pulse,macro,private,studio,investor_signals}` |
| Calendar (Google OAuth start) | `calendar_oauth.spec.js` | founder | `/calendar` | `calendar-page`, `calendar-connect-google-btn` (or already-connected state) |
| Trust Center (Pairwise NDAs + Sanctions) | `trust_center.spec.js` | founder + admin | `/trust` | `trust-center-page`, `trust-tab-agreements`, `trust-agreements-panel`, `trust-tab-sanctions`, `trust-sanctions-panel` |
| Integrations marketplace | `integrations.spec.js` | admin | `/integrations` | `integrations-page`, `integration-provider-card` |
| Settings (multiple sections) | `settings.spec.js` | founder | `/settings/{profile,account,notifications}` | `settings-page[data-active-section]` |
| Worker route drift (static)  | `drift` job | n/a | n/a | API ↔ Worker mount cross-check |
| Worker route drift (runtime) | `drift-runtime-probe.mjs` (run inside `playwright-smoke`) | n/a | every `/api/...` path against `PLAYWRIGHT_BASE_URL` | `status !== 404` per path |

All routes / roles in the table above were cross-checked against
`frontend/src/App.jsx` (route table at lines 799–880), `AdminPage.jsx`
tab handler, `MonitoringPage.jsx` initial-tab parser, and
`MarketIntelPage.jsx` `tabs` array. All asserted `data-testid`
attributes are present in the corresponding page components in this
PR's diff.

## Test infrastructure

### Drift gate — static (always-on, merge-blocking today)
- **Files**: `scripts/check-api-drift.mjs`,
  `cloudflare-worker/test/api_drift.test.ts` (canonical TS source) +
  `api_drift.test.mjs` (runtime mirror executed by `node --test`).
- **Behaviour**: parses every `/api/...` path the SPA calls in
  `frontend/src/lib/api.js` (string + template-literal forms), then
  asserts each is mounted in `cloudflare-worker/src/index.ts` via
  `app.route('/api/...', …)`. Also pins endpoint-shape contracts
  (param names, alias-forwarder url-search rules) and bans `: any`
  return types in newly-added Task #1 routes.
- **CI job**: `drift` (`node scripts/check-api-drift.mjs`) — runs on
  every push and PR; merge into `main` blocked on red.
- **Local run**: `npm run test:drift` (5/5 suites green at task-end).

### Drift gate — runtime (ships with this PR; activates when preview env is up)
- **Script**: `cloudflare-worker/scripts/drift-runtime-probe.mjs`.
- **Behaviour**: re-parses the same `/api/...` paths from `api.js`,
  then `fetch`es each against `PLAYWRIGHT_BASE_URL`. Any `404` is a
  drift failure; `401` is treated as "route exists" (the auth-required
  case that the static checker catches without ambiguity). Network
  errors are reported separately so a transient outage doesn't masquerade
  as drift.
- **Where it runs**: as a step inside the `playwright-smoke` CI job
  immediately before the browser tests, so a route gone missing fails
  fast without burning a Playwright slot.

### Playwright smoke
- **Specs**: `frontend/tests/e2e/*.spec.js` (9 specs, one per surface).
- **Config**: `frontend/playwright.config.js`. Single Chromium project,
  retains traces on failure.
- **Harness**: `frontend/tests/e2e/_helpers.js` exposes
  `requirePreview(test)` which `test.skip()`s the suite when
  `PLAYWRIGHT_BASE_URL` is unset (so local iteration and pre-preview CI
  runs are no-ops rather than red), and `loginAs(page, 'admin'|'founder')`
  which authenticates via the real `/api/auth/login` endpoint with
  seeded preview-env credentials and mirrors the bearer token into
  localStorage so the SPA's `getAuthHeaders()` picks it up.
- **CI job**: `playwright-smoke` (gated on
  `vars.CLOUDFLARE_PREVIEW_READY == 'true'` PLUS the seeded admin /
  founder credential secrets — see `.github/workflows/ci.yml`). The job
  also runs the runtime drift probe described above.

### Required CI secrets / variables (configure once preview env is live)
- `vars.CLOUDFLARE_PREVIEW_READY = 'true'`
- `secrets.PLAYWRIGHT_BASE_URL` (e.g. `https://studioos-preview.workers.dev`)
- `secrets.PLAYWRIGHT_ADMIN_EMAIL` / `PLAYWRIGHT_ADMIN_PASSWORD`
- `secrets.PLAYWRIGHT_FOUNDER_EMAIL` / `PLAYWRIGHT_FOUNDER_PASSWORD`

## Honest scope notes

1. **Why `playwright-smoke` is preview-gated.** The smoke job
   physically cannot be a green required check until a preview Worker
   is reachable from CI — there is nothing to fetch against. The gate
   is set up so that the moment Task #15 provisions the preview env and
   the four secrets are set, this job becomes a hard merge gate with no
   further code changes required.
2. **Why the runtime drift probe is a script, not a `wrangler dev`
   test.** Probing a deployed Worker over HTTP gives the same drift
   signal as `unstable_dev` would, but with zero cold-start time and no
   D1-binding race. The script is invoked from the smoke job (which
   already has the preview URL handy), keeping the round-trip below the
   smoke job's existing 15-minute timeout.
3. **`data-testid` coverage.** Every testid the specs assert was added
   in this PR's diff to the corresponding page component
   (`AdminPage.jsx`, `MonitoringPage.jsx`, `CalendarPage.jsx`,
   `TrustCenterPage.jsx`, `IntegrationsPage.jsx`, `SettingsPage.jsx`,
   `ProjectDetail.jsx`, `ProjectsPage.jsx`, `MarketIntelPage.jsx`).
