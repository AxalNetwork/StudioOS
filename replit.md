# Axal StudioOS

## Overview
Axal StudioOS is an API-first Venture Studio Operating System, designed as a "30-Day Spin-Out Engine" for venture capital firms and startup incubators. Its primary purpose is to manage the entire startup project lifecycle, encompassing intake, AI-driven scoring, legal formation (spin-outs), fundraising, and continuous portfolio monitoring. The platform aims to streamline the process of launching and managing new ventures, providing robust tools for legal, financial, and operational oversight.

## User Preferences
The user prefers clear and concise communication. They value iterative development and expect the agent to ask for confirmation before implementing major architectural changes or significant code refactoring. The user also requests that the agent prioritizes security best practices and robust error handling in all implementations.

## System Architecture

### Core Technologies
- **Frontend**: React 19, Vite 6, Tailwind CSS 4. Runs on port 5000 and proxies `/api` requests.
- **Backend**: FastAPI (Python) with SQLModel/SQLAlchemy. Uses SQLite for local development (`backend/app.db`) and PostgreSQL for production. Runs on port 8000.
- **Production API**: Cloudflare Worker serves as the canonical production API, mounting various routers at `/api/<prefix>`. The FastAPI backend mirrors these paths for local development.

### Key Features
- **AI Scoring Engine**: Evaluates startup potential.
- **Spin-out Wizard**: Guides legal entity formation.
- **Real-time Pipeline**: Supports WebSocket for live updates.
- **Legal & Compliance**: KYC and document management.
- **Network & Referrals**: Partner and referral system.
- **Fund Management**: Tools for fund and Limited Partner (LP) tracking.
- **Admin Controls**: Granular user access levels (admin, limited access, KYC enforcement).
- **Settings Management**: User profiles, jurisdictions, email changes, TOTP, notification preferences, privacy settings, and account deletion requests.
- **Multi-factor Authentication (MFA)**: TOTP setup with recovery codes and session management.

### Architectural Decisions
- The Cloudflare Worker is the primary production API, with FastAPI serving as the local development backend.
- Rate limiting is implemented per bucket (e.g., spinout 5/hr, AI 10/min) mirroring worker configurations.
- Strict data integrity measures are in place to prevent legacy data drift, blocking inserts/updates to specific deprecated tables.
- Content-Security-Policy (CSP) headers are rigorously enforced to mitigate security risks.
- GitHub auto-tickets are tagged with an `origin` label based on the environment.
- Admin user access is controlled by an `access_level` column, differentiating between full, limited, and KYC-dependent access.
- Sign-gate enforcement is server-authoritative, requiring approved KYC for binding agreements.
- Founders have KYC as optional by default, becoming mandatory only for signing critical legal documents.
- Admin role changes are restricted to direct SQL modifications for blast-radius control.
- Robust session management with `jti` (JWT ID) for individual session revocation and `jwt_min_iat` for global session invalidation.

## External Dependencies
- **JWT**: For authentication (`JWT_SECRET`).
- **Google OAuth**: For user authentication (`GOOGLE_REDIRECT_URI`).
- **GitHub**: For integration (e.g., auto-tickets) using `GITHUB_ACCESS_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`.
- **PostgreSQL**: Production database (configurable via `DATABASE_URL`, `PGHOST`, etc.).
- **Cloudflare R2**: For headshot storage and streaming.
- **Cloudflare D1**: Production database for the Cloudflare Worker.
- **pyotp & qrcode**: Python libraries for TOTP generation and QR code creation (used in FastAPI mirror).
- **SMTP Service**: For sending email notifications (e.g., email change confirmations).

## Epic 3 — Settings page (this commit)
Concrete changes shipped in this iteration. Treat this section as the source of truth for the surfaces actually wired up; the prose above is a high-level overview only.

**Routes added (worker `cloudflare-worker/src/routes/settings.ts` + FastAPI mirror `backend/app/api/routes/settings.py`):**
- `GET/PATCH /api/settings`, `POST /api/settings/headshot`, `GET /api/settings/headshot/:uid`
- Email change: `POST .../email-change/{request,confirm,revoke}` — confirm and revoke windows are both 24h
- TOTP: `POST .../totp/repair`, `POST .../totp/recovery-codes/regenerate` (8 codes XXXX-XXXX-XXXX, SHA-256 stored)
- Sessions: `GET .../sessions`, `POST .../sessions/{id}/revoke`, `POST .../sessions/revoke-all` (bumps `users.jwt_min_iat`)
- Founder invites: `GET/POST/DELETE .../founder/invites` (cap 10/project, 14d expiry, project ownership enforced via `projects.founder_id == user.founder_id`)
- Account: `POST .../account/delete-request{,/cancel}`, `GET .../data-export`

