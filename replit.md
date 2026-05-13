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

## Doc visibility
- Admin docs are admin-only. Sections/subsections in `frontend/src/pages/docs/sections/*.js` may carry `roles: ['admin']` (currently the entire `admin` section + the `admin` subsection inside `portals.js`). DocsLayout filters the rail, the body, and the right "On this page" list by `useAuth().role`; `lib/docs/search.js::createDocsFuse(role)` filters the search corpus the same way; and the hash-deep-link guard in DocsLayout strips admin anchors for non-admins (true 404-by-omission — the section literally isn't rendered). Never link to `#admin/*` from public-facing docs, marketing pages, or non-admin onboarding flows. Adding a new admin doc = add `roles: ['admin']` on the new section/subsection; no other wiring required.

## Persistent gotchas (always relevant)
### Backend / Worker
- **FastAPI is dev-only** — never attempt to deploy it.
- **API drift** — always run `npm run test:drift` before merge.
- **Admin role changes** — direct SQL only, no UI.
- **Migrations** — Apply via `wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/migrations/<file>.sql`. Migration `041_advisor_week_gating.sql` (Task #2 AR) adds `users.spinout_lab_week INTEGER DEFAULT 1` — uses `ALTER TABLE` so the apply will fail on prod if the column already exists; the worker's `ensureAdvisorWeekColumn()` lazy PRAGMA-check creates the column on first /advisor request as a self-healing fallback. As of 2026-05-12 all migrations through `038_settings_granular.sql` are applied to remote D1, plus `046_invite_reminders.sql` (Task #4 invite tracking — 3 statements, applied cleanly), plus `047_invite_joined_notified.sql` (Task #10 invite-joined notification idempotency — 1 ALTER + 1 CREATE INDEX, NOT idempotent on re-run; lazy ALTER in `routes/email.ts` self-heals dev/preview, and `attachReferral` has an inline `no such column` rescue ALTER for the same reason), plus `039_project_cascade.sql` was applied PARTIALLY: only the `projects.deleted_at` column + `idx_projects_deleted_at` index landed (via `--command`, marker row `_migrations_applied.name='039_project_cascade_partial_deleted_at_only'`). The FK-cascade child-table rebuilds (deals/score_snapshots/documents/discovery_interviews/roadmap_okrs) in 039 are NOT applied because D1 raw SQL rejects `BEGIN`/`COMMIT` ("To execute a transaction, please use the state.storage.transaction() …"). Re-running 039 as a file will fail at the first `BEGIN`. To finish 039, either (a) split each child-rebuild block into its own `--command` invocation (D1 implicitly transacts each statement), or (b) port the child rebuilds to a one-off TS script using `state.storage.transaction()`. Migration `034_unmounted_routes.sql` also failed remotely on `no such column: owner_user_id at offset 81` — left unapplied; needs a schema audit before retrying. The Replit env's default Node is 20 and wrangler requires Node 22+, but a Node 22 binary is available in the nix store at `/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin` — `export PATH=…/bin:$PATH` before running wrangler from this env. Caveat: `007_contracts_union.sql` was applied PARTIALLY (ALTER ran, backfill SELECT skipped — remote `documents` lacks `file_key`). Re-runs of older files may report duplicate-column errors (D1 rolls back the file on first error, but every CREATE is `IF NOT EXISTS` so the schema-bootstrap helpers in code make this self-healing); `024_settings_expansion.sql`'s two trailing `ALTER TABLE users ADD COLUMN` statements are NOT idempotent — those columns (`display_name`, `headline`) are already on prod, so re-running 024 will report duplicate-column on the first ALTER (expected; the CREATEs above it short-circuit). The market-intel route lazily runs `ensureMarketIntelSchema()` so a dev/stale D1 still serves requests; on prod this is now redundant for column existence but kept as defense-in-depth.
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
- **Toasts** — must use `useToast` (auto-clears on unmount). Raw `setTimeout(setToast, …)` leaks state into unmounted components.
- **Modals** — must call `useEscapeClose(onClose)` near the top.
- **Auth context** — `frontend/src/hooks/useAuthSync.jsx` exposes `<AuthProvider>` + `useAuth()`. App-wide `{user, role, loading, refresh, setUser}`. `/api/auth/me` re-fetched per route change, throttled to 5min via `lastFetchRef` (resets on cross-tab `storage` events). `handleImpersonate`/`exitImpersonation` call `refresh({force:true})`. Pages still using `safeReadJSON('user')` for read-only role checks keep working because `setUser` mirrors to localStorage.
- **Calendar OAuth refresh tokens** are encrypted at rest in `google_oauth_tokens.refresh_token` / `microsoft_oauth_tokens.refresh_token`; the read path lazily re-encrypts any legacy plaintext row on next sync. Required env: `GOOGLE_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI`, `MICROSOFT_CLIENT_ID/SECRET/CALENDAR_REDIRECT_URI` (+ optional `MICROSOFT_TENANT_ID`).
- **DD module** — admin/partner/investor/mentor read; founders never read. NDA upload is enforced before any verdict ≠ `n_a`. Reports R2-encrypted (AES-GCM via cryptoBox.encryptBytes), download via short-lived HMAC token.
- **Personal Advisor `/explain`** (Task #16) — routed via `aiRouter` task class `advisor_explain` (Workers AI `MID_LLAMA` primary → `SMALL_LLAMA` sibling fallback → `claude-sonnet-4-6` last-resort `anthropicFallback`). Provider can be flipped at runtime with the `ADVISOR_EXPLAIN_PROVIDER` env (`workers-ai` | `auto` (default) | `anthropic`); `anthropic` requires `ANTHROPIC_API_KEY` else the override is silently ignored. Output is buffered (NOT per-token streamed) so `stripVerbatimLeak` can run on the full text before any byte reaches the client; the SSE wire format remains `event: provider` (new — `{model, provider, fallback_used, cached}`) → `event: delta {text}` (single beat) → `event: done {leaked}`. The legacy 503-when-no-Anthropic-key guard is gone — Workers AI is always reachable via the `AI` binding.
- **Personal Advisor question banks** (Task #5 CH) — single source of truth lives in `cloudflare-worker/src/services/advisor/banks/*.ts`. The frontend `lib/advisor/router.js::predictTarget` consumes the **auto-generated `cloudflare-worker/src/services/advisor/banks.manifest.json`** as the AUTHORITATIVE source for every id's `page_target`/`doc_anchor`/`mi_section`; the legacy frontend `lib/advisor/banks/*.js` files now only contribute UI labels (manifest wins on conflict) and MUST stay a strict subset of worker ids. Size contract enforced by `scripts/check-advisor-bank-drift.mjs` (wired into `npm run test:drift`): `newFounderSpinout ≥ 80`, `existingFounder ≥ 120`, `investor ≥ 60`, `mentor ≥ 30`, `operatingPartner` per-sub-type ≥ 50 (4 sub-types: `service_provider`/`mentor_advisor`/`strategic`/`corporate_venture` — keyed by id prefix `partner.{sp,ma,st,cv}.*`), every `MISection` ≥ 3 tagged questions, ≥ 30 followup branches across all banks, plus the auto-generated union type `cloudflare-worker/src/services/advisor/questionIds.gen.ts` (regen with `node cloudflare-worker/scripts/gen-question-ids.mjs` — drift script runs `--check` mode automatically). Original Task #2 question IDs are preserved verbatim because `cloudflare-worker/src/services/advisor/writeRouter.ts` lines 764-984 hold a hard-coded id→column map; **never rename or delete an existing id, only ADD new ones** (new ids use `founder.lab.*`, `founder.dd.*`, `investor.<topic>.*`, `partner.{sp,ma,st,cv}.*`, `partner.rate.*`, `partner.comp.*` namespaces). MI section tags (`mi_section`) and `partner_subtype` fields on Question feed the Market Intel extractor (Task CE). The `BANK_SIZE_TARGETS` constant in `questionBank.ts` is informational only — the drift script hard-codes the same numbers locally (kept in sync manually). **Write-router coverage** is enforced by `scripts/check-write-router-coverage.mjs` (also wired into `npm run test:drift`): every bank id must EITHER be handled in `writeRouter.ts` (colMap/map/partnerMap/special-case) OR be listed (by id or prefix pattern) in `cloudflare-worker/src/services/advisor/no_write_allowlist.json`. Adding a new bank id without one of those steps fails CI, preventing silent drops of answers into `advisor_answers`-only with no domain-table side effect.
- **Advisor AI Gateway** (Task #4 CG) — Cloudflare Workers AI does NOT support multiple `[ai]` blocks per worker, so the advisor reuses the single `AI` binding but is routed through a dedicated AI Gateway slug (`CF_AI_GATEWAY_SLUG_ADVISOR`, default `advisor-ongoing`) so spend / latency / cache / rate-limit analytics are tracked separately from the onboarding chatbot. `services/aiRouter.ts::callWorkersAI()` injects `{ gateway: { id: slug } }` only for `advisor_turn` and `advisor_explain` tasks — every other task class continues to use the un-gatewayed binding. **Operator action required:** create the gateway in the Cloudflare dashboard (Workers AI → AI Gateway → New gateway, slug `advisor-ongoing`, cache TTL 5m for explainers / 0 for turns, rate limit 60-rpm/user 200-rpm/account) before merging the next advisor PR — until it exists, calls fall through to un-gatewayed traffic with no breakage but no separation either. **Required Cloudflare permissions to create/manage the gateway:** the dashboard user (or API token, if scripted) needs `AI Gateway: Edit` on the StudioOS account. The deploying worker itself needs only the existing `Workers AI: Read` binding scope already configured for `[ai] binding="AI"` — gateway routing is selected at call time and does NOT require a separate token. No `wrangler secret put` is needed for either env var; both are public values declared in `wrangler.toml [vars]`. CB will use `services/advisor/aiClient.ts::runAdvisorTurn()` for `/api/advisor/turn` (single-tier 8b fallback only on HTTP 500/429 from the 70b-fp8-fast primary, NO Anthropic / GitHub Models per spec). Per-user daily turn cap lives in KV `ai_spend:advisor:{user_id}:{yyyy-mm-dd}` with 2-day TTL — soft-warn at 80%, hard-block at 100% (default 100/day, configurable via `WORKERS_AI_ADVISOR_BUDGET_USD_DAY` — the spec's "USD" suffix is a misnomer; the value is a turn count. Legacy alias `WORKERS_AI_ADVISOR_BUDGET_PER_DAY` is also honoured). The `aiClient` budget is independent of `aiRouter`'s $-spend buckets so a tight retry loop can't burn the dashboard even with tiny per-call cost.

### Ops items still owned by user (not in code)
- (a) Disable R2 public access + add 90-day lifecycle rule to Standard-IA.
- (b) Verify search/backfill cron in prod.
- (c) **JWT_SECRET rotation (2026-05-11 + 2026-05-12 ×2).** A
  production-grade `JWT_SECRET` was committed to `.replit` THREE times
  in 24h: first at commit
  `e5ba56538b542a3f0ae4784f7c6f776c879aa2f7` (Task #51, 2026-05-11),
  again at commit
  `d9da1be1a41c216028cc8edb17ae6f02e1b0248d` (Task #2 AU Admin
  Publication Exports, 2026-05-12), and a THIRD time at commit
  `11e262ebc153a3540e80fd5c39a56ae479fccbad` (MI analysis / Task #2
  AT-1/AT-2+AU bundle, 2026-05-12). All three lines were removed from
  `.replit` via `deleteEnvVars` and all three commits added to
  `.gitleaks.toml`'s historical-leak allowlist. **All three leaked
  values must be considered burned.** Required follow-up: (1) re-add a freshly
  generated `JWT_SECRET` as a Replit Secret (Secrets pane, NOT `[env]`
  in `.replit` — committing it there is what causes the recurring
  gitleaks failure); (2) push the same fresh value to the production
  worker via `wrangler secret put JWT_SECRET --env production`;
  (3) re-issue any long-lived JWTs that were signed with the burned
  secret (or rely on natural token TTL expiry — `7d` per current
  settings). Recurrence note: task agents writing to `.replit`
  re-introduce this leak; consider adding a pre-commit hook or task-agent
  guardrail that rejects `JWT_SECRET = "..."` lines in `.replit`.
