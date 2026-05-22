# Changelog


## Canonical-host flip: code-side prep for `axal.vc` (Phase 2 part 1)

Code-side groundwork for making `axal.vc` the canonical product host.
**Production behaviour is unchanged after this commit** — the prod
`APP_URL` / `PUBLIC_BASE_URL` env vars in `wrangler.toml` still point at
`app.axal.vc`, so all OAuth flows keep working with their existing
provider-side `redirect_uri` registrations. The flip becomes live when
ops completes the cutover described below.

What this commit changes (code defaults + new infrastructure):

- **`cloudflare-worker/src/routes/auth_google.ts`** — `appUrl()` default
  flipped to `https://axal.vc`. Split out `oauthCallbackHost()` (defaults
  to `https://app.axal.vc`, overridable via the new
  `OAUTH_CALLBACK_BASE_URL` env) so the Google OAuth `redirect_uri` keeps
  pointing at the host registered in Google Cloud Console — only the
  post-callback redirect target moves to `axal.vc`. New
  `OAUTH_CALLBACK_BASE_URL` typed in `types.ts`.
- **17 Worker source files** (`routes/{auth,auth_recover,trust,settings,
  profiling,partner_onboarding,network,linkedin,esign,email,dd,
  admin_partners,admin_contracts,admin}.ts`,
  `services/{notifications,totpRemediation,email/send}.ts`) — every
  hardcoded `'https://app.axal.vc'` fallback flipped to `'https://axal.vc'`.
  These only fire when env vars are unset, so prod (env-pinned) is
  unchanged; new fresh deploys / dev / preview pick up the new default.
- **`cloudflare-worker/src/index.ts`** — new 301 middleware: in production,
  any `host=app.axal.vc` request whose path does NOT start with `/api/`
  is 301'd to the same path on `axal.vc`. `/api/*` is preserved because
  OAuth callbacks (Google/Microsoft/LinkedIn) are registered with the
  providers against `app.axal.vc/api/auth/*` and 301-ing a callback POST
  would lose the body. **Caveat**: per `[assets] run_worker_first =
  ["/api/*", "/landing/*"]`, the worker does NOT run before assets for
  SPA paths like `/dashboard` — so this 301 only fires for `/landing/*`
  and non-asset paths today. To converge all SPA bookmarks, either add
  the app's top-level routes to `run_worker_first`, or (preferred) set
  up a Cloudflare bulk-redirect rule on the `app.axal.vc` zone.
- **`cloudflare-worker/src/middleware/securityHeaders.ts`** — CSP
  `connect-src` reordered so `axal.vc` comes first (both still allowed).
- **`frontend/src/pages/LoginPage.jsx`** — post-login redirect changed
  from `https://axal.vc` (which landed on the Jekyll marketing root) to
  `/dashboard` (relative, host-preserving). Fixes the long-standing
  "I logged in but ended up on the marketing page" UX bug.
- **`frontend/src/pages/RecoverPage.jsx`** — doc comment updated.
- **`replit.md`** — Apex-routing gotcha updated to flag `axal.vc` as
  intended canonical and document the `appUrl()`/`oauthCallbackHost()`
  split.

What still needs ops work to make `axal.vc` actually canonical in prod:

1. **Update provider-side OAuth `redirect_uri` registrations** to
   `https://axal.vc/api/...` for each of: Google Calendar, Microsoft
   Calendar, LinkedIn, HubSpot, Salesforce, DocuSign, Carta, Slack,
   Stripe, Calendly. (Google Auth is already split via
   `OAUTH_CALLBACK_BASE_URL` and can keep `app.axal.vc`.)
2. **Flip `APP_URL` and `PUBLIC_BASE_URL` in `wrangler.toml`** (both
   `[vars]` and `[env.production.vars]`) to `https://axal.vc`, then
   `wrangler deploy`.
3. **Add a Cloudflare bulk-redirect rule** on the `app.axal.vc` zone:
   `app.axal.vc/*` → `axal.vc/$1` (301), excluding `/api/auth/google/callback`
   (and any other callback path still registered on app.axal.vc). This
   handles SPA bookmarks that the in-Worker 301 misses due to
   assets-first routing.
4. **(Optional)** Once monitoring confirms zero cross-host traffic,
   remove `app.axal.vc` from `PROD_ORIGINS` (`cloudflare-worker/src/index.ts`)
   and from the CSP `connect-src` allowlist.


## Apex `axal.vc/<app-route>` now serves the SPA (Phase 1)

Reverses the earlier "Worker never on apex" rule (see
`attached_assets/Pasted-Hard-constraint-axal-vc-apex-is-served-by-GitHub-Pages-_*.txt`).
The app now serves from both `app.axal.vc/<path>` and `axal.vc/<path>`,
while `axal.vc/` and Jekyll-owned paths stay on GitHub Pages.

