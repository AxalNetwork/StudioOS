# Axal StudioOS
API-first Venture Studio OS — manages startup lifecycle from intake to portfolio.

> **Two changelogs, keep them in sync.**
> - `CHANGELOG.md` (also symlinked at `frontend/public/CHANGELOG.md`) — the technical/engineering log. Task IDs, file paths, code refs welcome. Newest-first.
> - `frontend/public/CHANGELOG-user.md` — the in-app Docs → "What's new" page. Plain-English, no task IDs, no file paths, no code. Write it for the people using the platform.
> Any user-facing change needs a line in BOTH. Do not date task entries in the technical file.

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
- **Apex routing** — Worker serves the SPA on both `app.axal.vc/*` (custom domain) AND `axal.vc/{api,app,dashboard,admin,register,login}{,/*}` (path-scoped routes on the proxied apex CNAME → `axalnetwork.github.io`). Jekyll keeps `axal.vc/` and any other unrouted paths. Adding a new top-level app route means adding TWO patterns (exact + `/*`) to **BOTH** the top-level `[[routes]]` block **and** `[[env.production.routes]]` in `wrangler.toml` — the live prod deploy binds the **top-level** block, so env-only routes silently 404 on the apex (both blocks share `name = "studioos"` + identical vars/bindings, so only the route table differs; keep them in lockstep) — so Jekyll pages with similar prefixes (`/registered-*`) aren't hijacked. `/api/*` MUST stay routed on the apex or SPA fetches from `axal.vc/dashboard` 404 on Jekyll. **Hashed assets (Task #15)** — `axal.vc/assets/*` is ALSO carved to the Worker in BOTH route blocks: Worker-served app-route HTML references build-specific `/assets/*` hashes, so when they fell through to a stale GitHub Pages build they 404'd and the page rendered blank (the recurring post-login blank page). Only `/assets/*` is carved (hashed, build-specific); static roots (favicons/manifest/logos) keep stable names and stay on Pages. `npm run build` runs `scripts/build-frontend.mjs`, which retains the last few builds' hashes (ledger `docs/.asset-retention.json`, `ASSET_RETAIN_BUILDS` default 3) so the Pages-served apex root survives the deploy→Pages-catch-up window; `npm run deploy` builds first. **Canonical-host status (Phase 2 complete)**: `APP_URL`/`PUBLIC_BASE_URL` are now `https://axal.vc`; `OAUTH_CALLBACK_BASE_URL = "https://app.axal.vc"` pins all OAuth `redirect_uri` registrations to `app.axal.vc` until provider dashboards are updated. All integration providers and calendar/LinkedIn OAuth derive `redirect_uri` via `callbackBase()` in `cloudflare-worker/src/util/url.ts`. Remaining ops step: update provider redirect URI registrations → delete `OAUTH_CALLBACK_BASE_URL` env var. Edge 301 middleware in `index.ts` redirects `app.axal.vc/*` → `axal.vc/*` for non-`/api/*` paths; full SPA-bookmark convergence (paths not handled by the worker) requires the Cloudflare bulk-redirect rule on the `app.axal.vc` zone — see ops item (e). **Public marketing surface (Task #6 ID)** — decision recorded: the SPA is the public surface for app-owned routes; Jekyll keeps the apex root and any unrouted path. Apex-routed public pages: `/spinout-lab`, `/about`, `/insights`, `/directory`, `/contact`, `/articles` (×2 each). `/articles` (public feed) + `/articles/*` (reader at `/articles/:slug`) are apex-routed so the author editor's copy-link / "View live" share URL `https://axal.vc/articles/{slug}` resolves instead of 404ing on Jekyll. `/contact` MUST be apex-routed because the edge 301 above leaves NO `app.axal.vc` fallback for unauthenticated hard-loads — an unrouted page is publicly unreachable. `/about` reuses `TeamPage` (Guillaume's card); `/team` 301s to `/about`. `/insights` is a self-contained index over public list endpoint `GET /api/market-intel-public/publications` (published + `audience != 'internal'` only); cards deep-link to `/insights/public/:slug` (covered by `/insights/*`). Routes only take effect on `npm run deploy`.
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

The full, detailed gotchas now live in [`GOTCHAS.md`](./GOTCHAS.md) so this README stays a scannable overview. Subsections (each in `GOTCHAS.md`):
- [Migrations & schema](./GOTCHAS.md#migrations--schema)
- [Skills & values taxonomy](./GOTCHAS.md#skills--values-taxonomy-task-10)
- [Telegram broadcaster](./GOTCHAS.md#telegram-broadcaster-task-3)
- [X (Twitter) broadcaster](./GOTCHAS.md#x-twitter-broadcaster-task-4)
- [Auth blockers — magic-link / passkeys / step-up](./GOTCHAS.md#auth-blockers--magic-link--passkeys--step-up-task-4-ib)
- [Backend / Worker](./GOTCHAS.md#backend--worker)
- [Frontend](./GOTCHAS.md#frontend)
- [Ops items still owned by user](./GOTCHAS.md#ops-items-still-owned-by-user-not-in-code)
