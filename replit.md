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