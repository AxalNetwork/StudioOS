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
- **Fund Management**: Tools for fund and Limited Partner (LP) tracking.
- **Admin Controls**: Granular user access levels and robust session management with MFA.
- **Settings Management**: User profiles, jurisdictions, email changes, TOTP, notification preferences, privacy settings, and account deletion requests.
- **Financial Model Builder**: Allows founders to create and analyze financial projections, runway, and breakeven points.
- **Progress Tracking**: Modules for customer discovery (interviews), roadmap (OKRs with Kanban), and metrics snapshots (MRR, users, LTV-CAC, churn).
- **Demand Insights**: Aggregates founder needs into heatmaps, trends, and an insight feed for partners and investors.

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