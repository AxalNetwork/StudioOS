# Axal StudioOS – Production Deployment Guide

Single source of truth for deploying StudioOS to production. Covers the
Cloudflare Worker (canonical production API, and the SPA on both `axal.vc`
and `app.axal.vc`), the frontend bundle it serves, secrets, and the
post-deploy checklist.

---

## 1. Architecture in 30 seconds

| Component        | Tech                       | Hosted on                              | Source                                          |
| ---------------- | -------------------------- | -------------------------------------- | ----------------------------------------------- |
| **Public API**   | **TypeScript + Hono**      | **Cloudflare Workers** (`axal.vc`)     | `cloudflare-worker/src/index.ts` + `routes/`    |
| Database         | Cloudflare D1 (SQLite)     | Cloudflare (`studioos-db`)             | bound as `env.DB`                               |
| WebSocket fan-out| Durable Objects            | Cloudflare Workers                     | `cloudflare-worker/src/durable-objects/`        |
| Cache / sessions | KV                         | Cloudflare KV (`TOKENS`, `RATE_LIMITS`)| n/a                                             |
| Job queue        | Cloudflare Queues + cron   | Cloudflare                             | `cloudflare-worker/src/services/queueWorker.ts` |
| File storage     | R2                         | Cloudflare R2 (`studioos-files`)       | bound as `env.FILES`                            |
| Vector search    | Vectorize                  | Cloudflare (`axal-search`)             | bound as `env.VECTORIZE`                        |
| Dev backend      | FastAPI (Python)           | Local Replit only                      | `backend/`                                      |
| Frontend         | React + Vite               | **Cloudflare Workers** — the `studioos` Worker's `[assets]` copy of `docs/`, on `axal.vc` + `app.axal.vc` | `frontend/`                                     |

> **Architecture reality (revised 2026-04-28):** Earlier "audit #4" notes proposed
> making FastAPI the canonical backend with the worker as a thin proxy via
> `FASTAPI_ORIGIN`. That migration was never completed: the 23 production user
> accounts live in D1, which only the worker can reach, and FastAPI is not
> publicly deployed. The Cloudflare Worker is therefore the production API and
> the source of truth for `/api/*`. FastAPI in `backend/` is the local dev
> backend used during Replit iteration; do not point production traffic at it.

---

## 2. Release blockers (run before every prod deploy)