**Schema (durable in `cloudflare-worker/sql/epic3_settings.sql`, mirrored at runtime in both backends):**
- `users` adds: `bio, headshot_r2_key|headshot_local_path, jurisdictions, socials, notification_prefs, privacy_prefs, role_prefs, jwt_min_iat, deletion_requested_at, totp_recovery_codes`
- New tables: `email_change_requests`, `user_sessions(jti UNIQUE, user_agent, ip, created_at, last_seen_at, revoked_at)`, `founder_invites`

**Auth changes (worker `auth.ts` + FastAPI `auth.py` `get_current_user`):**
- Login mints a UUID `jti`, INSERTs into `user_sessions` with UA + X-Forwarded-For first-hop IP. JWT carries `jti`.
- Every request: reject if `iat < users.jwt_min_iat` (with ms→s normalization), and if `jti` is present reject when its session row is missing or `revoked_at IS NOT NULL`. Heartbeat `last_seen_at` per request. Tokens without `jti` skip the per-session check (back-compat).
- Login calls `_ensure_schema` first so cold-start logins don't lose their session row.

**Frontend (`frontend/src/pages/SettingsPage.jsx`, `frontend/src/lib/api.js`):**
- Single-page sectioned UI (sticky left rail): Profile, Jurisdictions, Email, Authentication, Notifications, Privacy, Role preferences (founder/partner only).
- Authentication section: TOTP repair, recovery codes (regenerate + download .txt), per-session list with "This device" badge + per-row Revoke + "Sign out everywhere".
- Notifications: 3-column matrix (Email / In-app / SMS) — SMS column is disabled with "Coming soon" tooltip. Partner role gets a second card with 5 partner-specific event triggers.
- Role preferences: Founder shows the Co-founder invites card; Partner shows a 0–100 risk slider (Capital preservation / Balanced / Frontier).
- Token-only landing pages: `/settings/email/confirm`, `/settings/email/revoke`.
- `api.js` adds: `getSettings, updateSettings, uploadHeadshot, requestEmailChange, confirmEmailChange, revokeEmailChange, repairTotp, listSessions, revokeSession, revokeAllSessions, regenerateRecoveryCodes, listFounderInvites, createFounderInvite, revokeFounderInvite, requestAccountDeletion, cancelAccountDeletion, exportMyData`.

**Known pre-existing bug (out of scope for this commit):** `frontend/src/pages/VerifyEmailPage.jsx` calls `api.verifyEmail` which doesn't exist — blocks the registration UI flow. Recommend a separate follow-up.
## Task #26 — Financial Model Builder (this commit)

**Backend (`backend/app/api/routes/financials.py`, mounted at `/api`):**
- `GET /api/financials/{project_id}` — fetch saved model, or default-scaffold projection if none.
- `PUT /api/financials/{project_id}` — upsert assumptions; recomputes projection, sensitivity, and capital category.
- `POST /api/financials/{project_id}/recompute` — re-run from stored assumptions (admin/founder/partner/investor read).
- `GET /api/financials/{project_id}/export.xlsx` — 4-sheet workbook (Assumptions, Projection, Summary, Sensitivity) via `openpyxl`.

**Drivers (Pydantic `Assumptions`):** starting_cash, price_per_unit, units_month_0, monthly_growth_pct, cac, monthly_churn_pct, salaries_monthly, opex_monthly, gross_margin_pct, horizon_months (3..60).

**Computation:** month-by-month projection of units/revenue/gross_profit/marketing/fixed/net/cash. Reports `runway_months` (caps when cash hits zero, else extrapolates from avg burn), `avg_monthly_burn`, `breakeven_month` (first month with net ≥ 0), `ending_cash`, `total_revenue_horizon`, `ltv`, `ltv_cac_ratio`. Sensitivity grid: ±20%/±10%/0 on top-3 drivers (price, units_month_0, cac), each cell holding runway/breakeven/ending cash.

