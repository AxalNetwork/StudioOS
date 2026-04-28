# Axal StudioOS

## Overview
API-first Venture Studio Operating System — "The 30-Day Spin-Out Engine" for venture capital and startup incubation. Manages startup project lifecycle from intake and AI scoring through legal formation (spin-outs), fundraising, and portfolio monitoring.

## Architecture

### Frontend (`frontend/`)
- React 19 + Vite 6 + Tailwind CSS 4
- Runs on port 5000
- Proxies `/api` requests to backend on port 8000
- Workflow: `Start application` → `cd frontend && npm run dev`

### Backend (`backend/`)
- FastAPI (Python) with SQLModel/SQLAlchemy
- SQLite database at `backend/app.db`
- Runs on port 8000
- Workflow: `Backend API` → `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload`

## Key Features
- AI Scoring Engine for startup evaluation
- Spin-out Wizard for legal entity formation
- Real-time pipeline with WebSocket support
- KYC & legal document management
- Partner network and referral system
- Fund management and LP tracking

## Environment Variables / Secrets
- `JWT_SECRET` — **Required.** Backend fails fast at import time if unset (no dev fallback).
- `STUDIOOS_ENV` — `production` / `staging` / `dev` / `preview`. Drives the GitHub support-ticket origin label. Defaults to `staging`.
- `GOOGLE_REDIRECT_URI` — Google OAuth redirect URI
- `GITHUB_ACCESS_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` — GitHub integration config
- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL credentials (available if needed)

## Dependencies
- Node packages installed globally (not in `frontend/node_modules`) — run from workspace root
- Python packages in `.pythonlibs/`
- Frontend package.json is in `frontend/`

## Notes
- Social media icons (Facebook, Instagram, Twitter, Youtube, Linkedin) removed from lucide-react 1.x — replaced with inline SVGs
- `AlertOctagon` removed from lucide-react 1.x — replaced with `AlertTriangle`
- `Github` icon removed from lucide-react 1.x — replaced with `GitBranch`

## Architecture decisions
- **The Cloudflare Worker is the production API** (revised 2026-04-28). The earlier "audit #4" plan to make FastAPI canonical was never completed — the 23 production users live in D1 and FastAPI was never deployed publicly. `cloudflare-worker/src/index.ts` mounts every router under `cloudflare-worker/src/routes/*.ts` (auth, scoring, projects, legal, capital, deals, …) at `/api/<prefix>`. FastAPI in `backend/` stays as the local Replit dev backend and mirrors the same `/api/...` paths so the frontend works against either. See `PRODUCTION.md` and `cloudflare-worker/src/routes/README.md` for the mount map and the deploy command (`npx wrangler deploy` — never `--env production`, that strips the bindings).
- **Per-bucket rate limits** in `backend/app/services/rate_limit.py` mirror the worker buckets: spinout 5/hr, ai 10/min, user 60/min, global 1000/min.
- **Legacy data drift sealed** (audit #1): `backend/app/services/db_guards.py` registers SQLAlchemy event listeners that raise on any insert/update to `lp_investors` or `entities(type='vc_fund')`. Reads still work for the consolidation migration.
- **Content-Security-Policy** header added to the FastAPI security middleware (audit #9).
- **GitHub auto-tickets** carry an `origin: <env>` label (audit #10), default `staging`; set `STUDIOOS_ENV=production` on the prod backend.
- See `PRODUCTION.md` for the release-blocker list (notably `POST /api/search/backfill`, audit #7).

## Phase A/C Safe-Slice (April 2026)
- **A1**: `entities` table now carries `CHECK (entity_type <> 'vc_fund') NOT VALID` constraint; ORM/Core guards now also emit a `deprecated_*_writes_blocked` ActivityLog row each time they fire so the admin dashboard can count drift attempts.
- **A2**: `tests/test_db_guards.py` proves all four legacy write paths (ORM insert, Core bulk insert × 2 deprecated targets) are sealed. Run with `uv run pytest tests/`.
- **A3**: `capital_calls.limited_partner_id` is promoted to `NOT NULL` automatically on the first boot after backfill completes (`_try_apply_capital_call_not_null`).
- **A4**: `POST /api/funds/distributions/execute` now requires a `fund_id` body field; missing field yields a 422 with `error.error_code = "ERR_DISTRIBUTION_FUND_ID_REQUIRED"`.
- **A5**: Both backend and Cloudflare worker fail fast on boot if `JWT_SECRET` is shorter than 32 bytes when `STUDIOOS_ENV ∈ {production, prod, staging}`. Dev/preview unchanged.
- **C2**: `POST /api/csp-report` collector persists violations as `ActivityLog` rows (action=`csp_violation`); per-IP throttled at 30/min.
- **C3**: CSP tightened — `connect-src` restricted to self + workers.dev + GitHub + OpenAI; `report-uri` wired to the new collector.
- **C4**: `/api/auth/register` enforces 5/min/IP and 3/day/email; the request body now accepts a `_axl_hp` honeypot field — non-empty values are silently dropped (logged as `register_bot_dropped`).
- **G1**: Removed obsolete `netlify.toml` (frontend ships via Cloudflare Pages, not Netlify).

## Admin user-access controls (April 2026)
- **Grant Full Access**: admin button on `/admin` reuses `kycAdminApprove` and additionally logs `kyc_bypass_granted` when no KYC submission exists. Sets `users.kyc_status='approved'`.
- **Limited Access (no KYC, no signing)**: new `users.access_level` column. `'limited'` lets a non-admin user log in and browse the platform without completing KYC, but they cannot sign any binding agreement. Worker endpoint `PATCH /api/admin/users/:user_id/access-level` (FastAPI mirror at same path) sets/clears the level. Audited as `access_limited_granted` / `access_limited_revoked`.
- **Sign-gate enforcement (server-authoritative)**: `requireApprovedKyc` (admin OR `kyc_status==='approved'`) is now used on every binding signing surface:
  - Worker `PUT /api/legal/documents/:id/sign`
  - Worker `PATCH /api/legalcap/legal/docs/:id/sign`
  - Worker `POST /api/funds/lps/:lpId/sign-lpa`
  - Worker `POST /api/legal/esign/sign/:token` (magic-link; resolves recipient by `envelope_user_id` then by lower(email) and returns 403 `kyc_required_for_signing` if limited+not-approved)
  - FastAPI `POST /api/legal/documents/{doc_id}/sign` (inline guard)
- Frontend: `App.jsx` KYC gate bypasses redirect when `access_level==='limited'`; `AdminPage.jsx` shows a sky-blue "Limited" pill and Grant/Revoke Limited buttons; `ESignPage.jsx` shows an amber "signing disabled" banner and disables the signature pad when the logged-in signer is limited.
- **Founders are KYC-optional by default**: founders are not auto-redirected to `/kyc` and the "Identity Verification" sidebar item is hidden for them. KYC only becomes mandatory for founders at the moment they sign incorporation/SAFE/IP_license/equity_allocation docs — those signing endpoints already enforce `requireApprovedKyc` server-side, and `ESignPage.jsx` shows an amber banner pointing to `/kyc`. The `/kyc` route remains reachable via direct URL for founders who want to start verification voluntarily.
- **Worker `PATCH /api/admin/users/:id/role` query-string fix** (2026-04-28): the frontend sends `?role=...` as a query string with no JSON body. Worker now reads from query first and falls back to body parse, so admin role changes no longer return 500.
