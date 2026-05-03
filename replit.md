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