# CODEBASE_MAP.md — verified engineering reference

Verified against `origin/main` (branch `claude/spinout-lab-workspace-wuyyqd`,
HEAD `777610a9`) on 2026-08-26. Every count and line reference below was read
from the tree, not carried over from an earlier snapshot.

Where this file and `CLAUDE.md` disagree, the disagreement is called out
inline — see **§4 Deploy** in particular.

---

## 1. Repository layout

### 1.1 `cloudflare-worker/` — the production API (Hono on Workers)

Entry point: `cloudflare-worker/src/index.ts`. This is the live API at
`axal.vc/api/*` and `app.axal.vc`.

| Subdirectory of `src/`   | Files | Notes |
| ------------------------ | ----: | ----- |
| `routes/`                |   151 | 150 `.ts` + `routes/README.md`. **25** files match `admin_*.ts`. |
| `services/`              |   244 | 149 top-level `.ts` plus 8 nested packages: `advisor/`, `calendar/`, `decks/`, `email/`, `market_intel/`, `referrals/`, `signals/`, `wellbeing/`. |
| `templates/`             |    55 | `templates/email/` (`layout.ts`, `registry.ts`) and `templates/legal/` (53 files: 52 `*_v1.md` contracts + `LEGAL_REVIEW.md`). |
| `integrations/`          |    16 | `oauth.ts`, `registry.ts`, `secrets.ts`, `autopush.ts` + `mappings/`, `providers/`. |
| `util/`                  |    14 | `d1Retry.ts`, `paymentMode.ts`, `url.ts`, `cronHistory.ts`, `webauthn.ts`, … |
| `middleware/`            |    10 | `csrf.ts`, `rateLimit.ts`, `observability.ts`, `securityHeaders.ts`, `cfAccess.ts`, `requireTier.ts`, `requireInvestorTier.ts`, `miAccess.ts`, `lastActive.ts`, `recoveryCoolOff.ts`. |
| `models/`                |     4 | `funds.ts`, `jobs.ts`, `liquidity.ts`, `distributions.ts`. |
| `data/`                  |     2 | `sectors.ts`, `expertCategories.ts`. |
| `durable-objects/`       |     2 | `pipeline-room.ts`, `onboarding-chat.ts`. |

Tests live in `cloudflare-worker/test/` — **122** files.

### 1.2 `frontend/` — React 19 + Vite 8 SPA

`frontend/src/`:

- `App.jsx` — 2,190 lines, **289** `<Route>` elements, all route/role policy.
- `lib/api.js` — 3,621 lines, **552** `request('/…')` call sites; `export const api = {` at line 276. `lib/` also holds ~48 other modules (PDF builders, view models, funnel, SEO).
- `sidebarConfig.js` — 547 lines.
- `pages/` — 178 `.jsx` files plus 13 subdirectories (`admin/`, `advisor/`, `captable/`, `docs/`, `events/`, `growth/`, `insights/`, `jobs/`, `partner/`, `pipeline/`, …).
- `components/` — 136 `.jsx` recursively, 12 subdirectories (`command-center/`, `advisor/`, `brand/`, `profile/`, `spinout/`, `cofounder/`, `scoring/`, `signals/`, `products/`, `play/`, `discovery/`, `events/`).
- `contexts/` — `ActiveCompanyContext.js`, `SettingsContext.jsx`, `ViewModeContext.js`.
- Also `hooks/`, `brand/`, `data/`, `decks/`, `templates/`, `index.css`, `main.jsx`.

**Styling** is Tailwind **v4**, wired as a Vite plugin — `import tailwindcss from
'@tailwindcss/vite'` in `frontend/vite.config.js:3`, used at line 7. There is no
`tailwind.config.js`; v4 configures from CSS.

**Dark-mode guard** is `scripts/check-dark-mode.mjs` — a repo-root guard script,
not a file under `frontend/test/`. It fails when a `className` in
`frontend/src/{pages,components}` uses `bg-white`, `text-gray-700/800/900`, or
`border-gray-200/300` without a `dark:` counterpart in the same string, with an
allowlist for marketing/auth/print surfaces. Auto-fixer:
`scripts/codemod-dark-mode.mjs`. It runs as the last step of `npm run test:drift`.