- [ ] **`POST /api/search/backfill`** — re-vectorise legacy semantic-search
      rows (audit #7). The runtime scrub keeps queries safe but old vectors
      stay stale until the backfill runs. Trigger it once after every schema
      change that touches a `*_embedding` column. Admin-only.
- [ ] Confirm `JWT_SECRET` is set on the worker
      (`wrangler secret put JWT_SECRET`). The worker fails fast at the top of
      every request if it's missing or weak.
- [ ] Confirm wrangler is authenticated against the right Cloudflare account
      (`wrangler whoami`).

---

## 3. Deploy

### Cloudflare Worker (production API)

```bash
wrangler secret put JWT_SECRET   # used for auth + Durable Object WS handshake
npm run deploy                   # from the REPOSITORY ROOT
```

`npm run deploy` is not a synonym for `wrangler deploy`. npm expands it into
three scripts: `predeploy` applies pending D1 migrations
(`scripts/migrate-d1.mjs --remote`), `deploy` builds the frontend and then runs
`wrangler deploy --config ../wrangler.toml --env production`, and `postdeploy`
probes the live site (`scripts/check-spa-live.mjs`). Running wrangler by hand —
or running `npm run deploy` from inside `cloudflare-worker/`, where the script
omits `--env production` — skips the migration hook and ships the worker ahead
of its schema.

**The full procedure, with pre-flight, migration-failure triage and rollback, is
[documentation/operations/DEPLOY.md](../operations/DEPLOY.md).**

> ✅ **Verified 2026-05-06:** `--env production` IS the correct deploy command.
> The `[env.production.*]` block in `wrangler.toml` redeclares
> every binding (D1, KV `TOKENS`/`RATE_LIMITS`, R2 `studioos-files`, Queue
> `studioos-job-queue`, AI, Durable Objects), so the live worker has all bindings
> intact — confirmed by `GET /accounts/.../workers/scripts/studioos/bindings`.
> An earlier note in this file warned against `--env production` because the env
> block historically didn't redeclare bindings; that's no longer true.

### Frontend

There is no separate frontend deploy. `axal.vc` and `app.axal.vc` are both
whole-host Workers Custom Domains of the `studioos` Worker (`wrangler.toml`
`[[routes]]` and `[[env.production.routes]]`, each `custom_domain = true`),
and the Worker serves the SPA on both from its own `[assets]` binding
(`directory = "./docs"`, `not_found_handling = "single-page-application"`,
`run_worker_first` for `/api/*`, `/landing/*`, `/p/*` and `/assets/*`). One
build sits behind both hosts and they ship together on every
`wrangler deploy` — `npm run deploy` by hand, or
`.github/workflows/cloudflare-worker-deploy.yml` on every push to `main`. A
deploy's closing `Deployed studioos triggers: axal.vc (custom domain),
app.axal.vc (custom domain)` lines are what settle who serves the hosts.

That has been the shape since 2026-09-01 (`1d320dda9`, "Remove stale
documentation asset files", which replaced the Pages cutover's three
path-scoped apex routes with the whole-host `axal.vc` custom domain). The
`studioos` Cloudflare Pages project (`studioos-2p8.pages.dev`) still receives
a build from `cloudflare-pages-deploy.yml` on every push, but it serves no
production hostname: it is a mirror, and a "Production" deployment in its
dashboard is not evidence that the Worker shipped (on 2026-09-03 the mirror
advanced twice while both hosts stayed on the previous build, because the
Worker deploy failed in its migration step). Its retirement is
`documentation/architecture/UNRESOLVED_ITEMS.md` U9.

`docs/` is still committed by hand, for review and for
`scripts/check-docs-fresh.mjs`. **No workflow commits it** — `ci.yml` builds
the frontend to typecheck it and then *validates* that the committed `docs/`
matches, but never writes the directory back — while both CI deploy workflows
*rebuild* it from source at deploy time, so the committed bytes are what
reviewers read, not necessarily what ships (DEPLOY.md §2.1). Run the build at
the REPO ROOT (`npm run build`, which also prerenders the crawlable routes)
and commit the result in the same PR as the source change.

### FastAPI (dev only)

`backend/` runs in the local Replit workflow `Backend API` for development.
It's not part of the production deploy path.

---

## 4. Secrets checklist

### Cloudflare Worker (required)
- [ ] `JWT_SECRET` – 64+ random chars (`openssl rand -hex 48`); the worker
      refuses requests if it's missing or weak.

### Cloudflare Worker (optional, per feature)
- [ ] `GITHUB_ACCESS_TOKEN` – ticket → GitHub-issue sync.
- [ ] `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` – outbound email.
- [ ] `STRIPE_ATLAS_API_KEY`, `STRIPE_WEBHOOK_SECRET` – spin-out incorporation.
- [ ] `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET` – KYC.
- [ ] `OPENAI_API_KEY` – AI scoring fallback (Workers AI is the primary).
- [ ] `TURNSTILE_SECRET_KEY` – bot protection on register / login.

### GitHub Actions secrets
- [ ] `CLOUDFLARE_API_TOKEN` – scoped: `Workers Scripts:Edit`, `Workers KV:Edit`, `Workers AI:Read`.
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `SLACK_DEPLOY_WEBHOOK_URL` – optional, failure notifications.

---

## 5. Post-deploy checklist

- [ ] `curl https://axal.vc/api/health` returns `{ "status": "ok", ... }` with
      every binding flag (`db`, `kv_tokens`, `kv_rate_limits`,
      `durable_pipeline`, `durable_onboarding`) reading `true`.
- [ ] Sign in to `https://axal.vc/dashboard` — verify all sub-queries resolve (no 500s).
- [ ] Submit a support ticket — verify it appears in `AxalNetwork/StudioOS`.
- [ ] Trigger `POST /api/search/backfill` (admin-only) once.
- [ ] Run a manual partner-scoring job; verify `partner_scores` rows.
- [ ] Send a test email from the admin panel to verify Gmail OAuth.
- [ ] Confirm cron is firing — `wrangler tail` should show `[cron] drain` lines.

---

## 6. Rate limits (audit #8)

The worker enforces per-bucket limits via KV (`RATE_LIMITS`). FastAPI mirrors
the same layout for local-dev parity. See
`cloudflare-worker/src/services/rateLimit.ts` and
`backend/app/services/rate_limit.py`.

| Bucket    | Limit          | Scope    | Applies to                                              |
| --------- | -------------- | -------- | ------------------------------------------------------- |
| `spinout` | 5 / hour       | per user | `POST/PUT/PATCH /api/legalcap/spinout/*`                |
| `ai`      | 10 / minute    | per user | `/api/scoring/`, `/api/matches/`, `/api/advisory/`, `/api/profiling/`, `/api/monitoring/anomalies` |
| `user`    | 60 / minute    | per user | All `/api/*`                                            |
| `global`  | 1000 / minute  | global   | All `/api/*` (burst protection)                         |

Exempt: `/api/health`, `/api/auth/login|register|verify|me`, `/api/monitoring/metrics|rate-limits`.

---

## 7. Rollback

```bash
# Worker + SPA — one deployment carries the script and its [assets] bundle,
# so both hosts (axal.vc, app.axal.vc) roll back together. Run from
# cloudflare-worker/ with the production config, as DEPLOY.md §3 does.
npx wrangler deployments list --config ../wrangler.toml --env production
npx wrangler rollback <DEPLOYMENT_ID> --config ../wrangler.toml --env production

# Then revert the source on main. Reverting the docs/ commit alone changes
# nothing live: both deploy workflows rebuild docs/ from source at deploy
# time, and the next push to main would re-ship the bad build.
git revert <SHA-of-the-source-change>
git push
```

Rollback reverts the worker (and with it the SPA), not D1 — see
[DEPLOY.md §3](../operations/DEPLOY.md#3-capture-a-rollback-point-first).
