# Changelog

> This file is the single source of truth. `frontend/public/CHANGELOG.md`
> is a symlink to it, so `vite build` copies it into `docs/CHANGELOG.md`
> where it is served by GitHub Pages and rendered inside the in-app
> Documentation page (`Docs → Changelog → Release notes`). Append new
> entries at the top (newest-first) and reference the originating task
> or commit.

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