`frontend/test/` holds **37** `*.test.mjs` files, including three deletion
guards: `founder_portal_removed.test.mjs`, `spinouts_page_removed.test.mjs`,
`studio_ops_removed.test.mjs`.

### 1.3 `cloudflare-worker/sql/` — D1 schema (canonical)

- `cloudflare-worker/sql/migrations/` holds **177** `.sql` files.
  Numeric prefixes run `001`–`175` with **`050` absent** and **three prefixes
  reused twice**: `011_sms_2fa.sql` / `011_subscription_tiers.sql`,
  `068_news_articles.sql` / `068_x_twitter.sql`,
  `118_captable_scenario_variants.sql` / `118_project_product_demo.sql`
  (174 distinct numbers, 177 files). Reused prefixes are **not** an
  ordering hazard: `compareMigrations` (`scripts/lib/migrationPlan.mjs:35-40`)
  sorts on the numeric prefix and then breaks ties on the full filename, so
  apply order is deterministic.
- `cloudflare-worker/sql/` itself also holds 33 non-ledger `.sql` files —
  `schema.sql` plus one-off feature scripts (`liquidity.sql`, `funds_v2.sql`,
  `infrastructure.sql`, `spinout_lab.sql`, …). These are **not** part of the
  ledger run; only `migrations/*.sql` is.

### 1.4 `docs/` — SPA build output

`docs/` is the committed Vite build output (`frontend/vite.config.js:43-44`:
`outDir: ../docs`, `emptyOutDir: true`) and is served as Worker Static Assets
(`[assets] directory = "./docs"`). Never hand-edited: staleness is enforced by
`scripts/check-docs-fresh.mjs`, a commit-based check (last commit touching
`frontend/src` vs. last commit touching `docs/`), run inside `test:guards` and
again as `--strict` in the `og-tags` CI job.

### 1.5 `scripts/`

Confirmed present, plus ~25 more:

- `build-frontend.mjs` — `npm run build`. Runs `vite build` into `docs/`, then
  restores a bounded window of prior builds' hashed `docs/assets/*`
  (`ASSET_RETAIN_BUILDS`, default 3; pure planner in `scripts/lib/assetRetention.mjs`),
  then runs `scripts/prerender-og.mjs` for per-route OG metadata.
- `migrate-d1.mjs` — the migration ledger runner (see §5.1).
- `lfs-size-gate.mjs` — LFS/large-file budget gate; also a CI job
  (`.github/workflows/lfs-budget.yml`) and an installable pre-commit hook.

### 1.6 `backend/` — dev-only FastAPI

Never deployed. `wrangler.toml`'s `main` is `cloudflare-worker/src/index.ts`.
CI's only backend job is `dev backend (import smoke)` in
`.github/workflows/ci.yml` — an import smoke test, not a deploy. No workflow
in `.github/workflows/` deploys anything; production deploys are run by hand
via `npm run deploy`.

### 1.7 `cloudflare-worker-tail/` — tail consumer worker

Separate worker `studioos-tail` (`cloudflare-worker-tail/wrangler.toml`), one
R2 binding `LOGS` → bucket **`studioos-logs`** (distinct from the three buckets
bound to the main worker), `RETENTION_DAYS = "2555"` (7 years). Producer→consumer
wiring lives entirely in the root `wrangler.toml` under both
`[[tail_consumers]]` and `[[env.production.tail_consumers]]`; the consumer must
NOT declare `[[tail_consumers]]` itself.

---

## 2. Cloudflare bindings — top-level vs `[env.production]`

Wrangler does not inherit binding tables into named environments, so both
tables matter. `npm run deploy` uses `--env production`, which makes the
`[env.production.*]` column the one that actually ships (see §4).

**Every binding is mirrored. There is no missing-binding asymmetry.**

