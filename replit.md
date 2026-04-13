# Axal VC — StudioOS v1.0

## Overview
A full-stack Venture Studio Operating System (StudioOS) designed for a 30-day startup spin-out model. Built for Axal VC to automate the venture creation pipeline from intake to spinout.

## Tech Stack
- **Backend**: Cloudflare Workers (TypeScript/Hono) at `https://studioos.guillaumelauzier.workers.dev`
- **Frontend**: React 19 + Vite + Tailwind CSS → built to `docs/` → served via GitHub Pages at `axal.vc`
- **Database**: Cloudflare D1 (SQLite at the edge) — `studioos-db`
- **Email**: Resend (transactional email via `RESEND_API_KEY` secret)
- **Spam Protection**: Cloudflare Turnstile (optional, via `TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`)
- **AI**: OpenAI API (optional, for memo generation + advisory)
- **Architecture**: Monorepo — Replit as code editor only, GitHub Pages for frontend, Cloudflare Workers for API

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
      auth.py          — TOTP authentication (register, login, JWT) — JWT_SECRET from env, no fallback
      scoring.py       — Scoring engine + POST /generateMemo (auth required)
      projects.py      — Project CRUD + playbook + auto-scoring (auth required)
      legal.py         — Legal & compliance engine (auth required)
      partners.py      — Partner ecosystem + POST /matchPartners (auth required)
      capital.py       — Capital & investment ops + POST /capitalCall (auth required)
      tickets.py       — Support hub (auth required, user-scoped)
      deals.py         — Deal flow pipeline (auth required)
      users.py         — User management (auth required, admin-only create)
      market_intel.py  — Market intelligence (public data, no auth)
      advisory.py      — AI advisory + financial planner (auth required)
      activity.py      — Activity/audit log endpoints (auth required, user-scoped for non-admins, GitHub sync)
      admin.py         — Admin console (admin-only)
      private_data.py  — Private data API (role-scoped, auth required)
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
      AdminPage.jsx     — Admin console: user management, impersonation, role changes
      MarketIntelPage.jsx — Market intelligence (pulse, macro, private, conviction, benchmarks)
      AdvisoryPage.jsx  — AI advisory + financial planner + diligence checker
      ActivityPage.jsx  — System activity/audit log
      ApiBridgePage.jsx — API Bridge & Jekyll integration (bridge script, usage examples, config)
