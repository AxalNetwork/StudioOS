# Axal VC — StudioOS v1.0

## Overview
A full-stack Venture Studio Operating System (StudioOS) designed for a 30-day startup spin-out model. Built for Axal VC to automate the venture creation pipeline from intake to spinout.

## Tech Stack
- **Backend**: Python 3.11 + FastAPI + SQLModel + Uvicorn
- **Frontend**: React 19 + Vite + Tailwind CSS
- **Database**: Replit PostgreSQL
- **Architecture**: Monorepo with `/backend` and `/frontend`

## Project Structure
```
/backend/
  app/
    main.py           — FastAPI app entry point
    database.py        — SQLModel + PostgreSQL connection
    models/entities.py — All database models
    schemas/scoring.py — Pydantic request schemas
    services/scoring.py — 100-point scoring algorithm
    api/routes/
      scoring.py       — Scoring engine endpoints
      projects.py      — Project CRUD + playbook
      legal.py         — Legal & compliance engine
      partners.py      — Partner ecosystem
      capital.py       — Capital & investment ops
      tickets.py       — Support hub
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
```

## 7 Core Modules
1. **Analytics & BI Core** — Dashboard stats and portfolio overview
2. **Partner Ecosystem** — Matchmaking, referral codes, deal flow
3. **Diligence & Scoring Engine** — 100-point algorithm (Market 25, Team 20, Product 15, Capital 15, Fit 15, Distribution 10)
4. **AI Advisory Suite** — AI adjustment layer in scoring
5. **Legal & Compliance Engine** — Document templates, incorporation, spin-out workflows
6. **Operations & Support Hub** — Ticket management
7. **Capital & Investment Ops** — LP investors, capital calls, portfolio tracking

## Scoring Algorithm (100 points)
- A. Market (25 pts): TAM/SAM (0-10), Urgency (0-10), Trend (0-5)
- B. Team (20 pts): Expertise (0-8), Execution (0-8), Network (0-4)
- C. Product (15 pts): MVP Time (0-7), Complexity (0-5), Dependencies (0-3)
- D. Capital (15 pts): Cost to MVP (0-7), Revenue Time (0-5), Burn Risk (0-3)
- E. Strategic Fit (15 pts): Alignment (0-10), Synergy (0-5)
- F. Distribution (10 pts): Channels (0-5), Virality (0-5)
- Tiers: 85-100 = Tier 1 (Immediate Spinout), 70-84 = Tier 2 (Conditional), <70 = Reject

## Development
Backend runs on port 8000 (localhost), Frontend on port 5000 (0.0.0.0).
Vite proxies /api/* to the backend.

## Seed Data
3 example projects (NexusAI, ChainFlow, DataCortex), 3 partners, 2 LP investors, 2 tickets.

## Deployment
Autoscale deployment: builds frontend, serves via FastAPI with static files.
