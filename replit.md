# Axal VC — StudioOS v1.0

## Overview
A full-stack Venture Studio Operating System (StudioOS) designed for a 30-day startup spin-out model. Built for Axal VC to automate the venture creation pipeline from intake to spinout.

## Tech Stack
- **Backend**: Python 3.11 + FastAPI + SQLModel + Uvicorn
- **Frontend**: React 19 + Vite + Tailwind CSS
- **Database**: Replit PostgreSQL
- **AI**: OpenAI API (optional, for memo generation + advisory)
- **Architecture**: Monorepo with `/backend` and `/frontend`

## Project Structure
```
/backend/
  app/
    main.py           — FastAPI app entry point
    database.py        — SQLModel + PostgreSQL connection
    models/entities.py — All database models (User, Deal, Project, Score, etc.)
    schemas/scoring.py — Pydantic request schemas
    services/
      scoring.py       — 100-point scoring algorithm
      ai_memo.py       — AI-powered deal memo generation (OpenAI)
    api/routes/
      auth.py          — TOTP authentication (register, login, JWT)
      scoring.py       — Scoring engine + POST /generateMemo
      projects.py      — Project CRUD + playbook + auto-scoring (POST /submit)
      legal.py         — Legal & compliance engine
      partners.py      — Partner ecosystem + POST /matchPartners
      capital.py       — Capital & investment ops + POST /capitalCall
      tickets.py       — Support hub
      deals.py         — Deal flow pipeline (applied→scored→active→funded)
      users.py         — User management with roles (admin/founder/partner)
      market_intel.py  — Market intelligence (sector signals, macro, private rounds)
      advisory.py      — AI advisory + financial planner + diligence checker
      activity.py      — Activity/audit log endpoints
  seed.py              — Seed data script

/frontend/
  src/
    App.jsx            — Main app with routing, auth guard, sidebar
    lib/api.js         — API client with JWT auth headers
    pages/
      LandingPage.jsx   — Public landing page (Axal Ventures)
      RegisterPage.jsx  — Registration with TOTP QR setup
      LoginPage.jsx     — TOTP-based login
      Dashboard.jsx     — Studio overview dashboard
      ScoringPage.jsx   — 100-point scoring UI
      ProjectsPage.jsx  — Project pipeline
      ProjectDetail.jsx — Project detail + playbook + 4-week tracker
      LegalPage.jsx     — Legal docs & incorporation
      PartnersPage.jsx  — Partner matchmaking + referrals
      CapitalPage.jsx   — LP investors & capital calls
      TicketsPage.jsx   — Support ticket management
      DealsPage.jsx     — Deal flow pipeline with status progression
      FounderPortal.jsx — Founder submission form with auto-scoring
      PartnerPortal.jsx — Partner view: deals + capital call acceptance
      MarketIntelPage.jsx — Market intelligence (pulse, macro, private, conviction, benchmarks)
      AdvisoryPage.jsx  — AI advisory + financial planner + diligence checker
      ActivityPage.jsx  — System activity/audit log
      LPPortalPage.jsx  — LP investor portal (portfolio, capital calls, returns)
```

## StudioOS Modules (7 Engines)
1. **Intelligence Engine** — BI, market data, sector signals, competitive intelligence, studio benchmarks
2. **Scoring & Diligence Engine** — 100-pt scoring, automated diligence (legal/tech/financial checks)
3. **AI Advisory Suite** — AI advisor (strategy/GTM/fundraising), financial planner, diligence automation
4. **Deal & Match Engine** — Deal flow pipeline, partner matchmaking, referral system
5. **Legal & Compliance Engine** — Incorporation, templates (SAFE, bylaws, equity, IP), document management, spinout workflow
6. **Operations & Support Hub** — Ticket support, activity/audit log
7. **Capital & Investment Engine** — Capital calls, LP investor portal, portfolio performance tracking

## Database Tables
- **users** — id, email, name, role (admin/founder/partner), password_hash
- **projects** — Startup pipeline (status, playbook week, sector, financials)
- **founders** — Founder profiles
- **partners** — Partner ecosystem with referral codes
- **deals** — Deal flow CRM (applied → scored → active → funded)
- **score_snapshots** — Historical scoring records
- **deal_memos** — Structured investment memos
- **documents** — Legal documents
- **entities** — Legal entities (holding company, subsidiary, VC fund)
- **lp_investors** — Limited Partners
- **capital_calls** — Capital call tracking
- **tickets** — Support tickets
- **activity_logs** — System activity/audit tracking