**Capital scoring hook:** Saving the model derives 0–10 sliders for the v2 scoring engine's capital category (`SCORING_V2_WEIGHTS["capital"]`):
- `runway` slider = clip(runway_months / 2.4, 0..10) — 24mo+ caps at 10/10.
- `burn_efficiency` slider = clip(ltv_cac_ratio × 3, 0..10) — 3.3:1 caps at 10/10.
The recompute is persisted on the model row (`capital_recompute_json`) and surfaced in the UI; the next official scoring run consumes it.

**Schema:** new `financial_models` table (SQLModel `FinancialModel` in `backend/app/models/entities.py`) — `project_id` UNIQUE, `assumptions_json`, `computed_json`, `sensitivity_json`, `capital_recompute_json`, `updated_by`, timestamps. Auto-created via `SQLModel.metadata.create_all` on startup.

**Authorization (mirrors scoring/legal pattern via `backend/app/api/deps.py`):**
- `_ensure_can_view`: admin/partner/investor (privileged) read all; founder reads only their own project (founder_id match) — blocks IDOR.
- `_ensure_can_edit`: admin always; founder only if `user.founder_id == project.founder_id`; partner/investor blocked.

**Frontend (`frontend/src/pages/FinancialsPage.jsx`, route `/build/financials`):**
- Founder nav entry under Intelligence section.
- Project selector (URL-synced via `?project_id=`), drivers form, save/reset/export buttons.
- Stat cards (runway, burn, breakeven, capital score), Recharts line charts (cash trajectory + revenue/net) with breakeven reference line, sensitivity grid heat-map, capital factor breakdown with progress bars.
- `api.js`: `getFinancialModel`, `saveFinancialModel`, `recomputeFinancialModel`, `downloadFinancialModelXlsx` (token-aware blob download).

**Dependency added:** `openpyxl` (Python).

## Task #28 — Customer discovery, roadmap, metrics (this commit)

Three founder sub-pages under `/build` that replace self-reported scoring inputs with observable signals.

**Schema (auto-created via SQLModel `metadata.create_all`):**
- `interviews` — Mom-Test interview log with `hypotheses_json` ([{hypothesis, status: validated/invalidated/inconclusive, evidence}]) and `pains_json`.
- `okrs` — kanban-backed objectives with `kanban_status` ∈ {now, next, later, done}, `key_results_json` ([{text, target, current, unit}]), and `quarter`.
- `metrics_snapshots` — periodic MRR/ARR/CAC/LTV/churn/active_users with `source` ∈ {manual, stripe}.

**Backend (`backend/app/api/routes/progress.py`, mounted at `/api`):**
- Discovery: `GET/POST /progress/discovery/{project_id}`, `PUT/DELETE /progress/discovery/interview/{id}`.
- Roadmap: `GET/POST /progress/roadmap/{project_id}`, `PUT/DELETE /progress/roadmap/okr/{id}`, `POST /progress/roadmap/okr/{id}/move` for kanban drag.
- Metrics: `GET/POST /progress/metrics/{project_id}`, `DELETE /progress/metrics/{snapshot_id}`, `POST /progress/metrics/{project_id}/import-stripe` (reads `Integration.last_sync_payload` for `provider_name in {stripe, stripe_billing}`; returns 400 with `code: stripe_not_connected` or `code: stripe_no_data` instead of silently fabricating data).
- `GET /progress/signals/{project_id}` — aggregates the three tables into v2 traction sliders.

**Scoring hook (traction category, max 15 in `services/scoring.py::SCORING_V2_WEIGHTS["traction"]`):**
- `users` (max 6): `sqrt(active_users)/5` base + period-over-period growth bonus (30% growth → +3).
- `revenue` (max 6): log-scale on MRR ($1k=4, $10k=6, $100k=8, $1M+=10), with −2 churn penalty when monthly churn > 10%.
- `signals` (max 3): interview cadence (20 interviews → 5/5) + validated-hypothesis count (10 validated → 5/5), capped at 10.

**Authorization (mirrors financials.py via `backend/app/api/deps.py`):**
- `_ensure_can_view`: privileged read (admin/partner/investor) + founder owns project.
- `_ensure_can_edit`: admin always; founder only if `user.founder_id == project.founder_id`; partner/investor blocked.

