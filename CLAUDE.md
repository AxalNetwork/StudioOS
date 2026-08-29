# Architecture truth — read first

This document is the canonical, authoritative description of where production
runs and how this repo is laid out. Other docs (README.md, replit.md,
documentation/architecture/GOTCHAS.md, documentation/architecture/PRODUCTION.md) defer to this file when they conflict. The detailed
operational gotchas previously inline in `replit.md` now live in `documentation/architecture/GOTCHAS.md`.

## The four facts

1. **The Cloudflare Worker is the production API at `axal.vc`.** Source of
   truth lives in `cloudflare-worker/src/index.ts` and `cloudflare-worker/src/routes/*.ts`.
   Wrangler config: `wrangler.toml`. Deploy with **`npm run deploy`**, which is
   `wrangler deploy --config ../wrangler.toml --env production` — `--env
   production` IS correct (`documentation/architecture/PRODUCTION.md`, verified 2026-05-06: the
   `[env.production]` block redeclares every binding, confirmed against the
   live worker's bindings API). Do not run `npx wrangler deploy` by hand: it
   skips the `predeploy` hook that applies D1 migrations, so the worker ships
   ahead of its schema.
2. **D1 (`studioos-db`) is the canonical user store.** All 23 production user
   accounts live in D1. The dev FastAPI uses a separate SQLite file
   (`backend/app.db`) and is **not** kept in sync.
3. **The FastAPI in `backend/` is Replit-dev-only.** It exists for local
   iteration speed during Replit sessions. It is **never** deployed to
   production — Cloudflare Workers do not run Python. Do not change
   `wrangler.toml`'s `main` field.
4. **The frontend is built from `frontend/` into `docs/` and served by the
   Worker itself**, through the `[assets]` binding in `wrangler.toml`
   (`directory = "./docs"`) — Workers Static Assets, **not** Cloudflare Pages.
   There is no Pages project in this repo. `docs/` is committed by hand; no
   workflow writes it, which is why `scripts/check-docs-fresh.mjs` exists.
   GitHub Pages still serves the **apex** (`main` + `/docs`) for any path the
   Worker route table does not claim — see `documentation/architecture/CLOUDFLARE-CUTOVER.md`, which is
   the plan for retiring it.

## File map

| Path                  | Role                                                      |
| --------------------- | --------------------------------------------------------- |
| `frontend/`           | React + Vite SPA → built into `docs/`, served by the Worker |
| `cloudflare-worker/`  | Hono on CF Workers → axal.vc/api/* (production)           |
| `cloudflare-worker/sql/` | D1 schema + migrations (canonical)                     |
| `backend/`            | FastAPI for Replit dev only — **never deployed**          |
| `attached_assets/`    | Design specs, methodology PDFs, legal templates           |
| `documentation/`      | **Every hand-written document.** Start at `documentation/README.md` |
| `design/`             | Design sources. `design/incoming/` is where NEW Claude Design exports land |
| `docs/`               | Built frontend bundle — the Worker's `[assets]` directory  |

**`documentation/` and `docs/` are different things.** `documentation/` is
prose a person wrote; `docs/` is build output a person must never edit. The
repo root once held 38 loose markdown files — they all live under
`documentation/` now, and `frontend/test/repo_layout.test.mjs` fails the build
if a seventh appears at the root (six stay because a tool reads them from
there: this file, `replit.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`
and `CHANGELOG.md`).

**Every folder that carries weight explains itself.** There is a `README.md` in
each significant directory saying what lives there and the rule for adding to
it, and `scripts/check-folder-docs.mjs` fails the build if one is missing, if it
does not name its own subfolders, or if it cites a file that does not exist —
the first run caught a route README documenting a mount for a file that has
never existed. Start at the README of whatever folder you land in.

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

Everything else worth reading is indexed in
[documentation/README.md](documentation/README.md): the architecture set
(`CODEBASE_MAP`, `ROUTE_MAP`, `DECISIONS`, `GOTCHAS`) under
`documentation/architecture/`; dated snapshots under `documentation/audits/`,
which are true as of their date and are **not** maintained afterwards — never
treat an audit finding as a live bug without re-checking the code; runbooks
under `documentation/operations/`; positioning under `documentation/product/`.
