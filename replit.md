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
- **FastAPI is the canonical API and source of truth** (audit #4). The Cloudflare Worker (`cloudflare-worker/`) is now a thin edge proxy/cache that forwards `/api/*` to FastAPI; only WebSocket Durable Objects + the queue consumer remain at the edge. Legacy in-worker route handlers under `cloudflare-worker/src/routes/*.ts` are kept for git history but are not mounted (see `cloudflare-worker/src/routes/README.md`).
- **Per-bucket rate limits** in `backend/app/services/rate_limit.py` mirror the worker buckets: spinout 5/hr, ai 10/min, user 60/min, global 1000/min.
- **Legacy data drift sealed** (audit #1): `backend/app/services/db_guards.py` registers SQLAlchemy event listeners that raise on any insert/update to `lp_investors` or `entities(type='vc_fund')`. Reads still work for the consolidation migration.
- **Content-Security-Policy** header added to the FastAPI security middleware (audit #9).
- **GitHub auto-tickets** carry an `origin: <env>` label (audit #10), default `staging`; set `STUDIOOS_ENV=production` on the prod backend.
- See `PRODUCTION.md` for the release-blocker list (notably `POST /api/search/backfill`, audit #7).
