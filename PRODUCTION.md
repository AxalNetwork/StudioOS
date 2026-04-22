# Axal StudioOS – Production Deployment Guide

Single source of truth for deploying StudioOS to production. Covers FastAPI
(canonical API), the Cloudflare Worker edge proxy, the GitHub Pages frontend,
secrets, and the post-deploy checklist.

---

## 1. Architecture in 30 seconds

| Component        | Tech                   | Hosted on                              | Source                              |
| ---------------- | ---------------------- | -------------------------------------- | ----------------------------------- |
| **Public API**   | **FastAPI (Python)**   | Replit Deployments / Fly / Render      | `backend/`                          |
| Database         | Postgres (or SQLite)   | Replit DB / managed Postgres           | `backend/app/database.py`           |
| Edge proxy       | TypeScript + Hono      | **Cloudflare Workers** (`/api/*` → FastAPI) | `cloudflare-worker/src/index.ts` |
| WebSocket fan-out| Durable Objects        | Cloudflare Workers                     | `cloudflare-worker/src/durable-objects/` |
| Cache / sessions | KV                     | Cloudflare KV (`TOKENS`, `RATE_LIMITS`)| n/a                                 |
| Job queue        | Cloudflare Queues + cron | Cloudflare                           | `cloudflare-worker/src/services/queueWorker.ts` |
| Frontend         | React + Vite           | **GitHub Pages** (`docs/`)             | `frontend/`                         |

> **Architecture decision (audit #4):** FastAPI is the canonical API and the
> source of truth. The Cloudflare Worker re-implemented FastAPI's surface area
> in TypeScript, which led to two-source-of-truth drift on auth, scoring and
> capital semantics. The worker is now a thin edge layer that proxies `/api/*`
> to the FastAPI origin and only owns the WebSocket Durable Objects + the
> queue consumer (which must run at the edge).
>
> Legacy in-worker handlers under `cloudflare-worker/src/routes/*.ts` are kept
> for git history but are **not mounted** by `index.ts`. See
> `cloudflare-worker/src/routes/README.md`.

---

## 2. Release blockers (run before every prod deploy)

- [ ] **`POST /api/search/backfill`** — re-vectorise legacy semantic-search
      rows (audit #7). The runtime scrub keeps queries safe but old vectors
      stay stale until the backfill runs. Trigger it once after every schema
      change that touches a `*_embedding` column. Admin-only.
- [ ] Confirm `STUDIOOS_ENV=production` is set on the FastAPI deploy so
      auto-created GitHub support tickets carry the `origin: production` label
      (audit #10).
- [ ] Confirm `JWT_SECRET` is set on the FastAPI deploy. The backend imports
      will fail-fast if it's unset — do not paper over with a dev fallback.
- [ ] Confirm `FASTAPI_ORIGIN` is set on the Cloudflare Worker:
      `wrangler secret put FASTAPI_ORIGIN`. The proxy returns 503 without it.

---

## 3. Deploy

### FastAPI backend

Deploy `backend/` to your hosting target (Replit Deployments, Fly, Render,
etc.). Required env:

```
JWT_SECRET=<openssl rand -hex 48>
DATABASE_URL=postgres://…   # optional; defaults to local SQLite
STUDIOOS_ENV=production
GITHUB_ACCESS_TOKEN=…       # optional, ticket→issue sync
GITHUB_REPO_OWNER=…
GITHUB_REPO_NAME=…
```

### Cloudflare edge proxy

```bash
wrangler secret put JWT_SECRET           # used only by Durable Objects' WS auth
wrangler secret put FASTAPI_ORIGIN       # e.g. https://api.axal.vc
wrangler deploy
```

### Frontend

GitHub Action rebuilds `docs/` on push to `main`.

---

## 4. Secrets checklist

### FastAPI (required)
- [ ] `JWT_SECRET` – 64+ random chars (`openssl rand -hex 48`); fails fast if unset.
- [ ] `DATABASE_URL` – Postgres URL (optional; SQLite default for local dev).
- [ ] `STUDIOOS_ENV` – `production` / `staging` / `dev` / `preview`.

### FastAPI (optional)
- [ ] `GITHUB_ACCESS_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` – ticket → GitHub-issue sync (auto-tagged with `origin: <env>`).
- [ ] `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` – outbound email.
- [ ] `STRIPE_ATLAS_API_KEY`, `STRIPE_WEBHOOK_SECRET` – spin-out incorporation.
- [ ] `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET` – KYC.
- [ ] `OPENAI_API_KEY` – AI scoring fallback.
- [ ] `TURNSTILE_SECRET_KEY` – bot protection on register / login.

### Cloudflare Worker
- [ ] `FASTAPI_ORIGIN` – the FastAPI public URL the proxy forwards to.
- [ ] `JWT_SECRET` – needed by the Durable Object WebSocket auth handshake.

### GitHub Actions secrets
- [ ] `CLOUDFLARE_API_TOKEN` – scoped: `Workers Scripts:Edit`, `Workers KV:Edit`, `Workers AI:Read`.
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `SLACK_DEPLOY_WEBHOOK_URL` – optional, failure notifications.

---

## 5. Post-deploy checklist

- [ ] `curl https://api.axal.vc/api/health` returns `{ "status": "ok" }`.
- [ ] `curl https://axal.vc/api/health` returns the **edge** health (proves the proxy is mounted).
- [ ] Sign in to `https://axal.vc/dashboard` — verify all sub-queries resolve (no 500s).
- [ ] Submit a support ticket — verify it appears in `AxalNetwork/StudioOS` with `origin: production` label.
- [ ] Trigger `POST /api/search/backfill` (admin-only) once.
- [ ] Run a manual partner-scoring job; verify `partner_scores` rows.
- [ ] Send a test email from the admin panel to verify Gmail OAuth.
- [ ] Confirm cron is firing — `wrangler tail` should show `[cron] drain` lines.

---

## 6. Rate limits (audit #8)

FastAPI now mirrors the worker's per-bucket layout. See
`backend/app/services/rate_limit.py`.

| Bucket    | Limit          | Scope    | Applies to                                              |
| --------- | -------------- | -------- | ------------------------------------------------------- |
| `spinout` | 5 / hour       | per user | `POST/PUT/PATCH /api/legalcap/spinout/*`                |
| `ai`      | 10 / minute    | per user | `/api/scoring/`, `/api/matches/`, `/api/advisory/`, `/api/profiling/`, `/api/monitoring/anomalies` |
| `user`    | 60 / minute    | per user | All `/api/*`                                            |
| `global`  | 1000 / minute  | global   | All `/api/*` (burst protection)                         |

Exempt: `/api/health`, `/api/auth/login|register|verify|me`, `/api/monitoring/metrics|rate-limits`.

In-process state today (single-replica). Swap to Redis when scaling out.

---

## 7. Rollback

```bash
# Worker
npx wrangler deployments list
npx wrangler rollback <DEPLOYMENT_ID>

# FastAPI: redeploy the previous commit on your hosting target.
# Frontend: revert the docs/ commit on main.
git revert <SHA-of-frontend-rebuild>
git push
```
