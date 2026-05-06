# GVPN OS

**Global Venture Partner Network** operating system — the platform where founders, partners, LPs, and capital connect across borders. Includes **Spin-Out Lab**, a niche 30-day venture sprint product that takes a startup from intake → AI scoring → legal formation → fundraising → portfolio monitoring.

Internal codename: Axal StudioOS. Operated by Axal Management, LLC.

> **Architecture in one sentence:** Production API runs on a Cloudflare Worker (`cloudflare-worker/`), the React SPA ships to Cloudflare Pages (`frontend/`), D1 is the canonical user store, and the FastAPI in `backend/` exists only as a Replit dev convenience and is **never deployed**. Read [`CLAUDE.md`](./CLAUDE.md) before contributing.

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

Optional secrets: `GITHUB_ACCESS_TOKEN`, `GMAIL_*`, `STRIPE_*`, `SUMSUB_*` — see `PRODUCTION.md`.

## Deploy

See `PRODUCTION.md` for the production Cloudflare deploy checklist, secrets, and post-deploy steps. See [`CLAUDE.md`](./CLAUDE.md) for the architecture rules every PR must respect.

## License

Proprietary — Axal Management, LLC.
