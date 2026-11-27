# Performance baseline — frontend, Worker and D1 (#4573, part 1)

**Date:** 2026-11-06.
**Commit:** `af28b98dbb` (`origin/main` at measurement time).
**Scope:** the local, deterministic part of #4573. No production traffic, no hosted preview, no deployment, no model or provider call, no schema change.
**Status:** a dated snapshot. True at this commit; not maintained afterwards (see `documentation/audits/README.md`). Re-run the commands below before relying on a number.

Every number below comes from a command in this repository, given beside it. A measurement that could not be made is marked **unavailable**, with the reason, and never shown as 0.

## 1. What is measured on main today (task 1)

| Surface | What exists | Sampling and retention | Privacy | Read by |
|---|---|---|---|---|
| Workers Observability (`wrangler.toml` `[observability]`) | invocation logs and traces | `head_sampling_rate = 1` (every request), `persist = true`; retention is Cloudflare's per plan, **not verified** | logs carry whatever a route `console.*`s; the house rule forbids tokens, codes, keys, page text, prompts, addresses and figures | the Cloudflare dashboard only; **no read from this session** (no account analytics token) |
| Analytics Engine `studioos_metrics` (`middleware/observability.ts`) | one data point per `/api` request: route, method, role, status, tier, branch, latency, user id | Analytics Engine samples by its own rules (index = path); retention per Cloudflare, **not verified** | stores the numeric user id (`double3`) | HQ Analytics "Technical", via `CLOUDFLARE_AE_API_TOKEN`; falls back to D1 when absent |
| D1 `system_metrics` | one row per `/api` request (endpoint, method, status, latency, role) | every request; purged only by `POST /api/monitoring/cleanup` (> 30 days, admin). A comment in `index.ts` refers to a "nightly" cleanup; **no scheduled delete was found in source** | no user id | HQ monitoring |
| D1 `activity_logs` | one row per logged request (`activityLogged`), with actor email and latency | every logged request; no purge found for request rows | **stores the actor's email** | Analytics, activity |
| D1 `error_logs` | one row per 5xx | purged by the same admin cleanup (> 30 days) | user id, endpoint, five stack lines | HQ monitoring |
| Tail Worker `studioos-tail` | tail events | not inspected here | — | — |
| Frontend | `POST /api/client-error` and `POST /api/public/analytics/pageview` | per event | — | — |
| Web Vitals (LCP, INP, CLS) | **none**: no `web-vitals`, no `PerformanceObserver` in `frontend/src` | — | — | — |
| CI | `scripts/lfs-size-gate.mjs` (repository size); no bundle, query-count or latency budget before this PR | — | — | — |

**Unavailable from this session (task 2):** Worker errors, CPU time, wall time and subrequests; D1 rows, queries and latency; Queue age; Workflow step duration; model error, timeout and 429 rates; actual spend. Each needs the Cloudflare account's analytics (GraphQL, Analytics Engine SQL or the dashboard) or the provider consoles, and this session has neither. #4559 owns the native metric dictionary; this baseline does not add a metrics vendor.

## 2. Frontend build composition (task 3)

`npm run build && node scripts/perf/bundle-baseline.mjs`. Compressed sizes are this script's zlib (gzip level 9, brotli quality 11): an estimate of what an edge serves, comparable build to build.

| | Files | Raw | gzip | brotli |
|---|---:|---:|---:|---:|
| Shell critical path: entry, 82 `modulepreload`s, 3 stylesheets, and the entry's static imports | 86 | 2,248.4 KiB | 590.7 KiB | **486.5 KiB** |
| All JS | 864 chunks | 22,301.7 KiB | 6,367.7 KiB | 5,423.1 KiB |

Lazy (dynamic-import) edges: 424.

Heaviest files on the shell path (brotli, raw in brackets):

- `index.js`: 193.0 KiB (851.2 KiB)
- `api.js`: 70.7 KiB (381.9 KiB)
- `react-vendor.js`: 68.6 KiB (255.3 KiB)
- `index.css`: 38.9 KiB (404.2 KiB)
- `BrandIcon.js`: 29.2 KiB (79.4 KiB)
- `WorkerRail.js`: 13.6 KiB (51.5 KiB)

Heaviest lazy loads, counting only what the shell does not already hold (brotli):

- `RaiseEvidence.js`: 549.9 KiB, 70 chunks
- `VisibilityPage.js`: 547.0 KiB, 76 chunks
- `PreviewPage.js`: 546.5 KiB, 76 chunks
- `VenturePage.js`: 545.0 KiB, 75 chunks
- `CycleRoute.js`: 537.6 KiB, 68 chunks
- `react-pdf.browser.js`: 349.5 KiB, 2 chunks
- `SettingsPage.js`: 258.7 KiB, 53 chunks
- `PitchEditor.js`: 242.1 KiB, 38 chunks
- `Dashboard.js`: 226.6 KiB, 66 chunks

