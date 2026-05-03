# Axal StudioOS

## Overview
Axal StudioOS is an API-first Venture Studio Operating System designed as a "30-Day Spin-Out Engine" for venture capital firms and startup incubators. Its core purpose is to manage the entire startup project lifecycle, including intake, AI-driven scoring, legal formation (spin-outs), fundraising, and continuous portfolio monitoring. The platform aims to streamline venture launches and management, providing tools for legal, financial, and operational oversight.

## User Preferences
The user prefers clear and concise communication. They value iterative development and expect the agent to ask for confirmation before implementing major architectural changes or significant code refactoring. The user also requests that the agent prioritizes security best practices and robust error handling in all implementations.

## System Architecture

### Core Technologies
- **Frontend**: React 19, Vite 6, Tailwind CSS 4.
- **Backend**: FastAPI (Python) with SQLModel/SQLAlchemy, using SQLite for local development and PostgreSQL for production.
- **Production API**: Cloudflare Worker.

### Key Features
- **AI Scoring Engine**: Evaluates startup potential.
- **Spin-out Wizard**: Guides legal entity formation.
- **Real-time Pipeline**: Supports WebSocket for live updates.
- **Legal & Compliance**: KYC and document management with sign-gate enforcement.
- **Network & Referrals**: Partner and referral system, including a service provider marketplace.
- **Service Catalogue & Engagement Lifecycle**: Manages productized offerings and engagement states, with Stripe Connect for invoicing (simulated mode available).
- **Public Partner Directory**: Auth-free directory with algorithmic ranking.
- **Fund Management**: Tools for fund and LP tracking.
- **Admin Controls**: Granular user access and session management with MFA.
- **Settings Management**: User profiles, notifications, and account settings.
- **Financial Model Builder**: For financial projections, runway, and breakeven.
- **Progress Tracking**: Modules for customer discovery, roadmap (OKRs with Kanban), and metrics snapshots.
- **Demand Insights**: Aggregates founder needs into heatmaps and trends.
- **Cap-Table Simulator**: Models SAFE notes, priced rounds, and exit waterfalls, providing share ledgers and founder dilution analysis with CSV export.
- **Mentor Matching + Office Hours**: Features a `mentor` user role, mentor profiles, booking system, and two-sided review process, with optional Cal.com integration.
- **Unified Calendar Layer**: Aggregates mentor sessions, IC meetings, and founder check-ins, offering Google Calendar sync and ICS export.
- **Co-founder Matching**: Facilitates connections based on mutual interest with auto-NDA generation and signing.
- **Mobile PWA**: Installable web app with manifest + service worker, offline cache for the app shell, Academy lessons, and the user's own project data, plus an install banner (Android/iOS) and a per-device "Enable push" toggle wired through the notification center via VAPID web push.
- **Watchlist + Decision Journal**: A capital-side due diligence instrument for tracking projects, recording investment decisions, and rolling up an "anti-portfolio" to identify missed opportunities.
- **Portfolio Health Score + Predictive Failure**: Provides daily health snapshots for portfolio companies, calculating a score and badge based on runway, growth, churn, and sentiment, with intervention alerts.
- **Trust Layer Hardening**: Includes KYB (Know Your Business) via Sumsub (or mock), investor accreditation verification, and per-role NDA acceptance with legal proof.
- **Founder Risk Profile**: Auto-pulls founder background data (or synthesizes it) to generate a risk score and breakdown for due diligence.
- **Reference Check Workflow**: Manages scheduling, consent, recording, transcription (Whisper), and summarization (Llama/GPT-4o-mini) of reference calls, integrated with the Deals pipeline.
- **Jurisdiction Wizard + Incorporation Flow**: `/incorporate` decision tree across Delaware C-Corp, Delaware LLC, UK Ltd, Singapore Pte Ltd, and Estonia OÜ (e-Residency) with per-jurisdiction explainers (cost, time-to-form, fundraising-friendliness, taxes). Delaware C-Corp routes to Stripe Atlas with the company name pre-filled; other jurisdictions generate the right founder document set from legal templates and surface in `/legal`. Backed by `GET /api/legal/jurisdictions` and `POST /api/legal/incorporate/wizard`.
- **Founder Wellbeing** (Task #40): `/wellbeing` exposes an optional weekly 5-question pulse (stress, sleep, support, decisions, energy on a 1-5 scale + free-text notes) plus a curated resource directory (hotlines, therapy, peer groups, coaching, reading). Privacy-first: every answer column is Fernet-encrypted at rest via `services.crypto_box` (`stress_enc/sleep_enc/...`). Per-row check-ins are visible ONLY to the authoring founder; admins see anonymized 30-day aggregates (mean per question + cohort size) and only above a minimum cohort of 3 unique founders so a single response can't be re-identified; investors are explicitly blocked from both rows AND aggregates. New `wellbeing_checkins` and `wellbeing_resources` tables (migration `ensure_wellbeing_tables` registered in `main.py`) with `UNIQUE(user_id, week_anchor)` so re-submitting in the same ISO week overwrites instead of duplicating. `GET /api/wellbeing/resources` lazily seeds a static-first directory (988, Samaritans, Reboot.io, BetterHelp, Open Path, etc.) on first read; admin-only `POST/DELETE /resources` for curation. Sidebar entries added for admin (after Trust Center) and founder (own "Wellbeing" section). Out of scope per the brief: tele-therapy bookings.
- **Compliance Calendar** (Task #32): `/compliance` lists every recurring obligation per project (annual report, franchise tax, registered agent renewal, board meetings) with a colored countdown pill, mark-complete + auto-rollforward (recurring events seed their next occurrence on completion), manual add, and per-project filter. Auto-populated from `/incorporate/wizard` via `seed_standard_events_for_jurisdiction()` — DE C-Corp/LLC, UK Ltd, SG Pte, EE OÜ each ship a tailored event catalogue. Idempotent unique index on `(project_id, event_type, due_date)` so re-running the wizard is a no-op. New `compliance_events` table + `ensure_compliance_events_table` migration registered in `main.py`. Endpoints (`GET/POST/PATCH/DELETE /api/compliance/events`) reuse the same IDOR-safe access pattern (admin/partner/investor read; admin/partner/owning-founder write; investors blocked from writes). New `services.compliance_reminders` daily loop wakes hourly, fires once per UTC date via the Phase 0.2 `notify()` publisher (in-app + email) at T-30 / 14 / 7 / 1 days; reminders dedup via `reminders_sent_json`. Out of scope: filing on behalf of the founder.
- **Co-Founder Agreement + 83(b) Tracker** (Task #31): `/incorporate/cofounder-agreement` 5-step wizard (founders/equity → vesting & cliff → IP assignment → decision rights & exit/buyout → review) generates a Co-Founder Agreement document via the legal template engine (`POST /api/legal/cofounder-agreement`, validates ≥2 founders and equity ≤100%). `/incorporate/83b` lists per-founder 83(b) trackers with a 30-day countdown, IRS-mailing checklist, and certified-mail receipt upload (`/api/legal/83b/trackers` GET/POST/PATCH + `/{id}/receipt` multipart upload). Tracker creation auto-generates the 83(b) election doc, computes `deadline = grant_date + 30 days`, fires a `notify()` ping (in-app + email), and is idempotent on `(project, user, grant_date)`. All write paths are gated by `_check_project_write_access` (admin/partner OR the project's own founder; investors blocked) — same IDOR-safe pattern as Task #30. E-sign flow remains out of scope.

### Architectural Decisions
- Cloudflare Worker is the primary production API, FastAPI for local development.
- Rate limiting is implemented per bucket.
- Strict data integrity measures and CSP headers are enforced.
- GitHub auto-tickets are tagged.
- Admin user access is controlled by `access_level`.
- KYC is optional for founders until critical legal documents require it.
- Admin role changes require direct SQL modifications.
- Robust session management with `jti` and `jwt_min_iat`.
- Data for insights is aggregated in-memory for SQL portability.
- Weekly digest loops are idempotent and asynchronous.

## External Dependencies
- **JWT**: For authentication.
- **Google OAuth**: For user authentication and calendar integration.
- **GitHub**: For auto-tickets.
- **PostgreSQL**: Production database.
- **Cloudflare R2**: For headshot storage.
- **Cloudflare D1**: Production database for Cloudflare Worker.
- **pyotp & qrcode**: For TOTP generation.
- **SMTP Service**: For email notifications.
- **openpyxl**: For Excel exports.
- **Stripe Connect**: For payment processing and invoicing (simulated or live).
- **Cal.com**: Optional integration for mentor scheduling.
- **Sumsub**: For KYB verification (or mock service).
- **Whisper (or equivalent)**: For audio transcription.
- **Llama (or equivalent OpenAI-compatible API)**: For text summarization.
- **PitchBook**: For founder background data integration.
- **pywebpush + VAPID**: For browser push notification delivery (FCM / Mozilla / Apple push services). VAPID keys read from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CLAIM_EMAIL` env vars; an ephemeral keypair is minted in dev when they are unset.