## Authentication
- TOTP-based (passwordless) authentication using pyotp
- Registration generates a TOTP secret + QR code for authenticator apps
- Login requires email + 6-digit TOTP code from authenticator
- JWT tokens (24h expiry) for session management
- Frontend auth guard redirects unauthenticated users to login
- Public pages: Landing (/), Register (/register), Login (/login)
- All dashboard routes are protected behind authentication

## API Endpoints
Auth:
- POST /api/auth/register — Register + get TOTP QR code
- POST /api/auth/login — Login with email + TOTP code → JWT
- GET /api/auth/me — Get current user (requires JWT)
- POST /api/auth/verify-totp — Verify a TOTP code

Core:
- POST /api/scoring/score — Score a startup (100-pt algorithm)
- POST /api/scoring/generateMemo — AI-generated deal memo
- POST /api/projects/submit — Founder submission with auto-scoring
- POST /api/partners/matchPartners — Ranked partner matchmaking
- POST /api/capital/capitalCall — Capital call with partner participation

Market Intelligence:
- GET /api/market-intel/market-pulse — Sector signals + gap opportunities
- GET /api/market-intel/macro — Public market data (P/E, growth, IPO windows)
- GET /api/market-intel/private-rounds — Recent private funding rounds
- GET /api/market-intel/studio-benchmarks — Studio performance metrics
- GET /api/market-intel/competitive-intelligence — High-conviction plays

AI Advisory:
- POST /api/advisory/ask — AI strategy advisor (GTM, fundraising, product, team)
- POST /api/advisory/financial-plan — Financial planner (burn, runway, projections)
- POST /api/advisory/diligence — Automated diligence checker

Activity:
- GET /api/activity/ — Activity log with filtering
- GET /api/activity/summary — Activity summary + action breakdown

Full CRUD on projects, partners, investors, tickets, deals, users, documents, entities.

## Automation Logic
- Startup submitted via Founder Portal → auto-scored immediately
- Score ≥ 85 → TIER_1 (Immediate Spinout), stage → BUILD
- Score ≥ 70 → TIER_2 (Conditional), deal status → scored
- Score < 70 → REJECTED
- Diligence checker auto-validates scoring, legal docs, team, financials
- Activity log auto-records all system actions

## Scoring Algorithm (100 points)
- A. Market (25 pts): TAM/SAM (0-10), Urgency (0-10), Trend (0-5)
- B. Team (20 pts): Expertise (0-8), Execution (0-8), Network (0-4)
- C. Product (15 pts): MVP Time (0-7), Complexity (0-5), Dependencies (0-3)
- D. Capital (15 pts): Cost to MVP (0-7), Revenue Time (0-5), Burn Risk (0-3)
- E. Strategic Fit (15 pts): Alignment (0-10), Synergy (0-5)
- F. Distribution (10 pts): Channels (0-5), Virality (0-5)

## User Portals
1. **StudioOS Dashboard** — Studio admin overview (projects, deals, partners, scores)
2. **Founder Portal** — Multi-step submission with instant scoring results
3. **Partner Portal** — Deal access + capital call acceptance
4. **LP Investor Portal** — Portfolio performance, capital calls, returns tracking

## Development
Backend runs on port 8000 (localhost), Frontend on port 5000 (0.0.0.0).
Vite proxies /api/* to the backend.

## Seed Data
4 example projects, 3 partners, 2 LP investors, 2 tickets.

## Deployment
Autoscale deployment: builds frontend, serves via FastAPI with static files.

## Environment Variables
- DATABASE_URL — PostgreSQL connection (auto-set by Replit)
- OPENAI_API_KEY — Optional, for AI advisory + memo generation (falls back to templates)
- JWT_SECRET — JWT signing key (defaults to dev key if not set)

## Auth Packages
- pyotp — TOTP generation/verification
- PyJWT — JWT token creation/validation
- qrcode — QR code generation for authenticator setup