| Binding | Top-level | `[env.production]` | Value |
| --- | --- | --- | --- |
| D1 `DB` | ✅ L371 | ✅ L855 | `studioos-db`, id `16a23acd-c82e-4ff1-a6c0-408e3eb014c8` |
| KV `TOKENS` | ✅ L379 | ✅ L860 | `8dc26ed83d154d0ebbfcbc51f592d67c` |
| KV `RATE_LIMITS` | ✅ L383 | ✅ L864 | `be811f14b6f342be961b8daa4513fb5b` |
| KV `AI_SPEND` | ❌ commented out L397-406 | ❌ | Planned only. `services/aiRouter.ts` falls back to `TOKENS` with `ai_spend:` / `ai_cache:` / `ai_killswitch:` prefixes. |
| Workers AI `AI` | ✅ L388 | ✅ L868 | — |
| Queue producer `JOB_QUEUE` | ✅ L416 | ✅ L871 | `studioos-job-queue` |
| Queue consumer (main) | ✅ L420 | ✅ L875 | batch 25 / 10s, `max_retries = 3`, DLQ `studioos-job-queue-dlq` |
| Queue consumer (DLQ) | ✅ L432 | ✅ L884 | batch 10 / 5s, `max_retries = 3` |
| DO `PIPELINE_ROOM` → `PipelineRoom` | ✅ L450 | ✅ L890 | — |
| DO `ONBOARDING_CHAT` → `OnboardingChat` | ✅ L454 | ✅ L894 | — |
| DO migration tag `v1-realtime` | ✅ L458 | ✅ L898 | `new_sqlite_classes` |
| Vectorize `VECTORIZE` | ✅ L469 | ✅ L902 | index `axal-search` |
| R2 `FILES` | ✅ L478 | ✅ L906 | `studioos-files` |
| R2 `PUBLICATIONS` | ✅ L487 | ✅ L910 | `studioos-publications` |
| R2 `BACKUPS` | ✅ L500 | ✅ L916 | `studioos-backups`; object-lock 365d compliance mode + IA-after-30d are **dashboard-configured, not in the TOML**. Binding is optional at runtime — `services/backup.ts` no-ops when absent. |
| Analytics Engine `ANALYTICS` | ✅ L513 | ✅ L920 | dataset `studioos_metrics` |
| Browser Rendering `BROWSER` | ✅ L522 | ✅ L924 | — |
| Static Assets `ASSETS` | ✅ L291 | ✅ L929 | `./docs`, SPA fallback, `run_worker_first = ["/api/*","/landing/*","/p/*","/assets/*"]` |
| Tail consumer | ✅ L587 | ✅ L942 | `studioos-tail` (non-inheritable, correctly mirrored) |
| Cron triggers | ✅ L534 | ✅ L945 | Six, identical in both — see §2.2 |
| `[vars]` | ✅ L324 | ✅ L833 | See §2.3 for the one difference |
| `[[rules]]` (Text loader) | ✅ L304 | — not mirrored | `globs = ["**/legal/*md*"]`. `rules` is an **inheritable** Wrangler key, so `--env production` still gets the loader. Required by the 9 `…md?raw` imports in `services/legalTemplates.ts`. |
| `[observability]` | ✅ L566-585 | — not mirrored | `observability` is inheritable (confirmed against the installed Wrangler). |

### 2.1 Things the claim list called bindings that are not bindings

- **AI Gateway `advisor-ongoing`** is not a binding. It is a plain var,
  `CF_AI_GATEWAY_SLUG_ADVISOR = "advisor-ongoing"`, present in **both**
  `[vars]` (L360) and `[env.production.vars]` (L847), read at
  `services/aiRouter.ts:393` and `services/advisor/aiClient.ts:115`, and passed
  as `{ gateway: { id } }` to `env.AI.run()`. Missing/unknown slug degrades to
  un-gatewayed, no breakage.
- **`ai_usage_logs`** is a D1 table
  (`cloudflare-worker/sql/migrations/040_ai_usage_logs.sql`), written by
  `services/aiRouter.ts` and read by `routes/monitoring.ts` — not a binding.
- **Turnstile** has no binding either. The Worker reads the
  `TURNSTILE_SECRET_KEY` **secret** (`services/turnstile.ts`; fails open with a
  warning when unset); the SPA reads the public site key from the build-time
  `VITE_TURNSTILE_SITE_KEY`. `wrangler.toml` mentions it only in comments
  (L363-368).

### 2.2 Cron triggers

Six, byte-identical in both tables:

