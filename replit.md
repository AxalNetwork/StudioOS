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
- `JWT_SECRET` — Required for auth token signing (set in Replit Secrets)
- `GOOGLE_REDIRECT_URI` — Google OAuth redirect URI
- `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` — GitHub integration config
- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL credentials (available if needed)

## Dependencies
- Node packages installed globally (not in `frontend/node_modules`) — run from workspace root
- Python packages in `.pythonlibs/`
- Frontend package.json is in `frontend/`

## Notes
- Social media icons (Facebook, Instagram, Twitter, Youtube, Linkedin) removed from lucide-react 1.x — replaced with inline SVGs
- `AlertOctagon` removed from lucide-react 1.x — replaced with `AlertTriangle`
- `Github` icon removed from lucide-react 1.x — replaced with `GitBranch`
- The Cloudflare Worker backend (`cloudflare-worker/`) is for production Cloudflare deployment only; the Python FastAPI backend is used in Replit
