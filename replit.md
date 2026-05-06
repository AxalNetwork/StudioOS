# Axal StudioOS
An API-first Venture Studio Operating System designed to manage the entire startup project lifecycle from intake to portfolio monitoring.

## Run & Operate
- **Run (dev)**: `npm run dev` (frontend) and `python backend/main.py` (dev backend).
- **Build**: `npm run build`
- **Deploy (production)**: `npm run deploy` (deploys Cloudflare Worker)
- **Typecheck**: `npm run typecheck`
- **Codegen**: _Populate as you build_
- **DB Push**: _Populate as you build_
- **Required Env Vars**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIM_EMAIL` (for web push notifications).

## Stack
- **Frontend**: React 19, Vite 6, Tailwind CSS 4
- **Production API**: Cloudflare Worker (Hono on Workers, TypeScript)
- **Dev Backend**: FastAPI (Python)
- **ORM**: _Populate as you build_
- **Validation**: _Populate as you build_
- **Build Tool**: Vite

## Where things live
- `frontend/`: React frontend.
- `cloudflare-worker/`: Production API source code.
  - `cloudflare-worker/src/index.ts`: Main Worker entry point.
  - `cloudflare-worker/src/routes/*.ts`: API routes.
- `backend/`: FastAPI development backend (never deployed).
  - `backend/app.db`: SQLite database for dev backend.
- `scripts/check-api-drift.mjs`: Script to check API ↔ Worker drift.
- **DB Schema**: `cloudflare-worker/src/schema.sql` (for D1) and `backend/app.db` (SQLite for dev).
- **API Contracts**: Defined implicitly by Cloudflare Worker routes and FastAPI routes.
- **Theme Files**: `frontend/tailwind.config.js`

## Architecture decisions
- Production API is a Cloudflare Worker for performance and scalability, while FastAPI provides a faster local development loop.
- Strict separation of production (Cloudflare D1) and development (SQLite) databases.
- Frontend logging and storage handled via `safeReadJSON`/`safeWriteJSON` and `reportError` for robust error handling and data integrity.
- API ↔ Worker drift is prevented by a CI script, ensuring consistency between frontend and backend contracts.
- Rate limiting is implemented per bucket, and strict CSP headers are enforced for security.

## Product
- AI-driven startup scoring engine.
- Legal entity formation (Spin-out Wizard, Incorporation Flow, Co-Founder Agreement).
- Fundraising tools (Cap-Table Simulator, Fund Management, Reserve Allocation, Exit Waterfall Simulator).
- Portfolio monitoring (Portfolio Health Score, Predictive Failure, Watchlist + Decision Journal).
- Compliance management (Compliance Calendar, 83(b) Tracker).
- Founder support (Wellbeing check-ins, Mentor Matching, Office Hours, Co-founder Matching).
- Partner engagement (Partner Office Hours, Co-Marketing, Public Partner Directory).
- Financial modeling (Financial Model Builder).
- Mobile PWA with offline capabilities and push notifications.

## User preferences
The user prefers clear and concise communication. They value iterative development and expect the agent to ask for confirmation before implementing major architectural changes or significant code refactoring. The user also requests that the agent prioritizes security best practices and robust error handling in all implementations.

## Gotchas
- The FastAPI backend is *only* for local development and is never deployed. Do not attempt to deploy it to Cloudflare.
- API ↔ Worker drift is a common issue; always run `npm run test:drift` or ensure CI passes before merging.
- Admin role changes require direct SQL modifications, as there is no UI for this.
- KYC is optional until critical legal documents require it, but ensure the system handles its eventual enforcement.
- After a deploy, apply pending one-time migrations: `wrangler d1 execute studioos-db --file=cloudflare-worker/sql/<file>.sql --remote`. Pending: `backfill_activity_user_ids.sql`, `perf_indexes.sql`, `financials_wellbeing.sql` (T11), `compliance_captable_cofounder.sql` (T12), `t13_t14_t15.sql` (T13/14/15 — mentors+slots+bookings+reviews, partner office hour slots/bookings, watchlist_items, decision_journal_entries, portfolio_health_snapshots, reference_checks, comarketing_pitches+attributions, company_profiles+user_company_links, founder_needs+rfps+quotes+engagements+reviews+service_offerings, insight_subscriptions+digests; ALTER users ADD mentor_id — re-running ALTER will error "duplicate column", ignore), `t3_fund_simulator.sql` (T3 — fund_reserve_allocations + fund_scenarios for the reserves/waterfall simulator).
- T12 cofounder NDA reuses the existing `documents` table (status enum: draft|generated|sent|signed). Worker schema lacks `signed_ip` — the connection row stores it instead (`nda_signed_ip_a/b`).
- T12 captable engine is a faithful TS port of `backend/app/services/captable.py`; CSV export served as `text/csv` with `Content-Disposition: attachment; filename="captable-<name>.csv"`.
- T12 incorporation auto-seed of compliance events (FastAPI `seed_standard_events_for_jurisdiction`) is NOT yet wired into the worker's `legal.ts`. Manual creation via `POST /api/compliance/events` works; auto-seeder is a follow-up.
- T11 wellbeing data uses AES-GCM (WebCrypto) keyed off `AXAL_ENCRYPTION_SECRET || JWT_SECRET` — ciphertext is NOT interchangeable with the FastAPI Fernet rows, by design (D1 and SQLite are separate stores). Helper: `cloudflare-worker/src/services/cryptoBox.ts`.
- T11 `/api/financials/:id/export.xlsx` returns `text/csv` (worker has no XLSX lib); the frontend download helper auto-renames via `Content-Disposition` filename, so no client change needed.
- `activity_logs.actor` now stores a 16-hex `email_hash` (SHA-256 truncated) for register / referral / verify / login events AND for every admin write in `routes/admin.ts` (view-profile, access-level, notes, resend-verification, impersonate, role change, toggle-active) — never the plaintext email. Use `user_id` for joins instead. The shared helper lives at `cloudflare-worker/src/util/hashEmail.ts`. Activity reads in `routes/activity.ts` still LOWER(actor)=LOWER(email)-match for backward compat with legacy pre-Epic-11 rows. **Follow-up**: convert remaining plaintext-actor writes in `kyc.ts`, `network.ts`, `admin_contracts.ts`, `profiling.ts` (T22.1-extension).
- T4 (Epic 11) ops items NOT in code, owner=user: (a) disable R2 public access + add 90-day lifecycle rule to Standard-IA, (b) verify search/backfill cron in prod, (c) apply pending D1 migrations via `wrangler d1 execute studioos-db --remote --file=…` (see Pending list below — `lp_investors_seal.sql` installs RAISE triggers so D1 itself rejects writes to the deprecated table).
- CI now runs `npm audit --omit=dev --audit-level=high` for both frontend and worker, plus `pip-audit` for the dev backend. High/critical CVEs in prod deps fail the build; dev-dep advisories don't.
- Paginated reads (`/api/activity`, `/api/admin/users`, `/api/marketplace/syndication`, `/api/dashboard?days=N`) are clamped via `cloudflare-worker/src/util/pagination.ts` (limit defaults vary; max 200 / 50 / 365 days).
- Frontend toasts must use `useToast` (auto-clears on unmount) — raw `setTimeout(setToast, …)` leaks state updates into unmounted components.
- Modals must call `useEscapeClose(onClose)` for keyboard dismissal; bind once near the top of the component.
- T9 — `SCORING_HMAC_SECRET` is hard-required in production (`ENVIRONMENT=production`); the worker refuses to boot without it (≥32 bytes). Dev/preview fall back to `JWT_SECRET` with a one-shot startup warning. Provision before next prod deploy: `openssl rand -hex 32 | npx wrangler secret put SCORING_HMAC_SECRET --env=production`.
- T5 — TOTP recovery codes are stored as SHA-256 hex hashes in the existing `users.totp_recovery_codes` JSON column (added in `epic3_settings.sql`); we deliberately did NOT add a separate `totp_backup_codes` table because the column-based design already shipped (Settings UI + regenerate endpoint) and a single-row UPDATE gives atomic single-use semantics. Generation paths: `/api/auth/setup-totp` mints 10 codes at enrol (returned once in `recovery_codes`); `/api/settings/totp/recovery-codes/regenerate` mints 10 in Settings. Consumption: `/api/auth/login` falls back to `tryConsumeRecoveryCode` when the 6-digit TOTP is invalid (logs `user_login_recovery_code` in activity_logs). `/api/auth/verify-totp` does NOT consume codes (it's a setup-time confirmation only). `/api/auth/verify-email` is now IP-rate-limited 10/15min via `verify-email-ip:` KV key. `/login`, `/verify-totp`, `/resend-verification` per-email caps were already in place.

## Pointers
- **Cloudflare Workers Docs**: [https://developers.cloudflare.com/workers/](https://developers.cloudflare.com/workers/)
- **Hono Docs**: [https://hono.dev/](https://hono.dev/)
- **React Docs**: [https://react.dev/](https://react.dev/)
- **Tailwind CSS Docs**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Vite Docs**: [https://vitejs.dev/](https://vitejs.dev/)
- **FastAPI Docs**: [https://fastapi.tiangolo.com/](https://fastapi.tiangolo.com/)
- **Cloudflare D1 Docs**: [https://developers.cloudflare.com/d1/](https://developers.cloudflare.com/d1/)
- **`CLAUDE.md`**: For full architecture rules and detailed context (if available).