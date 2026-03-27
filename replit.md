# Axal VC — StudioOS v1.0

## Overview
A full-stack Venture Studio Operating System (StudioOS) designed for a 30-day startup spin-out model. Built for Axal VC to automate the venture creation pipeline from intake to spinout.

## Tech Stack
- **Backend**: Python 3.11 + FastAPI + SQLModel + Uvicorn
- **Frontend**: React 19 + Vite + Tailwind CSS
- **Database**: Replit PostgreSQL
- **AI**: OpenAI API (optional, for memo generation)
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
      scoring.py       — Scoring engine + POST /generateMemo
      projects.py      — Project CRUD + playbook + auto-scoring (POST /submit)
      legal.py         — Legal & compliance engine
      partners.py      — Partner ecosystem + POST /matchPartners
      capital.py       — Capital & investment ops + POST /capitalCall
      tickets.py       — Support hub
      deals.py         — Deal flow pipeline (applied→scored→active→funded)
      users.py         — User management with roles (admin/founder/partner)
  seed.py              — Seed data script

/frontend/
  src/
    App.jsx            — Main app with routing + sidebar
    lib/api.js         — API client
    pages/
      Dashboard.jsx    — Studio overview dashboard
      ScoringPage.jsx  — 100-point scoring UI
      ProjectsPage.jsx — Project pipeline
      ProjectDetail.jsx — Project detail + playbook
      LegalPage.jsx    — Legal docs & incorporation
      PartnersPage.jsx — Partner matchmaking + referrals
      CapitalPage.jsx  — LP investors & capital calls
      TicketsPage.jsx  — Support ticket management
      DealsPage.jsx    — Deal flow pipeline with status progression
      FounderPortal.jsx — Founder submission form with auto-scoring
      PartnerPortal.jsx — Partner view: deals + capital call acceptance
```

## Database Tables
- **users** — id, email, name, role (admin/founder/partner), password_hash
- **projects** — Startup pipeline (status, playbook week, sector, financials)
- **founders** — Founder profiles
- **partners** — Partner ecosystem with referral codes
- **deals** — Deal flow CRM (applied → scored → active → funded)
- **score_snapshots** — Historical scoring records
- **deal_memos** — Structured investment memos
- **documents** — Legal documents
- **entities** — Legal entities
- **lp_investors** — Limited Partners
- **capital_calls** — Capital call tracking
- **tickets** — Support tickets
- **activity_logs** — System activity tracking

## API Endpoints
- POST /api/scoring/score — Score a startup
- POST /api/scoring/generateMemo — AI-generated deal memo (standalone)
- POST /api/projects/submit — Founder submission with auto-scoring
- POST /api/partners/matchPartners — Ranked partner matchmaking
- POST /api/capital/capitalCall — Capital call with partner participation
- GET /api/deals/ — Deal flow pipeline
- GET /api/users/ — User management
- Full CRUD on projects, partners, investors, tickets, deals

## Automation Logic
- When startup is submitted via Founder Portal → auto-scored immediately
- Score ≥ 85 → TIER_1 (Immediate Spinout), stage → BUILD
- Score ≥ 70 → TIER_2 (Conditional), deal status → scored
- Score < 70 → REJECTED

## Scoring Algorithm (100 points)
- A. Market (25 pts): TAM/SAM (0-10), Urgency (0-10), Trend (0-5)
- B. Team (20 pts): Expertise (0-8), Execution (0-8), Network (0-4)
- C. Product (15 pts): MVP Time (0-7), Complexity (0-5), Dependencies (0-3)
- D. Capital (15 pts): Cost to MVP (0-7), Revenue Time (0-5), Burn Risk (0-3)
- E. Strategic Fit (15 pts): Alignment (0-10), Synergy (0-5)
- F. Distribution (10 pts): Channels (0-5), Virality (0-5)

## Development
Backend runs on port 8000 (localhost), Frontend on port 5000 (0.0.0.0).
Vite proxies /api/* to the backend.

## Seed Data
3 example projects (NexusAI, ChainFlow, DataCortex), 3 partners, 2 LP investors, 2 tickets.

## Deployment
Autoscale deployment: builds frontend, serves via FastAPI with static files.

## Environment Variables
- DATABASE_URL — PostgreSQL connection (auto-set by Replit)
- OPENAI_API_KEY — Optional, for AI memo generation (falls back to template-based memos)
