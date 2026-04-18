# Axal StudioOS – Production Deployment Guide

This document is the single source of truth for deploying StudioOS to
production. It covers Cloudflare Workers, the GitHub Pages frontend, secrets,
and the post-deploy checklist.

---

## 1. Architecture in 30 seconds

| Component        | Tech                   | Hosted on                      | Source                              |
| ---------------- | ---------------------- | ------------------------------ | ----------------------------------- |
| Public API       | TypeScript + Hono      | **Cloudflare Workers**         | `cloudflare-worker/src/index.ts`    |
| Database         | SQLite-compatible      | **Cloudflare D1** (`studioos-db`) | `cloudflare-worker/sql/`           |
| Cache / sessions | KV                     | Cloudflare KV (`TOKENS`, `RATE_LIMITS`) | n/a                          |
| AI scoring       | Workers AI             | Cloudflare AI                  | `cloudflare-worker/src/services/`   |
| Job queue        | D1 table + cron        | Cloudflare (cron `* * * * *`)  | `cloudflare-worker/src/services/queueWorker.ts` |
| Frontend         | React + Vite           | **GitHub Pages** (`docs/`)     | `frontend/`                         |
| Dev backend      | FastAPI (Python)       | Replit only                    | `backend/`                          |

> **Heads up:** `backend/` (FastAPI) is a Replit-only dev mirror used for fast
> iteration. It is **not** deployed to Cloudflare. Cloudflare Workers do not
> run Python/FastAPI; the canonical production API is the TypeScript worker.

---

## 2. One-command deploy

From the repo root:

```bash
npm run deploy            # production
npm run deploy:preview    # preview / staging
```

Both commands shell out to `wrangler deploy` using the canonical
`wrangler.toml` at the repo root (which points at
`cloudflare-worker/src/index.ts`).

Frontend deploys happen automatically when you push to `main` — the GitHub
Action rebuilds `docs/` and commits the refreshed bundle.

---

## 3. Secrets checklist

Set these **once** per environment with `wrangler secret put <NAME>`:

### Required
- [ ] `JWT_SECRET` – 64+ random chars (`openssl rand -hex 48`)
- [ ] `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
      (see `cloudflare-worker/EMAIL-SETUP.md`)

### Optional but recommended
- [ ] `TURNSTILE_SECRET_KEY` – bot protection on register / login
- [ ] `OPENAI_API_KEY` – fallback when Workers AI is unavailable
- [ ] `GITHUB_ACCESS_TOKEN` – ticket → GitHub-issue sync
- [ ] `STRIPE_ATLAS_API_KEY`, `STRIPE_WEBHOOK_SECRET` – spin-out incorporation
- [ ] `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET` – KYC

### GitHub Actions secrets (repo settings → Secrets and variables → Actions)
- [ ] `CLOUDFLARE_API_TOKEN` – scoped token with `Workers Scripts:Edit`,
      `Workers KV Storage:Edit`, `D1:Edit`, `Workers AI:Read`
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `SLACK_DEPLOY_WEBHOOK_URL` – optional, for failure notifications

Verify secrets are loaded:
```bash
curl https://axal.vc/api/health
# Expect { "ok": true, "gmail": true, ... }
```

See `.env.example` for the full list with explanations of each variable.

---

## 4. First-time Cloudflare setup

Run these once on a fresh account. The IDs they produce go into
`wrangler.toml`.

```bash
# 1. D1 database
npx wrangler d1 create studioos-db
npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/schema.sql
npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/funds_v2.sql
npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/infrastructure.sql
npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/liquidity.sql
npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/monitoring.sql
npx wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/queue_jobs_alter.sql

# 2. KV namespaces
npx wrangler kv namespace create TOKENS
npx wrangler kv namespace create RATE_LIMITS

# 3. (Optional, future) Cloudflare Queues
npx wrangler queues create studioos-queue
npx wrangler queues create studioos-queue-dlq

# 4. (Optional, future) R2 bucket for file uploads
npx wrangler r2 bucket create studioos-files
```

Paste the resulting IDs into `wrangler.toml` (root). For preview, repeat with
`--env preview` and update the `[env.preview.*]` blocks.

---

## 5. Post-deploy checklist

After your first production deploy:

- [ ] `curl https://axal.vc/api/health` returns `{ ok: true }` and lists every
      binding (`db: true`, `ai: true`, `gmail: true`, …).
- [ ] Hit `https://axal.vc/dashboard` while signed in — verify D1 sub-queries
      all resolve (no 500s).
- [ ] Create the first **admin** user via:
      ```bash
      curl -X POST https://axal.vc/api/admin/seed-admin \
        -H "x-seed-token: $JWT_SECRET" \
        -d '{"email":"founder@axal.vc"}'
      ```
- [ ] Run the seed data import (optional):
      ```bash
      npx wrangler d1 execute studioos-db --remote \
        --file=cloudflare-worker/sql/seed.sql
      ```
- [ ] Confirm cron is firing — tail logs for `[queueWorker]` lines:
      ```bash
      npx wrangler tail
      ```
- [ ] Send a test email from the admin panel to verify Gmail OAuth.
- [ ] Submit a support ticket — verify it appears as a GitHub issue in
      `AxalNetwork/StudioOS`.
- [ ] Run a manual partner-scoring job; check the `partner_scores` table.

---

## 6. CI/CD overview

`.github/workflows/deploy.yml` runs on every push and PR:

1. **lint** – `tsc --noEmit` on the worker, `python -c "import backend.app.main"`
   on the FastAPI dev backend.
2. **build-frontend** – `npm ci && npm run build` in `frontend/` →
   uploads `docs/` as an artifact.
3. **deploy-preview** – on PRs, deploys the worker as
   `axal-studioos-preview`.
4. **deploy-production** – on push to `main`, deploys the production worker
   and commits the rebuilt `docs/` bundle so GitHub Pages picks it up.
5. **notify-failure** – Slack webhook on failed `main` deploys.

---

## 7. Rollback

```bash
# Roll the Worker back to a previous deployment
npx wrangler deployments list
npx wrangler rollback <DEPLOYMENT_ID>

# Roll the frontend back by reverting the docs/ commit on main
git revert <SHA-of-frontend-rebuild>
git push
```