- **`wrangler.toml`** — added 11 path-scoped `[[env.production.routes]]`
  on the `axal.vc` zone: `/api/*`, `/app`, `/app/*`, `/dashboard`,
  `/dashboard/*`, `/admin`, `/admin/*`, `/register`, `/register/*`,
  `/login`, `/login/*`. Conservative starter set — each path uses both
  an exact + `/*` variant so `/registered-foo` (hypothetical Jekyll
  page) is NOT hijacked. Apex DNS was already a proxied CNAME →
  `axalnetwork.github.io`, so the routes activated immediately on
  deploy. `/api/*` MUST be in this list because the SPA calls `/api`
  relative — without it, fetches on `axal.vc/dashboard` would hit
  Jekyll and 404.
- **`cloudflare-worker/src/auth.ts`** — `setAuthCookies` /
  `clearAuthCookies` now emit `Domain=.axal.vc` when
  `ENVIRONMENT=production` so a session set by
  `app.axal.vc/api/auth/*` is also valid on
  `axal.vc/<app-route>`. `clearAuthCookies` double-clears (with and
  without `Domain`) to clean up legacy host-only cookies on logout.
  Dev/preview deliberately omits `Domain` so localhost / *.workers.dev
  cookies still work.
- **CORS allow-list + CSP `connect-src`** — already included both
  `https://axal.vc` and `https://app.axal.vc` from an earlier
  migration pass, no change needed.
- **Token permission needed** — first deploy failed with `Workers
  Routes: Edit` missing on the `axal.vc` zone for
  `CLOUDFLARE_API_TOKEN`. User granted the permission; redeploy
  registered all 11 routes (version `71f5f68c-dd24-403c-8bb5-7996517f4ce3`).
- **Smoke verified post-deploy**: `axal.vc/` → Jekyll 200,
  `axal.vc/dashboard` → SPA HTML 200, `axal.vc/api/health` → Worker
  JSON 200, `app.axal.vc/*` unchanged.

**Still to do (Phase 2, deferred to a follow-up):**
- Flip `APP_URL` / `PUBLIC_BASE_URL` in `wrangler.toml` from
  `https://app.axal.vc` → `https://axal.vc` (affects referral URLs,
  email magic-links, verification links, OAuth state callbacks
  rendered into emails).
- Add 301 redirects in the Worker on
  `app.axal.vc/{dashboard,admin,register,login,app}*` →
  `axal.vc<path>` so legacy bookmarks / outbound links survive.
- Audit email templates for hardcoded `app.axal.vc` strings.
- OAuth callbacks (`app.axal.vc/api/auth/google/callback`, etc) stay
  on `app.axal.vc` — Google Cloud Console authorized redirect URI is
  registered there, do NOT change.


## Calendar connect `secret_missing` bucket pinpoints which env var is at fault

Task #69 surfaced a real cause (`encrypt`) instead of the bare
`token_exchange` toast, which revealed that `cryptoBox.encryptString` was
throwing inside `/api/calendar/google/callback`. Encryption failures lump
three distinct root causes into one bucket (missing secret, WebCrypto
PBKDF2 throw, WebCrypto AES-GCM throw) — unactionable. Hardened:

- **`services/cryptoBox.ts::getSecret()`** — trims both candidate secrets
  before falling back so a whitespace-only `wrangler secret put` paste no
  longer slips through and explodes downstream with an opaque WebCrypto
  error. When neither resolves to a usable value, throws
  `cryptoBox:secret_missing AXAL_ENCRYPTION_SECRET=<absent|empty|ok>
  JWT_SECRET=<absent|empty|ok>` so the very next log line names which
  secret to fix.
- **`routes/calendar.ts::bucketCallbackFailure()`** — new
  `secret_missing` bucket, matched BEFORE the generic `encrypt` regex so
  the actionable cause wins.
- **`frontend/src/pages/CalendarPage.jsx::humanizeOAuthReason()`** —
  translates `secret_missing` to "the server is missing an encryption
  secret — contact support".

Production secrets are not touched by this change; rotating
`JWT_SECRET` would invalidate every signed-in session (7-day TTL) and
adding a fresh `AXAL_ENCRYPTION_SECRET` standalone would silently make
existing rows encrypted with `JWT_SECRET` undecryptable (wellbeing
answers, DD report blobs). The hardening makes the next failure
self-describe so the safe remediation is one log line away.

**Safety detail:** `getSecret()` returns the *untrimmed* secret to
WebCrypto — trimming is only used to *detect* whitespace-only values and
skip past them in the fallback chain. Otherwise, derived PBKDF2 keys
would change for any deployed secret with accidental leading/trailing
whitespace and silently break decryption of every existing ciphertext
(wellbeing answers, DD report blobs, provider OAuth keys, calendar
refresh tokens, DocuSign tokens).

Deployed: worker version `0f57ef31-96d4-412c-9338-c4808319a8af`.

## Settings → Integrations: Google (Calendar + Gmail) and LinkedIn tiles (review fixes)

Code-review fixes on top of the Task #70 first pass:

- **`cloudflare-worker/src/services/calendar.ts`** — added
  `gmail.readonly` to `GOOGLE_SCOPES` so the single Google tile actually
  delivers the Gmail consent it advertises. Pre-Task-#70 connections
  will re-consent on their next OAuth round-trip (intended).