```

## StudioOS Modules (7 Engines)
1. **Intelligence Engine** — BI, market data, sector signals, competitive intelligence, studio benchmarks
2. **Scoring & Diligence Engine** — 100-pt scoring, automated diligence (legal/tech/financial checks)
3. **AI Advisory Suite** — AI advisor (strategy/GTM/fundraising), financial planner, diligence automation
4. **Deal & Match Engine** — Deal flow pipeline, partner matchmaking, referral system
5. **Legal & Compliance Engine** — Full VC legal stack across 4 layers: GP governance (operating agreement, carried interest, IC charter, service agreements), Fund formation (LPA, PPM, subscription, management co.), Portfolio execution (SAFE, term sheet, SPA, bylaws, equity split, IP, voting rights), Compliance (Form ADV, AML/KYC, 83(b) election). 18 templates total with preview, generation, and document management.
6. **Operations & Support Hub** — Ticket support, activity/audit log
7. **Capital & Investment Engine** — Capital calls, LP investor portal, portfolio performance tracking

## Database Tables
- **users** — id, email, name, role (admin/founder/partner), password_hash, email_verified, verification_token, verification_token_expires
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
- TOTP-based (passwordless) authentication using otpauth
- **Email verification required before TOTP setup** — prevents impersonation
- Registration flow: Form (+ Turnstile) → Email verification via Resend → TOTP authenticator setup → Dashboard
- Verification tokens are SHA-256 hashed in DB, expire in 24 hours
- Resend verification rate limited (max 3/hour per email)
- Email sending via Resend API (falls back to console warning if RESEND_API_KEY not set)
- Cloudflare Turnstile bot protection on registration (optional — skipped if TURNSTILE_SECRET_KEY not configured)
- JWT tokens (24h expiry) for session management (jose library)
- Frontend auth guard redirects unauthenticated users to login
- Public pages: Landing (/), Register (/register), Login (/login), Verify Email (/verify-email)
- All dashboard routes are protected behind authentication

## API Endpoints
Auth:
- POST /api/auth/register — Create pending user + send verification email
- POST /api/auth/verify-email?token=... — Verify email token, returns setup_token
- POST /api/auth/setup-totp — Set up TOTP (requires verified email + setup_token)
- POST /api/auth/resend-verification — Resend verification email (rate limited)
- POST /api/auth/login — Login with email + TOTP code → JWT
- GET /api/auth/me — Get current user (requires JWT)
- POST /api/auth/verify-totp — Verify a TOTP code

Support:
- POST /api/tickets/ — Create ticket + auto-create GitHub issue on AxalNetwork/StudioOS
- GET /api/tickets/ — List all tickets
- PUT /api/tickets/{id} — Update ticket status/assignment

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

Admin:
- GET /api/admin/users — List all users (admin only)
- POST /api/admin/impersonate/{user_id} — Impersonate a user (admin only)
- PATCH /api/admin/users/{user_id}/role — Change user role (admin only)
- PATCH /api/admin/users/{user_id}/toggle-active — Toggle user active status (admin only)

Private Data API (Jekyll Bridge):
- GET /api/private-data/profile — User profile + linked founder/partner data (auth required)
- GET /api/private-data/market/private-signals — Private market signals + conviction status (admin/partner)
- GET /api/private-data/portfolio/metrics — Role-scoped portfolio metrics (founder: projects/burn, partner: deals+fund/TVPI+portfolio, admin: all)
- GET /api/private-data/founder/{user_id} — Founder-specific data (admin or self only)

Full CRUD on projects, partners, investors, tickets, deals, users, documents, entities.

## Jekyll Integration (Clean Room Architecture)
- Private data (PII, financials, auth) stays in Replit PostgreSQL
- External Jekyll site fetches data via authenticated API calls
- Set JEKYLL_ORIGIN env var to restrict CORS to Jekyll domain (e.g., https://your-studio.github.io)
- Frontend bridge script available at /api-bridge page (admin only)
- Bridge handles JWT auth, session management, impersonation, and role-based data loading

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

## User Portals & RBAC
Role-based access control with 3 roles: admin, founder, partner (partner includes LP investor capabilities)

1. **Admin Console** — User management, role changes, impersonation ("Login As"), portal switcher
2. **StudioOS Dashboard** — Studio overview (all roles see this)
3. **Founder Portal** — Multi-step submission with instant scoring results
4. **Partner / Investor Portal** — Deal flow, LP investors, capital calls, portfolio performance

**Portal Switcher** (Admin only): A violet bar at the top allows admins to switch between Admin/Founder/Partner views. Sidebar navigation updates dynamically based on the selected view mode.

**Impersonation**: Admins can "Login As" any user to troubleshoot their experience. Original admin session is preserved and can be restored with "Exit Impersonation".

## Development
Backend runs on port 8000 (localhost), Frontend on port 5000 (0.0.0.0).
Vite proxies /api/* to the backend.

## Seed Data
4 example projects, 3 partners, 2 LP investors, 2 tickets.

## GitHub Pages (axal.vc)
The `docs/` directory contains the production build of the React frontend, served by GitHub Pages at axal.vc:
- Built via `./build-pages.sh` or `cd frontend && npx vite build`
- Output: `docs/` with index.html, assets/, 404.html, .nojekyll, CNAME
- SPA routing handled via 404.html redirect trick (GitHub Pages SPA pattern)
- API calls from axal.vc point to the Replit backend (cross-origin, CORS configured)
- CORS: backend explicitly allows `https://axal.vc` and `https://www.axal.vc`
- GitHub Pages source: main branch, `/docs` folder
- `api.js` auto-detects hostname: uses relative `/api` on Replit, full URL on axal.vc