**Frontend pages (founder nav under Intelligence):**
- `/build/discovery` — `DiscoveryPage.jsx`: project picker, interview list, per-interview hypothesis grid (validated/invalidated/inconclusive), pain-tag chips, modal with Mom-Test notes + hypothesis editor.
- `/build/roadmap` — `RoadmapPage.jsx`: 4-column kanban (Now/Next/Later/Done) with KR progress bars and "Move to next" affordance per card.
- `/build/metrics` — `MetricsPage.jsx`: stat cards (MRR / users / LTV-CAC / traction score), Recharts MRR + active-users charts, snapshot history table, "Import from Stripe" button (surfaces `stripe_not_connected` / `stripe_no_data` errors), traction signal breakdown card.

**`api.js` additions:** `listInterviews`, `createInterview`, `updateInterview`, `deleteInterview`, `listOkrs`, `createOkr`, `updateOkr`, `moveOkr`, `deleteOkr`, `listMetricsSnapshots`, `createMetricsSnapshot`, `deleteMetricsSnapshot`, `importMetricsFromStripe`, `getProgressSignals`.

## Task #36 — Service provider marketplace (this commit)

A discoverable directory of vetted service providers. The Partner role from Phase 0.1 identifies providers; this module adds public-facing profiles, KYB-tied verification, reviews, and inquiry threads.

**Out of scope (per task brief):** Stripe Connect invoicing (Task 5.2) and featured / paid placement (Task 5.4).

**Schema (additive on `partners` + new tables):**
- `partners` adds: `headline`, `bio`, `categories_json`, `sectors_json`, `pricing_tier` ($/$$/$$$), `hourly_rate_min/max`, `capacity_status` (available/limited/unavailable), `response_time_hours`, `kyb_status` (unverified/pending/verified/rejected), `kyb_verified_at`, `website`, `listed`. Idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migration in `models/migrations.py::ensure_marketplace_columns()` (registered in `main.py` startup chain).
- New tables: `partner_reviews(partner_id, reviewer_user_id, project_id?, rating 1..5, comment)`, `marketplace_inquiries(partner_id, requester_user_id, project_id?, subject, status open|closed)`, `marketplace_messages(inquiry_id, sender_user_id, body)`. All auto-created via SQLModel.

**Backend (`backend/app/api/routes/marketplace.py`, mounted at `/api`):**
- Providers: `GET /marketplace/providers` (filters: category, sector, capacity, pricing, verified_only, rate_max, q), `GET /marketplace/providers/{id}` (returns recent_reviews), `GET/PUT /marketplace/providers/me` (partner self-edit), `POST /marketplace/providers/{id}/kyb` (admin sets verification status).
- Reviews: `POST /marketplace/providers/{id}/reviews` (founder-only; one per reviewer, second submission updates), `GET /marketplace/providers/{id}/reviews`.
- Inquiries: `POST /marketplace/inquiries?partner_id=X`, `GET /marketplace/inquiries` (scoped: requester sees own; partner sees inbox; admin sees all), `GET /marketplace/inquiries/{id}` (full thread), `POST /marketplace/inquiries/{id}/messages`, `POST /marketplace/inquiries/{id}/close`.
- Metadata: `GET /marketplace/categories` (canonical enums for UI filters).

**Authorization:**
- Listing requires `Partner.listed=True` (partners see own row regardless).
- Inquiries enforce `_can_view_inquiry`: requester, the partner row's owner, or admin only.
- Reviews are founder-only; project-scoped reviews verify `user.founder_id == project.founder_id`.
- KYB write is admin-only.

**Categories enum:** legal, accounting, design, recruiting, fractional_cfo, gtm, engineering, marketing.

**Frontend (`/marketplace`, top-nav under Network):**
- `MarketplacePage.jsx` — three tabs: **Browse** (filter bar + provider cards with verified badge, rating, response time, capacity chip, pricing tier; detail modal with full bio, sectors, reviews, "Send inquiry" CTA), **My inquiries** (Inbox-style two-pane thread view with chat bubbles, ⌘/Ctrl+Enter to send, close action), **My listing** (partner-only — toggle `listed`, edit headline/bio/categories/sectors/pricing/rate range/capacity/response SLA/website).
- Visible to admin/founder/partner/investor; partners cannot inquire to themselves; founders are the only role that can leave reviews.