- **`cloudflare-worker/src/routes/calendar.ts`** — Google callback now
  validates verified-email + StudioOS-email match BEFORE writing any
  tokens when the round-trip was started from `/integrations`. Mismatch
  redirects with `google=error&reason=email_mismatch&google_email=…`
  (or `email_unverified`) and persists **zero** state — no calendar
  tokens, no `user_google_links` row. Legacy `/calendar` flow keeps its
  prior behaviour (mismatch surfaces as a warn flash, calendar tokens
  still saved).
- **`cloudflare-worker/src/routes/calendar.ts`** — `DELETE /google`
  now cascades `user_google_links` deletion so the Integrations Google
  tile flips fully to disconnected and "Continue with Google" sign-in
  is unlinked alongside Calendar + Gmail.
- **`frontend/src/lib/linkedinCsv.js`** (new) — extracted
  `parseLinkedInCsv` + `PENDING_LINKEDIN_IMPORT_KEY` from
  `ReferEarnPage.jsx` so it can be reused by the Integrations CSV
  import modal without duplication. ReferEarnPage now imports from it
  and gained a one-shot mount effect that picks up a stashed import
  (`localStorage[PENDING_LINKEDIN_IMPORT_KEY]`, 10-minute freshness
  window) and re-personalises rows with the current referral code /
  template before clearing the key.
- **`frontend/src/pages/IntegrationsPage.jsx`** — new
  `LinkedInCsvImportModal` rendered directly in Integrations: file
  picker → preview (count + first 5 rows) → "Import" button stashes
  the rows and navigates to `/refer` to send. The LinkedIn tile now
  opens this modal in-place instead of redirecting to `/refer`. Added
  per-tile inline error/warn slot (`inlineError` prop) so email
  mismatch and other connect failures render ON the tile that owns
  them; updated the Google disconnect confirm copy to reflect the new
  cascade behaviour. lucide-react in this repo doesn't ship a
  `Linkedin` glyph, so a small inline SVG component is used (mirrors
  the Twitter glyph pattern in `ReferEarnPage.jsx`).


## Settings → Integrations: Google (Calendar + Gmail) and LinkedIn tiles

Task #70 — adds two synthetic tiles to the Integrations page that wire to
existing first-party routes instead of duplicating the providers
contract. Calendar tokens remain the single source of truth.

- **`frontend/src/pages/IntegrationsPage.jsx`** — new "Identity &
  Calendar" section with Google and LinkedIn tiles via a new
  `ExternalProviderCard`. Probes `googleCalStatus()` + `linkedinStatus()`
  in parallel with the marketplace, disables the Connect button when
  `status.configured === false` (missing server secrets), and surfaces a
  one-shot return-flash banner driven by `?google=…`/`?linkedin=…` query
  params (cleaned from the URL after read).
- **`frontend/src/lib/api.js`** — `googleCalConnect`/`linkedinOAuthStart`
  now accept `{ return_to: 'integrations' }`.
- **`cloudflare-worker/src/routes/calendar.ts`** — Google `/start` writes
  a short-lived, path-scoped cookie when `?return_to=integrations`; the
  Google callback reads + deletes it and routes back to `/integrations`
  instead of `/calendar`. On a verified, matching Google email, the
  callback also `INSERT OR IGNORE`s into `user_google_links` so the
  same consent unlocks "Continue with Google" sign-in (side table per
  the documented D1 column-limit pattern). Mismatched emails skip the
  link and surface a `warn=google_email_mismatch` flash without failing
  the calendar/Gmail connect. Microsoft callback honours the same cookie
  but doesn't auto-link.
- **`cloudflare-worker/src/routes/linkedin.ts`** — `/oauth/start`
  accepts `return_to` via query or JSON body, sets a path-scoped cookie,
  and the callback redirects to `/integrations` instead of `/refer` when
  set.

## Google/Outlook Calendar connect surfaces real failure reason

The OAuth callback used to bucket every uncaught exception into a bare
`(token_exchange)` toast, hiding whether the real cause was the upstream
provider, the database, encryption, or a timeout. Fixed:

- **`routes/calendar.ts::bucketCallbackFailure()`** — new helper maps
  caught messages into stable, URL-safe reason codes:
  `token_exchange:<status>:<code>`, `oauth_unavailable`, `db_write`,
  `encrypt`, `timeout`, or `unknown:<slug>` (first ≤40 chars URL-safe).
  Both `/google/callback` and `/microsoft/callback` now use it.
- **`routes/calendar.ts::ensureCalendarOAuthSchema()`** — defensive
  lazy `CREATE TABLE IF NOT EXISTS` for `google_oauth_tokens` and
  `microsoft_oauth_tokens` (per-isolate `WeakSet` cache, mirrors
  `ensureAdvisorWeekColumn` / `ensureMarketIntelSchema`). The tables
  exist on prod D1 today, but the canonical schema lives in
  `sql/calendar.sql` (not a numbered migration) so a fresh D1 would
  otherwise hit "no such table" — now self-heals.
- **`frontend/src/pages/CalendarPage.jsx::humanizeOAuthReason()`** —
  translates the new reason codes into a short English sentence; falls
  back to `(rawCode)` so support can still triage unrecognised values.

## 2026-05-21 — Service Provider Directory admin approval/feature toggle

