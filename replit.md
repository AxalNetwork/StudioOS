# Axal StudioOS
API-first Venture Studio OS — manages startup lifecycle from intake to portfolio.

> **Changelog lives in `CHANGELOG.md`** (symlinked into `frontend/public/` for the in-app Docs → Release notes page). Append there, newest-first. Do not date task entries in this file.

## Run & Operate
- **Dev**: `npm run dev` (frontend) + `python backend/main.py` (FastAPI, dev-only).
- **Build**: `npm run build` · **Deploy (prod)**: `npm run deploy` (Cloudflare Worker)
- **Typecheck**: `npm run typecheck` · **Drift check**: `npm run test:drift` (required pre-merge)
- **Required env**: `JWT_SECRET`, `SCORING_HMAC_SECRET` (≥32 bytes, hard-required in prod), `AXAL_ENCRYPTION_SECRET` (falls back to JWT_SECRET), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CLAIM_EMAIL` (push).

### Sync Cheatsheet (PUSH_REJECTED from Replit's Sync UI — run in Shell, not the agent)
| Situation | Command |
|---|---|
| Clean fast-forward | `bash scripts/git-sync.sh` |
| Diverged from `origin/main` | `bash scripts/git-sync.sh --auto` |
| Push only | `bash scripts/git-push.sh` |

`git-push.sh` auto-detects workflow-file commits and falls back to `GITHUB_TOKEN` (Replit's OAuth lacks the `workflow` scope until ops item (d) below is done). Full reconcile flow lives in `scripts/sync-reconcile.sh`.

## Stack
- **Frontend**: React 19 + Vite 7 + Tailwind 4 + react-router 7
- **Prod API**: Cloudflare Worker (Hono, TypeScript) on D1
- **Dev API**: FastAPI on SQLite — never deployed

## Where things live
- `frontend/` · `cloudflare-worker/src/index.ts` (route mounts) · `routes/*.ts` · `services/*.ts` · `integrations/providers/*.ts` · `sql/migrations/NNN_*.sql` · `backend/` (dev FastAPI) · `scripts/check-*.mjs` (CI guards).

## Architecture invariants
- Prod = Worker on D1; dev = FastAPI on SQLite. Never deploy FastAPI.
- API drift prevented by `npm run test:drift`.
- Per-bucket rate limiting + strict CSP headers.
- Theme/density via CSS-vars in `frontend/src/index.css` (`--app-bg/--app-surface/--app-text/--app-input-*`). Tailwind 4 `@custom-variant dark`. `SettingsContext` toggles both `data-theme` and `.dark` on `<html>`. New pages need `dark:` variants on hardcoded `bg-white`/`text-gray-*`.
- Frontend storage via `safeReadJSON`/`safeWriteJSON`; errors via `reportError`.

## User preferences
- Clear, concise communication.
- Iterative — confirm before major architectural changes or significant refactors.
- Security-first; explicit error handling over silent fallbacks.
- API keys UI is gated behind a server-driven feature flag.

## Doc visibility
Admin docs live behind `roles: ['admin']` on sections/subsections in `frontend/src/pages/docs/sections/*.js`. DocsLayout filters rail/body/TOC and the hash-deep-link guard by `useAuth().role`; `lib/docs/search.js::createDocsFuse(role)` filters search. Adding a new admin doc = add `roles: ['admin']`; no other wiring. Never link to `#admin/*` from non-admin surfaces.

## Persistent gotchas

### Migrations & schema
- Apply via `wrangler d1 execute studioos-db --remote --env production --file=cloudflare-worker/sql/migrations/<file>.sql`. Wrangler needs Node 22+; use `export PATH=/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin:$PATH` first.
- New migrations: additive-only, `IF NOT EXISTS`. If an ALTER is needed, add a lazy PRAGMA-check in the consuming route (`ensureAdvisorWeekColumn()` / `ensureMarketIntelSchema()` are the reference patterns).
- **`users` table has hit D1's ALTER-rewrite column limit** — `ALTER TABLE users ADD COLUMN` now fails with `too many columns on sqlite_altertab_users`. New user-attached fields must use a side table keyed by `user_id PRIMARY KEY` (see `user_google_links` from migration 065 for the canonical pattern).
- **Pending / partial migrations**: `039_project_cascade.sql` partial (deleted_at + index applied; FK-cascade rebuilds blocked by D1's BEGIN/COMMIT rejection); `034_unmounted_routes.sql` unapplied (missing `owner_user_id`); `056_customer_chat_threads.sql` unapplied; `057_data_imports.sql` applied 2026-05-22 (fixes `/api/imports/quota` 500s); `060_auth_recovery.sql` **partial** (`auth_recovery_tickets` + `auth_trusted_contacts` tables + indexes applied 2026-05-22; the two `users` ALTERs for `recovery_cooling_off_until`/`recovery_step_up_due_at` blocked by the column-limit — move to a side table when needed; `user_sessions.assurance_level` ALTER still pending); `061_google_sub.sql` **superseded by 065** (don't re-apply); `062`/`063`/`064` unapplied.

### Backend / Worker
- **Admin role changes** — direct SQL only, no UI.
- **`activity_logs.actor`** — 16-hex SHA-256-truncated `email_hash` for all writes (`util/hashEmail.ts`); never plaintext. Join on `user_id`. Legacy reads in `routes/activity.ts` keep `LOWER(actor)=LOWER(email)`.
- **`SCORING_HMAC_SECRET`** — ≥32 bytes hard-required in production; worker refuses to boot otherwise. Dev falls back to `JWT_SECRET` with a warning.
- **`AXAL_ENCRYPTION_SECRET || JWT_SECRET`** keys all `cryptoBox` AES-GCM at-rest encryption. PBKDF2 iterations are **100,000** (Workers runtime caps PBKDF2 at 100k — values above throw `NotSupportedError: PBKDF2 failed: iterations exceeds the maximum`). `decryptString`/`decryptBytes` retain a 200k LEGACY fallback via `decryptWithFallback()` so ciphertext written by older isolates (whose key was cached before the limit tightened) stays readable. Never change `ITERATIONS` without keeping the legacy in the fallback list.
- **Pagination clamps** — always use `util/pagination.ts` (`/api/activity` ≤200, `/api/admin/users` ≤50, `/api/dashboard?days` ≤365).
- **CI audit gates** — `npm audit --omit=dev --audit-level=high` (frontend + worker) + `pip-audit` (backend) block high/critical CVEs in prod deps.
- **OAuth keys (Slack/HubSpot/Salesforce/DocuSign)** — env-var first, then admin-managed `provider_oauth_keys` rows; 60s in-isolate cache. `ensureCreds()` is async — never call sync. Admin revoke cascades `integrations.status='disconnected'` for that provider.
- **MI Personas export** — chart fields are `Maybe<X> = X | GatedChart`. CSV/PDF exporters in `routes/market_intel.ts` MUST narrow via `isGated()` before reading `.buckets`/`.cells`/`.rows`; the 402-tier guard is the first line of defence, this narrowing is the second.
- **Anthropic is dev/eval-only** — production runs on Workers AI. Only `routes/assistant.ts` may call Anthropic, double-gated by `STAGE !== 'production' && ENABLE_ANTHROPIC_DEV === '1'`. CI guard `scripts/ci/no-anthropic-in-prod.mjs` blocks new prod callers. After deploy: `wrangler secret delete ANTHROPIC_API_KEY --env production`.
- **Personal Advisor `/explain`** (Task #16/#31) — Workers AI only via `aiRouter` task class `advisor_explain` (`MID_LLAMA` → `SMALL_LLAMA` fallback). Output buffered so `stripVerbatimLeak` runs on full text. SSE wire: `provider` → `delta…` → `done`.
- **Advisor question banks** (Task #5 CH) — single source of truth in `cloudflare-worker/src/services/advisor/banks/*.ts`. Frontend `router.js::predictTarget` consumes the auto-generated `banks.manifest.json` (manifest wins on conflict; legacy frontend banks must stay a strict subset). Size + write-router coverage enforced by `scripts/check-advisor-bank-drift.mjs` and `scripts/check-write-router-coverage.mjs` (both wired into `npm run test:drift`). Never rename or delete bank ids — `writeRouter.ts` holds a hard-coded id→column map keyed by Task #2 originals. New ids use `founder.lab.*` / `founder.dd.*` / `investor.<topic>.*` / `partner.{sp,ma,st,cv}.*` / `partner.rate.*` / `partner.comp.*` namespaces.
- **Advisor AI Gateway** (Task #4 CG) — advisor traffic routes through gateway slug `CF_AI_GATEWAY_SLUG_ADVISOR` (default `advisor-ongoing`) via `aiRouter.ts::callWorkersAI()` for `advisor_turn` + `advisor_explain` only. Gateway must exist in CF dashboard (Workers AI → AI Gateway) — until then calls fall through un-gatewayed (no breakage, no separation). Per-user daily turn cap in KV `ai_spend:advisor:{user_id}:{yyyy-mm-dd}` (TTL 2d, default 100/day, configurable via `WORKERS_AI_ADVISOR_BUDGET_USD_DAY` — value is a turn count, not USD).

### Frontend
- **Toasts** — use `useToast` (auto-clears on unmount); raw `setTimeout(setToast,…)` leaks state.
- **Modals** — must call `useEscapeClose(onClose)` near the top.
- **Auth context** — `frontend/src/hooks/useAuthSync.jsx` exposes `<AuthProvider>` + `useAuth()` with `{user, role, loading, refresh, setUser}`. `/api/auth/me` refetched per route, throttled 5min, reset on cross-tab `storage` events. Legacy `safeReadJSON('user')` callers still work because `setUser` mirrors to localStorage.
- **Cmd+K palette / Help widget / Customer chat** — `CommandPalette.jsx` mounted globally in `ProtectedLayout`, indexes pages + recent activity + doc anchors + quick actions via Fuse.js (5-min activity refresh). `HelpWidget.jsx` is the bottom-right LifeBuoy (always visible, `?` hotkey). Customer chat is tier-gated (`isChatEligible()` mirrors worker `isEligible()` in `routes/customer_chat.ts`); admin/mentor/partner bypass, investor `institutional` only, founder `studio` only. Worker posts to `AXAL_TEAM_SLACK_WEBHOOK_URL` and reconciles `pending:%` placeholder `thread_ts` on first inbound reply via `/slack-reply` Events API. Required envs: `AXAL_TEAM_SLACK_WEBHOOK_URL`, `SLACK_SIGNING_SECRET`.
- **Integrations Connect modal** (Task #17) — `ConnectModal` always renders PAT input + button when `provider.supports_pat` (HubSpot + Calendly). Validation is backend-side; submit is NOT gated client-side. Parent `onConnect()` MUST re-throw non-402 errors so the modal-local red banner can render. HubSpot Marketplace OAuth is blocked by HubSpot's unpublished-app rule on non-test portals — PAT is the only working path. `providers/hubspot.ts::connect()` branches on `input.api_key` (Private App: `is_private_app: true`, no refresh, validated via `/oauth/v1/access-tokens/{token}`).
- **Calendar OAuth refresh tokens** — encrypted at rest in `google_oauth_tokens`/`microsoft_oauth_tokens`; read path lazily re-encrypts plaintext legacy rows. Required envs: `GOOGLE_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI`, `MICROSOFT_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI` (+ optional `MICROSOFT_TENANT_ID`).
- **Continue with Google sign-in** — `users` is too wide for ALTER TABLE, so the Google link lives in side table `user_google_links(user_id PK, google_sub UNIQUE)` (migration 065). All link reads/writes in `routes/auth_google.ts` + `routes/settings.ts` use `INSERT OR IGNORE` to defend against double-click races (would otherwise 500 on UNIQUE → `internal_error` toast). Worker secrets `GOOGLE_AUTH_CLIENT_ID`/`SECRET` are pushed via `wrangler secret put` (NOT Replit Secrets — those only flow to dev). Google OAuth client must list `https://app.axal.vc/api/auth/google/callback` in Authorized redirect URIs.
- **DD module** — admin/partner/investor/mentor read; founders never read. NDA upload enforced before any verdict ≠ `n_a`. Reports R2-encrypted (AES-GCM via `cryptoBox.encryptBytes`), download via short-lived HMAC token.

### Ops items still owned by user (not in code)
- **(a)** Disable R2 public access + add 90-day Standard-IA lifecycle rule.
- **(b)** Verify search/backfill cron in prod.
- **(c)** **JWT_SECRET rotation** — three prod values were committed to `.replit` 2026-05-11/12 and are burned. Pending: (1) generate fresh, add as Replit **Secret** (NOT `[env]` in `.replit`), (2) `wrangler secret put JWT_SECRET --env production`, (3) let long-lived JWTs expire (TTL 7d). Worth adding: pre-commit hook rejecting `JWT_SECRET = "..."` in `.replit`. Full incident detail in `CHANGELOG.md`.
- **(d)** **Grant Replit GitHub App `Workflows: Read & write`** at https://github.com/settings/installations → Configure on Replit → AxalNetwork/StudioOS. One-time click; until then workflow-touching commits must use `scripts/git-sync.sh`.
