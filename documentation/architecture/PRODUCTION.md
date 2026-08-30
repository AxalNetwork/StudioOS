# Axal StudioOS – Production Deployment Guide

Single source of truth for deploying StudioOS to production. Covers the
Cloudflare Worker (canonical production API), the GitHub Pages frontend,
secrets, and the post-deploy checklist.

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
| Frontend         | React + Vite               | **GitHub Pages** (`docs/`)             | `frontend/`                                     |

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

`docs/` is committed by hand. **No workflow rebuilds or commits it** — `ci.yml`
builds the frontend to typecheck it and then *validates* that the committed
`docs/` matches (`scripts/check-docs-fresh.mjs`), but it never writes the
directory back. That validation is the only thing standing between a source
change and a stale production bundle, so run the build at the REPO ROOT
(`npm run build`, which also prerenders the crawlable routes) and commit the
result in the same PR as the source change.

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
# Worker
npx wrangler deployments list
npx wrangler rollback <DEPLOYMENT_ID>

# Frontend: revert the docs/ commit on main.
git revert <SHA-of-frontend-rebuild>
git push
```