Admin console can now approve who appears on the public `/directory`
page and which partners get the "featured" promotion above standard
rows.

- **Migration `063_partner_directory_approval.sql`** — adds
  `directory_listed`, `directory_featured`, `directory_decided_at`,
  `directory_decided_by` columns to `partners` plus an index on
  (listed, featured). Pair with the lazy bootstrap helper
  `services/partnerDirectorySchema.ts::ensurePartnerDirectoryColumns()`
  (PRAGMA-checked, per-isolate cached, same pattern as
  `ensureAdvisorWeekColumn`) so fresh envs self-heal.
- **Public `/api/public/partners`** now filters
  `status='active' AND directory_listed=1` and surfaces
  `featured: !!directory_featured`. Featured rows sort first
  (`ORDER BY directory_featured DESC, referrals_count DESC, name ASC`)
  and their `ranking_score` is offset by 1e6 so featured always wins.
- **Admin worker routes** in `routes/admin_partners.ts`:
  `GET /api/admin/partners/directory` (search by name/company/email,
  returns flags + audit columns) and
  `POST /api/admin/partners/:id/directory` (body `{ listed?, featured? }`).
  Featuring auto-clears if `listed=false` (invariant: featured ⇒ listed).
  Decisions logged via `logAdminAction` → `activity_logs` +
  `admin_audit_log` as `partner_directory_toggled`.
- **Frontend**: new `Directory` tab in `AdminPage.jsx` rendering
  `DirectoryPanel` (rows with Approve/Remove + Feature/Unfeature
  buttons, search box, approved/featured counts). API helpers
  `adminListDirectoryPartners()` + `adminSetPartnerDirectory()` added
  to `frontend/src/lib/api.js`. `useCallback` added to AdminPage's
  React import.

**Apply migration** (post-merge ops step — additive ALTER TABLE,
NOT yet applied to remote D1):
```
wrangler d1 execute studioos-db --remote \
  --file=cloudflare-worker/sql/migrations/063_partner_directory_approval.sql
```
The worker is self-healing via the lazy PRAGMA helper, so missing the
migration only costs an extra ALTER round-trip on the first request to
either `/api/public/partners` or the new admin endpoints.

## 2026-05-21 — Task #52 (follow-up patch) — partner OH hooks + CAL-OAuth aliases + external-mirror migration

Addressing the architect's follow-up findings on Task #52:

- **Partner office hours** booking + cancel hooks now wired the same
  way (`routes/partner_office_hours.ts`): book lines 176-217, cancel
  branch in `transition()` lines 278-287. `PUSHABLE_KINDS` already
  contained `partner_office_hour`; `services/calendar.ts` already
  exports the matching event-row shape.
- **Calendar-specific OAuth client envs** —
  `GOOGLE_CAL_CLIENT_ID/SECRET` and `MICROSOFT_CAL_CLIENT_ID/SECRET`
  are now the preferred env names, with `GOOGLE_CLIENT_ID/SECRET` and
  `MICROSOFT_CLIENT_ID/SECRET` kept as fallbacks. New helpers
  `googleCalClientId/Secret` + `microsoftCalClientId/Secret` in
  `services/calendar.ts` ; every auth-URL builder, code-exchange and
  refresh path now reads through the helpers. `preflightOAuthSecrets`
  surfaces the new env names in the `missing` array.
