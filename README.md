# GVPN OS

**Global Venture Partner Network** operating system — the platform where founders, partners, LPs, and capital connect across borders. Includes **Spin-Out Lab**, a niche 30-day venture sprint product that takes a startup from intake → AI scoring → legal formation → fundraising → portfolio monitoring.

Internal codename: Axal StudioOS. Operated by **Axal VC Management LLC**
(Delaware). Brand and platform IP owned by **Axal VC Holdings LLC**
(Delaware). **Axal VC Fund I, LP** (Delaware) is managed by **Axal VC
GP LLC** (Delaware) — the GP signs no platform contracts and is not the
operating entity. See [`documentation/architecture/LEGAL_ENTITIES.md`](./LEGAL_ENTITIES.md) for the
canonical entity map.

> **Architecture in one sentence:** The `studioos` Cloudflare Worker (`cloudflare-worker/`) serves both `axal.vc` and `app.axal.vc` as whole-host custom domains — the React SPA (`frontend/`, built into `docs/`) from its `[assets]` binding and the API at `/api/*` — with one build behind both hosts; D1 is the canonical user store; there is no Cloudflare Pages deployment any more (the mirror was retired on 2026-09-03); and the FastAPI in `backend/` exists only as a Replit dev convenience and is **never deployed**. Read [`CLAUDE.md`](./CLAUDE.md) before contributing. The `app.axal.vc` cutover runbook at [`documentation/architecture/MIGRATE_TO_CUSTOM_DOMAIN.md`](./documentation/architecture/MIGRATE_TO_CUSTOM_DOMAIN.md) is a dated record of the 2026-05 migration, not the current topology.

## Repo layout

| Path                | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `frontend/`         | React 19 + Vite 6 + Tailwind 4 SPA — built into `docs/`, served by the Worker on both hosts |
| `cloudflare-worker/`| **Production API** — Hono on Cloudflare Workers, D1, KV, R2, Queues, Vectorize, Durable Objects |
| `backend/`          | FastAPI (Python) — **Replit-dev-only**, not deployed to production    |
| `attached_assets/`  | Design specs, screenshots, methodology docs, legal templates          |
| `docs/`             | Built frontend bundle (Vite output) — the Worker's `[assets]` directory; its `_headers` sets the static security headers |

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
