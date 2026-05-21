# Axal StudioOS
An API-first Venture Studio Operating System designed to manage the entire startup project lifecycle from intake to portfolio monitoring.

> **Historical changelog lives in `CHANGELOG.md` at repo root** (single source of truth — `frontend/public/CHANGELOG.md` is a symlink to it so `vite build` copies it into `docs/CHANGELOG.md` for GitHub Pages, and the in-app Documentation page renders it under `Docs → Changelog → Release notes` via a new `markdownUrl` field on doc subsections). Do not append dated `Task #N` entries to this file — append to CHANGELOG instead, newest-first.

## Run & Operate
- **Run (dev)**: `npm run dev` (frontend) and `python backend/main.py` (dev backend).
- **Build**: `npm run build`
- **Deploy (production)**: `npm run deploy` (deploys Cloudflare Worker)
- **Typecheck**: `npm run typecheck`
- **Drift check**: `npm run test:drift` (must pass before merge)
- **Required Env Vars**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIM_EMAIL` (web push), `SCORING_HMAC_SECRET` (≥32 bytes, hard-required in prod), `JWT_SECRET`, `AXAL_ENCRYPTION_SECRET` (falls back to JWT_SECRET).

### Sync Cheatsheet
When Replit's Sync UI shows PUSH_REJECTED, run **one** of these from the Replit Shell tab (not the agent — `git push` is sandbox-blocked):

| Situation | Command |
|---|---|
| Normal push, clean tree, fast-forward | `bash scripts/git-sync.sh` |
| Diverged from `origin/main` (task-merge replay or Dependabot landed upstream) | `bash scripts/git-sync.sh --auto` (delegates to `sync-reconcile.sh`) |
| Just want the push half | `bash scripts/git-push.sh` |

`git-push.sh` auto-detects whether any pending commit touches `.github/workflows/*`. If yes, it pushes via `GITHUB_TOKEN` (which carries the `workflow` scope Replit's OAuth lacks); if no, it uses the default `origin` remote so Replit's Sync UI stays warm. See "Recovering from a Sync divergence" gotcha below for the full reconcile flow.

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

## Doc visibility
- Admin docs are admin-only. Sections/subsections in `frontend/src/pages/docs/sections/*.js` may carry `roles: ['admin']` (currently the entire `admin` section + the `admin` subsection inside `portals.js`). DocsLayout filters the rail, the body, and the right "On this page" list by `useAuth().role`; `lib/docs/search.js::createDocsFuse(role)` filters the search corpus the same way; and the hash-deep-link guard in DocsLayout strips admin anchors for non-admins (true 404-by-omission — the section literally isn't rendered). Never link to `#admin/*` from public-facing docs, marketing pages, or non-admin onboarding flows. Adding a new admin doc = add `roles: ['admin']` on the new section/subsection; no other wiring required.

## Persistent gotchas (always relevant)
### Backend / Worker
- **FastAPI is dev-only** — never attempt to deploy it.
- **API drift** — always run `npm run test:drift` before merge.
- **Admin role changes** — direct SQL only, no UI.
- **Migrations** — Apply via `wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/migrations/<file>.sql` (the Replit env's default Node is 20 and wrangler requires Node 22+; the Node 22 nix binary is at `/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin` — `export PATH=…/bin:$PATH` before running wrangler). Older files use `CREATE … IF NOT EXISTS` so re-runs that hit duplicate-column errors are usually safe; D1 rolls back the file on the first error and the worker's schema-bootstrap helpers (`ensureAdvisorWeekColumn()`, `ensureMarketIntelSchema()`, `attachReferral()`'s inline rescue ALTER) make individual columns self-healing on first request. **Pending / partial / unapplied migrations** (state as of 2026-05-12 — see `CHANGELOG.md → 2026-05-21 — Trimmed replit.md` for the full per-file history): `039_project_cascade.sql` applied partially (deleted_at column + index only; FK-cascade child rebuilds blocked by D1's BEGIN/COMMIT rejection); `034_unmounted_routes.sql` failed on `no such column: owner_user_id`, unapplied; `056_customer_chat_threads.sql` not yet applied. Adding a new migration: keep it additive-only with `IF NOT EXISTS`, and if it ALTERs an existing table also add a lazy PRAGMA-check in the route that needs the column.
- **MI Platform Personas CSV export** (Task #4) — chart fields on the
  payload are `Maybe<X> = X | GatedChart`. The CSV exporter at
  `routes/market_intel.ts:1238-1277` MUST narrow with the `isGated()`
  type-guard before reaching into chart-specific fields
  (`.buckets`/`.cells`/`.rows`); the PDF renderer at lines 1294-1301
  uses the same pattern. Tier-gated charts contribute zero rows to the
  export. Skipping the guard reintroduces 8 tsc errors and lets free-
  tier callers leak gated chart shapes through the export endpoint
  (the 402-tier guard at line 1206 already blocks free callers, but
  the type narrowing is the second line of defence).
- **`activity_logs.actor`** — stores 16-hex SHA-256-truncated `email_hash` (T22.1) for ALL writes; never plaintext. Use `user_id` for joins. Helper: `cloudflare-worker/src/util/hashEmail.ts`. Reads in `routes/activity.ts` keep `LOWER(actor)=LOWER(email)` for legacy backward compat.
- **`SCORING_HMAC_SECRET`** — hard-required in production (`ENVIRONMENT=production`); worker refuses to boot without ≥32 bytes. Dev/preview falls back to `JWT_SECRET` with a startup warning.
- **`AXAL_ENCRYPTION_SECRET || JWT_SECRET`** keys all `cryptoBox` AES-GCM at-rest encryption (wellbeing, OAuth refresh tokens, DD reports, column-cipher v1).
- **Pagination clamps** via `cloudflare-worker/src/util/pagination.ts` (`/api/activity` max 200, `/api/admin/users` max 50, `/api/dashboard?days=N` max 365). Always use the helper.
- **CI audit gates** — `npm audit --omit=dev --audit-level=high` (frontend + worker) + `pip-audit` (backend). High/critical CVEs in prod deps fail the build.
- **KYC** is optional until a flow requires it (incorporation, capital movement, payouts).
- **OAuth keys (Slack/HubSpot/Salesforce/DocuSign)** — env vars FIRST, then admin-managed DB rows (`provider_oauth_keys` table); 60s in-isolate cache. Provider `ensureCreds()` is async; never use sync access. Removing keys via Admin UI cascades `UPDATE integrations SET status='disconnected', last_error='oauth_keys_revoked_by_admin'` for that provider.

### Frontend
- **Cmd+K palette / Help widget / Customer chat** (Task #7 IG) — `CommandPalette.jsx` is mounted globally in `ProtectedLayout` and indexes 4 sources via Fuse.js (pages from `SIDEBAR_GROUPS` filtered by `hasTier`/`hasInvestorTier`, recent activity from `/api/activity/recent?limit=20`, doc anchors from `pages/docs/sections/*.js`, quick actions). Hotkey is `Cmd+K`/`Ctrl+K`; 5-min activity refresh. `HelpWidget.jsx` is the floating bottom-right LifeBuoy button (always visible to signed-in users, `?` hotkey, listens for `open-help-widget` custom event from palette). Tier-gated customer chat: `isChatEligible()` matches worker `isEligible()` in `routes/customer_chat.ts` — admin/mentor/partner bypass, investor `institutional` only, founder `studio` only (Growth gets Help-only despite paying, per spec). `CustomerChatWidget.jsx` slide panel polls `/api/customer-chat/thread` every 20s, optimistic send. Worker route `customer_chat.ts` posts to `AXAL_TEAM_SLACK_WEBHOOK_URL` (incoming-webhook, no ts returned) and stamps `slack_thread_ts='pending:<user>:<ts>'`; the `/slack-reply` Events API webhook reconciles the placeholder to the canonical Slack `thread_ts` on the FIRST inbound reply by finding the most-recent `pending:%` row on that channel within a 30-min window. **Required envs**: `AXAL_TEAM_SLACK_WEBHOOK_URL` (incoming webhook), `SLACK_SIGNING_SECRET` (Events API HMAC; absent ⇒ verification skipped — dev only, MUST be set in prod). Migration `056_customer_chat_threads.sql` (idempotent CREATE TABLE/INDEX IF NOT EXISTS, additive-only, NOT yet applied to remote D1 — apply via `wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/migrations/056_customer_chat_threads.sql`).
- **Toasts** — must use `useToast` (auto-clears on unmount). Raw `setTimeout(setToast, …)` leaks state into unmounted components.
- **Modals** — must call `useEscapeClose(onClose)` near the top.
- **Integrations Connect modal** (Task #17) — `IntegrationsPage.jsx::ConnectModal` renders the PAT input + Connect button whenever `provider.supports_pat` is true (currently HubSpot + Calendly), regardless of whether the user has typed a token yet. Validation lives on the backend — modal submit is NOT gated client-side, so empty-token submits will hit the worker and get back a canonical error (e.g. `hubspot_invalid_private_app_token`, `hubspot_requires_oauth_code_or_pat`). The parent's `onConnect()` MUST re-throw non-402 errors so `ConnectModal.submit` can `setErr(ex.message)` into the modal-local red banner — page-level `setError()` is hidden behind the modal overlay and the user never sees it. PAT field copy is provider-keyed (HubSpot points to "Settings → Integrations → Private Apps", Calendly to "Integrations → API & Webhooks"). HubSpot Marketplace OAuth is currently blocked by HubSpot's unpublished-app rule on non-test portals; PAT is the only working path until the public app is published. Backend contract: `providers/hubspot.ts::connect()` branches on `input.api_key` first (Private App: long-lived bearer, `is_private_app: true`, no refresh, validated via `/oauth/v1/access-tokens/{token}`); `getActiveAccessToken()` short-circuits the refresh+lease code path when `creds.is_private_app === true` OR when there is no `refresh_token`/`expires_at`.
- **Auth context** — `frontend/src/hooks/useAuthSync.jsx` exposes `<AuthProvider>` + `useAuth()`. App-wide `{user, role, loading, refresh, setUser}`. `/api/auth/me` re-fetched per route change, throttled to 5min via `lastFetchRef` (resets on cross-tab `storage` events). `handleImpersonate`/`exitImpersonation` call `refresh({force:true})`. Pages still using `safeReadJSON('user')` for read-only role checks keep working because `setUser` mirrors to localStorage.
- **Calendar OAuth refresh tokens** are encrypted at rest in `google_oauth_tokens.refresh_token` / `microsoft_oauth_tokens.refresh_token`; the read path lazily re-encrypts any legacy plaintext row on next sync. Required env: `GOOGLE_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI`, `MICROSOFT_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI` (+ optional `MICROSOFT_TENANT_ID`).
- **DD module** — admin/partner/investor/mentor read; founders never read. NDA upload is enforced before any verdict ≠ `n_a`. Reports R2-encrypted (AES-GCM via cryptoBox.encryptBytes), download via short-lived HMAC token.
- **Personal Advisor `/explain`** (Task #16, updated Task #31) — routed via `aiRouter` task class `advisor_explain`, **Workers AI only** (`MID_LLAMA` primary → `SMALL_LLAMA` fallback). Task #31 removed the Anthropic last-resort fallback and the unsafe-completion Anthropic retry; the `ADVISOR_EXPLAIN_PROVIDER` env is no longer read (kept in the `Env` type for backward compat only). Output stays buffered so `stripVerbatimLeak` runs on the full text before any byte ships; SSE wire format unchanged: `event: provider {model, provider:'workers-ai', fallback_used, cached}` → `event: delta {text}` → `event: done {leaked}`.
- **Anthropic is dev/eval-only** (Task #31) — production runs on Workers AI exclusively. The only remaining Anthropic caller is `routes/assistant.ts` (dashboard chatbot), double-gated: (1) mount middleware in `src/index.ts` returns 404 unless `STAGE !== 'production'` AND `ENABLE_ANTHROPIC_DEV === '1'`; (2) handler-level `anthropicDevAllowed()` re-checks the same invariant. CI guard `scripts/ci/no-anthropic-in-prod.mjs` (wired into `npm run test:drift` and the `drift` job in `ci.yml`) scans `cloudflare-worker/src/**/*.ts` for `api.anthropic.com` / `@anthropic-ai/sdk` / `env.ANTHROPIC_API_KEY` / `'claude-…'` string literals — only `routes/assistant.ts`, `types.ts`, and `index.ts` are allow-listed; the `// @anthropic-dev-only` marker comment is an escape hatch for genuinely dev-only files. Dev/preview enabling steps + operator cutover checklist live in `docs/dev/ANTHROPIC_DEV.md`. **Operator action**: `wrangler secret delete ANTHROPIC_API_KEY --env production` after deploy.
- **Personal Advisor question banks** (Task #5 CH) — single source of truth lives in `cloudflare-worker/src/services/advisor/banks/*.ts`. The frontend `lib/advisor/router.js::predictTarget` consumes the **auto-generated `cloudflare-worker/src/services/advisor/banks.manifest.json`** as the AUTHORITATIVE source for every id's `page_target`/`doc_anchor`/`mi_section`; the legacy frontend `lib/advisor/banks/*.js` files now only contribute UI labels (manifest wins on conflict) and MUST stay a strict subset of worker ids. Size contract enforced by `scripts/check-advisor-bank-drift.mjs` (wired into `npm run test:drift`): `newFounderSpinout ≥ 80`, `existingFounder ≥ 120`, `investor ≥ 60`, `mentor ≥ 30`, `operatingPartner` per-sub-type ≥ 50 (4 sub-types: `service_provider`/`mentor_advisor`/`strategic`/`corporate_venture` — keyed by id prefix `partner.{sp,ma,st,cv}.*`), every `MISection` ≥ 3 tagged questions, ≥ 30 followup branches across all banks, plus the auto-generated union type `cloudflare-worker/src/services/advisor/questionIds.gen.ts` (regen with `node cloudflare-worker/scripts/gen-question-ids.mjs` — drift script runs `--check` mode automatically). Original Task #2 question IDs are preserved verbatim because `cloudflare-worker/src/services/advisor/writeRouter.ts` lines 764-984 hold a hard-coded id→column map; **never rename or delete an existing id, only ADD new ones** (new ids use `founder.lab.*`, `founder.dd.*`, `investor.<topic>.*`, `partner.{sp,ma,st,cv}.*`, `partner.rate.*`, `partner.comp.*` namespaces). MI section tags (`mi_section`) and `partner_subtype` fields on Question feed the Market Intel extractor (Task CE). The `BANK_SIZE_TARGETS` constant in `questionBank.ts` is informational only — the drift script hard-codes the same numbers locally (kept in sync manually). **Write-router coverage** is enforced by `scripts/check-write-router-coverage.mjs` (also wired into `npm run test:drift`): every bank id must EITHER be handled in `writeRouter.ts` (colMap/map/partnerMap/special-case) OR be listed (by id or prefix pattern) in `cloudflare-worker/src/services/advisor/no_write_allowlist.json`. Adding a new bank id without one of those steps fails CI, preventing silent drops of answers into `advisor_answers`-only with no domain-table side effect.
- **Advisor AI Gateway** (Task #4 CG) — Cloudflare Workers AI does NOT support multiple `[ai]` blocks per worker, so the advisor reuses the single `AI` binding but is routed through a dedicated AI Gateway slug (`CF_AI_GATEWAY_SLUG_ADVISOR`, default `advisor-ongoing`) so spend / latency / cache / rate-limit analytics are tracked separately from the onboarding chatbot. `services/aiRouter.ts::callWorkersAI()` injects `{ gateway: { id: slug } }` only for `advisor_turn` and `advisor_explain` tasks — every other task class continues to use the un-gatewayed binding. **Operator action required:** create the gateway in the Cloudflare dashboard (Workers AI → AI Gateway → New gateway, slug `advisor-ongoing`, cache TTL 5m for explainers / 0 for turns, rate limit 60-rpm/user 200-rpm/account) before merging the next advisor PR — until it exists, calls fall through to un-gatewayed traffic with no breakage but no separation either. **Required Cloudflare permissions to create/manage the gateway:** the dashboard user (or API token, if scripted) needs `AI Gateway: Edit` on the StudioOS account. The deploying worker itself needs only the existing `Workers AI: Read` binding scope already configured for `[ai] binding="AI"` — gateway routing is selected at call time and does NOT require a separate token. No `wrangler secret put` is needed for either env var; both are public values declared in `wrangler.toml [vars]`. CB will use `services/advisor/aiClient.ts::runAdvisorTurn()` for `/api/advisor/turn` (single-tier 8b fallback only on HTTP 500/429 from the 70b-fp8-fast primary, NO Anthropic / GitHub Models per spec). Per-user daily turn cap lives in KV `ai_spend:advisor:{user_id}:{yyyy-mm-dd}` with 2-day TTL — soft-warn at 80%, hard-block at 100% (default 100/day, configurable via `WORKERS_AI_ADVISOR_BUDGET_USD_DAY` — the spec's "USD" suffix is a misnomer; the value is a turn count. Legacy alias `WORKERS_AI_ADVISOR_BUDGET_PER_DAY` is also honoured). The `aiClient` budget is independent of `aiRouter`'s $-spend buckets so a tight retry loop can't burn the dashboard even with tiny per-call cost.

### Recovering from a Sync divergence (PUSH_REJECTED)
When Replit's Sync UI shows a stack of local commits that won't push
because `origin/main` has commits the local repo doesn't, the cause is
almost always the task-merge pipeline replaying the same change as
multiple duplicate commits while Dependabot lands dependency bumps
upstream. **Do not force-push without lease.** Run
`bash scripts/sync-reconcile.sh` (or `--auto-squash` for non-interactive)
— it tags a recovery point (`pre-sync-reconcile-<timestamp>`), soft-resets
onto `origin/main`, takes upstream's version of lockfiles +
`.github/workflows/*` + `requirements.txt`, squashes everything else
into one commit, runs `npm run test:drift`, then pushes with
`--force-with-lease`. Recovery if anything goes wrong:
`git reset --hard pre-sync-reconcile-<timestamp>`. This must be run
**outside** the main agent sandbox (locally, in the Replit shell, or in
a fresh task-agent Repl) because main-agent bash blocks every git
operation that creates a `.git/*.lock` file — including `git tag`,
`git reset`, `git merge`, `git rebase`, and `git push`.

### Ops items still owned by user (not in code)
- (a) Disable R2 public access + add 90-day lifecycle rule to Standard-IA.
- (b) Verify search/backfill cron in prod.
- (d) **Grant Replit GitHub App the `workflow` scope** so the Sync UI works for commits that touch `.github/workflows/*` without needing `scripts/git-push.sh`'s `GITHUB_TOKEN` fallback. Steps: open https://github.com/settings/installations → click **Configure** on the Replit app → under **Repository permissions** for `AxalNetwork/StudioOS`, grant **Workflows: Read & write** → save. Until this is done, every workflow-touching commit must use `bash scripts/git-sync.sh` (the wrapper handles it transparently), and Replit's blue Sync button alone will keep rejecting those commits. This is a one-time click-through; the wrapper is the bridge.
- (c) **JWT_SECRET rotation** — three production `JWT_SECRET` values were committed to `.replit` on 2026-05-11 / 05-12 and must be considered burned. Pending: (1) generate a fresh value, add it as a Replit **Secret** (Secrets pane, NOT `[env]` in `.replit` — that's the recurrence cause), (2) push it to the worker via `wrangler secret put JWT_SECRET --env production`, (3) let long-lived JWTs expire naturally (TTL `7d`). Full incident detail (commit SHAs, gitleaks allowlist entries) lives in `CHANGELOG.md → 2026-05-21 — Trimmed replit.md`. Recurrence guard worth adding: a pre-commit hook (or task-agent guardrail) that rejects `JWT_SECRET = "..."` lines in `.replit`.