```
* * * * *      queue drain + sub-minute internal dispatch
0 3 * * *      daily cleanup (legacy)
0 */6 * * *    market-intel free connectors refresh
0 4 * * *      market-intel composite + daily snapshot
0 9 * * *      daily digest emails
0 9 * * 1      weekly digest emails (Monday)
```

Per-minute lease dedupe is real — see §5.4.

### 2.3 The one `[vars]` asymmetry

`[env.production.vars]` declares `EXTRA_DEV_ORIGINS = ""` (L852); the top-level
`[vars]` does not declare it at all. This is deliberate: an explicit empty
string keeps the workers.dev sandbox origin out of the production CORS
allowlist. Every other var is identical across the two tables.

### 2.4 `[placement]`

**Not set anywhere.** `grep -n 'placement' wrangler.toml` returns nothing.
Smart Placement is off.

### 2.5 The `routes` tables

Both `[[routes]]` and `[[env.production.routes]]` contain **two entries each**,
and a normalised diff of the two shows them **identical**: `axal.vc` and
`app.axal.vc`, each a whole-host Workers Custom Domain (`custom_domain = true`).
There are no zone routes at all.

The apex is served by the Worker (revised 2026-09-03 — from the 2026-08-31
Pages cutover until then this section read "the apex remains on Cloudflare
Pages" over a four-entry table of `app.axal.vc` plus `axal.vc/api/*`,
`axal.vc/landing/*` and `axal.vc/p/*`). `1d320dda9` (2026-09-01, "Remove stale
documentation asset files" — a message that does not mention routing) replaced
those three path routes with the `axal.vc` custom domain in both tables, so the
`[assets]` binding (`directory = "./docs"`,
`not_found_handling = "single-page-application"`, `run_worker_first` for
`/api/*`, `/landing/*`, `/p/*` and `/assets/*`) answers the root, the SPA
fallback and the static assets on both hosts from one build. There is
deliberately no `axal.vc/*` or `axal.vc/assets/*` route: a path-scoped zone
route would take those URLs away from the assets binding and break the SPA
fallback, and `cloudflare-worker/test/apex_cutover_bootstrap.test.mjs` and
`frontend/test/apex_route_coverage.test.mjs` refuse both. Cloudflare Pages
(`studioos-2p8.pages.dev`) is a mirror of `docs/` with no production hostname
(`UNRESOLVED_ITEMS.md` U9). Who serves a host is settled by the deploy log's
"Deployed studioos triggers" lines and the Pages dashboard's Domains line,
never by prose.

### 2.6 `[env.preview]` (for completeness)

`studioos-preview`, `workers_dev = true`. Mirrors D1/KV/AI/Queues/DOs/migrations
/R2/Analytics/Browser/triggers, but **omits** Vectorize, the `PUBLICATIONS` and
`BACKUPS` R2 buckets, `assets`, and `tail_consumers`. D1/KV ids are still
`REPLACE_WITH_PREVIEW_*` placeholders, so the preview deploy is gated on the
`CLOUDFLARE_PREVIEW_READY` repo variable.

---

## 3. Build

```
npm run build      # = node scripts/build-frontend.mjs
```

Never call `vite` directly: `build-frontend.mjs` wraps the Vite build with
hashed-asset retention (the previous 3 builds' `docs/assets/*` are restored so
the Worker can still serve the prior build's hashes during a deploy window) and
then runs `scripts/prerender-og.mjs`. Output lands in `docs/`.

---

## 4. Deploy — `--env production`, not top-level

```
npm run deploy
# predeploy : node scripts/migrate-d1.mjs --remote
# deploy    : npm run build
#             && cd cloudflare-worker
#             && npx wrangler deploy --config ../wrangler.toml --env production
# postdeploy: node scripts/check-spa-live.mjs
```

`PRODUCTION.md:53-63` records this explicitly:

> **Verified 2026-05-06:** `--env production` IS the correct deploy command. …
> An earlier note in this file warned against `--env production` because the env
> block historically didn't redeclare bindings; that's no longer true.

**`CLAUDE.md` fact #1 is stale on this point.** It still says deploys go via
`npx wrangler deploy` at top level "not `--env production`". The actual npm
script, `PRODUCTION.md`, and the fully-mirrored `[env.production.*]` block all
say otherwise. The top-level config remains deployable and fully bound (that is
why both tables are kept in lockstep), but it is not the path anyone runs.

Related:

- Preview deploy: `npm run deploy:preview` → `--env preview`.
- Tail worker deploys separately: `cd cloudflare-worker-tail && npx wrangler deploy`.
- Nothing in `.github/workflows/` deploys the Worker. `post-deploy-smoke.yml`
  runs after a deploy, it does not perform one.

---

## 5. Conventions

### 5.1 Migration ledger

`scripts/migrate-d1.mjs` enumerates `cloudflare-worker/sql/migrations/*.sql` in
numeric order, consults the **`schema_migrations`** ledger table, applies only
pending files, and records each on success with a checksum. Forward-only; a
failure exits non-zero naming the file. A safety guard refuses to run against a
non-empty database with an empty ledger. `--baseline` exists for the one-time
adoption of the ~124 hand-applied prod migrations.

Entry points:

| Script | Effect |
| --- | --- |
| `npm run d1:migrate:remote` | `migrate-d1.mjs --remote` — the production runner |
| `npm run d1:migrate:local` / `:preview` | same runner, other targets |
| `npm run d1:baseline` | `--remote --baseline`, one-time per environment |
| `npm run d1:audit` | `--audit`, idempotency audit, touches no DB |
| `npm run d1:migrate` | **not** the ledger runner — raw `wrangler d1 execute --remote --file=sql/schema.sql` |
| `predeploy` hook | runs `migrate-d1.mjs --remote` automatically on every `npm run deploy` |

So `d1:migrate:remote` is the canonical *manual* command, but migrations also
run automatically as part of `npm run deploy`, and `d1:migrate` is a separate,
non-ledger escape hatch.

### 5.2 Self-healing `ensure*Schema` helpers

**121** helpers match `ensure*Schema` / `ensure*Columns` / `ensure*Table`
across `cloudflare-worker/src/`. The dominant pattern is a module-level
`_ready` / `_xSchemaReady` boolean plus `CREATE TABLE IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS` inside a `try/catch` that logs a warning — see
`services/advisor/guardrails.ts:490-502`.

Only **10** of the 121 short-circuit on `ENVIRONMENT === 'production'`:
`services/teamSchema.ts`, `services/jobBoardSchema.ts`,
`services/referralCommissions.ts`, `services/referralSubmissions.ts`,
`services/profileExpansion.ts`, `services/networkProfilesSchema.ts`,
`services/circlesSchema.ts`, `services/eventsSchema.ts`, `routes/public.ts`,
`routes/follows.ts`. The other 111 run their idempotent DDL once per isolate
in every environment, production included.

### 5.3 Money representation — mixed, not uniform

`*_cents` INTEGER columns exist but are **not** a repo-wide convention. 15
distinct `*_cents` column names appear across 11 SQL files — the newer,
payment-adjacent subsystems: `liquidity.sql`, `funds_v2.sql`, `schema.sql`,
`migrations/034`, `058_refer_earn_payouts`, `070_wellbeing_experts_v2`,
`086_incorporations`, `109_events_core`, `140_investor_profile_unify`,
`152_cart_orders`, `168_portfolio_marks_distributions`. Names:
`amount_cents`, `amount_usd_cents`, `price_cents`, `total_cents`,
`subtotal_cents`, `vat_cents`, `discount_cents`, `valuation_cents`,
`ai_valuation_cents`, `asking_price_cents`, `executed_price_cents`,
`proposed_price_cents`, `fund_size_cents`, `min_check_cents`, `max_check_cents`.

Everywhere else money is a floating `REAL` — roughly 50 distinct money-ish
`REAL` columns, concentrated in the older capital/fund/portfolio subsystems:
`commitment_amount`, `invested_amount` (`infrastructure.sql:26-27`,
`migrations/126_portfolio_positions.sql:14`), `amount`
(`migrations/151_deal_flow.sql:25`, `migrations/145_raise_rounds.sql:48`,
`consolidate_capital_rebuild.sql:34`), `price` (`t13_t14_t15.sql:350,371`),
`current_valuation`, `distribution_total`, `management_fee`, `mrr_usd`,
`arr_usd`, `monthly_burn_usd`, `ai_spend_usd`, …

**Rule of thumb for new work:** use integer cents. Do not assume an existing
column is cents — check the DDL.

### 5.4 Queue → DLQ → D1 mirror

- Producer: `JOB_QUEUE` → `studioos-job-queue`.
- Main consumer `queueConsumer` (`cloudflare-worker/src/queue-consumer.ts:121`)
  dispatches through `handleJob()` from `services/queueWorker.ts`, with an
  atomic `INSERT OR IGNORE INTO job_idempotency` delivery claim and a
  per-minute AI budget gate (`AI_BUDGET_PER_MIN = 5`, KV `ai:budget:{minute}`)
  that defers over-budget work with `message.retry({ delaySeconds: 60 })`.
- `max_retries = 3`; exhausted messages are forwarded by the platform to
  `studioos-job-queue-dlq`.
- DLQ consumer `dlqConsumer` (`queue-consumer.ts:95-119`) mirrors each exhausted
  message into the D1 table **`cf_dlq_mirror`** (`message_id`, `job_type`,
  `payload`, `attempts`, `error`, `received_at`) and acks; a mirror failure
  retries.
- Fan-out is by queue name: `cloudflare-worker/src/index.ts:1832-1835` routes
  `batch.queue?.includes('dlq')` to `dlqConsumer`, everything else to
  `queueConsumer`.
- The legacy D1 `queue_jobs` cron drain still runs in parallel, gated by the
  `USE_CF_QUEUE` var (currently `"true"`).

### 5.5 Cron lease dedupe

`cloudflare-worker/src/index.ts:1217-1230` — the scheduled handler takes a lease
in the `RATE_LIMITS` KV namespace under key `cron:queue:lease` with a
`crypto.randomUUID()` holder token and `expirationTtl: 90`. If the key is
already held it logs `[cron] drain skipped — lease held` and returns; at the end
of the run (line 1823) it deletes the key only if it still owns it. This is what
keeps the `* * * * *` trigger from colliding with the daily/weekly triggers on
a shared wall-clock minute. All per-cadence routing is internal time gating
(`now.getUTCHours()` / `getUTCMinutes()`), so extra cron lines are for dashboard
observability, not new behaviour.

### 5.6 API ↔ Worker parity

The rule holds — no `/api/*` method may be added to `frontend/src/lib/api.js`
without a matching worker route — but the enforcement has a debt ledger.

- Enforcer: **`scripts/check-api-drift.mjs`**. It statically resolves the worker
  route graph (following `app.route()` mounts and nested sub-mounts) and matches
  on `(METHOD, path)`, normalising Hono params and template interpolation to
  `:p`. It additionally checks that every `c.json({…}, >=400)` carries an
  `error` / `detail` / `message` key.
- Baseline: **`scripts/api-drift-baseline.json`** records pre-existing drift so
  the gate fails only on *new* drift. Current contents: **58** `missing_route`
  entries, **0** `missing_method`, **0** `error_envelope`. The file is a debt
  ledger — it may only shrink.
- Where it runs: inside `npm run test:guards` (hence inside `test:drift`), and
  again as its own `api ↔ worker drift` CI job in `.github/workflows/ci.yml:102-111`.

---

## 6. Tests — the real script names

Root `npm test` is **not wired** (`echo "Error: no test specified" && exit 1`).
The real suite is `npm run test:drift`, and it **subsumes** the worker and
frontend tests rather than sitting alongside them:

```
test:drift = test:frontend         # 37 files, frontend/test/*.test.mjs
          && test:worker           # 122 files, cloudflare-worker/test/*.test.{ts,mjs}
          && test:retention        # scripts/lib/assetRetention.test.mjs
          && test:guards           # 8 guard scripts, below
          && test:types            # cd cloudflare-worker && tsc --noEmit
          && node scripts/check-dark-mode.mjs
```

`test:guards` runs, in order:
`check-api-drift.mjs`, `check-sql-unsafe.mjs`, `check-tail-consumer.mjs`,
`check-advisor-bank-drift.mjs`, `check-statemachine-coverage.mjs`,
`check-deck-templates.mjs`, `check-deck-payload-wiring.mjs`,
`check-docs-fresh.mjs`.

Other suites: `test:decks` (6 deck tests), `test:e2e` (Playwright).

CI (`.github/workflows/ci.yml`) runs `npm run test:drift` as one job plus
separate jobs for frontend build, worker typecheck, the api-drift checker on its
own, OG metadata freshness, the LFS size gate, the backend import smoke, and
three dependency audits.

---

## 7. Routing and roles

### 7.1 `ROLE_DEFAULT_PATH` — `frontend/src/App.jsx:281-298`

**Seven** entries, not five:

| Role | Default path |
| --- | --- |
| `admin` | `/studio` |
| `founder` | `/studio` |
| `partner` | `/partner-portal` |
| `investor` | `/studio` |
| `advisor` | `/office-hours` |
| `pending` | `/onboarding/chat` |
| `exploring` | `/exploring` |

`pending` covers fresh Google signups before the onboarding chatbot classifies
them; `exploring` covers chat-completed users awaiting admin role assignment.
Consumed at App.jsx:1345 (post-auth redirect), 1398 (view-mode switch), 1425
(impersonation), and 1597 (`/` for a signed-in user).

### 7.2 `/studio`

One shared role-branching route (`App.jsx:1717`):

```jsx
<Route path="/studio" element={guard(labRoles(['admin','founder','partner','investor','advisor']), <Dashboard />)} />
```

`Dashboard` is lazy-loaded at App.jsx:34 from `./pages/Dashboard`.
Note `partner` is inside the `/studio` guard even though `ROLE_DEFAULT_PATH`
lands partners on `/partner-portal` — partners may reach `/studio`, they just
don't default there.

Branching inside `Dashboard.jsx` keys on the **server-supplied**
`data.role_view` from `GET /api/dashboard`, not the client `user.role`
(`Dashboard.jsx:146-149`: `isInvestor = role_view === 'investor'`,
`isOperator = role_view === 'founder' || 'admin' || has assigned tasks`).
`user.role` is used only for the `<RoleBadge>` (line 168).

`/dashboard` is a legacy redirect: `DashboardRedirect` (App.jsx:303-305)
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
  used directly.
- Provided **once**, inside `ProtectedLayout` (declared App.jsx:901): the
  provider opens at **App.jsx:994** and closes at **App.jsx:1097**, wrapping the
  entire authenticated shell (sidebar + routed content). Value shape:
  `{ company, setCompany, companies, setCompanies }`.
- `CompanySwitcher` (App.jsx:471) fetches memberships via
  `api.listMyCompanies()` → `GET /company/memberships`
  (`frontend/src/lib/api.js:2086`; worker route
  `cloudflare-worker/src/routes/company.ts:139`, registered before the `:uid`
  param route so `uid="memberships"` can't shadow it). It sets `companies` and,
  if nothing is selected, activates `arr[0]` (the API returns
  `is_primary_admin` first).
- The **"Add a new company" button is disabled** (App.jsx:539, label at 544,
  `title="Creating additional companies is coming soon"`) even though the full
  path works end to end: `api.createCompany()` at `lib/api.js:2092` posts to
  `/company/create`, and the worker implements
  `r.post('/company/create')` at `cloudflare-worker/src/routes/company.ts:164`.
  The block is UI-only, pending "task #5" per the comment at App.jsx:469.

### 7.5 Who actually consumes `useActiveCompany()`

The complete list — three call sites in two files:

| File | Line | What it takes |
| --- | --- | --- |
| `frontend/src/App.jsx` (inside `CompanySwitcher`) | 472 | `{ company, setCompany, companies, setCompanies }` — imported aliased as `_useActiveCompany` (App.jsx:7) |
| `frontend/src/pages/CompanySettingsPage.jsx` | 62 | `{ company: activeCompany }` |
| `frontend/src/pages/CompanySettingsPage.jsx` | 106 | `{ setCompany }` |

**`Dashboard` — the component rendered at `/studio` — does not consume it.**
`grep useActiveCompany frontend/src/pages/Dashboard.jsx` returns zero matches.
The active company is effectively a sidebar-widget + settings-page concern;
`/studio` scopes itself server-side via `GET /api/dashboard`'s `role_view`
payload instead.