The first five share one cause. `CycleRoute.js` is a single **1,095 KiB raw** chunk, and it statically imports every cycle step: `InvestorCapTablePanel` 278 KiB, `BuildInLovable` 99 KiB, `BuildPlan` 93 KiB, `CapRelOutreach` 92 KiB and `ClosingRoom` 83 KiB, all raw. `Dashboard.js` statically pulls in recharts' `CategoricalChart` (251 KiB raw) and `ProductTestingStudio` (228 KiB raw).

**Cache headers.** In the Worker, `/assets/*` comes from the assets binding through `index.ts` (`run_worker_first`), with content-hashed names. The shell's headers come from `frontend/public/_headers`. The live `Cache-Control` was **not measured** (no request to production).

**Third-party origin on the shell.** `fonts.googleapis.com` is loaded as a non-blocking stylesheet (`media="print"` with an `onload` swap), plus a `<noscript>` copy. It is not render-blocking.

## 3. Lab Web Vitals, anonymous pages (task 3)

`node scripts/perf/vitals-local.mjs --runs=5`. These are LAB values: the built bundle served locally (SPA fallback, brotli, immutable `/assets`), Chromium 1243, five cold loads per page, the median (worst in brackets). Third-party origins are blocked.

Every `/api` call was answered with 401 locally, recording method and path only. **This stub changes what the page renders.** On `/` the page reports "Session expired" (it posts `/api/client-error`), and its LCP element is a late `<p>`. So the `/` and `/pricing` LCPs are **provisional**: they measure the page's fallback state, not its normal one. `/login` and `/register` do not depend on the answers (LCP = FCP).

Profiles:

- **mobile:** 412×823, 4× CPU slowdown, 150 ms RTT, 1.6 Mbps down / 750 kbps up.
- **desktop:** no throttling.

| Page | Profile | LCP ms | FCP ms | CLS | load ms | Requests | Transfer |
|---|---|---:|---:|---:|---:|---:|---:|
| `/` | mobile | 6,500 (8,492) *provisional* | 1,368 | 0 | 3,925 | 114 | 665 KiB |
| `/` | desktop | 164 (240) | 164 | 0 | 291 | 119 | 1,391 KiB |
| `/login` | mobile | 1,376 (1,392) | 1,376 | 0 | 3,915 | 97 | 867 KiB |
| `/login` | desktop | 160 (224) | 160 | 0 | 290 | 97 | 867 KiB |
| `/register` | mobile | 1,348 (1,368) | 1,348 | 0 | 3,912 | 96 | 866 KiB |
| `/register` | desktop | 164 (200) | 164 | 0 | 281 | 96 | 866 KiB |
| `/pricing` | mobile | 5,420 (5,516) *provisional* | 1,348 | 0 | 3,891 | 113 | 667 KiB |
| `/pricing` | desktop | 724 (744) | 168 | 0 | 293 | 113 | 667 KiB |

**INP: unavailable.** INP is a field metric and needs real interactions.

API calls each anonymous page makes before any interaction:

- `/`: 7 GETs (`articles`, `public/events`, `public/plans-and-packs`, `public/stats`, `settings/appearance`, `settings/explainers`, `spinout-lab/brief`).
- `/login`: 4 GETs.
- `/register`: 3 GETs.
- `/pricing`: 4 GETs and one pageview POST.

**Signed-in pages are unavailable in this lab.** The Founder project and workflow, investor, HQ and research pages need an account and a live API. They belong to the hosted preview that #4566 and #4594 own.

## 4. API flows: D1 statements per request (task 4)

Run with:

```
node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs scripts/perf/api-bench.mjs
```

The whole Worker (`src/index.ts`, every middleware) runs over the migrated schema in node:sqlite, with synthetic accounts. Every D1 statement is counted. Statement counts are exact and deterministic. In production each one is a D1 round trip.

In-process times are SQLite in the same process: they rank flows on one machine and are **not** production latency. They are p50 / p95 / p99 over 200 requests, each with a fresh rate-limit store.

