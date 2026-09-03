# Axal StudioOS
API-first Venture Studio OS — manages startup lifecycle from intake to portfolio.

> **Two changelogs, keep them in sync.**
> - `CHANGELOG.md` (also symlinked at `frontend/public/CHANGELOG.md`) — the technical/engineering log. Task IDs, file paths, code refs welcome. Newest-first.
> - `frontend/public/CHANGELOG-user.md` — the in-app Docs → "What's new" page. Plain-English, no task IDs, no file paths, no code. Write it for the people using the platform.
> Any user-facing change needs a line in BOTH. Do not date task entries in the technical file.

## Replit Dev Setup (one-time, already done)

The following steps were completed when this project was imported into Replit:

1. **Frontend dependencies installed** — `cd frontend && npm install` (installs Vite, React, Tailwind, etc. into `frontend/node_modules/`).
2. **`JWT_SECRET` added to Replit Secrets** — required; the dev backend (`backend/app/api/routes/auth.py`) raises `RuntimeError` at import time if unset.
3. **Workflows verified running**:
   - `Backend API` — `UV_PROJECT_ENVIRONMENT=.venv uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload` (port 8000)
   - `Start application` — `cd frontend && npm run dev` (port 5000, proxies `/api` → 8000)
4. **`postgresql-16` module restored** in `.replit` (was accidentally removed during import; dev backend uses a local SQLite file via SQLModel, but the module is kept for parity).

If you clone or fork this repl, repeat steps 1–2.

