# CODEBASE_MAP.md — verified engineering reference

Re-verified against `origin/main` at `617cfa0540` on 2026-11-27 (#9057). Every
statement below was read from the tree at that commit: the workflows, the
`package.json` scripts, `wrangler.toml` and the files themselves.

**Counts are commands, not numbers.** This file used to carry hard counts and
line numbers, and they went stale within weeks (`routes/` was "151 files" when
it held six hundred). Where a size matters, the command that measures it is
given instead; run it from the repository root. Code is cited by file and
symbol, not by line.

Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins (its last
paragraph says so) — fix this file.

---

## 1. Repository layout

### 1.1 `cloudflare-worker/` — the production API (Hono on Workers)

Entry point: `cloudflare-worker/src/index.ts` (`wrangler.toml`'s `main`). It is
the live API on both hosts, `axal.vc` and `app.axal.vc`, and serves the SPA from
its `[assets]` binding (§2.5). `cloudflare-worker/src/README.md` describes each
subfolder; the larger ones:

| Subdirectory of `src/` | What lives there |
| --- | --- |
| `routes/` | One Hono router per file. Most mount themselves (below). `routes/README.md` holds a generated file list. |
| `services/` | Domain logic, top-level `.ts` files plus nested packages (`advisor/`, `decks/`, `email/`, `mail/`, `scoring/`, …). |
| `agents/` | The agent engine runtime (D1528). |
| `mcp/` | StudioOS as a remote MCP server at `/mcp` (D665, D666). |
| `rpc/` | The `WorkerEntrypoint` classes HQ and a branch call each other through (D108). |
| `contracts/` | JSON Schemas for deck v2 replies, checked by `test:drift` (D1511). |
| `durable-objects/` | The Worker's own Durable Object classes. |
| `integrations/` | The connector framework. Mercury here is a member's own (Grow and Raise, by Sign in with Mercury); Axal VC's accounts are `routes/admin_mercury.ts` and `services/mercury/` only (D879–D883). |
| `templates/` | `templates/email/` and `templates/legal/` (the bundled contracts, loaded as text by the `[[rules]]` in `wrangler.toml`). |
| `middleware/`, `util/` | Request gates; small shared helpers with no domain logic. |
| `probes/` | Throwaway Worker entries for hosted checks; production never imports them. |
| `models/`, `data/` | A few typed models and static lists. |

Sizes, when you need them:

```bash
git ls-files 'cloudflare-worker/src/routes/*.ts' | wc -l      # route files
git ls-files 'cloudflare-worker/src/services/' | wc -l        # every file under services/
git ls-files 'cloudflare-worker/test/*.test.*' | wc -l        # Worker test files
```

**Self-mounting routers (#4105).** A route module exports `mount`
(`{ path, router, before? }`, the `RouteMount` type in
`cloudflare-worker/src/util/routeRegistry.ts`). `scripts/build-route-registry.mjs`
finds every module with that export and writes `routes/_registry.ts`, which
`index.ts` hands to `attachRouteRegistry`; `planMounts` decides the order at
startup. A new router adds no `app.route(...)` line to `index.ts`; the mounts
already there stay where they are. Compare the two kinds:

```bash
git grep -l '^export const mount' -- cloudflare-worker/src/routes | wc -l   # self-mounted modules
grep -c 'app.route(' cloudflare-worker/src/index.ts                         # hand-written mounts
```

**Generated modules are never committed (D5612).** `routes/_registry.ts`,
`frontend/src/lib/apiModules.generated.js` and
`cloudflare-worker/src/services/agents/skillLibrary.generated.ts` are
gitignored (so is `documentation/architecture/MODEL_INVENTORY.json`, D8519).
`node scripts/build-generated.mjs` writes them; `npm run build`, the
`pretest:*` hooks and each CI job run it first. A fresh checkout has none of
them until you run it.

**Deck builder v2 (the Grid).** Its routes are the `routes/deck_*.ts` files,
nearly all mounted at `/api/decks` (the route map's deck sections list them,
one per decision); its engine is `services/decks/` (`genRuntime.ts`,
`queueRuntime.ts`, `elementModels.ts`, …) with the `DeckGenRoom` Durable
Object; its operations runbook is `documentation/operations/DECK_GRID.md`
(D1547).

Tests live in `cloudflare-worker/test/` (count above).

### 1.2 `frontend/` — React 19 + Vite 8 SPA

`frontend/src/`:

- `App.jsx` — the router and the route/role policy that predates the route
  modules. Its existing `<Route>` elements stay there (tests read the file by
  path).
- `routes/` — **where a new area's routes go** (D528, #4105). One
  `frontend/src/routes/<area>.jsx` per area; `App.jsx` collects every file in
  the folder with `import.meta.glob('./routes/*.jsx', { eager: true })`, so a
  new area is one new file and no edit to `App.jsx`. Start at
  `frontend/src/routes/README.md`.
- `lib/api.js` — the client for the Worker. From D527 a **new** API domain gets
  its own module under `frontend/src/lib/api/`; `scripts/build-api-index.mjs`
  generates `frontend/src/lib/apiModules.generated.js`, which `api.js`
  re-exports with one fixed line. Start at `frontend/src/lib/api/README.md`.
- `workspaces/` — the shared workspace layer (shell, zone navigation, bucket
  boards). Start at `frontend/src/workspaces/README.md`.
- `ui/` — shared shell components (`CompanySwitcher.jsx`, `SidebarNav.jsx`,
  `phone/`, …).
- `pages/`, `components/`, `contexts/`, `hooks/`, `brand/`, `data/`, `decks/`,
  `templates/`, `sidebarConfig.js`, `index.css`, `main.jsx`.

Sizes, when you need them:

```bash
wc -l frontend/src/App.jsx frontend/src/lib/api.js
grep -c '<Route ' frontend/src/App.jsx                    # routes still in App.jsx
git ls-files 'frontend/src/routes/*.jsx' | wc -l          # route modules
git ls-files 'frontend/src/lib/api/*.js' | wc -l          # API client modules
git ls-files 'frontend/test/*.test.mjs' | wc -l           # frontend test files
```

**Styling** is Tailwind **v4**, wired as a Vite plugin (`import tailwindcss from
'@tailwindcss/vite'` in `frontend/vite.config.js`). There is no
`tailwind.config.js`; v4 configures from CSS.

**Dark-mode guard** is `scripts/check-dark-mode.mjs` — a repo-root guard script,
not a file under `frontend/test/`. It fails when a `className` in
`frontend/src/{pages,components}` uses `bg-white`, `text-gray-700/800/900`, or
`border-gray-200/300` without a `dark:` counterpart in the same string, with an
allowlist for marketing/auth/print surfaces. Auto-fixer:
`scripts/codemod-dark-mode.mjs`. It runs as the last step of
`npm run test:drift`.

`frontend/test/` holds the frontend tests, including three deletion guards:
`founder_portal_removed.test.mjs`, `spinouts_page_removed.test.mjs`,
`studio_ops_removed.test.mjs`.

### 1.3 `cloudflare-worker/sql/` — D1 schema (canonical)

- `cloudflare-worker/sql/migrations/` is the ledger: every file there is
  applied once, in order, by `scripts/migrate-d1.mjs` (§5.1). Numbered files
  (`001_…` up to 799) came first; a few numbers are used twice, which is not an
  ordering hazard because `compareMigrations` in `scripts/lib/migrationPlan.mjs`
  sorts on the number and breaks ties on the full file name. A **new**
  migration is named by its UTC minute and its issue,
  `YYYYMMDDHHMM_<issue>_<slug>.sql` (D4106, D5398), and sorts after every
  numbered file. `scripts/check-sql-migrations.mjs` fails on a shared number
  or identity.
- `cloudflare-worker/sql/schema_baseline.sql` is the baseline the runner
  bootstraps an empty database from.
- `cloudflare-worker/sql/forward-fixes/` and `cloudflare-worker/sql/historical/`
  are **not** part of the ledger run; each has a README saying what it holds.
  The old one-off feature scripts (`liquidity.sql`, `funds_v2.sql`,
  `schema.sql`, …) are in `historical/`.

```bash
git ls-files 'cloudflare-worker/sql/migrations/*.sql' | wc -l
```

### 1.4 `docs/` — SPA build output

`docs/` is the Vite build output (`frontend/vite.config.js`:
`outDir: ../docs`) and is served as Worker Static Assets
(`[assets] directory = "./docs"`). It is not committed (D529): every job that
needs it runs the root `npm run build` first, so there is no committed copy to
go stale. Never hand-edited.

### 1.5 `scripts/`

`scripts/README.md` indexes them. The ones this file leans on:

- `build-frontend.mjs` — `npm run build` (§3).
- `build-generated.mjs` — writes the generated modules (§1.1).
- `migrate-d1.mjs` — the migration ledger runner (§5.1).
- `run-guards.mjs` — `npm run test:guards`, from the catalog in
  `scripts/lib/guardCatalog.mjs` (§6).
- `lfs-size-gate.mjs` — LFS/large-file budget gate; also a CI job
  (`.github/workflows/lfs-budget.yml`) and an installable pre-commit hook
  (`npm run lfs:install-hook`).

### 1.6 `backend/` — dev-only FastAPI

Never deployed. `wrangler.toml`'s `main` is `cloudflare-worker/src/index.ts`.
CI's only backend job is `dev backend (import smoke)` in
`.github/workflows/ci.yml` — an import smoke test, not a deploy. Production is
the Worker, shipped by the workflow in §4.

### 1.7 `cloudflare-worker-tail/` — tail consumer worker

Separate worker `studioos-tail` (`cloudflare-worker-tail/wrangler.toml`), one
R2 binding `LOGS` → bucket **`studioos-logs`**, `RETENTION_DAYS = "2555"`
(7 years). It is the long-term archive of the `studioos` Worker's tail events.
Producer→consumer wiring lives entirely in the root `wrangler.toml` under both
`[[tail_consumers]]` and `[[env.production.tail_consumers]]`; the consumer must
NOT declare `[[tail_consumers]]` itself, and `scripts/check-tail-consumer.mjs`
(a `test:guards` guard) fails if it does. **No workflow deploys it** (§4).

---

## 2. Cloudflare bindings — top-level vs `[env.production]`

Wrangler does not inherit binding tables into named environments, so both
tables matter. The release workflow deploys with `--env production` (§4), which
makes the `[env.production.*]` tables the ones that actually ship.

**Every binding is declared in both tables**, and
`scripts/check-wrangler-binding-parity.mjs` (a `test:guards` guard) fails a
binding added to only one. `wrangler.toml` is the list; it is not copied here.
To see it:

```bash
grep -n -E '^\[\[?(env\.production\.)?[a-z_.]+\]\]?' wrangler.toml
```

Notes on the bindings whose behaviour is not obvious from the toml:

| Binding | Notes |
| --- | --- |
| D1 `DB` | `studioos-db`, the canonical user store (`CLAUDE.md` fact 2). |
| KV `OAUTH_KV` | The MCP OAuth store (D681), live since 2026-10-14. HQ-only: generated branch configs omit it and keep MCP off (`scripts/lib/branchConfig.mjs`); `[env.preview]` binds its own placeholder, `REPLACE_WITH_PREVIEW_KV_OAUTH_ID`, never HQ's id. |
| KV `AI_SPEND` | Planned only, commented out in both tables. `services/aiRouter.ts` falls back to `TOKENS` with `ai_spend:` / `ai_cache:` / `ai_killswitch:` prefixes. |
| Queues | `JOB_QUEUE` → `studioos-job-queue` and `AGENT_QUEUE` → `studioos-agent-queue`, each consumed with a dead-letter queue that is consumed too (§5.4). The release refuses to publish when a required queue is missing (`scripts/check-production-queues.mjs`). |
| R2 `BACKUPS` | `studioos-backups`; object-lock and lifecycle are **dashboard-configured, not in the TOML**. Optional at runtime — `services/backup.ts` no-ops when absent. |
| R2 `COMPANY_LOGOS` | `studioos-company-logos` (#4201): **created by an operator** before the deploy that binds it; the logo routes in `routes/company.ts` answer 503 `storage_unconfigured` when the binding is absent. |
| Static Assets `ASSETS` | `./docs`, SPA fallback; see §2.5. |
| Tail consumer | `studioos-tail` (non-inheritable, mirrored in both tables; §1.7). |
| `[[rules]]` | Text and Data loaders scoped to `**/legal/…`, not mirrored: `rules` is an **inheritable** Wrangler key, so `--env production` still gets them. |
| `[observability]` | Not mirrored; `observability` is inheritable. |

### 2.1 Things that look like bindings and are not

- **AI Gateway slugs** are plain vars, e.g. `CF_AI_GATEWAY_SLUG_ADVISOR`, read by
  `services/aiRouter.ts` and passed as `{ gateway: { id } }` to `env.AI.run()`.
  `scripts/check-ai-gateways.mjs` holds the tables in agreement (D8508); the
  release runs it before publishing.
- **`ai_usage_logs`** is a D1 table, written by `services/aiRouter.ts` and read
  by `routes/monitoring.ts` — not a binding.
- **Turnstile** has no binding either. The Worker reads the
  `TURNSTILE_SECRET_KEY` **secret** (`services/turnstile.ts`); the SPA reads the
  public site key from the build-time `VITE_TURNSTILE_SITE_KEY`.

### 2.2 Cron triggers

`[triggers] crons` is byte-identical in both tables; read it in `wrangler.toml`.
Weekdays are Cloudflare's numbering, 1 = Sunday … 7 = Saturday (the weekly
digest line is `0 9 * * 2`, Monday; D201). `CRON_TRIGGERS`
(`cloudflare-worker/src/util/cronHistory.ts`) mirrors the list, and
`cloudflare-worker/test/cron_record_d201.test.ts` fails when they disagree.
Per-minute lease dedupe is in §5.5.

### 2.3 `[vars]` asymmetries

`[env.production.vars]` declares a few vars the top-level `[vars]` does not;
no var differs in value between the two. The deliberate one is
`EXTRA_DEV_ORIGINS = ""`: an explicit empty string keeps the workers.dev
sandbox origin out of the production CORS allowlist. To list them:

```bash
python3 -c "import tomllib;t=tomllib.load(open('wrangler.toml','rb'));a=t['vars'];b=t['env']['production']['vars'];print(sorted(set(a)^set(b)),[k for k in a if k in b and a[k]!=b[k]])"
```

### 2.4 `[placement]`

**Not set anywhere.** `grep -n 'placement' wrangler.toml` returns nothing.
Smart Placement is off.

### 2.5 The `routes` tables and `[assets]`

Both `[[routes]]` and `[[env.production.routes]]` hold the same two entries:
`axal.vc` and `app.axal.vc`, each a whole-host Workers Custom Domain
(`custom_domain = true`). There are no zone routes at all.

The `[assets]` binding (`directory = "./docs"`,
`not_found_handling = "single-page-application"`) answers the root, the SPA
fallback and the static assets on both hosts from one build. Its
`run_worker_first` list in `wrangler.toml` names the paths the Worker answers
before the assets binding (the API, `/mcp`, the public share and profile
pages, …); read it there rather than here. There is deliberately no
`axal.vc/*` or `axal.vc/assets/*` route: a path-scoped zone route would take
those URLs away from the assets binding and break the SPA fallback, and
`cloudflare-worker/test/apex_cutover_bootstrap.test.mjs` and
`frontend/test/apex_route_coverage.test.mjs` refuse both. The history (the
2026-08-31 Pages cutover, `1d320dda9` on 2026-09-01, the mirror retired on
2026-09-03, `DECISIONS.md` D36) is in `CLAUDE.md` fact 4. Who serves a host is
settled by the deploy log's "Deployed studioos triggers" lines, never by prose.
`docs/_headers` (from `frontend/public/_headers`) sets the security headers on
every response the assets binding serves; the `run_worker_first` paths get
`middleware/securityHeaders.ts` instead.

### 2.6 `[env.preview]` (for completeness)

`studioos-preview`, `workers_dev = true`. It omits Vectorize, `assets` and
`tail_consumers`, and its D1/KV ids are still `REPLACE_WITH_PREVIEW_*`
placeholders (`OAUTH_KV`'s too: preview must never bind HQ's OAuth namespace,
D681), so `npm run deploy:preview` cannot succeed until they are provisioned.
No CI job deploys this environment. Pull-request previews are a separate
Worker per PR with no bindings (D36: Cloudflare generates no preview URL for a
Worker that implements a Durable Object): `wrangler.pr-preview.toml` at the
repo root plus `scripts/pr-preview-worker.mjs`, deployed and deleted by
`.github/workflows/pr-preview.yml`.

---

## 3. Build

```
npm run build      # = node scripts/build-frontend.mjs
```

Never call `vite` directly. `build-frontend.mjs` runs
`scripts/build-generated.mjs`, then the Vite build into `docs/`, then restores
prior builds' hashed `docs/assets/*` so a tab opened before a deploy can still
load its chunks, then runs `scripts/prerender-og.mjs`. The retention policy is
**72 hours, at least three builds including this one, within an 18,000-file
cap** (`ASSET_RETENTION_HOURS`, `ASSET_MIN_BUILDS` and `ASSET_MAX_FILES` in
`scripts/lib/assetRetention.mjs`; `ASSET_RETAIN_BUILDS` can raise the floor,
never lower it). A local build has only what is already in `docs/`; the
deploy restores the previous deploy's `docs/assets` and retention ledger from
the Actions cache first — see `documentation/operations/DEPLOY.md` §2.1.

---

## 4. Deploy — the workflow, never a hand `wrangler deploy`

```
npm run deploy     # = gh workflow run cloudflare-worker-deploy.yml --repo AxalNetwork/StudioOS --ref main
```

`npm run deploy` only **dispatches** `.github/workflows/cloudflare-worker-deploy.yml`
on `main`; the command succeeding means GitHub accepted the dispatch. The same
workflow also runs on **every push to `main`**, so a merge ships without anyone
dispatching it. In order:

1. **`admission`** — `scripts/verify-production-candidate.mjs` waits for the
   required checks on the exact `main` SHA and decides whether it may ship
   (D5501).
2. **`deploy`** (environment `production`, under the
   `studioos-production-release` lock) — rechecks the candidate, builds the SPA
   over the previous deploy's restored assets (§3), checks the AI gateway
   settings, the production queues and the prepared Worker's startup budget,
   records the migration plan and the live Worker version, confirms the
   candidate still owns the release, then **applies pending D1 migrations**
   (`node scripts/migrate-d1.mjs --remote`) and **publishes** with
   `wrangler deploy --config ../wrangler.toml --env production`. It then
   stamps and caches the shipped assets for the next deploy.
3. **`spa-smoke`** — `scripts/check-spa-live.mjs` against both hosts.
4. **`rollback`** — automatic rollback, off unless the repository variable
   `RELEASE_ROLLBACK_MODE` is `report` or `act` (D7152).
5. **`schema-drift`** and **`branches`** — production's schema parity and the
   branch rollout, separate jobs after the deploy.

The runbook is `documentation/operations/DEPLOY.md` (§1 for the release,
§3 for a rollback point, §5 for verifying what shipped). This matches
`CLAUDE.md` fact 1. Do not run `wrangler deploy` for the `studioos` Worker by
hand: it skips admission, the queue and startup checks and the migrations.
`post-deploy-smoke.yml` runs checks after a deploy; it does not perform one.

Related:

- Preview: `npm run deploy:preview` → `--env preview` (§2.6; not provisioned).
- D1 maintenance without a release: `npm run d1:migrate:remote` and the other
  `d1:*` aliases dispatch `.github/workflows/d1-migrate.yml` (§5.1).
- Other Workers ship from their own workflows: `meeting-bot-deploy.yml`,
  `merge-control-deploy.yml`, `archive-observer-deploy.yml`.
- **`studioos-tail` has no deploy workflow.** `archive-observer-deploy.yml`
  triggers on changes under `cloudflare-worker-tail/**` but deploys only
  `cloudflare-archive-observer/wrangler.jsonc`, and no workflow names
  `cloudflare-worker-tail/wrangler.toml`. A merge that changes
  `cloudflare-worker-tail/src/` does not reach production by itself.

---

## 5. Conventions

### 5.1 Migration ledger

`scripts/migrate-d1.mjs` enumerates `cloudflare-worker/sql/migrations/*.sql` in
`compareMigrations` order, consults the **`schema_migrations`** ledger table,
applies only pending files, and records each on success with a checksum.
Forward-only; a failure exits non-zero naming the file. A safety guard refuses
to run against a non-empty database with an empty ledger. Never apply a
migration to `studioos-db` by hand.

| Script | Effect |
| --- | --- |
| `npm run deploy` | the release (§4) applies pending migrations before it publishes |
| `npm run d1:migrate:remote` / `d1:migrate` | dispatch `d1-migrate.yml` on `main` with `mode=apply` |
| `npm run d1:baseline`, `d1:adopt-legacy-ledger`, `d1:verify-marked` | dispatch `d1-migrate.yml` in the matching mode |
| `npm run d1:migrate:local` / `d1:migrate:preview` | the runner directly, against a local D1 or the preview database |
| `npm run d1:audit` | `--audit`, idempotency audit, touches no DB |

`documentation/operations/DEPLOY.md` §1.2 covers the production modes.

### 5.2 Self-healing `ensure*Schema` helpers

Many services create their own tables at runtime with a module-level ready
flag plus `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` inside a
`try/catch` that logs a warning; a few skip it when
`ENVIRONMENT === 'production'`. New DDL belongs in a migration, and
`scripts/check-runtime-ddl.mjs` guards runtime DDL. To see the helpers:

```bash
git grep -n -E 'function ensure[A-Za-z]*(Schema|Columns|Table)\b' -- cloudflare-worker/src | wc -l
```

### 5.3 Money representation — mixed, not uniform

`*_cents` INTEGER columns exist but are **not** a repo-wide convention: the
newer, payment-adjacent subsystems use them, and the older capital, fund and
portfolio subsystems keep money in floating `REAL` columns. **Rule of thumb for
new work:** use integer cents. Do not assume an existing column is cents —
check its DDL:

```bash
git grep -n -E '[a-z_]+_cents\b' -- cloudflare-worker/sql/migrations | head
```

### 5.4 Queue → DLQ → D1 mirror

- Producers: `JOB_QUEUE` → `studioos-job-queue`, `AGENT_QUEUE` →
  `studioos-agent-queue` (see `cloudflare-worker/src/agents/README.md`).
- The Worker's `queue()` handler in `index.ts` hands each batch to
  `dispatchQueue`, which routes it by queue name to `queueConsumer`,
  `dlqConsumer` (both in `cloudflare-worker/src/queue-consumer.ts`) or the
  agent queue's consumers.
- `queueConsumer` claims each delivery with an `INSERT OR IGNORE INTO
  job_idempotency` and gates AI work on a per-minute budget
  (`AI_BUDGET_PER_MIN`), deferring over-budget work with a retry.
- Exhausted messages (`max_retries = 3`) are forwarded by the platform to the
  dead-letter queue; `dlqConsumer` mirrors each into the D1 table
  **`cf_dlq_mirror`** and acks; a mirror failure retries.
- The legacy D1 `queue_jobs` cron drain still runs in parallel, gated by the
  `USE_CF_QUEUE` var.

### 5.5 Cron lease dedupe

The scheduled handler in `cloudflare-worker/src/index.ts` takes a lease in the
`RATE_LIMITS` KV namespace under key `cron:queue:lease`. The value is
`leaseHolderValue(uuid, event.scheduledTime, trigger)` — an id only this tick
knows, the minute it was scheduled for, and the expression that fired it
(D201). If the key is already held it writes its own `cron_run_history` row
through `recordLeaseHeldFire` — `deduped` when the holder was scheduled for the
same minute, `skipped` when it was not — and returns. At the end of the run it
deletes the key only if it still owns it. All per-cadence routing is internal
time gating, so extra cron lines are for dashboard observability and the
per-trigger record HQ · Platform reads, not new behaviour.

### 5.6 API ↔ Worker parity

No `/api/*` method may be added to `frontend/src/lib/api.js` or a module under
`frontend/src/lib/api/` without a matching mounted worker route.

- Enforcer: **`scripts/check-api-drift.mjs`**. It statically resolves the worker
  route graph (hand-written `app.route()` mounts, the self-mount registry and
  nested sub-mounts) and matches on `(METHOD, path)`, normalising Hono params
  and template interpolation. It also checks that every `c.json({…}, >=400)`
  carries an `error` / `detail` / `message` key.
- Baseline: **`scripts/api-drift-baseline.json`** records pre-existing drift so
  the gate fails only on *new* drift. It is a debt ledger — it may only shrink.
  `node -e "const b=require('./scripts/api-drift-baseline.json');for(const k of ['missing_route','missing_method','error_envelope'])console.log(k,b[k].length)"`
  prints its size.
- Where it runs: inside `npm run test:guards` (hence `test:drift`), and as the
  `api ↔ worker drift` job in `.github/workflows/ci.yml`.

---

## 6. Tests — the real script names

Root `npm test` is **not wired** (`echo "Error: no test specified" && exit 1`).
The real suite is **`npm run test:drift`**. It chains the frontend and Worker
suites, the meeting-bot and merge-control suites, the script library tests,
the guards, both type checks, the undefined-name lint and the dark-mode guard;
`package.json` is the list, not this file:

```bash
node -p "require('./package.json').scripts['test:drift']"
```

`npm run test:guards` is `scripts/run-guards.mjs`, which runs the ordered
catalog in `scripts/lib/guardCatalog.mjs`; `node scripts/run-guards.mjs --guard
<id>` reproduces one guard, and `npm run test:guards:preflight` runs the quick
subset. The full suite is long; `.claude/skills/verify-before-push/SKILL.md`
says which parts a change needs.

Other suites: `test:decks` (the deck tests), `test:e2e` (Playwright).

CI (`.github/workflows/ci.yml`) does not run `test:drift` as one job. It cuts
it into parallel parts with `scripts/test-drift-parts.mjs` (`--list` prints
them) and runs them as the `suite (<part>)` matrix, whose `gate` job reports
`test:drift (full suite)`, or `test:drift (draft fast tier)` on a draft PR.
Alongside it are the frontend build, the Worker typecheck, `ci / fast`, the
api-drift job, the Open Graph metadata check and the backend import smoke.
The checks the merge queue requires are listed in
`.github/workflows/README.md` ("The merge queue").

---

## 7. Routing and roles

### 7.1 `ROLE_DEFAULT_PATH` — `frontend/src/App.jsx`

**Seven** entries:

| Role | Default path |
| --- | --- |
| `admin` | `/studio` |
| `founder` | `/studio` |
| `partner` | `/studio` |
| `investor` | `/studio` |
| `advisor` | `/studio` |
| `pending` | `/onboarding/chat` |
| `exploring` | `/exploring` |

`pending` covers fresh Google signups before the onboarding chatbot classifies
them; `exploring` covers chat-completed users awaiting admin role assignment.
`grep -n ROLE_DEFAULT_PATH frontend/src/App.jsx` lists where it is read (the
post-auth redirect, the role-guard notices and `/` for a signed-in user).

### 7.2 `/studio`

One shared role-branching route in `App.jsx`, guarded by
`labRoles(['admin', 'founder', 'partner', 'investor', 'advisor'])`. It renders
`MultiLicenceStudio` when `multiLicenceSet` (`frontend/src/lib/multiLicencePages.js`)
finds more than one held licence on a signed-in, non-admin, non-impersonating
account, and `Dashboard` (`frontend/src/pages/Dashboard.jsx`) otherwise, passing
the effective role as `activeRole`.

Branching inside `Dashboard.jsx` keys on `activeRole`, falling back to the
**server-supplied** `role_view` from `GET /api/dashboard`, not the client
`user.role`.

`/dashboard` is a legacy redirect: `DashboardRedirect` in `App.jsx`
`<Navigate>`s to `/studio` preserving `search` and `hash`.

### 7.3 Founder Portal — gone

No `FounderPortal` component, route, or `founder-portal` path exists anywhere in
`frontend/src`. `frontend/test/founder_portal_removed.test.mjs` guards the
removal. Two sibling guards exist for other deletions
(`spinouts_page_removed.test.mjs`, `studio_ops_removed.test.mjs`).

### 7.4 Active-company context

- Defined in `frontend/src/contexts/ActiveCompanyContext.js` — a bare
  `createContext` plus a `useActiveCompany()` hook. There is **no**
  `ActiveCompanyProvider` component; the raw `ActiveCompanyContext.Provider` is
  used directly, once, inside `ProtectedLayout` in `App.jsx`, wrapping the
  authenticated shell. Value shape:
  `{ company, setCompany, companies, setCompanies }`.
- `frontend/src/ui/CompanySwitcher.jsx` fetches memberships via
  `api.listMyCompanies()` → `GET /company/memberships` (worker route in
  `cloudflare-worker/src/routes/company.ts`, registered before the `:uid`
  param route so `uid="memberships"` can't shadow it), and creates a company
  with `api.createCompany()` → `POST /company/create`.

### 7.5 Who consumes `useActiveCompany()`

The shell (`frontend/src/ui/`, `frontend/src/workspaces/WorkspaceShell.jsx`),
some pages and hooks. The list moves; get it from the tree:

```bash
git grep -l useActiveCompany -- frontend/src
```

`Dashboard`, the component rendered at `/studio`, does not consume it; it
scopes itself server-side via `GET /api/dashboard`'s `role_view`.

D1345 (#3553) retires the peer Messages inbox in favour of Email. `/messages`
redirects through `frontend/src/pages/email/MessagesRedirect.jsx` (EM10). The
Worker entry keeps only 410 tombstones at `/api/messages` and descendants. See
[D1345](decisions/D1345.md).
