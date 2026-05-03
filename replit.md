# Axal StudioOS

## Overview
Axal StudioOS is an API-first Venture Studio Operating System, designed as a "30-Day Spin-Out Engine" for venture capital firms and startup incubators. Its primary purpose is to manage the entire startup project lifecycle, encompassing intake, AI-driven scoring, legal formation (spin-outs), fundraising, and continuous portfolio monitoring. The platform aims to streamline the process of launching and managing new ventures, providing robust tools for legal, financial, and operational oversight.

## User Preferences
The user prefers clear and concise communication. They value iterative development and expect the agent to ask for confirmation before implementing major architectural changes or significant code refactoring. The user also requests that the agent prioritizes security best practices and robust error handling in all implementations.

## System Architecture

### Core Technologies
- **Frontend**: React 19, Vite 6, Tailwind CSS 4. Runs on port 5000 and proxies `/api` requests.
- **Backend**: FastAPI (Python) with SQLModel/SQLAlchemy. Uses SQLite for local development and PostgreSQL for production. Runs on port 8000.
- **Production API**: Cloudflare Worker serves as the canonical production API, mounting various routers at `/api/<prefix>`. The FastAPI backend mirrors these paths for local development.

### Key Features
- **AI Scoring Engine**: Evaluates startup potential and traction using financial models and progress signals.
- **Spin-out Wizard**: Guides legal entity formation.
- **Real-time Pipeline**: Supports WebSocket for live updates.
- **Legal & Compliance**: KYC and document management, with sign-gate enforcement for binding agreements.
- **Network & Referrals**: Partner and referral system, including a service provider marketplace and needs board.
- **Service Catalogue & Engagement Lifecycle**: Partners publish productised offerings (price, SLA, deliverables); founders book directly. Engagements run a strict state machine (`accepted → in_progress → delivered → reviewed → invoiced`, plus `cancelled`). Two-sided ratings unlock only after `delivered` and both sides must review for the engagement to promote to `reviewed`. Stripe Connect handles invoicing — runs in **simulated mode** when `STRIPE_SECRET_KEY` is unset (deterministic `acct_sim_*` / `in_sim_*` IDs flagged with `simulated: true`), otherwise hits the real Stripe API. Repeat invoicing is idempotent.
- **Public Partner Directory**: No-auth `/directory` page (and `/partners/:slug` profile) backed by `GET /api/marketplace/public/partners` and `GET /api/marketplace/public/partners/{slug}`. Only rows with `Partner.listed = True` surface; email and inquiry-internal fields are stripped from public DTOs. Algorithmic ranking weights completed engagements (×6), avg rating (×12), review volume (×1.5, capped), KYB-verified (+25), response-time tier (20 / 10 / 5 pts for ≤4h / ≤24h / ≤72h), and a featured boost (+1000) so paid/editor slots clear the algorithmic top. Admin-only `POST /api/marketplace/providers/{id}/featured` toggles featured status with a tier (`platinum`/`gold`/`editor`) and optional days-until-expiry; tier validated, expiry honoured at read time. Slugs are generated on first public surface (`{slug(name)}-{uid[:6]}`), guaranteed unique.
- **Fund Management**: Tools for fund and Limited Partner (LP) tracking.
- **Admin Controls**: Granular user access levels and robust session management with MFA.
- **Settings Management**: User profiles, jurisdictions, email changes, TOTP, notification preferences, privacy settings, and account deletion requests.
- **Financial Model Builder**: Allows founders to create and analyze financial projections, runway, and breakeven points.
- **Progress Tracking**: Modules for customer discovery (interviews), roadmap (OKRs with Kanban), and metrics snapshots (MRR, users, LTV-CAC, churn).
- **Demand Insights**: Aggregates founder needs into heatmaps, trends, and an insight feed for partners and investors.
- **Founder Risk Profile** (Task #41): Admin/partner/investor-only DD signal that auto-pulls founder background (prior roles, exits, failures, domain expertise, tags, notable highlights) from the existing PitchBook integration when a key is configured, falling back to a deterministic synthetic profile derived from a sha256(email) seed when none is. A weighted, hand-tunable score (`compute_founder_risk_score` in `services/scoring.py` — base 50, exits −12 each / cap 3, failures +10 each / cap 3, domain years −1 each / cap 15, senior prior roles −3 each / cap 4, +20 unknown penalty when no signal) lands in 0..100 (lower = safer) with a `low/medium/high` band and a per-line breakdown trace. Persisted one-row-per-founder (`founder_risk_profiles`) with raw provider payload kept for audit. Endpoints: `GET /api/founder-risk/by-founder/{id}`, `GET /api/founder-risk/by-deal/{deal_id}`, `POST /api/founder-risk/{id}/pull`, `POST /api/founder-risk/{id}/recompute`. Founders are blocked at the API layer from reading or pulling their own profile. Surfaced inline on the Deals pipeline as a coloured `FounderRiskBadge` next to the next-stage button, with a popover showing stats, tags, signals, and the score breakdown.
- **Reference Check Workflow** (Task #43): Admin/investor-only flow to schedule reference calls, capture explicit consent (snapshotted text + audit trail), upload audio recordings (50MB cap, audio mime allowlist), transcribe via Whisper, and summarise via Llama (`LLAMA_API_URL`/`LLAMA_API_KEY`, OpenAI-compatible) → OpenAI `gpt-4o-mini` → keyword fallback. Output includes summary, tags, strengths, red flags, quotes, and overall sentiment. Recording upload is hard-gated on consent; consent withdrawal cascades a wipe of recording + transcript + summary. Recordings served only via short-lived signed tokens (`/api/files/references/{token}`). Surfaced as an expandable panel on the Deals pipeline page; partners and founders are blocked at the API layer.

### Architectural Decisions
- The Cloudflare Worker is the primary production API, with FastAPI serving as the local development backend.
- Rate limiting is implemented per bucket, mirroring worker configurations.
- Strict data integrity measures are in place to prevent legacy data drift.
- Content-Security-Policy (CSP) headers are rigorously enforced.
- GitHub auto-tickets are tagged with an `origin` label.
- Admin user access is controlled by an `access_level` column.
- Founders have KYC as optional by default, becoming mandatory only for signing critical legal documents.
- Admin role changes are restricted to direct SQL modifications.
- Robust session management with `jti` for individual session revocation and `jwt_min_iat` for global session invalidation.
- Data for insights is aggregated in-memory to ensure SQL portability.
- Weekly digest loops for insights are idempotent and run asynchronously.

## External Dependencies
- **JWT**: For authentication.
- **Google OAuth**: For user authentication.
- **GitHub**: For integration (e.g., auto-tickets).
- **PostgreSQL**: Production database.
- **Cloudflare R2**: For headshot storage.
- **Cloudflare D1**: Production database for the Cloudflare Worker.
- **pyotp & qrcode**: Python libraries for TOTP generation.
- **SMTP Service**: For sending email notifications.
- **openpyxl**: Python library for exporting financial models to Excel.