## Run & Operate
- **Dev**: `npm run dev` (frontend) + `python backend/main.py` (FastAPI, dev-only).
- **Build**: `npm run build` · **Deploy (prod)**: `npm run deploy` (Cloudflare Worker)
- **D1 migrations auto-apply on deploy**: `npm run deploy` runs `predeploy` → `node scripts/migrate-d1.mjs --remote`, a forward-only runner that applies only the pending `cloudflare-worker/sql/migrations/*.sql` (in numeric order, deterministic on duplicate prefixes) and records each in the `schema_migrations` ledger. A failing migration aborts the deploy loudly (non-zero, names the file). Re-deploy with no new migrations = fast no-op. Other targets: `npm run d1:migrate:local` / `d1:migrate:preview`; audit-only `npm run d1:audit`; preview the plan with `node scripts/migrate-d1.mjs --remote --dry-run`. Needs Node 22+ (same `export PATH=…nodejs-22…/bin` as manual wrangler). **One-time baseline**: ✅ DONE (2026-07-08) — the prod ledger now holds all 149 files (idempotent ones executed, non-idempotent ones recorded-only; `funnel_events` + `user_role_review` PRAGMA-verified present). Deploys now auto-apply only new migrations. Note: `--dry-run` always prints the plan *assuming an empty ledger* — to see what's really pending, run the live runner (it prints "N already applied, M pending" before touching anything) or query `schema_migrations` directly.
- **Typecheck**: runs inside `npm run test:drift` (`tsc --noEmit` in `cloudflare-worker/`; there is no standalone `npm run typecheck`) · **Drift check**: `npm run test:drift` (required pre-merge)
- **Required env**: `JWT_SECRET`, `SCORING_HMAC_SECRET` (≥32 bytes, hard-required in prod), `AXAL_ENCRYPTION_SECRET` (falls back to JWT_SECRET), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CLAIM_EMAIL` (push).

### Sync Cheatsheet (PUSH_REJECTED from Replit's Sync UI — run in Shell, not the agent)
| Situation | Command |
|---|---|
| Clean fast-forward | `bash scripts/git-sync.sh` |
| Diverged from `origin/main` | `bash scripts/git-sync.sh --auto` |
| Push only | `bash scripts/git-push.sh` |

`git-push.sh` auto-detects workflow-file commits and falls back to `GITHUB_TOKEN` (Replit's OAuth lacks the `workflow` scope until ops item (d) below is done). Full reconcile flow lives in `scripts/sync-reconcile.sh`.

## Stack
- **Frontend**: React 19 + Vite 7 + Tailwind 4 + react-router 7
- **Prod API**: Cloudflare Worker (Hono, TypeScript) on D1
- **Dev API**: FastAPI on SQLite — never deployed

## Where things live
- `frontend/` · `cloudflare-worker/src/index.ts` (route mounts) · `routes/*.ts` · `services/*.ts` · `integrations/providers/*.ts` · `sql/migrations/NNN_*.sql` · `backend/` (dev FastAPI) · `scripts/check-*.mjs` (CI guards).

## Architecture invariants
- Prod = Worker on D1; dev = FastAPI on SQLite. Never deploy FastAPI.
- **Apex routing** (rewritten 2026-09-03 — the earlier text described path-scoped `axal.vc/{api,app,dashboard,…}` routes over a GitHub Pages/Jekyll apex, a topology gone since 2026-09-01) — the `studioos` Worker serves **BOTH** `axal.vc` and `app.axal.vc` as whole-host Workers Custom Domains (`pattern = "axal.vc"` / `"app.axal.vc"`, `custom_domain = true`, in **BOTH** the top-level `[[routes]]` block **and** `[[env.production.routes]]` in `wrangler.toml`; keep them in lockstep — `frontend/test/apex_route_coverage.test.mjs` asserts the two tables match). Every path on either host is answered by the Worker: `/api/*` by Hono, everything else by the `[assets]` binding (`directory = "./docs"`, `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*", "/landing/*", "/p/*", "/assets/*"]`). There is no Jekyll, no GitHub Pages and no per-page route list any more: a new top-level SPA route needs **no** `wrangler.toml` entry. **Never add a path-scoped apex route** (`axal.vc/*`, `axal.vc/assets/*`) — it would take those URLs away from the assets binding and break the SPA fallback, the mechanism behind the 2026-08-31 blank-page outage (entry module 404 → `?__reboot=` watchdog loop); `cloudflare-worker/test/apex_cutover_bootstrap.test.mjs` refuses it. The flip to whole-host domains landed in `1d320dda9` (2026-09-01, "Remove stale documentation asset files" — a message that does not mention it), so who serves a host is read from the deploy log's "Deployed studioos triggers" lines and the Pages dashboard's Domains line, never from prose. One build sits behind both hosts and ships on every `wrangler deploy` (`.github/workflows/cloudflare-worker-deploy.yml` on push to `main`, or `npm run deploy`); a missing `/assets/*` file gets a real 404 from `index.ts` rather than the SPA shell, so a stale tab reloads onto the current build, and `npm run build` (`scripts/build-frontend.mjs`) still retains the last few builds' hashes (ledger `docs/.asset-retention.json`, `ASSET_RETAIN_BUILDS` default 3). Cloudflare Pages (`studioos`, `studioos-2p8.pages.dev`) is only a mirror of `docs/` fed by `.github/workflows/cloudflare-pages-deploy.yml`; it serves no production hostname, and a "Production" deployment on its dashboard proves nothing about what the Worker shipped (2026-09-03: two Worker deploys failed at the migration step, both hosts stayed a build behind, the mirror advanced twice). **Canonical-host status (Phase 2 complete)**: `APP_URL`/`PUBLIC_BASE_URL` are now `https://axal.vc`; `OAUTH_CALLBACK_BASE_URL = "https://app.axal.vc"` pins all OAuth `redirect_uri` registrations to `app.axal.vc` until provider dashboards are updated. All integration providers and calendar/LinkedIn OAuth derive `redirect_uri` via `callbackBase()` in `cloudflare-worker/src/util/url.ts`. Remaining ops step: update provider redirect URI registrations → delete `OAUTH_CALLBACK_BASE_URL` env var. Edge 301 middleware in `index.ts` (369-390) is written to redirect `app.axal.vc/*` → `axal.vc/*` for non-`/api/*` paths — whether it fires for SPA paths the assets binding answers before the Worker runs is unverified live (see U10); full SPA-bookmark convergence (paths not handled by the worker) requires the Cloudflare bulk-redirect rule on the `app.axal.vc` zone — see ops item (e). **Public marketing surface (Task #6 ID)** — decision recorded: the SPA is the public surface. Since 2026-09-01 that is every path on the apex, so the former list of apex-routed public pages (`/spinout-lab`, `/about`, `/insights`, `/directory`, `/contact`, `/articles`) needs no route entries; what remains true: `https://axal.vc/articles/{slug}` is the author editor's copy-link / "View live" share URL, `/about` reuses `TeamPage` (Guillaume's card), `/team` 301s to `/about`, and `/insights` is a self-contained index over public list endpoint `GET /api/market-intel-public/publications` (published + `audience != 'internal'` only) whose cards deep-link to `/insights/public/:slug`. Route-table changes only take effect on `wrangler deploy`.
- API drift prevented by `npm run test:drift`.
- Per-bucket rate limiting + strict CSP headers.
- Theme/density via CSS-vars in `frontend/src/index.css` (`--app-bg/--app-surface/--app-text/--app-input-*`). Tailwind 4 `@custom-variant dark`. `SettingsContext` toggles both `data-theme` and `.dark` on `<html>`. New pages need `dark:` variants on hardcoded `bg-white`/`text-gray-*`.
- Frontend storage via `safeReadJSON`/`safeWriteJSON`; errors via `reportError`.

## User preferences
- Clear, concise communication.
- Iterative — confirm before major architectural changes or significant refactors.
- Security-first; explicit error handling over silent fallbacks.
- API keys UI is gated behind a server-driven feature flag.

## Doc visibility
Admin docs live behind `roles: ['admin']` on sections/subsections in `frontend/src/pages/docs/sections/*.js`. DocsLayout filters rail/body/TOC and the hash-deep-link guard by `useAuth().role`; `lib/docs/search.js::createDocsFuse(role)` filters search. Adding a new admin doc = add `roles: ['admin']`; no other wiring. Never link to `#admin/*` from non-admin surfaces.

## Persistent gotchas

The full, detailed gotchas now live in [`documentation/architecture/GOTCHAS.md`](./GOTCHAS.md) so this README stays a scannable overview. Subsections (each in `documentation/architecture/GOTCHAS.md`):
- [Migrations & schema](./GOTCHAS.md#migrations--schema)
- [Skills & values taxonomy](./GOTCHAS.md#skills--values-taxonomy-task-10)
- [Telegram broadcaster](./GOTCHAS.md#telegram-broadcaster-task-3)
- [X (Twitter) broadcaster](./GOTCHAS.md#x-twitter-broadcaster-task-4)
- [Auth blockers — magic-link / passkeys / step-up](./GOTCHAS.md#auth-blockers--magic-link--passkeys--step-up-task-4-ib)
- [Backend / Worker](./GOTCHAS.md#backend--worker)
- [Frontend](./GOTCHAS.md#frontend)
- [Ops items still owned by user](./GOTCHAS.md#ops-items-still-owned-by-user-not-in-code)
