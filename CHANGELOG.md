# Changelog

> This file is the single source of truth. `frontend/public/CHANGELOG.md`
> is a symlink to it, so `vite build` copies it into `docs/CHANGELOG.md`
> where it is served by GitHub Pages and rendered inside the in-app
> Documentation page (`Docs → Changelog → Release notes`). Append new
> entries at the top (newest-first) and reference the originating task
> or commit.

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