| Flow | Status | Statements | auth | telemetry | route | in-process p50 / p95 / p99 ms |
|---|---:|---:|---:|---:|---:|---:|
| `GET /api/health` | 200 | 0 | 0 | 0 | 0 | 1.08 / 2.23 / 4.64 |
| `GET /api/auth/me` | 200 | 12 | 7 | 2 | 3 | 2.22 / 3.46 / 9.8 |
| `GET /api/projects` | 200 | 11 | 7 | 2 | 2 | 5.65 / 8.62 / 13.53 |
| `GET /api/projects/1` | 200 | 12 | 7 | 2 | 3 | 5.46 / 8.54 / 12.9 |
| `GET /api/dashboard` | 200 | 9 | 7 | 2 | 0 | 5.76 / 7.86 / 12.79 |
| `GET /api/notifications` | 200 | 10 | 7 | 2 | 1 | 5.2 / 7.56 / 12.81 |
| `GET /api/search?q=` | 200 | 9 | 7 | 2 | 0 | 5.54 / 8.31 / 10.2 |
| `GET /api/decks/by-project/1` | 200 | 13 | 7 | 2 | 4 | 6.07 / 8.3 / 11.67 |
| `GET /api/data-room/shared` (investor) | 200 | 10 | 7 | 2 | 1 | 4.96 / 6.59 / 11.49 |
| `GET /api/research/overview` | 200 | **30** | 7 | 2 | **21** | **36.7 / 52.18 / 59.18** |
| `GET /api/funds` (investor) | 200 | **17** | **13** | 2 | 2 | 6.1 / 7.69 / 15.54 |
| `GET /api/projects/1`, another venture's founder | 403 | 11 | 7 | 2 | 2 | 5.44 / 7.69 / 15.73 |

The categories:

- **auth:** resolving the caller in `getCurrentUser`: the user row, held licences, the subscription and the recovery state.
- **telemetry:** the observability middleware's `INSERT`s, run in `waitUntil`.
- **route:** the route's own work.

Without the `ANALYTICS` binding, the telemetry count leaves out the subscription read that the middleware adds when that binding is present. That read is one more statement per signed-in request in production.

**Not benchmarked here.** Risk, proposal and approval flows, document download, and inference through `run()` (quote, hold, settlement) need fixtures this first PR does not add. The research list routes and streaming fallback are also not covered. Load and concurrency, write capacity and spending ceilings need hosted, owner-approved runs (§7).

## 5. Ten proven bottlenecks, ranked by evidence and reach

Each item names its evidence, a candidate PR scope and the gain it predicts. A gain is **predicted**, never claimed, until a before/after run shows it.

1. **H1: the caller is resolved two to four times per request.**
   - Evidence (§4): `SELECT * FROM users WHERE id = ?`, the subscription and the recovery-state reads run twice on every signed-in flow, and four times on `/api/funds`. `rateLimit` caches the user on the context; its comment says this spares "downstream route handlers", but `getCurrentUser` never reads that cache. Licences are already memoized per request.
   - Candidate: a per-request memo inside `getCurrentUser`, keyed on the request context, and invalidated wherever a route changes the session. The revocation and recovery checks must stay correct.
   - Predicted: 3 fewer D1 statements per signed-in request (9 fewer on `/api/funds`), about 27–53% of each flow's statements.
2. **H2: telemetry writes to D1 on every `/api` request.**
   - Evidence: `system_metrics` and `activity_logs` inserts (2 statements). With `ANALYTICS` bound, a subscription read is added (3). The `system_metrics` purge is admin-triggered, and no scheduled one was found.
   - Candidate, for #4559 to decide: request metrics in Analytics Engine only, `system_metrics` kept as an explicit fallback, and a scheduled retention for both tables.
   - Predicted: 2–3 fewer D1 statements per request, all of them writes.
3. **H3: the Worker script is 16.47 MiB raw, 4.72 MiB gzip.**
   - Evidence: `cd cloudflare-worker && npx wrangler deploy --dry-run --outdir <dir> --config ../wrangler.toml`. That is about 47% of the paid plan's 10 MiB compressed limit, and all of it is parsed and evaluated when an isolate starts.
   - Isolate start time itself is **unavailable** (it needs production metrics).
   - Candidate: measure where the size comes from (route modules, `services/aiRouter.ts`, `routes/research.ts`, embedded assets), then lazy-load the rarely hit paths. #4574 owns source splitting; file size alone is not latency.
4. **H4: the shell is 486.5 KiB brotli across 86 files, with 82 `modulepreload`s.**
   - Evidence (§2): `index.js` is 851 KiB raw and `api.js` 382 KiB raw, both on the critical path. Signed-out `/login` fetches 97 requests and 867 KiB.
   - Candidate: take the domain API modules out of the shell (`api.js` re-exports every module) and route-split `App.jsx`'s eager imports.
   - Predicted: the size of whatever leaves the path, re-measured by `check-bundle-budget`.
