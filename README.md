# Axal StudioOS

The 30-Day Spin-Out Engine — an API-first venture studio operating system that takes a startup from intake → AI scoring → legal formation → fundraising → portfolio monitoring.

## Repo layout

| Path                | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `frontend/`         | React 19 + Vite 6 + Tailwind 4 SPA (the dashboard)                    |
| `backend/`          | **FastAPI** (Python) — the canonical API. Source of truth.            |
| `cloudflare-worker/`| Edge proxy/cache (Hono on CF Workers) + Durable Objects for WebSockets|
| `attached_assets/`  | Design specs, screenshots, methodology docs                           |
| `docs/`             | Built frontend bundle (Vite output, served via GitHub Pages)          |

## Local development on Replit

Two workflows are configured:

- **Backend API** — `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload`
- **Start application** — `cd frontend && npm run dev` (Vite on port 5000, proxies `/api` → 8000)

Required secret: `JWT_SECRET` (the backend fails fast at import time if unset).

Optional secrets: `GITHUB_ACCESS_TOKEN`, `GMAIL_*`, `STRIPE_*`, `SUMSUB_*` — see `PRODUCTION.md`.

## Architecture

FastAPI is the canonical API. The Cloudflare Worker is a thin edge layer that:

1. Proxies `/api/*` to the FastAPI origin (configured via `FASTAPI_ORIGIN` secret).
2. Hosts WebSocket fan-out via Durable Objects (`PipelineRoom`, `OnboardingChat`).
3. Drains background jobs via cron + Queues consumer.

The legacy in-worker route handlers (`cloudflare-worker/src/routes/*.ts`) are kept for git history but are no longer mounted from `index.ts`. See `cloudflare-worker/src/routes/README.md`.

## Deploy

See `PRODUCTION.md` for the production checklist, secrets, and post-deploy steps.

## License

Proprietary — Axal Management, LLC.
