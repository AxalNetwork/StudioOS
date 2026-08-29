# GVPN OS

**Global Venture Partner Network** operating system — the platform where founders, partners, LPs, and capital connect across borders. Includes **Spin-Out Lab**, a niche 30-day venture sprint product that takes a startup from intake → AI scoring → legal formation → fundraising → portfolio monitoring.

Internal codename: Axal StudioOS. Operated by **Axal VC Management LLC**
(Delaware). Brand and platform IP owned by **Axal VC Holdings LLC**
(Delaware). **Axal VC Fund I, LP** (Delaware) is managed by **Axal VC
GP LLC** (Delaware) — the GP signs no platform contracts and is not the
operating entity. See [`documentation/architecture/LEGAL_ENTITIES.md`](./LEGAL_ENTITIES.md) for the
canonical entity map.

> **Architecture in one sentence:** Production API runs on a Cloudflare Worker at `app.axal.vc/api/*` (`cloudflare-worker/`), the React SPA ships to Cloudflare Pages at `app.axal.vc` (`frontend/`), the `axal.vc` apex is GitHub Pages marketing (do NOT attach Cloudflare to the apex), D1 is the canonical user store, and the FastAPI in `backend/` exists only as a Replit dev convenience and is **never deployed**. Read [`CLAUDE.md`](./CLAUDE.md) before contributing. Cutover runbook for the `app.axal.vc` migration lives at [`documentation/architecture/MIGRATE_TO_CUSTOM_DOMAIN.md`](./MIGRATE_TO_CUSTOM_DOMAIN.md).

## Repo layout

| Path                | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `frontend/`         | React 19 + Vite 6 + Tailwind 4 SPA — ships to Cloudflare Pages        |
| `cloudflare-worker/`| **Production API** — Hono on Cloudflare Workers, D1, KV, R2, Queues, Vectorize, Durable Objects |
| `backend/`          | FastAPI (Python) — **Replit-dev-only**, not deployed to production    |
| `attached_assets/`  | Design specs, screenshots, methodology docs, legal templates          |
| `docs/`             | Built frontend bundle (Vite output, also served via GitHub Pages)     |

## Local development on Replit

Two workflows are configured:

- **Backend API** — `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload`
- **Start application** — `cd frontend && npm run dev` (Vite on port 5000, proxies `/api` → 8000)

Required secret: `JWT_SECRET` (the dev backend fails fast at import time if unset).

Optional secrets: `GITHUB_ACCESS_TOKEN`, `GMAIL_*`, `STRIPE_*`, `SUMSUB_*` — see `documentation/architecture/PRODUCTION.md`.

## Deploy

See `documentation/architecture/PRODUCTION.md` for the production Cloudflare deploy checklist, secrets, and post-deploy steps. See [`CLAUDE.md`](./CLAUDE.md) for the architecture rules every PR must respect.

## Claude Code setup

Claude Code in this repo authenticates with an Anthropic API key
(`ANTHROPIC_API_KEY`) — **not** the Claude.ai subscription, which is
disabled at the org level for this account.

- **Replit**: add `ANTHROPIC_API_KEY` to Replit Secrets (lock icon →
  New secret).
- **GitHub Actions**: add `ANTHROPIC_API_KEY` under
  **Settings → Secrets and variables → Actions → New repository secret**.
- **Workflow**: `.github/workflows/claude-code.yml` runs on `@claude`
  mentions in issues / PRs and on manual dispatch. It hard-fails with a
  readable message if the secret is missing.
- **Verify locally**: `bash scripts/check-anthropic-key.sh` (or
  `npm run claude:check`).

Full walkthrough + auth-error troubleshooting:
[`docs/claude-code-setup.md`](./docs/claude-code-setup.md).

## License

Proprietary — platform IP owned by Axal VC Holdings LLC and licensed
to Axal VC Management LLC for operation.
