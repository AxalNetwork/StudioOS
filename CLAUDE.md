# Architecture truth — read first

This document is the canonical, authoritative description of where production
runs and how this repo is laid out. Other docs (README.md, replit.md,
GOTCHAS.md, PRODUCTION.md) defer to this file when they conflict. The detailed
operational gotchas previously inline in `replit.md` now live in `GOTCHAS.md`.

## The four facts

1. **The Cloudflare Worker is the production API at `axal.vc`.** Source of
   truth lives in `cloudflare-worker/src/index.ts` and `cloudflare-worker/src/routes/*.ts`.
   Wrangler config: `wrangler.toml`. Deploys via `npx wrangler deploy`
   (top-level config — **not** `--env production`, see `PRODUCTION.md`).
2. **D1 (`studioos-db`) is the canonical user store.** All 23 production user
   accounts live in D1. The dev FastAPI uses a separate SQLite file
   (`backend/app.db`) and is **not** kept in sync.
3. **The FastAPI in `backend/` is Replit-dev-only.** It exists for local
   iteration speed during Replit sessions. It is **never** deployed to
   production — Cloudflare Workers do not run Python. Do not change
   `wrangler.toml`'s `main` field.
4. **The frontend ships from `frontend/` to Cloudflare Pages** (built into
   `docs/` and historically also pushed to GitHub Pages).

## File map

| Path                  | Role                                                      |
| --------------------- | --------------------------------------------------------- |
| `frontend/`           | React + Vite SPA → Cloudflare Pages                       |
| `cloudflare-worker/`  | Hono on CF Workers → axal.vc/api/* (production)           |
| `cloudflare-worker/sql/` | D1 schema + migrations (canonical)                     |
| `backend/`            | FastAPI for Replit dev only — **never deployed**          |
| `attached_assets/`    | Design specs, methodology PDFs, legal templates           |
| `docs/`               | Built frontend bundle (output of `frontend/` build)       |

## Rules for new work

- **New features must be implemented in `cloudflare-worker/src/routes/` first.**
  FastAPI ports in `backend/app/api/routes/` are an optional dev convenience
  for fast local iteration; they are not the production behaviour.
- **Do not add a `/api/*` method to `frontend/src/lib/api.js`** without a
  matching worker route in `cloudflare-worker/src/index.ts`. The drift smoke
  test (`npm run test:drift`) enforces this on every PR.
- **Do not modify `wrangler.toml`'s `main` field** — it points at the worker
  entry. FastAPI is not deployable on Workers.
- **D1 schema changes go in `cloudflare-worker/sql/`** as new migration
  files, applied via `wrangler d1 execute studioos-db --file=...`. Mirror the
  same change in `backend/app/models/migrations.py` only if you need dev
  parity for a feature you're actively iterating on.

## Why this doc exists

Three earlier audits ("audit #4" in particular) attempted to flip the
architecture so FastAPI would become canonical with the worker as a thin
proxy. That migration was never completed: the production user accounts
already lived in D1 and FastAPI was never publicly deployed. Some legacy
docs still reflect the never-finished migration. This file is the corrective.

If a doc disagrees with this file, **this file wins** — fix the doc.