## Deployment
Autoscale deployment: builds frontend, serves via FastAPI with static files.

## Environment Variables
- DATABASE_URL — PostgreSQL connection (auto-set by Replit)
- OPENAI_API_KEY — Optional, for AI advisory + memo generation (falls back to templates)
- JWT_SECRET — JWT signing key (defaults to dev key if not set)
- GOOGLE_CLIENT_ID — Gmail API OAuth2 client ID (from Google Cloud Console)
- GOOGLE_CLIENT_SECRET — Gmail API OAuth2 client secret
- GOOGLE_REFRESH_TOKEN — Gmail API OAuth2 refresh token (from OAuth Playground)
- GMAIL_SENDER_EMAIL — Gmail address used to send verification emails
- GOOGLE_REDIRECT_URI — OAuth2 redirect URI (defaults to OAuth Playground URL)
- GITHUB_ACCESS_TOKEN — GitHub OAuth token (via Replit GitHub connector)
- GITHUB_REPO_OWNER — GitHub repo owner for ticket issues (AxalNetwork)
- GITHUB_REPO_NAME — GitHub repo name for ticket issues (StudioOS)

## Auth Packages
- pyotp — TOTP generation/verification
- PyJWT — JWT token creation/validation
- qrcode — QR code generation for authenticator setup

## Cloudflare Worker Migration (`cloudflare-worker/`)
A complete port of the FastAPI backend to Cloudflare Workers (TypeScript/Hono).

### Stack
- **Runtime**: Cloudflare Workers (edge)
- **Framework**: Hono (TypeScript)
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Email**: Resend (transactional email)
- **Auth**: JWT (jose) + TOTP (otpauth)
- **KV**: TOKENS (verification tokens), RATE_LIMITS (login/resend throttling)

### D1 Setup (one-time)
```bash
cd cloudflare-worker
npm run db:create           # creates the D1 database, prints the ID
# → copy the ID into wrangler.toml [d1_databases] database_id
npm run db:schema:remote    # applies schema.sql to the live D1 database
npm run deploy              # deploy the worker
```

### Structure
```
cloudflare-worker/
  wrangler.toml       — Cloudflare config (KV, D1, vars) — replace REPLACE_WITH_D1_DATABASE_ID
  package.json        — Dependencies
  tsconfig.json       — TypeScript config
  sql/schema.sql      — SQLite/D1 schema
  SETUP.md            — Step-by-step deployment guide
  src/
    index.ts          — Main entry (Hono app, CORS, error handling, routes)
    types.ts          — TypeScript interfaces (Env uses D1Database)
    db.ts             — D1 tagged-template helper (getSQL)
    auth.ts           — JWT + TOTP auth helpers
    services/
      email.ts        — Resend email service
      scoring.ts      — 100-point scoring engine
    routes/
      auth.ts         — Register, verify, TOTP setup, login
      scoring.ts      — Score engine, deal memos, queue
      projects.ts     — Project CRUD, submit + auto-score
      legal.ts        — 18 legal templates, documents, entities
      partners.ts     — Partner CRUD, matchmaking, referrals
      capital.ts      — LP investors, capital calls, portfolio
      deals.ts        — Deal flow pipeline
      tickets.ts      — Support tickets + GitHub sync
      users.ts        — User management
      admin.ts        — Admin console (impersonation, roles)
      activity.ts     — Activity/audit logs
      market-intel.ts — Market intelligence (static data)
      advisory.ts     — AI advisory, financial planner, diligence
      private-data.ts — Role-scoped private data API
```

### Deploy
See `cloudflare-worker/SETUP.md` for complete deployment instructions.