- **Migration 062** — `062_calendar_external_sync.sql` adds the
  additive `calendar_external_sync` table (sync_token, delta_link,
  watch_channel_id / resource_id / expires_at) — scaffolding for
  follow-up Task #58 (Google sync_token + Microsoft Graph delta
  read-only mirror). Strictly idempotent — only `CREATE TABLE IF NOT
  EXISTS` + `CREATE INDEX IF NOT EXISTS`, no ALTERs (D1 doesn't
  support `ADD COLUMN IF NOT EXISTS`; the `external_provider` /
  `external_event_id` columns on `calendar_events` move to a lazy
  PRAGMA-table_info() helper in #58).
- **Google scopes** widened to include `calendar.readonly` and
  `userinfo.profile` so the future external→Axal mirror can list
  events via `sync_token` without a second consent screen, and the
  consent screen names the connecting user.
- **Preflight** now reports the canonical `GOOGLE_CAL_CLIENT_ID/SECRET`
  / `MICROSOFT_CAL_CLIENT_ID/SECRET` env names plus `PUBLIC_BASE_URL`
  in the `missing` payload (legacy `GOOGLE_CLIENT_*` /
  `MICROSOFT_CLIENT_*` vars still accepted as fallback at the resolver
  layer for back-compat).
- **Cancel-sync durability** — `onAxalSessionCancelled()` now only
  DELETEs the `calendar_sync_records` row AFTER the upstream provider
  DELETE confirmed success. Failed deletes leave the mapping in place
  (and stamp `last_error` if the column exists) so a retry can finish
  the job — preventing transient 5xx errors from permanently orphaning
  external events with no mapping back to Axal. Test stub updated to
  understand both the legacy 2-param and new 4-param DELETE shapes.
- **Frontend** — `CalendarPage.jsx` `KIND_LABEL`/`KIND_COLOR` now
  cover `partner_office_hour` (emerald) and the future
  `google_external` / `microsoft_external` mirrored rows (gray /
  dimmed) so the unified feed can render them out-of-the-box.

Investor 1:1s are already covered: the original Task #52 wired IC
meetings, which IS the investor meeting surface.

## 2026-05-21 — Task #52 — Calendar two-way sync for booked sessions

Sessions booked on-platform (mentor sessions, IC meetings, founder
check-ins) now appear on `/calendar` AND propagate to every connected
attendee's Google / Outlook calendar within seconds — and disappear
again on cancel. Booking endpoints stay snappy because the push runs
inside `c.executionCtx.waitUntil(...)` after the HTTP response returns.

**New service** — `cloudflare-worker/src/services/calendar/sync.ts`
exposes three hooks:
- `onAxalSessionCreated(env, ev)` — pushes the event to every
  connected attendee (organizer + invitees). Idempotent: re-runs
  PATCH the existing external event via the `(user_id, provider,
  source_kind, source_id) → external_event_id` map in
  `calendar_sync_records`.
- `onAxalSessionUpdated` — alias for `onAxalSessionCreated`.
- `onAxalSessionCancelled(env, kind, source_id)` — DELETEs upstream +
  clears the sync row.
- `pushOneEventForUser(env, userId, ev)` — powers the new "Add to
  my Google / Outlook" button for sessions that pre-date the user's
  OAuth connection.

**Wired booking hooks** (all best-effort, exceptions never break the
underlying booking):
- `POST /api/mentors/slots/:id/book` →
  `routes/mentors.ts` lines 314-341.
- Mentor booking cancel / no-show transitions →
  `routes/mentors.ts` lines 404-411.
- `POST /api/calendar/ic-meetings` →
  `routes/calendar.ts` lines 263-285.
- `DELETE /api/calendar/ic-meetings/:id` →
  `routes/calendar.ts` lines 338-343.
- `POST /api/calendar/founder-checkins` →
  `routes/calendar.ts` lines 406-424.
- `DELETE /api/calendar/founder-checkins/:id` →
  `routes/calendar.ts` lines 459-464.

**New endpoint** — `POST /api/calendar/push/:kind/:source_id` lets the
SPA push an already-booked Axal session to whichever providers the
caller has connected. Returns `{ ok: true, pushed: { google, microsoft } }`.

**Frontend** — `CalendarPage.jsx` renders an "Add to Google / Outlook
Calendar" button on each agenda row whenever at least one external
provider is connected. Re-clicking is safe (PATCH not insert). New
`api.pushOneToExternal(kind, sourceId)` helper in `frontend/src/lib/api.js`.

**Disconnect symmetry** — existing `DELETE /calendar/google` and
`DELETE /calendar/microsoft` already cascade `DELETE FROM
calendar_sync_records WHERE provider = ?`, so reconnect → fresh push
cycle leaves no orphan rows.

**Tests** — `cloudflare-worker/test/calendar.sync_hooks.test.ts`
covers (a) push to Google for connected user, (b) DELETE + sync-row
cleanup on cancel, (c) silent no-op when the user has no OAuth row.
Uses a hand-rolled stub `fetch` + in-memory tables.

**Calendar OAuth client separation** — already in place from Task #51:
sign-in uses `GOOGLE_AUTH_CLIENT_ID/SECRET`, calendar uses
`GOOGLE_CLIENT_ID/SECRET`. Redirect URI continues to resolve to
`https://app.axal.vc/api/calendar/google/callback` via
`PUBLIC_BASE_URL` (preferred) or `APP_URL`. Microsoft mirrors the
same pattern.

**Out of scope (deferred to follow-ups)** — Google `sync_token` +
push-notification watch channels for the external-mirror read-only
side; Outlook delta-token parity; partner office hours + investor
meetings hooks (no D1 tables today — partner OH already goes through
Calendly). Existing `/api/calendar/{google,microsoft}/sync` endpoints
remain the broad-window catch-up path for any push that failed the
per-event hook.



> This file is the single source of truth. `frontend/public/CHANGELOG.md`
> is a symlink to it, so `vite build` copies it into `docs/CHANGELOG.md`
> where it is served by GitHub Pages and rendered inside the in-app
> Documentation page (`Docs → Changelog → Release notes`). Append new
> entries at the top (newest-first) and reference the originating task
> or commit.

## 2026-05-21 — Task #51 — Optional "Continue with Google" sign-in / sign-up

Adds an OPTIONAL Google identity path alongside the existing magic-link
+ TOTP flows. Never the only way in: every account retains its
magic-link + TOTP fallback. Google counts as ONE factor only —
sensitive routes still demand TOTP/passkey/SMS via `requireFactor()`.

- **Migration #061** (`061_google_sub.sql`, additive-only, IF NOT EXISTS):
  `users.google_sub TEXT` + partial unique index
  `idx_users_google_sub WHERE google_sub IS NOT NULL`.
- **New route** `cloudflare-worker/src/routes/auth_google.ts` mounted at
  `/api/auth/google` (sibling of `/api/auth/recover`):
  - `GET /start` — HMAC-signed state (JWT_SECRET, 10-min window),
    accepts `?action=signin|link` + `?redirect=<absolute-path>`.
    503 when `GOOGLE_AUTH_CLIENT_ID/SECRET` unset.
  - `GET /callback` — exchanges code, decodes id_token (aud + iss
    defence-in-depth), applies precedence rules: (1) `google_sub`
    match → sign in; (2) case-insensitive email + `email_verified=true`
    → auto-link no-merge; (3) `email_verified=false` → REFUSE
    `link_blocked_unverified`; (4) no row → fresh signup with
    `email_verified=true`, role `partner`, seeded trust obligations.
    Session minted with `user_sessions.factor='google'`.
  - Auth-linking from Settings parallels with L1-L4 rules
    (already_linked / sub_owned_by_other / caller_email_unverified
    / cross-email accepted-with-audit-log).
- **Settings endpoints** (in `routes/settings.ts`):
  - `GET /settings/connected-accounts` — returns Google link state +
    `unlinkable` flag based on no-orphan guard.
  - `POST /settings/connected-accounts/google/unlink` — fail-closed
    409 `last_sign_in_path` when no other factor exists (TOTP / SMS /
    verified-email magic-link).
- **Frontend**:
  - `LoginPage.jsx` + `RegisterPage.jsx` step 1 — "Continue with
    Google" button hidden when `/start` returns 503. Error toasts
    map every `?google_error=*` code back to human copy.
  - `SettingsPage.jsx → Security tab` — new `ConnectedAccountsPanel`
    above the TOTP card. Link button kicks off `/start?action=link`;
    unlink shows "Cannot unlink — only sign-in path" badge when the
    server flags it.
  - `lib/api.js` — `googleStartUrl`, `getConnectedAccounts`,
    `unlinkGoogle` helpers.
- **Env**: new `GOOGLE_AUTH_CLIENT_ID` + `GOOGLE_AUTH_CLIENT_SECRET`
  (SEPARATE OAuth client from the existing `GOOGLE_CLIENT_ID/SECRET`
  used for Calendar/Mail — different scopes, different refresh-token
  policy). Both added to the `Env` type in `types.ts`.
- **Tests** (`test/auth_google.test.ts`, 14 cases, all pass via
  `--experimental-strip-types`): four spec-mandated scenarios
  (link-verified, link-unverified-blocked, fresh-signup,
  no-merge-double-account) via the pure exported helpers
  `decideSigninAction` + `decideLinkAction`, plus state-HMAC
  roundtrip / tamper-reject / expiry-reject / future-skew-reject /
  bogus-action-reject.
- **Operator action**: apply migration with
  `wrangler d1 execute studioos-db --remote --file=cloudflare-worker/sql/migrations/061_google_sub.sql`
  (Node 22 path documented in replit.md). Add the redirect URI
  `https://app.axal.vc/api/auth/google/callback` to the Google Cloud
  Console OAuth client BEFORE the next worker deploy.

## 2026-05-21 — /directory page reachable (public partner list endpoint)

- `cloudflare-worker/src/routes/public.ts` — added
  `GET /api/public/partners`, a no-auth list endpoint backing the
  `PublicDirectoryPage` (`axal.vc/directory`). The page was calling
  `/api/marketplace/public/partners`, which was never mounted in the
  worker; Hono's default 404 (`{"error":"Not found"}`) rendered as
  the red "Not found" banner under the search bar.
- The `partners` table only carries
  `{uid, name, company, specialization, referral_code, status,
  referrals_count}`, so richer fields the page expects (categories,
  kyb_verified, featured/featured_tier, reviews.avg_rating,
  response_time_hours, pricing_tier) are returned with safe
  null/false/empty defaults. `completed_engagements` and
  `ranking_score` both proxy off `referrals_count` for now;
  `PartnerCard` already null-checks every field it renders, so the
  cards degrade cleanly.
- Filter params: `q` is honoured via case-insensitive
  `LIKE … ESCAPE '\'` against `name`, `company`, `specialization`.
  `category` / `capacity` / `pricing` / `verified_only` / `rate_max`
  are accepted but ignored at the worker layer — no backing columns
  exist yet. Future work: populate richer columns on `partners` (or
  pivot to `marketplace_profiles`) and start respecting the filters.
- Frontend — `frontend/src/lib/api.js::publicListPartners` /
  `publicGetPartner` now point at `/public/partners` and
  `/public/p/:slug` respectively. `/public/` is already in the
  `isPublicEndpoint` allowlist on the 401 handler, so anonymous
  visitors never get bounced to /login.
- Worker deployed to production via the CF API `/content` endpoint
  at 2026-05-21T09:18:29Z. Verified live:
  `curl https://axal.vc/api/public/partners` returns real rows.

## 2026-05-21 — Trimmed `replit.md`; migration & JWT-rotation history moved here

Moved two oversized blocks out of `replit.md` (Persistent gotchas) into
this file so the README stays focused on live invariants. The original
content is preserved verbatim below.

### Migration history (state as of 2026-05-12)

- All migrations through `038_settings_granular.sql` are applied to
  remote D1.
- `041_advisor_week_gating.sql` (Task #2 AR) adds
  `users.spinout_lab_week INTEGER DEFAULT 1`. Uses `ALTER TABLE` so a
  re-apply on prod will fail if the column already exists; the
  worker's `ensureAdvisorWeekColumn()` lazy PRAGMA-check creates it
  on first `/advisor` request as a self-healing fallback.
- `046_invite_reminders.sql` (Task #4 invite tracking) — 3 statements,
  applied cleanly.
- `047_invite_joined_notified.sql` (Task #10 invite-joined notification
  idempotency) — 1 ALTER + 1 CREATE INDEX, NOT idempotent on re-run.
  Lazy ALTER in `routes/email.ts` self-heals dev/preview, and
  `attachReferral()` has an inline `no such column` rescue ALTER for
  the same reason.
- `039_project_cascade.sql` — applied PARTIALLY. Only
  `projects.deleted_at` column + `idx_projects_deleted_at` index
  landed (via `--command`, marker row
  `_migrations_applied.name='039_project_cascade_partial_deleted_at_only'`).
  The FK-cascade child-table rebuilds
  (deals / score_snapshots / documents / discovery_interviews /
  roadmap_okrs) are NOT applied because D1 raw SQL rejects
  `BEGIN`/`COMMIT` ("To execute a transaction, please use the
  `state.storage.transaction()` …"). Re-running 039 as a file will
  fail at the first `BEGIN`. To finish: either (a) split each
  child-rebuild block into its own `--command` invocation (D1
  implicitly transacts each statement), or (b) port the child
  rebuilds to a one-off TS script using `state.storage.transaction()`.
- `034_unmounted_routes.sql` — failed remotely on
  `no such column: owner_user_id at offset 81`; left unapplied,
  needs a schema audit before retrying.
- `056_customer_chat_threads.sql` (Task #7 IG) — idempotent
  CREATE TABLE/INDEX IF NOT EXISTS, additive-only, NOT yet applied
  to remote D1.
- **Re-run safety** — older files may report duplicate-column errors
  (D1 rolls back the file on first error, but every CREATE is
  `IF NOT EXISTS` so the schema-bootstrap helpers in code make this
  self-healing). `007_contracts_union.sql` applied PARTIALLY (ALTER
  ran, backfill SELECT skipped — remote `documents` lacks `file_key`).
  `024_settings_expansion.sql`'s two trailing
  `ALTER TABLE users ADD COLUMN` statements are NOT idempotent —
  `display_name` and `headline` are already on prod, so a re-apply
  will report duplicate-column on the first ALTER (expected; the
  CREATEs above it short-circuit). The market-intel route lazily
  runs `ensureMarketIntelSchema()` so a dev/stale D1 still serves
  requests; on prod this is now redundant for column existence but
  kept as defense-in-depth.
- **Node version** — the Replit env's default Node is 20 and wrangler
  requires Node 22+, but a Node 22 binary is available in the nix
  store at
  `/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin` —
  `export PATH=…/bin:$PATH` before running wrangler from this env.

### JWT_SECRET rotation incident (2026-05-11 + 2026-05-12 ×2)

A production-grade `JWT_SECRET` was committed to `.replit` THREE
times in 24 h:

1. Commit `e5ba56538b542a3f0ae4784f7c6f776c879aa2f7` (Task #51,
   2026-05-11).
2. Commit `d9da1be1a41c216028cc8edb17ae6f02e1b0248d` (Task #2 AU
   Admin Publication Exports, 2026-05-12).
3. Commit `11e262ebc153a3540e80fd5c39a56ae479fccbad` (MI analysis /
   Task #2 AT-1/AT-2+AU bundle, 2026-05-12).

All three lines were removed from `.replit` via `deleteEnvVars` and
all three commits added to `.gitleaks.toml`'s historical-leak
allowlist. **All three leaked values must be considered burned.**

Required follow-up (still pending; tracked in
`replit.md → Ops items still owned by user`):

1. Re-add a freshly generated `JWT_SECRET` as a Replit Secret
   (Secrets pane, **NOT** `[env]` in `.replit` — committing it there
   is what causes the recurring gitleaks failure).
2. Push the same fresh value to the production worker via
   `wrangler secret put JWT_SECRET --env production`.
3. Re-issue any long-lived JWTs that were signed with the burned
   secret (or rely on natural token TTL expiry — `7d` per current
   settings).

**Recurrence note**: task agents writing to `.replit` re-introduce
this leak; consider adding a pre-commit hook or task-agent guardrail
that rejects `JWT_SECRET = "..."` lines in `.replit`.

## 2026-05-21 — Verification email actually delivered (not just enqueued)

- `cloudflare-worker/src/routes/auth.ts::sendVerification()` now passes
  `immediate: true` to the unified email send pipeline. Previously
  `send()` returned `ok: true` the instant the job was placed on
  `JOB_QUEUE`, so the API replied `email_sent: true` and the UI
  showed "Email sent" even when Gmail later failed inside the queue
  consumer (expired refresh token, mailbox bounce, queue not
  draining) — and the user never knew their link wasn't on the way.
- Synchronous delivery costs ~500 ms-2 s but the user is already
  watching a loading spinner. In exchange, the response's `email_sent`
  flag is now truthful; on failure RegisterPage's `emailWarning`
  state kicks in and exposes the dev fallback `verification_url`.
- Same call site is reused by `/auth/register`, `/auth/profiling/save`
  (the deferred-email flush), and `/auth/resend-verification`, so all
  three interactive flows now surface real delivery results.
- Deployed to production via the CF API `/content` endpoint
  (`PUT /accounts/{acct}/workers/scripts/studioos/content`).

## 2026-05-21 — Public landing page reachable with stale session

- `frontend/src/lib/api.js` — the 401 handler in `request()` no longer
  force-redirects to `/login` when the current path is one of the
  public marketing / onboarding routes (`/`, `/spinout-lab`,
  `/directory`, `/roadmap`, `/pricing/*`, `/partner-onboarding/*`,
  `/partners/onboard`, `/esign/*`, `/deck/share/*`,
  `/insights/public/*`, `/settings/email/*`, plus the existing
  `/login`, `/register`, `/verify-email`). Stale `localStorage` is
  still cleared so the UI reflects "signed out", but the visitor
  stays on the page they asked for.
- Root cause of the user-reported "axal.vc bounces me to /login" bug:
  `useAuthSync.refresh()` fires `/auth/me` whenever localStorage has
  a cached `user` blob. If the `studioos_auth` cookie has since
  expired, `/me` returns 401, and the old api.js handler force-
  redirected to /login regardless of which page the visitor was on
  — making the public LandingPage unreachable for anyone who had
  previously signed in.

## 2026-05-21 — In-app changelog surface

- `frontend/public/CHANGELOG.md` is now a symlink to this file, so
  `vite build` copies it into `docs/CHANGELOG.md` (served by GitHub
  Pages alongside the SPA). The note at the top of the previous
  changelog warning that `docs/` gets wiped is no longer accurate —
  the symlink + vite's public-dir copy step preserves it across
  builds.
- New docs section `frontend/src/pages/docs/sections/changelog.js`
  (id `changelog`, icon `History`) registered last in
  `frontend/src/pages/docs/sections/index.js`. Single subsection
  `release-notes` uses a new optional `sub.markdownUrl` field which
  `DocsLayout.jsx::SubsectionView` renders via a new `MarkdownBody`
  component (fetch + `react-markdown`, with loading / error states
  and inline Tailwind prose-style overrides). Anchor:
  `#changelog/release-notes`.
- No role restriction — the changelog is visible to every signed-in
  role (founder/investor/partner/mentor/admin).
- Earlier same day, separately: deferred verification-email send
  (`defer_email` flag wired through worker `/register` and
  `frontend/src/pages/RegisterPage.jsx`) so the email arrives exactly
  when the "Check Your Email" screen renders (was previously fired
  before the profile-completion step). Worker `safe()` wrapper in
  `cloudflare-worker/src/routes/auth.ts` extended with a
  `SAFE_ERROR_CODES` table that surfaces known throws
  (`kek_pii_missing`, `kek_pii_too_short`, `encryption_keys_missing`)
  through the `code` field instead of the generic "Could not set up
  authenticator…" fallback. Production `KEK_PII` secret provisioned
  on the `studioos` worker (was missing — the root cause of the
  /setup-totp failure on axal.vc).

## 2026-05-15 — Task #17: Finalize HubSpot Private App connection

- Registry: `cloudflare-worker/src/integrations/registry.ts` — added
  `supports_pat: true` to the HubSpot descriptor (was previously only on
  Calendly), exposing the Private-App path through
  `publicDescriptor()` → `/api/integrations/available`.
- Modal (`frontend/src/pages/IntegrationsPage.jsx`):
  - PAT field label, placeholder (`pat-na1-...`), and helper text are
    HubSpot-aware (point to "Settings → Integrations → Private Apps"
    with the required `crm.objects.deals.read/write` +
    `crm.objects.contacts.read` scopes).
  - OAuth blurb explains why PAT is the recommended path while the
    public app is pending HubSpot Marketplace review.
  - Connect submit button is always rendered for PAT-capable OAuth
    providers (no client-side gating on `apiKey`); backend handles
    validation and returns canonical error codes.
  - `ConnectModal.submit()` awaits `onSubmit` and catches; parent
    `onConnect()` re-throws non-402 errors so worker errors
    (`hubspot_invalid_private_app_token`,
    `hubspot_requires_oauth_code_or_pat`) render inline in the modal's
    red banner instead of being lost behind the overlay.
- `replit.md`: new gotcha under **Persistent gotchas → Frontend**
  ("Integrations Connect modal") documenting the registry flag, modal
  error-bubble contract, and HubSpot dual-auth backend contract.
- No backend logic change — `providers/hubspot.ts::connect()` already
  branches on `input.api_key` first, and `getActiveAccessToken()`
  short-circuits the refresh path for `is_private_app: true` rows.

Validation: `npm run test:drift` passes (9/9). Worker deployed as
`01b041d0-08e2-4ec9-b267-7ee11a64a84f`.
