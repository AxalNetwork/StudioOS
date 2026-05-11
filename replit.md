# Axal StudioOS
An API-first Venture Studio Operating System designed to manage the entire startup project lifecycle from intake to portfolio monitoring.

> **Historical changelog moved to `docs/CHANGELOG.md`** (per-task entries since project start). This file holds only architecture, persistent gotchas, and active contracts. Do not append dated `Task #N` entries here — append to CHANGELOG instead.

## Run & Operate
- **Run (dev)**: `npm run dev` (frontend) and `python backend/main.py` (dev backend).
- **Build**: `npm run build`
- **Deploy (production)**: `npm run deploy` (deploys Cloudflare Worker)
- **Typecheck**: `npm run typecheck`
- **Drift check**: `npm run test:drift` (must pass before merge)
- **Required Env Vars**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIM_EMAIL` (web push), `SCORING_HMAC_SECRET` (≥32 bytes, hard-required in prod), `JWT_SECRET`, `AXAL_ENCRYPTION_SECRET` (falls back to JWT_SECRET).

## Stack
- **Frontend**: React 19, Vite 7, Tailwind CSS 4, react-router 7, lucide-react 1
- **Production API**: Cloudflare Worker (Hono on Workers, TypeScript)
- **Dev Backend**: FastAPI (Python) — local dev only, never deployed
- **DB**: Cloudflare D1 (prod), SQLite (dev FastAPI)
- **Build Tool**: Vite

## Where things live
- `frontend/`: React frontend.
- `cloudflare-worker/src/index.ts`: Worker entry; routes mounted here.
- `cloudflare-worker/src/routes/*.ts`: API routes.
- `cloudflare-worker/src/services/*.ts`: shared services (cryptoBox, notify, calendar, dueDiligence, analyticsReports, providerOauthKeys, …).
- `cloudflare-worker/src/integrations/providers/*.ts`: third-party OAuth/API providers.
- `cloudflare-worker/sql/migrations/NNN_*.sql`: numbered one-shot migrations applied via `wrangler d1 execute studioos-db --remote --file=…`.
- `backend/`: FastAPI dev backend.
- `scripts/check-api-drift.mjs`: API ↔ Worker drift CI script.
- `frontend/tailwind.config.js`: theme tokens.

## Architecture decisions
- Production API is a Cloudflare Worker; FastAPI is dev-only.
- Strict separation of prod (D1) vs dev (SQLite) DBs.
- Frontend storage via `safeReadJSON`/`safeWriteJSON`; errors via `reportError`.
- Theme/density via CSS-variables in `frontend/src/index.css` (`--app-bg`, `--app-surface`, `--app-text`, `--app-input-*`) under `:root` and `[data-theme="dark"]/.dark`. Tailwind 4 `@custom-variant dark (&:where(.dark, .dark *))`. `SettingsContext` flips both `data-theme` and `.dark` class on `<html>`. Add `dark:` variants on hardcoded `bg-white`/`text-gray-*` tokens in new pages. Density rules target `[data-card]` and `[data-density-target]`.
- API ↔ Worker drift prevented by `npm run test:drift`.
- Per-bucket rate limiting + strict CSP headers.

## Product
AI scoring; legal entity formation; cap-table simulator + fund mgmt + waterfall; portfolio health + watchlist; compliance calendar + 83(b); founder support (mentor matching, office hours, cofounder matching, wellbeing); partner engagement; financial model builder; PWA + push.

## User preferences
- Clear and concise communication.
- Iterative dev; ask for confirmation before major architectural changes or significant refactors.
- Prioritize security best practices and robust error handling.
- API keys UI is gated behind a server-driven feature flag.

## Persistent gotchas (always relevant)
### Backend / Worker
- **FastAPI is dev-only** — never attempt to deploy it.
- **API drift** — always run `npm run test:drift` before merge.
- **Admin role changes** — direct SQL only, no UI.
- **Migrations** — Apply via `wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/migrations/<file>.sql`. As of 2026-05-11 all migrations through `023_provider_oauth_keys.sql` plus `027_investor_paywall.sql` are applied to remote D1. Migrations `024–026`, `028–029`, and `030_market_intel.sql` (Task #14 AA-1) are written and idempotent but PENDING remote apply — the Replit env runs Node 20, wrangler requires Node 22+, so apply from a local shell. Caveat: `007_contracts_union.sql` was applied PARTIALLY (ALTER ran, backfill SELECT skipped — remote `documents` lacks `file_key`). Re-runs of older files may report duplicate-column errors; D1 rolls back the file but every CREATE is `IF NOT EXISTS` so re-runs are effectively idempotent. The market-intel route lazily runs `ensureMarketIntelSchema()` so a dev/stale D1 still serves requests.
- **`activity_logs.actor`** — stores 16-hex SHA-256-truncated `email_hash` (T22.1) for ALL writes; never plaintext. Use `user_id` for joins. Helper: `cloudflare-worker/src/util/hashEmail.ts`. Reads in `routes/activity.ts` keep `LOWER(actor)=LOWER(email)` for legacy backward compat.
- **`SCORING_HMAC_SECRET`** — hard-required in production (`ENVIRONMENT=production`); worker refuses to boot without ≥32 bytes. Dev/preview falls back to `JWT_SECRET` with a startup warning.
- **`AXAL_ENCRYPTION_SECRET || JWT_SECRET`** keys all `cryptoBox` AES-GCM at-rest encryption (wellbeing, OAuth refresh tokens, DD reports, column-cipher v1).
- **Pagination clamps** via `cloudflare-worker/src/util/pagination.ts` (`/api/activity` max 200, `/api/admin/users` max 50, `/api/dashboard?days=N` max 365). Always use the helper.
- **CI audit gates** — `npm audit --omit=dev --audit-level=high` (frontend + worker) + `pip-audit` (backend). High/critical CVEs in prod deps fail the build.
- **KYC** is optional until a flow requires it (incorporation, capital movement, payouts).
- **OAuth keys (Slack/HubSpot/Salesforce/DocuSign)** — env vars FIRST, then admin-managed DB rows (`provider_oauth_keys` table); 60s in-isolate cache. Provider `ensureCreds()` is async; never use sync access. Removing keys via Admin UI cascades `UPDATE integrations SET status='disconnected', last_error='oauth_keys_revoked_by_admin'` for that provider.

### Frontend
- **Toasts** — must use `useToast` (auto-clears on unmount). Raw `setTimeout(setToast, …)` leaks state into unmounted components.
- **Modals** — must call `useEscapeClose(onClose)` near the top.
- **Auth context** — `frontend/src/hooks/useAuthSync.jsx` exposes `<AuthProvider>` + `useAuth()`. App-wide `{user, role, loading, refresh, setUser}`. `/api/auth/me` re-fetched per route change, throttled to 5min via `lastFetchRef` (resets on cross-tab `storage` events). `handleImpersonate`/`exitImpersonation` call `refresh({force:true})`. Pages still using `safeReadJSON('user')` for read-only role checks keep working because `setUser` mirrors to localStorage.
- **Calendar OAuth refresh tokens** are encrypted at rest in `google_oauth_tokens.refresh_token` / `microsoft_oauth_tokens.refresh_token`; the read path lazily re-encrypts any legacy plaintext row on next sync. Required env: `GOOGLE_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI`, `MICROSOFT_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI` (+ optional `MICROSOFT_TENANT_ID`).
- **DD module** — admin/partner/investor/mentor read; founders never read. NDA upload is enforced before any verdict ≠ `n_a`. Reports R2-encrypted (AES-GCM via cryptoBox.encryptBytes), download via short-lived HMAC token.

### Ops items still owned by user (not in code)
- (a) Disable R2 public access + add 90-day lifecycle rule to Standard-IA.
- (b) Verify search/backfill cron in prod.
