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