5. **H5: `CycleRoute` is one 1,095 KiB raw chunk.**
   - Evidence (§2): it statically imports every cycle step, so the five heaviest pages each cost about 540–550 KiB brotli beyond the shell.
   - Candidate: lazy-load each step under `CycleRoute`.
   - Predicted: a step page loads its own step, not all of them.
6. **H6: `Dashboard` statically imports recharts and `ProductTestingStudio`.**
   - Evidence (§2): 251 KiB and 228 KiB raw, and 226.6 KiB brotli beyond the shell.
   - Candidate: lazy-load the charted and studio panels.
7. **H7: `/api/research/overview` runs 21 aggregate statements.**
   - Evidence (§4): six of them repeat one `NOT EXISTS` dedupe over `research_fund_directory`. Each is a full-table aggregate, and its in-process time is about 7× the other flows', even on empty tables. The cost grows with directory size; production row counts were **not read**.
   - Candidate: one snapshot the existing crons write, read by this route.
8. **H8: `GET /api/funds` writes on a read.**
   - Evidence (§4): `UPDATE limited_partners SET user_id = ? WHERE user_id IS NULL AND LOWER(email) = LOWER(?)` runs on every list, besides H1's four resolutions of the caller.
   - Candidate: do the claim once, at sign-in or acceptance, and keep `LOWER(email)` off the read path.
9. **H9 (provisional): the landing and pricing pages' mobile lab LCP is 5.4–6.5 s, against a 1.35 s FCP.**
   - Evidence (§3): it depends on API answers that the lab stubs with 401, so it **must be re-measured** with real public endpoints in the hosted preview before any work is scoped.
10. **H10: anonymous pages fetch configuration that rarely changes on every load.**
    - Evidence (§3): `settings/appearance`, `settings/explainers` and `public/plans-and-packs` are fetched on every anonymous page, three to seven API calls before any interaction.
    - Candidate: cacheable public responses (`Cache-Control` with revalidation), checked against how fresh each must be.

## 6. Proposed budgets and SLOs, for the owner to decide (task 5)

**In CI from this PR.** Each is deterministic, measured at this commit, and raised or lowered only on purpose in the PR that moves it:

- **Shell size:** critical path ≤ 500 KiB brotli, ≤ 95 files, entry chunk ≤ 900 KiB raw (`scripts/check-bundle-budget.mjs`, in `test:guards`).
- **D1 statements per flow, by category:** the table in §4 (`cloudflare-worker/test/perf_budgets_4573.test.ts`). Each flow's authorization outcome is pinned beside its counts, so a cheaper flow cannot be one that stopped checking access.

**Proposed for decision.** Options, each with the one I would pick:

- **A. Signed-in read flows: ≤ 6 D1 statements on the latency path, after H1.**
  - Telemetry is counted separately.
  - **Pick A** once H1 lands: it is H1's predicted result, and the budget test enforces it.
- **B. Shell: ≤ 350 KiB brotli, after H4 and H5.**
  - **Pick B** as a target, not a gate, until H4 has a measured result.
- **C. Latency SLOs (route p95 ms, Worker CPU ms, error rate).**
  - **Defer.** No production percentile was measured, and a number set now would be invented.
  - Set it from #4559's metric dictionary after two weeks of Analytics Engine p50/p95/p99 per route, separating agent registry scale from active execution concurrency, as #4573's second-pass audit asks.

## 7. What the larger, owner-approved run needs (task 6 runbook)

The hosted run is #4566's isolation preflight and #4594's lifecycle and load evidence; this PR does not start it. It needs, before anything is sent:

- the preview environment's identity and its isolated D1;
- synthetic accounts for each role;
- written ceilings for rate, duration, concurrency and spend;
- a provider kill switch;
- the account's current platform entitlements, with the date.

Then:

1. Run `scripts/perf/vitals-local.mjs` against the preview origin, with the stub off, for the signed-in pages.
2. Run `scripts/perf/api-bench.mjs`'s flows over HTTP at a fixed, rising rate, recording p50, p95 and p99, errors and D1 rows read and written from the account's analytics.
3. Report the cost per completed task, not the cost per call.

None of it touches production.

## Reproduce

```
npm ci && (cd frontend && npm ci) && (cd cloudflare-worker && npm ci)
npm run build
node scripts/perf/bundle-baseline.mjs --json=bundle.json
node scripts/perf/vitals-local.mjs --runs=5 --json=vitals.json
node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs scripts/perf/api-bench.mjs --json=api.json
node scripts/check-bundle-budget.mjs
```

Measured on Node v22.22.0 with Playwright 1.64.1 and Chromium 1243 (`/opt/pw-browsers/chromium`; set `PW_CHROMIUM` to use another binary).
