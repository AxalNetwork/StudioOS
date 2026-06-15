# Changelog

> **Engineering changelog.** This file is the technical log read by
> contributors and on GitHub — task IDs, file paths, code refs are
> expected here.
>
> **User-facing changes also need a plain-English line in
> `frontend/public/CHANGELOG-user.md`** (the file the in-app Docs
> "What's new" page reads). Keep that one short, jargon-free, and
> written for the people using the platform, not the engineers
> building it.

## Autofill & wire the NEW Spin-Out demo-day deck (Task #41)

- **What:** founders on a Spin-Out deck can now generate a fully-populated
  10-slide `.pptx` from their live Lab data, with actionable "complete these to
  finish your deck" gaps and a DRAFT marker while the project is mid-program.
- **Worker assembler:** new `cloudflare-worker/src/services/decks/spinoutDeckData.ts`.
  `mapToSpinoutDeckData(src: SpinoutDemoDayData) => { data, notes, gaps, draft, programDay }`
  is a PURE remap of the existing `fillAxalSpinoutDemoDay()` output into the new
  `buildDeck()` 10-slide contract (Task #40) — no second D1 read.
  `assembleSpinoutDeckData(env, userId, projectId)` is the thin fill+map wrapper.
  - `programDay = clamp(28 − meta.days_remaining, 0, 28)`; `draft = programDay < 28 || gaps.length > 0`.
  - A slide pushes a `gap` only when its backing Lab module is empty (a fully
    completed project ⇒ zero gaps). Narrative-only empty fields render as
    `[draft — complete in <Module>]`; empty chart-bearing modules fall back to
    neutral template figures (never a real company's numbers) so the slide still
    renders, always paired with a gap. Speaker `NOTES` are static.
- **Worker route:** `projects.post('/:projectId/spinout-deck')` in `routes/projects.ts`.
  Premium-gated via `ensureMethodAllowed(user, 'axal_spinout_demoday', PREMIUM_METHOD_IDS)`
  (mirrors `/api/decks/apply-method` → 402 paywall payload, NOT `ensureTier`), then
  the same owner RBAC as `PUT /:id` (privileged bypass / founder owns ⇒ 404/403).
  Returns `{ data, notes, gaps, draft, program_day }`. The `.pptx` is built in the
  browser (pptxgenjs needs no Worker runtime).
- **Dev mirror:** `POST /api/projects/{project_id}/spinout-deck` in
  `backend/app/api/routes/projects.py` returns a deterministic, fully-populated
  payload (keyed to the project name, `program_day=16`, two sample gaps, `draft=True`)
  so the preview download is exercisable in dev. Never deployed.
- **Frontend:** `api.spinoutDeck(projectId)` helper; `PitchDeckPage` PPTX export, when
  `isSpinoutDeck`, calls it, dynamically imports `decks/spinout/buildDeck.js`, runs
  `buildDeck(data, { notes, draft })`, downloads the blob (filename gets `-DRAFT`),
  and renders the returned `gaps[]` in a "complete these to finish your deck" panel.
  402 surfaces a clean upgrade nudge. Historical decks + the React registry entry +
  per-slide reorder UI for non-spinout decks are untouched.
- **Test:** `cloudflare-worker/test/spinoutDeckData.test.ts` (node:test) pins both
  ends: a full Day-28 fixture ⇒ zero gaps, no `[draft …]` leak, `draft=false`; a
  partial Day-16 fixture ⇒ `draft=true`, populated gaps, placeholders present; both
  ⇒ structurally renderable (3 market rings, 4 solution steps with valid icon keys,
  positive funnel max, finite signal series). Wired into `npm run test:drift`.
  `check-deck-templates.mjs` stays green (no template/registry change).

## New Spin-Out demo-day deck generator — `buildDeck()` (Task #40)

- **What:** ported the `axal_vc_spinout_deck` template into a browser-runnable
  generator at `frontend/src/decks/spinout/buildDeck.js`. Exports
  `buildDeck(data, opts)` (returns the 10-slide `.pptx` as a Blob/Buffer),
  plus `SAMPLE_DATA`/`SAMPLE_NOTES` (the template's bundled content, retained
  as a fixture/fallback), `THEME`, and a `fmt` money/number helper. `THEME`
  (colour + fonts), every slide's geometry/copy, the 10-slide order, and the
  per-slide speaker `NOTES` are kept byte-for-byte.
- **Platform deviations from the attached prompt (unavoidable here):**
  generation runs in the **browser** via `pptxgenjs`, not server-side Node —
  prod is a Cloudflare Worker (no Node runtime, no native binaries). Dropped
  `sharp` + `react-icons` + `react-dom/server`: the five glyphs
  (`ingest`/database, `score`/chart-line, `monitor`/eye, `act`/bolt, `check`)
  are **pre-baked** to base64 PNG in `frontend/src/decks/spinout/icons.generated.js`
  by `scripts/gen-spinout-icons.mjs` (ImageMagick rasterises clean geometric
  SVGs; accent `2C4BE0` / white). No native deps, no async icon load.
- **Refactor:** removed the module-level `pres` singleton and the top-level
  IIFE/`writeFile`; the slide builders now take `(pres, data, notes, ICON)`
  and read no globals. `opts.draft` stamps the file metadata title with
  "DRAFT" (the autofill/wiring layer decides when to set it).
- **Dep:** added `pptxgenjs@^4.0.1` to both root and `frontend/package.json`
  (browser bundle). Did NOT add `sharp`/`react-icons`/`react-dom` for this.
- **Test:** `frontend/test/spinout_pptx_build.test.mjs` renders the sample
  fixture and asserts a valid, non-empty OOXML package (ZIP `PK\x03\x04`
  signature, `[Content_Types].xml` + `ppt/presentation.xml`, exactly 10
  `slideN.xml` entries, 10 `notesSlideN.xml` parts + a verbatim speaker-note
  slice), plus `fmt`/`THEME`/fixture contract checks. Wired into `test:decks`
  (so it runs under `test:drift`). The existing React `axal_spinout_demoday`
  registry entry is left untouched.
- **Out of scope (Task #41):** real project/milestone data, the HTTP endpoint,
  the "Generate deck" button, and the `gaps[]` UI.

## Post-deploy guard: verify hashed assets actually resolve (blank-page recurrence)

- **Symptom:** hard-loading a Worker-routed app path (e.g. `axal.vc/about`)
  rendered a blank page even though the route returned a valid SPA shell. The
  shell referenced `/assets/index-<hash>.js`, but that file 404'd on the apex.
- **Root cause:** Worker/GitHub-Pages build skew. The apex serves `/assets/*`
  from GitHub Pages (`docs/` on the remote `main` tip), while `npm run deploy`
  ships the newest build to the Cloudflare Worker. Deploying without pushing
  leaves Pages on an older build, so the Worker's fresh `index.html` points at
  asset hashes that don't exist on Pages → 404 → blank. (Immediate fix is the
  same as the apex-404: `bash scripts/git-push.sh` so Pages rebuilds.)
- **Guard added** in `scripts/check-spa-live.mjs` (runs in the `postdeploy`
  hook): after asserting the SPA shell, it now extracts every hashed
  `/assets/*.{js,css}` the shell references and fetches each one on the same
  host, failing the deploy if any returns a non-200 or `text/html` (the
  SPA-fallback/404 signature). The prior check only confirmed the shell
  *mentioned* an asset; it never confirmed the asset *loaded*. Failure output
  now names the push remedy explicitly.

## Fix pitch deck PDF export (pdf_render_failed) (Task #33)

- **Why:** the apex host (`axal.vc`) is a proxied Jekyll site; the Worker only
  serves the SPA for an explicit allowlist of paths. `/deck/...` and
  `/share/deck/...` were NOT on that allowlist, so the headless Browser
  Rendering session landed on Jekyll instead of the SPA print page, producing
  a 404 render and the opaque `502 pdf_render_failed` response.
- **Apex routes added** in `wrangler.toml` (both `[[routes]]` and
  `[[env.production.routes]]`): `/deck/print-export`, `/deck/print-export/*`,
  `/deck`, `/deck/*`, `/share/deck`, `/share/deck/*` (exact + wildcard pairs
  to avoid hijacking similarly-prefixed Jekyll paths).
- **Frontend error detail** surfaced in `PitchDeckPage.jsx`: the 502 JSON
  response now includes `detail`/`message` in the toast and `reportError`,
  so a genuine render failure is diagnosable instead of a bare error code.
- **Graceful fallback** for 502 PDF errors: mirrors the existing 503 path
  — `downloadDeckPdf` client-side renderer fires automatically with a toast
  so the user is never fully blocked.

## Per-Template PDF Download (Task #31)

- **Why:** reviewers can't get a real PDF of an unsigned template without
  going through the e-sign flow.
- **Shared pagination routine** extracted in `cloudflare-worker/src/services/pdf.ts`
  (`paginateBody`) and refactored `renderAgreementPdf` to use it with a
  `reservedTailHeight` for the signature block — output is unchanged.
- **`renderTemplatePreviewPdf`** added — no signature block, placeholder
  envelope `PREVIEW-NOT-YET-SENT`, body SHA-256 computed from body, and a
  45° low-opacity `PREVIEW` watermark drawn on every page.
- **Worker route** `GET /admin/contracts/templates/store/:slug/preview.pdf`
  (`?resolve=brackets|raw`) added in `admin_contracts.ts`. Requires admin,
  loads template via `storeGetTemplate`, applies `resolveWithBrackets` unless
  `resolve=raw`, returns `application/pdf` with `Content-Disposition: inline`
  filename and `Cache-Control: no-store`. Binary endpoint — kept OUT of the
  typed API drift surface.
- **Frontend blob helper** `adminTemplateStorePreviewPdfBlob` in `api.js`
  mirrors `adminFormPreviewBlob` auth pattern.
- **Download PDF button** in `AdminTemplates.jsx` modal footer, immediately
  left of Cancel. Disabled when new/saving/loading. Respects the "Resolve
  merge fields" toggle. Download via synthetic `<a download>` click. Errors
  surface through existing `setErr`.
- **Changelogs synced** in `CHANGELOG.md` and `frontend/public/CHANGELOG-user.md`.

## Rebrand bare "Axal" → "Axal VC" across frontend & user-facing literature (Task #28)

- **Why:** the official brand is **Axal VC**, not "Axal" alone. Standalone brand
  mentions in the frontend and user-facing copy now read "Axal VC".
- **Scope:** frontend + literature only (per user: backend/Worker/code out of
  scope). ~246 automated replacements across 69 files via a case-sensitive,
  word-boundary regex `\bAxal\b(?! VC)(?!\.[vV]c)(?!-)` → "Axal VC", plus manual
  fixes for hyphenated literature (`Axal-branded` → `Axal VC-branded`,
  `Axal-network` → `Axal VC network`, `Axal-VC` → `Axal VC`).
- **Product/feature names also carry VC** (approved default): "Axal StudioOS" →
  "Axal VC StudioOS", "Axal Signal" → "Axal VC Signal", etc. Touches
  `index.html`, `manifest.webmanifest`, `offline.html`, `sw.js`, `lib/seo.js`,
  `brand/gvpn.ts`, `lib/explainers.js`, `decks/templates/*.tsx`, and many
  `pages/**` + `components/**`.
- **Legacy company name collapsed:** "Axal Ventures" → "Axal VC" (not the
  redundant "Axal VC Ventures") on legal back-links, `ApiBridgePage` app_name,
  and sample deck data. `TermsPage` trademark list de-duplicated to
  `"Axal VC" and "StudioOS"`.
- **Intentionally retained (NOT changed):** code comments; the
  `X-Axal-Signature` wire header (`IntegrationsPage`); the `Axal.vc` domain in
  `RiskDisclosuresPage` legal text; all lowercase identifiers / domains
  (`axal.vc`) / emails / filenames / localStorage keys; CamelCase identifiers
  (`AxalCheckout`, `axal_spinout_demoday`); the `/^AXAL/` recovery-code prefix.
  `lib/api.js` and `lib/stripe.js` skipped (their only `Axal` matches are
  comments); `decks/templates/index.ts` left as-is (its one remaining bare
  `Axal` is a comment — registry data uses lowercase ids). Backend/Worker
  untouched.

## Document template preview spacing fixed; one shared body renderer (Task #27)

- **Why:** document templates (legal agreements, resolutions, etc.) are authored
  as PLAIN TEXT — line breaks and blank lines carry the structure (CAPS section
  headers, `1.1`/`2.2` numbering, `-` bullets, `______` fill-in blanks). The
  admin template editor's **Live preview** ran the body through `react-markdown`
  (`AdminTemplates.jsx`), which per Markdown rules collapses single newlines into
  spaces and would mangle the underscores/dashes — so sections and clauses jammed
  into run-on paragraphs and the preview did not match the finished document.
- **New shared component** `frontend/src/components/DocumentBody.jsx` — renders a
  document/template body as plain text with whitespace preserved
  (`whitespace-pre-wrap`), dark-mode aware, with an optional `emptyText`. Tokens
  (`{{merge_field}}`), underscores, and dashes are shown literally. `className`
  lets each site keep its own font/size/colour so appearance is unchanged.
- **`AdminTemplates.jsx`** — Live preview now renders via `DocumentBody` (dropped
  `react-markdown`/`remark-gfm` imports and the `prose` wrapper, which styled the
  `<pre>` like a code block). The editor preview now matches the e-signed/generated
  document exactly (same `font-sans text-[13.5px]` look). The source-pane label
  "Markdown" → "Plain text" and the placeholder now shows plain-text structure
  (no `# Heading`), so authors aren't misled into expecting Markdown.
- **`ESignPage.jsx`** and **`LegalPage.jsx`** — the e-signature document view and
  the user-facing template preview now route through the same `DocumentBody`
  (each passes its existing className), so the editor preview and the live output
  share one rendering path and can't drift. No appearance change at these two.
- **Out of scope (unchanged):** the article/news editors and pitch-deck print view
  (`DocsLayout.jsx`, `PitchDeckPrintPage.jsx`) are a genuinely Markdown-based
  system. The admin contract detail in `AdminPage.jsx` no longer inlines the body
  (Security #8 — body lives in object storage, download-only), so there was no
  body render to unify there.

## Articles sidebar collapsed to a single entry (Task #26)

- The left sidebar listed three items for the same feature — **Articles**,
  **Write an Article** (`/articles/draft`), and **My Articles** (`/articles/mine`)
  — repeated across all five role groups in `frontend/src/sidebarConfig.js`. Since
  `/articles` is already a tabbed hub (Browse + a My Articles tab) with a
  "Write an article" button, the two extra items were redundant.
- Removed the `Write an Article` and `My Articles` items from every role's
  `account` group, keeping the single `Articles` entry; dropped the now-unused
  `PenLine` lucide import.
- No route changes — `/articles/draft` and `/articles/mine` still resolve
  (`App.jsx` unchanged), so existing links/bookmarks keep working; only the
  sidebar shortcuts were removed.

## Onboarding chatbot: admins exempt (Task #24)

- **Why:** admins (and accounts created as a partner and later promoted to admin)
  were being pinned to the onboarding chatbot at `/onboarding/chat`. The SPA gate
  in `frontend/src/App.jsx` (RequireAuth) checked `user.role`, which comes from the
  stale login-token / localStorage and is never refreshed, so a promoted admin's
  client role stayed `partner` and the admin bypass failed. The leftover incomplete
  `onboarding_progress` row (`flow='chat'`, `completed_at=NULL`) seeded at signup
  also lingered after promotion.
- **SPA gate** (`frontend/src/App.jsx`): RequireAuth now syncs the authoritative
  `role` from `/api/me` into a `serverRole` state (and into stored `user`, alongside
  the existing `kyc_status`/`access_level` sync) and the onboarding-chat bypass
  evaluates against `effectiveRole = serverRole || user.role`, plus a belt-and-braces
  `realUser?.role !== 'admin'` for impersonation sessions.
- **Server guard** (`cloudflare-worker/src/routes/onboarding.ts`): `GET
  /api/onboarding/progress` no longer reports an active `flow='chat'` for admin
  accounts — a leftover incomplete chat row is returned as no active flow, so the
  client gate can't pin an admin even with a stale local role.
- **Signup seeding** (`cloudflare-worker/src/routes/auth.ts`): the chat gate row is
  only seeded for non-admin signups. (Google signups are always `partner`, unchanged.)
- **Dev mirror** (`backend/app/api/routes/onboarding.py`): same admin guard on
  `GET /progress` so the SPA behaves identically against dev FastAPI.
- **Data cleanup**: `cloudflare-worker/sql/migrations/104_release_admin_chat_onboarding.sql`
  marks lingering incomplete `flow='chat'` rows complete for admin accounts, releasing
  currently-stuck admins. Idempotent.

## Onboarding profiling chatbot: FastAPI dev mirror (Task #10 follow-up)

- **Why:** the onboarding chat ("Tell us about yourself") was Worker-only — the
  prod `/profiling/chat` + `/profiling/save` route through Workers AI, and the dev
  FastAPI mirror never implemented them. In the dev preview the SPA's
  `POST /api/profiling/chat` 404'd, so every reply after the hardcoded greeting
  threw and showed the "I'm having trouble reaching the AI assistant" fallback —
  the chatbot could never get past the first question in dev.
- **New `backend/app/api/routes/profiling.py`** (registered in `main.py` next to
  `onboarding`): a deterministic, **scripted** persona-profiling flow (dev has no
  LLM). `POST /profiling/chat` walks the same persona sequence the worker's
  SYSTEM_PROMPT describes (founder new/existing tracks, investor LP/Syndicate/
  Co-Investor, operator, and service-partner sub-types), returning `{reply,
  degraded:false}`.
- **`POST /profiling/save`** mirrors the worker's persistence: classifies the
  persona + founder track from the transcript, upserts `partner_profiles`
  (same columns), logs `profile_captured` to `activity_logs`, conservatively
  promotes role (`partner → founder/investor`, never demotes), and releases the
  onboarding-chatbot gate by writing `onboarding_progress` `flow='chat'` +
  `completed_at` (the exact row App.jsx's RequireAuth checks). Body `email` is
  accepted but ignored — the user is resolved from the session (worker Task #66
  parity).
- Dev-only; never deployed. Prod parity for the AI-driven flow stays the worker's
  responsibility (unchanged).

## Security audit: external-link scheme validation, users API access control, build fix

- **External-link XSS hardening:** added `frontend/src/lib/url.js` exporting
  `safeExternalUrl()` — allows `http(s)://`, root-relative `/path`, and scheme-less
  domains (prefixed to `https://`); rejects `javascript:`/`data:`/`vbscript:` and
  protocol-relative `//host`, returning `undefined` so an unsafe value renders a
  non-navigable anchor. Applied to every anchor that binds a DB/AI-supplied URL
  straight into `href`: `CompanyProfilePanel.jsx` (`website`, `linkedin_url`),
  `ProjectDetail.jsx` (`cb_url` ×2, `website`), `CoMarketingPage.jsx`
  (`asset_url`, `published_url` ×2), `advisor/PersonalAdvisor.jsx` (`open_url`),
  and `AuthorProfilePage.jsx`
  (`website`, `twitter`, `linkedin`). Closes a stored-XSS vector where a
  `javascript:` URL persisted in profile/pitch data executes on click.
- **Users API access control (`cloudflare-worker/src/routes/users.ts`):** `GET /`
  now requires admin; `GET /:id` is admin-or-self (403 otherwise) and rejects
  non-integer / non-positive ids (400) before authorization. Previously any
  authenticated user could enumerate the full user list or read arbitrary records.
- **Build fix (`AuthorProfilePage.jsx`):** lucide-react 1.x removed the `Twitter`
  and `Linkedin` brand glyphs, so the import hard-failed `npm run build`. Replaced
  with local inline SVGs mirroring lucide's stroke style — the same local-SVG
  pattern already used across the app for brand icons.
- **Worker typecheck fix (`cloudflare-worker/src/routes/auth_passkey.ts`):** cast the
  passkey `userID` (`TextEncoder().encode(...)`) to `Uint8Array<ArrayBuffer>` to
  satisfy `@simplewebauthn` under the TS 5.7 lib typings — runtime-unchanged
  (TextEncoder always allocates a regular `ArrayBuffer`). Unblocks `npm run test:drift`.
- **Dev migration fix (`backend/app/models/migrations.py`):** both investor-backfill
  INSERTs (the idempotent sweep and the per-promoted-user path) now set
  `created_at`/`updated_at`, fixing a NOT NULL violation on FastAPI dev boot.
  Dev-only (FastAPI is never deployed).

## Post-deploy live SPA smoke check (Task #16)

- **Why:** Task #15 fixed the blank-page incident and added a build-time guard
  that the Vite artifact (`docs/index.html` + `docs/assets/`) is complete, but
  nothing verified the *live* site after `npm run deploy`. The original incident
  shipped because no post-deploy check existed.
- **`scripts/check-spa-live.mjs`** — runtime sibling to the build-time guard. For
  each key route it asserts HTTP 200, `Content-Type: text/html`, the SPA mount
  node `<div id="root">`, and a hashed `/assets/*.js` module script, and rejects
  the worker's JSON 404 (`{"detail":"Not found"}`). Covers `/`, `/about`,
  `/dashboard`, `/articles`, and the deep link `/articles/:slug` on both hosts.
  Host-aware: on the `axal.vc` apex, `/` serves Jekyll (only 200 + HTML is
  required there) while the zone-routed app paths must serve the SPA shell; on
  the `app.axal.vc` custom domain every path must serve the shell. Retries with
  backoff for deploy propagation; tunable via `SMOKE_HOSTS`/`SMOKE_SLUG`/
  `SMOKE_RETRIES`/`SMOKE_RETRY_MS`/`SMOKE_TIMEOUT_MS`; `SKIP_LIVE_SMOKE=1`
  bypasses (explicit + logged).
- **`package.json`** — runs as the `postdeploy` lifecycle hook so `npm run deploy`
  fails loudly if the deployed site is blank/broken; also exposed as
  `npm run verify:live`.
- **`.github/workflows/post-deploy-smoke.yml`** — synthetic/on-demand layer
  (`workflow_dispatch` + 6-hourly cron) to catch a site that goes blank between
  deploys. No secrets — plain public HTTPS.

## Stripe payment fulfilment regression test (gated, opt-in) (Task #12)

- **What:** new opt-in test `cloudflare-worker/test/billing_webhook_fulfilment.test.mjs`
  boots the Worker via wrangler `unstable_dev` against a freshly seeded LOCAL D1
  (`sql/schema.sql` + migrations `011_subscription_tiers`, `027_investor_paywall`,
  `103_mi_pro_subscriptions`) with `ENVIRONMENT=test`, POSTs UNSIGNED Stripe events
  to `/api/billing/stripe/webhook`, then asserts the final `mi_pro_subscriptions` state.
- **Covers four fulfilment invariants:** (1) `checkout.session.completed` grants the
  right plan + `active` status; (2) a REPLAYED checkout does not double-grant (upsert is
  keyed on `user_id`); (3) an OUT-OF-ORDER `customer.subscription.created` arriving before
  the checkout keeps `period_end` (the later checkout must not clobber it); (4)
  `customer.subscription.deleted` scoped by `subscription_id` leaves a CO-EXISTING
  subscription on the same Stripe customer intact.
- **Gating:** skipped unless `RUN_BILLING_WEBHOOK_TEST=1` (wrangler cold-start + CLI seed
  spawns add ~25s and need the wrangler binary). Intentionally NOT wired into `test:drift`.
- **Why:** the webhook fan-out (checkout vs `subscription.*`, replays, out-of-order delivery,
  multi-sub customers) silently regresses; this pins the observable end-state in D1.
  Test-only — no runtime or user-facing change (no `CHANGELOG-user.md` line needed).
- **Harness note:** bindings are wired via `unstable_dev` OPTIONS (`d1Databases` + `vars`),
  not a `config` file — a `config` living in a temp dir makes wrangler resolve
  `main`/node_modules relative to that dir and hang. The CLI seed/read uses a tiny config
  sharing the same `database_id` + `persistTo` so both processes hit the same local sqlite.

## Onboarding chat routed through the resilient AI router (Task #10)

- **Why:** the `/profiling/chat` and `/profiling/save` endpoints called Workers AI
  directly with a single model (`@cf/meta/llama-3.1-8b-instruct`) and no fallback,
  so any transient model hiccup (capacity, timeout) hard-failed onboarding with
  "AI service error. Please try again." — blocking new partners from completing
  their profile. Every other AI feature already routes through
  `services/aiRouter.ts` for automatic fallback, kill-switch/spend handling, and
  usage logging.
- **Chat turn** (`routes/profiling.ts` `/chat`) now calls `aiRouterRun` with
  `task: 'advisor_turn'` (MID_LLAMA primary → SMALL_LLAMA fallback). System prompt,
  last-12-message trimming, and the real-time admin tail are preserved. On a router
  refusal / total-chain failure the handler no longer returns a 502: it returns
  `200 { reply, degraded: true }` with a clear, non-blocking message so the user can
  still click "Save & continue". The underlying reason (task, model, refusal, error)
  is logged via `console.error`.
- **Structured extraction** (`/save`) now routes through `aiRouterRun` with
  `task: 'tool_call'` (qwen-coder → MID/SMALL llama fallback), keeping the existing
  extraction prompt, JSON-parse logic, and best-effort behavior (save still completes
  with raw transcript + pending-admin status if extraction yields nothing).
- **Frontend** (`OnboardingChatPage.jsx`, `RegisterPage.jsx`) catch-block copy updated
  to the same graceful message so users understand they can proceed.
- Both onboarding entry points (Google-OAuth `OnboardingChatPage` and manual
  `RegisterPage` step 2) hit the same updated `/profiling/*` endpoints.

## Market Intel Pro subscription state moved to a side table; multi-product webhook hardening (Task #6)

- **Why:** the prod `users` table is at Cloudflare D1's hard 100-column limit, so
  the `ALTER TABLE users ADD COLUMN` that used to bootstrap MI Pro's
  `mi_subscription_*` columns always threw `too many columns` and re-threw out of
  `routes/billing.ts::handleStripeEvent` — 500ing EVERY Stripe webhook and
  blocking fulfilment for ALL products. D1 also rejects result sets wider than
  100 columns, so MI Pro state cannot be JOINed into `SELECT * FROM users`. See
  `.agents/memory/d1-users-column-limit.md`.
- **New side table** `mi_pro_subscriptions(user_id PK, status, subscription_id,
  plan, period_end, stripe_customer_id, updated_at)` (migration
  `cloudflare-worker/sql/migrations/103_mi_pro_subscriptions.sql`) with a UNIQUE
  index on `subscription_id`. `middleware/miAccess.ts::ensureMiPaywallSchema`
  bootstraps the identical shape (incl. the UNIQUE index) — keep the two in
  lockstep.
- **`auth.ts::getCurrentUser`** keeps `SELECT * FROM users` (100 cols) then does a
  SEPARATE keyed lookup into `mi_pro_subscriptions`, merged onto the user object
  as `mi_subscription_*`/`mi_stripe_customer_id` (try/catch → `free`).
- **`routes/billing.ts` webhook** — `checkout.session.completed` MI upserts by
  `user_id`. `customer.subscription.created/updated` UPSERTs MI by `user_id`
  (incl. `period_end`) when the event carries `kind=mi`, so an out-of-order
  `created` arriving before checkout completes still creates the row WITH
  `period_end`; legacy MI subs lacking metadata fall back to a
  `subscription_id`-scoped update. `subscription.deleted` cancels by
  `subscription_id`.
- **Cross-product clobber fixed** — MI Pro and founder-tier Checkout now
  propagate `subscription_data[metadata][kind|user_id|tier/plan]` (investor
  already did) so `customer.subscription.*` events carry their product kind; the
  founder-tier renewal fallback is gated `else if (isTier)` so MI/investor events
  sharing a Stripe customer can no longer overwrite `users.subscription_*`. The MI
  plan-catalog auto-register block runs only for confirmed MI events/rows.
- **Reporting reads** (`services/analyticsReports.ts`,
  `services/subscriptionPlans.ts`, `middleware/observability.ts`,
  `routes/admin_billing.ts`, `routes/assistant.ts`) rewritten to JOIN/LEFT JOIN
  `mi_pro_subscriptions` instead of reading `users.mi_subscription_*`.
- Deployed to prod with Stripe TEST keys; migration applied to prod D1. Verified:
  `/api/health` 200, unsigned webhook → 400 `invalid_signature` (not 500),
  `mi-pro/status` unauth → 401. Webhook write lifecycle (incl. out-of-order
  ordering + UNIQUE-safe resubscribe) and analytics JOINs validated directly
  against prod D1 (no >100-col errors).

## Articles merged into one tabbed hub (Task #5)

- **`frontend/src/pages/ArticlesPage.jsx`** is now a single Articles hub with two
  tabs instead of a public-only feed. `BrowseTab` holds the former public feed
  (search/role/sector filters, featured strip, pagination, `PAGE_SIZE=12`,
  `ArticleCard`). `MyArticlesTab` folds in the former `MyArticlesPage` content
  (status badges via `STATUS_LABEL`/`STATUS_BADGE`, View live, Edit). A
  "Write an article" button (signed-in only) links to `/articles/draft`, which
  still opens the unchanged full-screen `ArticleAuthorPage` editor.
- Active tab is derived from the route, not internal state: `/articles` →
  Browse, `/articles/mine` → My Articles. Tab clicks `navigate()` between the
  two so tabs are deep-linkable. The My Articles tab + Write button only render
  when `useAuth().user` is present.
- **`frontend/src/App.jsx`** — `/articles/mine` now renders `authOnly(<ArticlesPage />)`
  (was `MyArticlesPage`); the standalone `MyArticlesPage` lazy import is removed.
- **Removed** `frontend/src/pages/MyArticlesPage.jsx` (folded into the hub).
- No backend/API or routing (`wrangler.toml`) changes — `/articles/*` apex
  routing already covers `/articles/mine`, and the `articles.list`/`articles.mine`
  endpoints are unchanged.

## Incorporation order status polling & failure surface (Task #1)

- **`useIncorporationStatus` hook** (`frontend/src/hooks/useIncorporationStatus.js`): polls `GET /api/legal/incorporate/status?id=<id>` every 5 s, stops on terminal states (`packet_ready`, `documents_ready`, `failed`) or after 60 attempts (5 min). Returns `{ status, data, error, timedOut, polling }`.
- **`IncorporationStatusBadge`** (`frontend/src/components/IncorporationStatusBadge.jsx`): compact status pill mapping each status to label + icon + color. Handles `null` (initial "Checking…"), in-progress (blue+spinner), ready (green), failed (red), and a `timedOut` amber override. Accepts `size` prop (`sm` | `md`).
- **`DoneStep` in `IncorporatePage.jsx`**: replaced static success banner with live badge + dynamic copy driven by the hook. Failure panel (red) shows when `status === 'failed'` or `timedOut === true`, with a `mailto:support@axal.vc` link and the order ID to quote. "Open Legal" CTA turns emerald when documents are ready.
- **`GET /api/legal/incorporate/orders`** (`cloudflare-worker/src/routes/legal.ts`): new owner-scoped endpoint returning up to 20 non-`pending_payment` orders for the current user (id, status, jurisdiction_id, company_name, amount_cents, currency, paid_at, created_at). Used by the Legal page.
- **`LegalPage.jsx`**: loads incorporation orders on mount (parallel with existing fetches, errors silenced). Shows a "Pending Filings" card above the doc grid for any paid/processing/ready/failed orders, with `IncorporationStatusBadge` per row and a "Contact support" link on failed orders.
- **`api.js`**: added `legalIncorporationOrders()` → `GET /legal/incorporate/orders`.

## E2E checkout pass + Stripe Tax (Task #12)

- **Stripe Tax (`automatic_tax`) — flag-gated, default OFF.** New pure helper `cloudflare-worker/src/util/stripeTax.ts`: `stripeTaxEnabled(env)` (truthy `STRIPE_TAX_ENABLED` ∈ `1|true|yes|on`, case/space-insensitive) + `automaticTaxParams(enabled, {checkout, hasExistingCustomer})` returning `{}` when disabled (callers spread unconditionally), `{'automatic_tax[enabled]':'true'}` otherwise, plus `{'customer_update[address]':'auto'}` ONLY on the checkout surface WITH an existing `customer`. Added `STRIPE_TAX_ENABLED` to `Env` in `cloudflare-worker/src/types.ts`.
- Wired the helper into every tax-capable create: subscription params in `routes/payments.ts`; the three Checkout Sessions in `routes/billing.ts` (mi-pro, founder-tier, investor — `checkout:true, hasExistingCustomer:!!params.customer`); and `routes/legal.ts` incorporation Checkout Session + the incorporation **Invoice** create (`automatic_tax[enabled]` only — `customer_update` is Checkout-only).
- **Deliberately NOT touched:** raw PaymentIntents (`routes/payments.ts::createPaymentIntent` à la carte/charges, `routes/bookings.ts`). Stripe's PI API has no `automatic_tax` param (it 400s); taxing one-time flows needs the Stripe Tax **Calculation API** — deferred to a follow-up. See `GOTCHAS.md` → "Stripe Tax + payment debugging".
- **Tests:** `cloudflare-worker/test/stripeTax.test.ts` (7 cases — flag parsing, disabled no-op, subscription/invoice vs checkout shapes, the existing-customer `customer_update` gate) wired into `npm run test:drift`'s strip-types group. `frontend/tests/e2e/checkout_embedded.spec.js` — `requirePreview()`-gated embedded-checkout smoke per product line (founder-tier subscription via Settings → Billing, incorporation via `/incorporate`) asserting the `<AxalCheckout>` terminal mounts ("Secured by Stripe" / Stripe iframe) or shows the explicit not-configured notice, never a checkout error, plus a PCI SAQ-A guard (no app-owned card inputs) and a conditional tax-line assertion when `STRIPE_TAX_ENABLED=1` in the Playwright env.
- **Webhook idempotency** is already enforced by per-effect DB UNIQUE constraints (`feature_unlocks.source_payment_intent_id`, `promo_redemptions.payment_intent_id`, commission `UNIQUE(user_id,source_type,source_id)`, `invoice_email_log`), so replayed events no-op — documented in GOTCHAS. A test-clock lifecycle run + webhook-replay integration test need live Stripe test keys (not CI-runnable here) → follow-up.
- **Ops:** new `GOTCHAS.md` ops item **(k)** — activate Stripe Tax in the dashboard (origin address + registrations) BEFORE setting `STRIPE_TAX_ENABLED=1`, or every checkout/subscription/invoice create 502s.

## Refund + dispute admin tooling (Task #11)

- Admin Console gains a **Billing** tab (`frontend/src/pages/AdminPage.jsx::BillingPanel`, `data-testid="admin-tab-billing"`/`admin-billing-panel`) with three tools: issue refunds (per-product policy + automatic referral-commission clawback), upload/submit dispute evidence, and look up a customer's lifetime value. Built alongside the promo tab (not a revert).
- `cloudflare-worker/src/services/referralPayouts.ts`: new `clawbackReferralCommissionForRefund(env, {paymentIntentId, refundedAmountCents, chargeAmountCents, chargeRefundedToDateCents, adminId, refundId})` (+ `ClawbackResult` interface, `reverseCommissionCredit` helper). Links the refunded purchase to its payout via `commissions.source_id = paymentIntentId AND source_type='purchase'` → `referral_payouts.redemption_id`. When the payout is `paid` with a `stripe_transfer_id`, reverses the Connect transfer via Stripe `POST /transfers/{id}/reversals` — **cumulative-aware** sizing so sequential partial refunds neither over- nor under-claw from rounding: reads the charge's cumulative `amount_refunded` (`refundedToDate`) and the transfer's authoritative `amount_reversed`, computes `targetCumulative = min(round(payout * refundedToDate / chargeTotal), payout)` and reverses only `targetCumulative − alreadyReversed`. Idempotency-Key `clawback-{transferId}-{refundId}`. Finalizes (payout → `reversed` w/ `reversed_at`, `failure_reason='refund_clawback'`; commission → `reversed`) once `refundedToDate >= chargeTotal` or the payout is fully reversed; partial reversals stamp `failure_reason='partial_clawback:…'` and leave the payout `paid`. Refuses to guess when the charge total can't be read (`skipped`) and surfaces a Stripe transfer-read failure (`error`); voids not-yet-paid payouts. Returns a structured `ClawbackResult` and **never throws** (refund success must not depend on clawback).
- `cloudflare-worker/src/routes/admin_billing.ts`: added `evaluateRefundPolicy(env, {paymentIntentId, chargeId})` — retrieves the PI (or charge→PI) from Stripe and reads `metadata.kind`: `incorporation` blocks once `incorporations.status` ∈ `INCORPORATION_FILED_STATUSES` (`packet_processing`/`filed`/`submitted`/`in_review`/`completed`/`active`); `expert_booking` blocks inside the `SESSION_CANCEL_WINDOW_MS` (24h) before `expert_bookings.scheduled_at`; subscriptions (`tier`/`investor`/`mi_pro`) allow with a prorated note; unknown kinds allow. Policy eval **fails open**. The `/refund` handler honors an `override_policy` body flag (recorded), returns `409 refund_policy_blocked` (with `reason`/`kind`) on a block without override, stamps refund metadata, then calls the clawback and includes both the policy outcome and `ClawbackResult` in the response + audit JSON.
- `cloudflare-worker/src/routes/admin_billing.ts`: new endpoints — `GET /disputes` + `GET /disputes/:id` (Stripe list/retrieve, `requireAdmin`), `POST /disputes/:id/evidence` (`requireFactor` + step-up + audit `billing_dispute_evidence`; `DISPUTE_EVIDENCE_FIELDS` allow-list of text/file-id fields, optional `submit`), and `GET /ltv?user_id=` (`requireAdmin`; sums net `amount_captured - amount_refunded` across the user's `stripe_customer_id`/`investor_stripe_customer_id`/`mi_stripe_customer_id` charges — **bucketed per currency** (`by_currency[]`, `mixed_currency` flag, dominant-currency top-level `ltv`) so multi-currency customers aren't summed across currencies; returns totals, count, and recent charges). Added a shared `stripeErrorResponse()` helper; imported `Context` from `hono` to satisfy tsc.
- `frontend/src/lib/api.js`: added `adminBillingRefund`, `adminBillingListDisputes`, `adminBillingGetDispute`, `adminBillingSubmitEvidence`, `adminBillingLTV`. The refund UI reads the structured `refund_policy_blocked` body off `error.data` to prompt the override.
- Out of scope (unchanged): E2E test pass and Stripe Tax (downstream task), new product lines.
- Verify: `cd cloudflare-worker && npx tsc --noEmit` (clean for the changed files; pre-existing unrelated `auth_passkey.ts` Uint8Array error remains) + `npm run test:drift` (all suites green).

## Branded invoices / receipts via Gmail (Task #10)

- Every successful payment now yields exactly one Axal-branded receipt email, delivered through the existing Gmail sender — Stripe's own customer emails are disabled (ops step) so buyers only ever see Axal branding.
- `cloudflare-worker/sql/migrations/101_invoice_emails.sql`: new `invoice_email_log` table — `dedupe_key` UNIQUE (Stripe invoice id `in_…` for the invoice path, charge id `ch_…` for the non-invoice path), `kind` (`invoice`|`charge`), `stripe_invoice_id`, `recipient`, `sent_at` (stamped only after a confirmed send), plus `idx_invoice_email_log_invoice`. The next sequential number is 101 (the spec's `088_` was stale).
- `cloudflare-worker/src/services/invoiceEmails.ts` (new): `ensureInvoiceEmailSchema` (lazy bootstrap for stale D1, mirrors the migration), `handleInvoiceEvent(env, inv)` and `handleChargeSucceeded(env, charge)`. **Paid-gating** — `handleInvoiceEvent` emails only when the invoice is actually paid (`inv.paid === true || inv.status === 'paid'`); a finalized-but-unpaid invoice (auto-charge subs finalize before settlement; manual invoices finalize unpaid) is skipped and the later `invoice.paid` delivery sends it. **Idempotency + delivery** is record-on-success: a row is written ONLY after a confirmed send (`sent_at` set); before sending we check `alreadySent` (a sent row exists) and no-op if so — duplicate/retry deliveries never double-send. On a Gmail send failure the handler THROWS, which surfaces as a non-2xx from the webhook so Stripe retries the event (the retry re-checks the ledger and re-sends). Recording only on success means a crash before the send leaves no stranded claim that would suppress a retry. `fetchPdfBytes` downloads the Stripe `invoice_pdf` (URL carries its own token — no auth header) best-effort; a failed download still sends the branded email (hosted URL links it).
- `cloudflare-worker/src/services/email.ts`: added `sendBrandedInvoiceEmail(env, {to, name, amountCents, currency, description, invoiceNumber, hostedInvoiceUrl, pdfBytes, paidAt})` — renders an Axal-branded HTML/text receipt reusing the existing private helpers (`getGmailAccessToken`, `buildRawEmail`/`buildRawEmailWithAttachment`, `escapeHtml`). Attaches the PDF when `pdfBytes` is present, otherwise links the hosted receipt. From `Axal VC <billing@axal.vc>`. Manual month/date formatting (no `Intl` reliance in the Worker runtime).
- `cloudflare-worker/src/routes/billing.ts`: `handleStripeEvent` gains cases before `default` — `invoice.paid` + `invoice.finalized` → `handleInvoiceEvent` (invoice-backed payments; sends once paid, PDF attached), `charge.succeeded` → `handleChargeSucceeded` (NON-invoice one-time charges only; `charge.invoice` set ⇒ skipped because the invoice path already covers it; links the Stripe `receipt_url`). These are DEDICATED email events with no other fulfilment, so a send failure is intentionally NOT swallowed — it propagates out of `handleStripeEvent` (called without a try/catch in the webhook route) → non-2xx → Stripe retry. (Contrast Task #8's commission block, which IS best-effort because it shares the `payment_intent.succeeded` event with fulfilment that must never be blocked.)
- Ops step (not in code): in the Stripe Dashboard disable Stripe's own customer emails (Settings → Customer emails: turn off "Successful payments" / invoice emails) so buyers receive only the Axal-branded receipt. Also ensure the webhook endpoint subscribes to `invoice.paid`, `invoice.finalized`, and `charge.succeeded`. See `GOTCHAS.md`.
- Out of scope (unchanged): refund/dispute tooling, tax-line correctness (covered by the downstream E2E + Stripe Tax task).
- Verify: `cd cloudflare-worker && npx tsc --noEmit` (clean for the changed files; pre-existing unrelated `auth_passkey.ts` Uint8Array error remains) + `npm run test:drift` (all suites green; the non-zero exit is solely that pre-existing tsc error).

## Universal referral attribution + commission (Task #8)

- Generalises refer-earn so a referral pays commission on **any sold SKU** (one-time PaymentIntents), not just the rule-keyed milestone events (`kyc/deal/lp/spinout/partner_fee`). Attribution-driven (cookie/query-param), not rule-keyed.
- `cloudflare-worker/sql/migrations/100_referral_attributions.sql`: new `referral_attributions` table — first-touch attribution for purchases, distinct from the registration-time `referrals` table. `user_id` UNIQUE (first-touch-wins), `referral_code`, `referrer_user_id`, `first_touch_at`, `expires_at` (first-touch + 30d), `converted_payment_intent_id`/`converted_at`, plus `idx_referral_attributions_referrer`.
- `cloudflare-worker/src/services/referralAttribution.ts` (new): `ensureAttributionSchema` (lazy bootstrap for dev/SQLite + stale D1, mirrors the migration), `captureAndResolveAttribution(env, buyerUserId, cookieCode)` — records a first-touch row via `INSERT OR IGNORE` when the cookie carries a valid non-self code (resolved through `resolveReferralCode`), then returns the buyer's active (non-expired, non-self) attribution; `markAttributionConverted(env, buyerUserId, piId)` (stamps the first converting PI, idempotent on `converted_payment_intent_id IS NULL`); `readRefCookie(cookieHeader)` (parses `axal_ref`). All capture/resolve paths are best-effort and never throw — attribution must never block a purchase. `ATTRIBUTION_WINDOW_DAYS = 30` mirrors the payouts approval/refund window.
- `cloudflare-worker/src/routes/payments.ts`: the shared `createPaymentIntent` helper now resolves attribution from the `axal_ref` cookie + buyer and stamps `metadata.referral_code` + `metadata.referrer_user_id` onto the PI. Single chokepoint covers `/intent` (one-time price), the raw-amount path, and `/alacarte/intent`. Recurring/subscription path is intentionally NOT covered (out of scope; subscriptions earn via milestone events). Self/expired attributions are skipped.
- `cloudflare-worker/src/routes/network.ts`: added `firePurchaseCommission(env, {buyerUserId, referrerUserId, referralCode, paymentIntentId, amountCents, currency, commissionPct, productName})` — self-referral guard, `commission = round(amountCents * min(pct,100) / 100)`, `INSERT OR IGNORE` into `commissions` (`source_type='purchase'`, `source_id=paymentIntentId`, `referral_id` NULL — attribution is tracked in `referral_attributions`, not `referrals`), idempotent via the existing `UNIQUE(user_id, source_type, source_id)` index. The payout handoff to `createReferralPayoutForCommission` (post-charge Connect transfer + approval engine, clawback-able) runs whether the commission row was just inserted OR already existed, so a webhook retry recovers from a transient payout-creation failure on the first delivery (the handoff is itself idempotent on `UNIQUE(redemption_id)`); the once-only side effects (mark attribution converted, `commission_earned` activity log) are gated on the fresh insert. Does NOT fire L2/L3 compounding (chain bonuses are registration-chain-based, not attribution-based).
- `cloudflare-worker/src/routes/billing.ts`: `handleStripeEvent`'s `payment_intent.succeeded` case gains a referral-commission block placed BEFORE the `metadata.kind` dispatch (so it fires for kinds that `return` early — alacarte/booking/incorporation). When the PI carries `referral_code` + `referrer_user_id` + `price_id` it resolves the product via `findCatalogProductByPriceId`, reads `metadata.commission_pct` (percent; pct>0 required), and calls `firePurchaseCommission` with `amount_received ?? amount`. Wrapped in try/catch — any failure logs and never blocks fulfilment.
- `frontend/src/App.jsx`: `AppInner` now captures `?ref=CODE` from ANY entry point into the `axal_ref` cookie (normalised to the short form, `path=/`, `max-age=2592000`, `SameSite=Lax`, `Secure` on https). First-touch wins — never overwrites an existing cookie. Complements the existing `/register` `?ref` read.
- Catalog: a product earns a referral commission by carrying `metadata.commission_pct` (a percentage, e.g. `"10"` = 10%). No `commission_pct` (or ≤0) → no commission. Set it in Stripe product metadata, then `POST /api/admin/catalog/sync`.
- Out of scope (unchanged): refund-driven reversal UI/logic (the post-charge transfer + approval engine already gate on the refund window), promo codes, invoice emails, and subscription/recurring commission.
- Verify: `cd cloudflare-worker && npx tsc --noEmit` (clean for the changed files; pre-existing unrelated `auth_passkey.ts` Uint8Array error remains) + `npm run test:drift` (9/9).

## Incorporation + compliance fees through the embedded terminal (Task #6)

- `cloudflare-worker/src/services/incorporations.ts`: added `createPendingIncorporationOrder({user_id, project_id, jurisdiction_id, company_name, registered_agent_name?, registered_agent_address?, amount_cents, currency})` (INSERTs an `incorporations` row in `pending_payment`; reuses the existing table as the order/filing row — it already models the lifecycle and the packet pipeline binds to it, so no new migration), `attachIncorporationPaymentIntent(env, id, piId)`, and `recordPaidIncorporationFromPaymentIntent(env, pi)` (idempotent pending→paid transition keyed on `incorporation_id`; enqueues `incorporation_packet_start` with key `incorp_packet:${id}` to advance the filing workflow).
- `cloudflare-worker/src/routes/legal.ts`: added `POST /api/legal/incorporation/order` (`requireAuth`, founder-owns-project / admin / partner gate). Resolves the fee via `resolveIncorporationPrice` (env price id → catalog `incorporation` product tagged `metadata.jurisdiction_id` → `JURISDICTION_COSTS` fallback) and the annual Registered Agent offer via `resolveRegisteredAgentOffer` (catalog `subscription` product flagged `metadata.category|plan==='registered_agent'`, prefers the yearly recurring price). Creates a one-time Stripe **Invoice** (`collection_method=charge_automatically`, `auto_advance=false`, `pending_invoice_items_behavior=exclude`, card) + invoiceitem, finalizes with `expand[]=payment_intent`, stamps the PI `metadata{kind:'incorporation', incorporation_id, user_id, jurisdiction_id}` so the webhook dispatches to fulfilment, persists the order row, and returns `{incorporation_id, client_secret, payment_intent_id, invoice_id, amount_cents, currency, registered_agent}`. Invoice (not bare PI) so the one-time fee shows in the Billing dashboard. Dev fallback (no `STRIPE_SECRET_KEY`) marks the order paid immediately. Imports `ensurePaymentsCustomer` from `./payments` and `findCatalogPriceById`/`getCatalog` from `../services/catalog`.
- `cloudflare-worker/src/routes/billing.ts`: `handleStripeEvent`'s `payment_intent.succeeded` case gains a `metadata.kind==='incorporation'` branch → `recordPaidIncorporationFromPaymentIntent` (idempotent; marks paid + enqueues the packet pipeline). Runs after the promo-redemption recording, consistent with the other `kind` dispatches.
- `frontend/src/lib/api.js`: added `legalIncorporationOrder(body)` (`POST /legal/incorporation/order`).
- `frontend/src/pages/IncorporatePage.jsx`: replaced the `window.location.href = res.url` Stripe Checkout redirect with the embedded terminal. Added a `payment` step rendering `<AxalCheckout clientSecret=…>` for the one-time fee (dev-paid orders skip straight to Done), and reworked the Done step to confirm the filing started plus surface (a) an optional annual Registered Agent opt-in (`<AxalCheckout priceId=…>` recurring) and (b) compliance one-offs as à la carte catalog products (`api.catalogProducts('alacarte')` filtered to `metadata.category==='compliance'`), each purchasable inline via the embedded terminal. The one-time fee and RA subscription appear as separate invoices in Billing. Add-on catalog fetch failures are non-blocking.
- Ops: requires the Stripe webhook to deliver `payment_intent.succeeded` (already needed by Tasks #7/#9). Optional catalog setup: an `incorporation` Product per jurisdiction (`metadata.jurisdiction_id`), a `subscription` Product flagged `metadata.category=registered_agent` (yearly price), and `alacarte` Products flagged `metadata.category=compliance`; then `POST /api/admin/catalog/sync`. Without them the fee falls back to `JURISDICTION_COSTS` and the RA/compliance sections simply don't render. See `GOTCHAS.md#backend--worker`.

## Promo codes — admin CRUD + embedded-checkout redemption (Task #9)

- `cloudflare-worker/sql/migrations/099_promo_codes.sql`: new. `promo_codes` (D1 mirror of the Stripe coupon + promotion code: `code` UNIQUE, `stripe_coupon_id`, `stripe_promotion_code_id`, `type` percent|fixed, `percent_off`, `amount_off`, `currency`, `duration`, `duration_in_months`, `max_redemptions`, `times_redeemed`, `product_ids` JSON allow-list, `active`, `expires_at`) + `promo_redemptions` (`promo_code_id`, `payment_intent_id` UNIQUE for idempotent counting, `user_id`). Not auto-applied to prod — apply on deploy.
- `cloudflare-worker/src/services/promos.ts`: new. `ensurePromoSchema` (idempotent in-code bootstrap mirroring 099), `normalizeCode` (trim+upper), `listPromos`/`getPromoByCode`/`getPromoById`, `mirrorPromo`/`setPromoActive`, `computeDiscount(promo, amountCents)` (percent → `round(amount*pct/100)`; fixed → `min(amount_off, amount)`; clamps the result to the amount so the discounted total never goes negative), `validatePromoForProduct({env, code, productId, amountCents, currency})` (resolves the mirror row, then checks active/expiry/product allow-list/currency; usage cap compares the LIVE Stripe `coupon.times_redeemed` AND the mirror redemption count against `max_redemptions` so a code can't over-redeem across the PI window), `fulfilFreeUnlock` (atomic reserve via a synthetic `promo:<promoId>:<userId>` PI id — a conditional `UPDATE` cap-check with rollback — then `writeFeatureUnlock` for 100%-off/sub-minimum à la carte), `recordPaidRedemption({env, promoId, paymentIntentId, userId})` (idempotent `INSERT OR IGNORE` keyed on the PI id; bumps `times_redeemed` mirror ONLY when `changes===1`).
- `cloudflare-worker/src/routes/admin_promos.ts`: new. `GET /api/admin/promos` (list mirror), `POST /api/admin/promos` (creates a Stripe Coupon — `percent_off` XOR `amount_off`+`currency`, `duration`/`duration_in_months`, native `applies_to[products][]` from the product allow-list, `metadata.product_ids` copy — then a Promotion Code wrapping it with `code`, `max_redemptions`, `expires_at`; mirrors to D1), `PATCH /api/admin/promos/:id` (activate/deactivate — flips the Stripe promotion code `active` + mirror), `DELETE /api/admin/promos/:id` (deletes the backing Coupon with `{ method: 'DELETE' }` — which Stripe cascades to detach the promotion code — and deactivates the mirror; promotion codes themselves are not deletable in Stripe). `type:'trial'` is rejected (free-trial-days descoped: a Stripe coupon needs percent_off XOR amount_off). All four guarded by `requireAdmin` + `requireTotp` + `requireStepUp` and write `audit_log` rows.
- `cloudflare-worker/src/index.ts`: import + mount `adminPromos` BEFORE the `/api/admin` catch-all router (otherwise the catch-all swallows `/api/admin/promos`); added `/api/admin/promos` to `COOL_OFF_PREFIXES` so a freshly-issued step-up token can't be replayed against promo mutations.
- `cloudflare-worker/src/routes/payments.ts`: added `POST /api/payments/promo/validate` (`requireAuth`, rate-limited) → previews a code against a `price_id`/`product_id` without creating an intent, returning `{valid, code, percent_off|amount_off, currency, original_amount, discount_cents, discounted_amount, free}` or `{valid:false, reason}` (reasons: `not_found`/`inactive`/`expired`/`product_not_eligible`/`usage_limit_reached`/`currency_mismatch`). Extended the recurring `/intent` path (subscription) to pass `discounts[0][promotion_code]` and, when the first invoice nets to zero, return `{kind:'subscription', free:true, ...}` (no PI); the one-time `/intent` and `/alacarte/intent` paths now recompute the discount server-side from the catalog amount, stamp `metadata.promo_code_id`+`promo_code`, enforce the Stripe ~50¢ minimum (`amount_too_small_after_discount`), and — when the discount zeroes the total — skip the PI entirely and call `fulfilFreeUnlock`, returning `{kind:'payment', free:true, feature_key}`. The ad-hoc raw-`amount` path rejects any promo (`promo_not_supported_for_raw_amount`) since there's no catalog product to gate against. The PI idempotency key now includes the normalized promo code (or `none`) so applying/removing a code re-fetches a fresh discounted intent instead of reusing the prior one.
- `cloudflare-worker/src/middleware/rateLimit.ts`: added a `promo_validate` bucket (20/min/user) for the validate endpoint.
- `cloudflare-worker/src/routes/billing.ts`: `handleStripeEvent`'s `payment_intent.succeeded` case now, when `metadata.promo_code_id` is present, calls `recordPaidRedemption` (idempotent) BEFORE the `metadata.kind` fulfilment dispatch, so a paid redemption is counted exactly once even on webhook re-delivery.
- `frontend/src/lib/api.js`: added `validatePromo({code, price_id, product_id})` (`POST /payments/promo/validate`) near the checkout helpers, and admin CRUD helpers `adminListPromos`/`adminCreatePromo(body)`/`adminSetPromoActive(id, active)`/`adminDeletePromo(id)`.
- `frontend/src/components/AxalCheckout.jsx`: added a `PromoField` child — the buyer types a code, it calls `validatePromo`, and on success shows a friendly discounted-price preview (`formatMoney`, reason-code → human-message map). A valid code flows into the `/intent` request body and into the mount dependency list so the intent re-fetches. A 100%-off (or sub-minimum) result is gated behind an explicit "Complete free order" button (`freeConfirm` state); a `{free:true}` response routes straight to the success handler (`onSuccessRef`) without mounting Stripe Elements.
- `frontend/src/pages/AdminPage.jsx`: added a **Promo Codes** tab (Ticket icon) + `PromoCodesPanel` — lists the mirror (code, discount, product allow-list, redeemed/limit, expiry, active), a create form (percent/fixed, duration, max-redemptions, expiry, and product checkboxes sourced from `api.catalogProducts`), plus deactivate/delete actions. Mutations rely on the global `request` helper's existing 403 `step_up_required` handling — no extra TOTP wiring in the panel.
- Ops: requires the Stripe webhook to deliver `payment_intent.succeeded` (already needed by Task #7). Promo codes are created through the admin UI; no Stripe-dashboard setup needed. See `GOTCHAS.md#backend--worker`.

## Mentorship sessions + à la carte SKUs through the embedded terminal (Task #7)

- `cloudflare-worker/sql/migrations/098_feature_unlocks.sql`: new. `feature_unlocks(id, user_id, feature_key, expires_at, source_payment_intent_id, created_at)` with a UNIQUE index on `source_payment_intent_id` (idempotent webhook writes) and an index on `(user_id, feature_key)` (gate reads). Not auto-applied to prod — apply on deploy.
- `cloudflare-worker/src/services/featureUnlocks.ts`: new. `ensureFeatureUnlockSchema` (idempotent in-code bootstrap mirroring 098), `writeFeatureUnlock({userId, featureKey, paymentIntentId, unlockDays?})` (`INSERT OR IGNORE`, keyed on the PI id; `unlockDays>0` → `expires_at = now + days`, else permanent/NULL), `hasFeatureUnlock(env, userId, featureKey)` (true on a non-expired row), `listActiveUnlocks(env, userId)`.
- `cloudflare-worker/src/services/catalog.ts`: added `findCatalogProductByPriceId(env, priceId)` → `{product, price}` so the à la carte path can read `metadata.feature_key`/`metadata.unlock_days` and assert `kind==='alacarte'`.
- `cloudflare-worker/src/routes/payments.ts`: exported `ensurePaymentsCustomer` (reused by the booking PI path). Added `POST /api/payments/alacarte/intent` (validates the price resolves to an active `alacarte` product with a one-time price + non-empty `feature_key`; creates a one-time PaymentIntent carrying `metadata.kind='alacarte'`, `feature_key`, `unlock_days`, `price_id`; idempotency key `pi:${user}:alacarte_${price}:${nonce}`) and `GET /api/payments/alacarte/unlocks` (the caller's active unlocks).
- `cloudflare-worker/src/services/wellbeing/bookings.ts`: replaced `createBookingCheckout` (Stripe Checkout redirect) with `createBookingPaymentIntent` — a destination-charge PaymentIntent (`application_fee_amount` + `transfer_data[destination]` preserved, so the expert payout is unchanged) on the platform customer (`ensurePaymentsCustomer`, `setup_future_usage='off_session'`, `automatic_payment_methods`), idempotency key `pi:booking:${uid}`, `metadata.kind='expert_booking'`+`booking_uid`. Returns `{client_secret, payment_intent_id, application_fee_cents}`. Refactored confirmation into a shared `applyBookingConfirmed` core with two callers: `confirmBookingFromPaymentIntent` (new path; reads `amount_received`) and `confirmBookingFromStripe` (legacy Checkout sessions still in flight; reads `amount_total`). Removed the now-unused `appUrl` helper.
- `cloudflare-worker/src/routes/wellbeing.ts`: the paid-booking branch now calls `createBookingPaymentIntent` and returns `{client_secret, payment_intent_id, ...}` (no `checkout_url`), persisting `stripe_payment_intent_id`+`application_fee_cents`. The expert-profile-view tier gate now bypasses the free-tier cap when the caller holds an active `wellbeing_expert_views` unlock (additive — Growth tier OR unlock).
- `cloudflare-worker/src/routes/billing.ts`: `handleStripeEvent` gains a `payment_intent.succeeded` case dispatching STRICTLY on `metadata.kind` (default no-op): `expert_booking` → `confirmBookingFromPaymentIntent`, `alacarte` → `writeFeatureUnlock`. Legacy Checkout-session bookings set metadata on the SESSION only, so their PI lacks `kind` → no double-fulfilment. `checkout.session.completed`→`confirmBookingFromStripe` retained for in-flight sessions.
- `frontend/src/components/AxalCheckout.jsx`: added an optional `clientSecret` prop — when supplied (e.g. a server-created booking PI), the component renders that intent directly and skips its own `POST /api/payments/intent` fetch.
- `frontend/src/pages/ExpertProfilePage.jsx`: removed the `checkout_url` redirect; a paid booking now renders `<AxalCheckout clientSecret=…>` inline (the embedded terminal) and confirms in-app, flipping to a confirmation message on success.
- `frontend/src/lib/api.js`: added `alacarteIntent(body)` (`POST /payments/alacarte/intent`) and `alacarteUnlocks()` (`GET /payments/alacarte/unlocks`).
- Ops: requires the Stripe webhook endpoint to deliver `payment_intent.succeeded`, and operators to create the `session`/`alacarte` Products in Stripe (`metadata.kind`, plus `metadata.feature_key`/`unlock_days` for à la carte) then run `POST /api/admin/catalog/sync`. See `GOTCHAS.md#backend--worker`.

## In-app billing dashboard — replaces Stripe Customer Portal (Task #5)

- `cloudflare-worker/src/routes/billing.ts`: added server-side management endpoints (before the webhook, after `/investor/dev-upgrade`), all via the `stripeCall` wrapper so the secret key stays server-side: `GET /billing/overview?scope=founder|investor` (active subscriptions + items, payment methods, upcoming invoice, last 12 invoices, `has_customer`/`stripe_configured` flags), `POST /billing/subscription/cancel`, `/resume` (toggle `cancel_at_period_end`), `/swap/preview` (upcoming-invoice proration preview: `proration_amount`, `amount_due`, `currency`), and `/swap/confirm`. Added `billingScope`/`resolveScopeCustomer` (founder → `stripe_*`, investor → `investor_stripe_*`), `fetchOwnedSub` (ownership check → 404 if the subscription's customer ≠ the scope's customer), `resolveScopePrice` (scope-aware price authorization, see Security note below), normalizers, and `setCancelAtPeriodEnd`. Swap-confirm updates Stripe subscription metadata AND immediately syncs D1 (`subscription_tier`, or investor `investor_tier` + `dealroom_max`) so the UI reflects the new tier without waiting for the webhook. Built on top of the catalog refactor (`getCatalog`), not a revert.
- `frontend/src/lib/api.js`: added `billingOverview`, `billingCancelSubscription`, `billingResumeSubscription`, `billingSwapPreview`, `billingSwapConfirm` (all pass `scope`).
- `frontend/src/components/BillingDashboard.jsx`: new. Props `scope` (`founder`|`investor`), `flash`, `onChanged`. Renders active subscriptions with cancel/resume, plan-switch buttons (other active recurring prices in scope, from `catalogProducts('subscription')`), a proration-preview confirm modal, payment methods, upcoming invoice, and recent invoices. Graceful states for loading / `has_customer === false` / `stripe_configured === false`.
- `frontend/src/pages/SettingsPage.jsx`: removed the "Manage subscription" Stripe-portal redirect button + `portal()` fn from BOTH `FounderBillingPanel` and `InvestorBillingPanel`. Active paid subscribers (`hasCustomer && tier !== 'free'`) now see `<BillingDashboard>` in a "Manage subscription" card; free/unsubscribed users keep the Plans ladder + `EmbeddedCheckoutCard`. `onChanged` re-fetches tier status.
- Security: swap/preview and swap/confirm authorize the client-supplied `price_id` server-side via `resolveScopePrice` BEFORE any Stripe call — the destination must be an active, recurring `subscription` catalog price whose product carries the same-scope metadata (`tier` for founder, `investor_tier` for investor). Unknown / inactive / one-time / non-subscription / cross-scope prices hard-reject with `400 invalid_price`, so a caller can't switch to hidden/cross-scope internal prices and confirm can't change Stripe billing while leaving the D1 tier columns stale.
- Security: the billing *mutation* endpoints (`/billing/subscription/cancel`, `/resume`, `/swap/preview`, `/swap/confirm`, and the payment-method endpoints below) are step-up gated with `requireFactor(c, 'totp')` + `requireStepUp(c)`, mirroring the (now-removed) Stripe portal endpoints so subscription changes never run on an SMS-only or stale session. The SPA's global `request()` handler auto-prompts for a fresh TOTP on the `403 step_up_required` and retries, so the dashboard needs no extra wiring. The read-only `/billing/overview` stays on `requireAuth` so the dashboard can load.
- In-app payment-method management (removing the Stripe portal made the dashboard the ONLY place to manage cards). New scope-aware endpoints in `cloudflare-worker/src/routes/billing.ts`: `POST /billing/payment-method/setup-intent` (creates a Stripe SetupIntent for the scope's customer → `client_secret`), `POST /billing/payment-method/default` (sets `invoice_settings.default_payment_method` + re-points live subscriptions' `default_payment_method`), `POST /billing/payment-method/detach`. `default`/`detach` re-fetch the payment method and assert `pm.customer === resolveScopeCustomer(user, scope)` so a caller can never act on a card that isn't theirs. The existing founder-only `/api/payments/*` card endpoints are untouched (they don't support the investor scope and aren't step-up gated).
- `frontend/src/lib/api.js`: added `billingPaymentMethodSetup`, `billingPaymentMethodDefault`, `billingPaymentMethodDetach` (all pass `scope`).
- `frontend/src/components/BillingDashboard.jsx`: payment-methods section now has an "Add card" button (opens a modal with a Stripe Elements `PaymentElement` confirmed via `confirmSetup({ redirect: 'if_required' })` against a SetupIntent — 3DS inline, raw card data never touches our servers), plus per-card "Make default" and "Remove" actions. Reuses `getStripe`/`buildAppearance`/`STRIPE_PUBLISHABLE_KEY` from `frontend/src/lib/stripe.js` (same Elements pattern as `AxalCheckout`, but SetupIntent instead of PaymentIntent).

## Axal-branded embedded checkout component (Task #4)

- `frontend/package.json`: added `@stripe/stripe-js` + `@stripe/react-stripe-js` (browser Elements libraries).
- `frontend/src/lib/stripe.js`: new. `getStripe()` memoises a single `loadStripe(VITE_STRIPE_PUBLISHABLE_KEY)` promise (returns `null` when the publishable key is unset so callers can render a graceful "not configured" state). `buildAppearance(isDark)` produces a Stripe Elements `appearance` object read live from Axal's CSS variables (`--color-brand`, `--app-input-bg/-text/-border`, `--app-text-muted`) so the Payment Element matches Settings light/dark. Stripe only reads `appearance` at Elements creation, so callers must re-mount on theme flip.
- `frontend/src/components/AxalCheckout.jsx`: new reusable embedded-checkout component. Accepts `priceId` (recurring → subscription, one-time → charge) OR ad-hoc `amount`/`currency`, plus `quantity`/`description`/`submitLabel`/`onSuccess`/`onError`. Fetches a `client_secret` from `POST /api/payments/intent` (stable per-mount `nonce` so retries reuse the server idempotency key), mounts `<Elements>` keyed on `clientSecret:theme`, renders `<PaymentElement>` with a loading skeleton (`CheckoutSkeleton`, mirrors the final layout), and confirms via `stripe.confirmPayment({ redirect: 'if_required' })` so 3DS/SCA challenges surface inline (no redirect to checkout.stripe.com). `elements.submit()` validates first; success/processing/requires_capture fire `onSuccess`, terminal errors fire `onError`. Card data only ever lives inside Stripe Elements (PCI SAQ A).
- `frontend/src/lib/api.js`: added `paymentIntent(body)` (`POST /payments/intent`) and `catalogProducts(kind)` (`GET /catalog/products?kind=`).
- `frontend/src/pages/SettingsPage.jsx`: `FounderBillingPanel` now renders a new `EmbeddedCheckoutCard` ("Pay by card") below the Plans card. It lists the mirrored Stripe `subscription` catalog (active prices) and lets the user pay inline with `<AxalCheckout>` for the selected price id — no redirect. Self-hides when `VITE_STRIPE_PUBLISHABLE_KEY` is unset or the catalog is empty; on success it flashes and refreshes tier status.
- `cloudflare-worker/src/middleware/securityHeaders.ts`: CSP now names `https://js.stripe.com` in `script-src` and adds a new `frame-src https://js.stripe.com https://hooks.stripe.com https://*.stripe.network` directive for the Stripe Payment Element + 3DS challenge iframes. `connect-src` already allowed `api.stripe.com`; no existing directive was weakened.
- `frontend/.env.example`: documented `VITE_STRIPE_PUBLISHABLE_KEY` (public key; secret stays on the Worker).

## Refactor subscription checkout to use the catalog

- `cloudflare-worker/src/services/catalog.ts`: new `priceForPlanMetadata(env, metaKey, metaValue, interval?)` — resolves the active `stripe_products` row whose Stripe `metadata[metaKey] === metaValue`, then returns its price for the requested recurring `interval`. `interval` accepts a string ('month'|'year') for an exact match, `null` for a one-time price, or `undefined` to take the product's single recurring price (used by the founder tiers whose plan key doesn't encode an interval). Returns `null` when nothing matches (callers treat that like an unconfigured price).
- `cloudflare-worker/src/routes/billing.ts`: the three subscription `/checkout` routes now resolve their Stripe price ID through the catalog instead of `STRIPE_PRICE_*` env vars — removing the `PLAN_TO_PRICE_ENV`, `TIER_PRICE_ENV`, and the `envKey` field on `INVESTOR_PLAN_TO_PRICE` (the investor map now carries `{tier, interval}`). MI Pro looks up `plan=mi_pro` (interval from `mi_pro_monthly|annual`); founder tiers look up `tier=growth|studio` (single recurring price); investor looks up `investor_tier=professional|institutional` (interval from `*_monthly|*_yearly`). Response shapes are unchanged; the catalog lookup is only attempted when `STRIPE_SECRET_KEY` is set, so a `null` result falls through to the existing dev-upgrade fallback exactly like a previously-unset price env var. The webhook (`handleStripeEvent`) and all three dev-upgrade endpoints are untouched — they read subscription metadata, never price env vars. `STRIPE_PRICE_*` is now read only by `routes/legal.ts` (incorporation fees).
- This makes the Stripe catalog the single source of truth for subscription SKUs. Operators must set the product metadata above in Stripe and run `POST /api/admin/catalog/sync` after edits (the read path also self-heals on an empty mirror). See `GOTCHAS.md#backend--worker`.

## Portfolio Coverage PDF export (Task #33)

- `frontend/src/lib/coveragePdf.js`: new. `exportCoveragePdf(data, companies)` builds a print-ready, branded **vector** PDF of the coverage heatmap with jsPDF (landscape A4, lazy `import('jspdf')` so the lib stays out of the initial bundle) and triggers the download. Drawn directly (filled rects + centred score text) rather than via html2canvas — the live table uses sticky columns, dark-mode classes, and horizontal scroll that rasterise poorly. Mirrors the on-screen ramp via `scoreColors(score)` (RGB equivalents of `cellStyle()` — keep the two in sync), draws gap axes with a rose outline, washes flagged rows rose with a `!` name prefix, and renders the portfolio-average footer row (whole numbers plain, fractions 1dp). Header band is redrawn on page breaks for large portfolios. Exports `coverageScopeToken`/`coveragePdfFilename` (`portfolio-coverage-<scope>-<YYYY-MM-DD>.pdf`).
- `frontend/src/pages/PortfolioCoveragePage.jsx`: added an **Export PDF** button beside Export CSV (admin/partner page, already gated). New `pdfBusy` state shows a "Generating…" label and disables the button during generation; errors route through `reportError` + the existing error banner. Feeds the already-sorted `sortedCompanies` and the loaded `GET /portfolio/coverage` payload, so the PDF respects the selected fund and current sort exactly like the CSV (no new endpoint).

## Portfolio coverage scoring tests (Task #30)

- `cloudflare-worker/src/routes/portfolio.ts`: extracted the coverage heatmap's regression-sensitive rules into pure, exported helpers so they're unit-testable without auth/D1/radar plumbing — `coverageGapAxes(axes, threshold)` (gap = score < `GAP_THRESHOLD`), `isFlagged(gapCount)` (flagged at `MIN_GAP_AXES_TO_FLAG` = 3), `aggregateAxes(companyAxesList, slugs)` (per-axis mean, 2dp, zeros on empty), and `validateFundId(raw)`. The `/coverage` route now calls these; behavior is unchanged. `GAP_THRESHOLD`/`MIN_GAP_AXES_TO_FLAG` are now exported.
- `cloudflare-worker/test/portfolio_coverage.test.ts`: new. (A) unit tests for the pure rules incl. the `aggregate[axis] === mean(companies[].axes[axis])` sanity check and the 60-is-not-a-gap boundary; (B) integration tests driving the real Hono app via `app.request()` with a minted HS256 JWT + in-memory D1 stub — admin/partner gating (403 for founder/investor/mentor/guest), invalid `fund_id` → 400, empty portfolio → zeros, and a teamless company → all-gap + flagged end-to-end.
- `package.json`: added the new `.ts` test to the `test:drift` strip-types batch so it runs pre-merge.

## Export portfolio coverage heatmap (CSV)

- `frontend/src/pages/PortfolioCoveragePage.jsx`: added an "Export CSV" control (next to Refresh, admin/partner-only page) that downloads the current scope as a CSV. New pure helpers `csvCell` (RFC-4180 escaping), `buildCoverageCsv(data, companies)` (header + one row per company in the on-screen sort order + a "Portfolio average" footer row), and `downloadTextFile`. Columns: Company, Sector, Stage, Team size, one per radar axis (label), Gap count, Flagged (yes/no). The average row mirrors the table's `aggregate` (integers plain, fractions to 1dp). Export is client-side from the already-loaded `GET /portfolio/coverage` payload, so it respects the selected fund and current sort with no new endpoint. Filename: `portfolio-coverage-<scope>-<YYYY-MM-DD>.csv` (scope = fund slug or `all-companies`). Button disabled while loading or when there are no companies in scope.

## Privacy, Consent & Taxonomy Versioning (Task #19)

- `cloudflare-worker/src/services/matchingConsent.ts`: new. `filterOptedInUserIds(env, userIds)` returns the subset who set `user_settings.matching_opt_in = 1` (fails closed — empty set on error/missing column). Exports `MATCHING_MIN_COMPLETION_PCT = 60`.
- `cloudflare-worker/src/services/userSettings.ts`: added `matching_opt_in` (default 0) to `UserSettingsRow`, `DEFAULT_ROW`, the `CREATE TABLE`, an idempotent `ALTER TABLE … ADD COLUMN`, `UserSettingsPatch`, and `buildUpdates` (asInt).
- `cloudflare-worker/src/routes/settings.ts`: `GET/PUT /settings/privacy` now expose `matching_opt_in` plus `profile_completion_pct`, `matching_min_pct`, and `matching_eligible` (read from `users.profile_completion_pct`). `PUT` rejects enabling the toggle with 400 when completion < 60%.
- `cloudflare-worker/src/services/taxonomyVersion.ts`: new. `getTaxonomyVersion(env)` = counts + `MAX(updated_at)` over `skill_categories`/`skills`/`value_dimensions`; `ensureTaxonomyVersionColumns(env)` idempotently adds `taxonomy_version TEXT` to `user_skills`/`user_values`.
- `cloudflare-worker/src/routes/radar.ts`: replaced the local taxonomy-version helper with the centralized `getTaxonomyVersion`; version is computed once per request and folded into the KV radar cache key (taxonomy bump → key change → recompute next request, ≪60s).
- `cloudflare-worker/src/routes/skills.ts` (`PUT /me`) + `routes/values.ts` (`POST /submit`): stamp `taxonomy_version` on each `user_skills`/`user_values` upsert (INSERT + ON CONFLICT).
- Hard consent filter enforced across people-match endpoints: `routes/matches.ts` `/investor-match` (filters investor candidates before scoring) and `/admin/all`; `routes/partners.ts` `/match` (drops linked-user partners not opted in, keeps directory-only partners with no linked user); `routes/cofounder.ts` `/browse` (skips opted-out user_ids alongside hidden ids). Note: cofounder `/browse` was included beyond the task's listed files to satisfy "any people-match endpoint."
- `cloudflare-worker/src/services/matchAudit.ts`: new. `logMatchListGeneration(env, user, kind, details)` writes `activity_logs(action='match_list_generated', …)`, admin-only no-op, never throws. Called from `matches.ts /admin/all` and `partners.ts /match`.
- `frontend/src/pages/SettingsPage.jsx`: `PrivacyCoreCard` gains an "Include me in matching" toggle, disabled with an inline hint until the profile is ≥60% complete; saved via existing `api.updatePrivacySettings`.
- `SECURITY.md`: new "Matching data — storage, sharing, and retention" section.
- Prod = Worker on D1; the new endpoints/columns 404/degrade gracefully in dev FastAPI by design.

## Partner Coverage Analytics (Task #18)

- `cloudflare-worker/src/routes/portfolio.ts`: new `GET /coverage[?fund_id=N]` (admin/partner only, else 403). Builds a portfolio-wide skill-coverage heatmap: for each in-scope project it resolves the team (`users.founder_id` == `project.founder_id` with `is_active=1`, plus active `cofounder_connections`), calls `computeRadar(env, teamUserIds)` (after `ensureSkillsTaxonomySchema`/`ensureSkillProfileSchema`), and emits the 8 `RADAR_AXES` scores (0–100). Gap axis = score < `GAP_THRESHOLD` (60); a company is `flagged` when it has ≥ `MIN_GAP_AXES_TO_FLAG` (3) gap axes. `fund_id` scopes via `fund_reserve_allocations(fund_id, project_id)` JOIN with fund name from `vc_funds`. Aggregate row = mean of per-company axis scores (2dp). Returns `{axes, companies[], aggregate, fund, company_count, flagged_count, gap_threshold}`. Worker-only (D1); 404s in dev FastAPI by design.
- `frontend/src/lib/api.js`: added `portfolioCoverage(fundId)` → `GET /portfolio/coverage`.
- `frontend/src/pages/PortfolioCoveragePage.jsx`: new admin/partner dashboard — companies × 8-axis heatmap with graduated colour ramp, sortable columns (any axis, company name, gap count), per-company flag (≥3 gaps), summary cards, fund selector (`api.fundsList()`), and a portfolio-average footer row. On a 404 in dev it shows the standard amber "unavailable in this environment" banner; `dark:` variants throughout.
- `frontend/src/App.jsx`: lazy import + `<Route path="/portfolio/coverage" element={guard(['admin','partner'], …)} />`.
- `frontend/src/sidebarConfig.js`: "Portfolio Coverage" nav entry (admin group after Due Diligence; partner Capital group after Portfolio Health).

## Restore admin console reachability in dev

- `backend/app/services/demo_seed.py`: seed a dev-only `demo-admin@axal.test` (role ADMIN) alongside the existing demo investor/founder so the Admin Console (`/admin`) is reachable AND its API calls authorize in the dev FastAPI backend. `_ensure_user` now assigns the well-known TOTP secret to ADMIN as well as INVESTOR so both quick-login and manual `/login` TOTP work. `_ensure_onboarding_complete` marks the admin onboarded. Gated by the existing `is_production()` check.
- `backend/app/api/routes/auth.py`: add `DEMO_ADMIN_EMAIL` to the `dev/quick-login` allowlist (still a strict allowlist of seeded demo accounts; route stays 404 in prod/staging).
- `frontend/src/pages/LoginPage.jsx`: `demoLogin` now accepts `{email, landing}`; added a "Sign in as demo admin (dev only)" button that quick-logs the seeded admin and lands on `/admin`. Dev-only (gated on `import.meta.env.DEV`).
- `frontend/src/pages/AdminDueDiligencePage.jsx`: the DD case store is worker-only (D1); on a 404 in dev the page now shows the same amber "unavailable in this development environment" banner the Forms/Templates panels use, instead of a red "Failed to load cases" error toast.
- Root cause: the `/admin` guard is client-side only, but no admin account existed in the dev DB, so every admin API call returned 401 (rendered as "Request failed"/zero data). Worker-only endpoints (`/admin/forms`, `/admin/contracts/templates/store`, `/dd/cases`) additionally 404 in dev by design and now all degrade gracefully.

## Spin-out Deck Radar Autofill (Task #17)

- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`: the Axal spin-out demo-day deck now autofills a real 8-axis founding-team coverage radar. Resolves the team = founder (`userId`) + active `cofounder_connections` (status='active', user_a_id/user_b_id), then calls `computeRadar(env, teamUserIds)` (after `ensureSkillsTaxonomySchema`/`ensureSkillProfileSchema`) and maps it into a new `TeamRadar` shape via `buildTeamRadar()`. Team mode plots per-axis `coverage` (best-of member); solo founders plot their own axis `score`. Gap axes (coverage < 60) get up to 2 suggested hiring roles via the static `GAP_AXIS_ROLES` map. Constant ideal-coverage reference = 70/axis. Emitted as `mn_team_radar_json`; degrades to `null` on any DB/schema error so the slide falls back to the legacy skill_coverage spider. All wrapped in try-catch.
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`: added `TeamRadar`/`TeamRadarAxis`/`TeamRadarGap` types, `team_radar` on `mentor_network` (type + SAMPLE_DATA + hydrate via `parseJsonField`), and a new pure-SVG `TeamCoverageRadar` component (team polygon + dashed ideal reference polygon + gold gap-axis vertices/labels + Team/Ideal legend + gap hiring chips as styled HTML below). Rendered in both the Mentor & Network slide (size 200) and the merged Team slide (size 170), preferring `team_radar.has_data && axes.length >= 3`, then the legacy `SkillsSpider`, then `NetworkConstellation`.
- `DECK_AUTOFILL_AUDIT.md`: marked `mentor_network.team_radar.*` as AUTOFILLED (#17).

## Investor Matching (Task #16)

- `cloudflare-worker/sql/migrations/096_investor_thesis.sql`: adds `anti_thesis_sectors_json`, `anti_thesis_stages_json`, `value_weights_json` to `investor_profiles` (idempotent, SQLite/D1 safe). Also updated `cloudflare-worker/sql/schema.sql`.
- `cloudflare-worker/src/routes/investor_signals.ts`: extended `ProfileRow` interface, `emptyProfile()`, `shapeProfile()`, and `PUT /me` to accept, persist, and return anti-thesis + value_weights. Lazy-bootstrap `ALTER TABLE ADD COLUMN` fallback in `ensureSchema` for tables created before migration 096.
- `cloudflare-worker/src/routes/matches.ts`: new `POST /api/matches/investor-match` endpoint. Scores investors for a given project_id using weights: thesis_fit (0.45), traction_fit (0.20), values_alignment (0.20), network_warmth (0.15). Hard anti-thesis exclusion (sector/stage) before scoring. Check-size band gate using ticket_band midpoint or min/max bounds. Uses `user_values` for cosine-similarity values alignment and `investor_introductions` for network warmth. Returns ranked results + excluded list with per-component breakdown.
- `backend/app/api/routes/investor_signals.py`: backend parity. `PUT /me` now parses and persists `anti_thesis_sectors`, `anti_thesis_stages`, and `value_weights` (clamped 0-1). `_empty_profile` returns default values for the new fields.
- `frontend/src/lib/api.js`: added `api.matchInvestors(projectId)` (POST /api/matches/investor-match).
- `frontend/src/pages/MatchesPage.jsx`: added "Investor Match" tab (founder-only, visible when `role === 'founder'`). Displays project selector, ranked investors with score pills, per-component breakdown (thesis/traction/values/network), and an excluded list with reasons. Uses existing `DealCard`/`ScorePill`/`Loading`/`Empty` patterns.
- `frontend/src/components/OnboardingWizard.jsx`: added `SliderField` export (range 0-1, step 0.05, percentage display).
- `frontend/src/pages/OnboardingInvestorPage.jsx`: added two new wizard steps: "Anti-thesis" (sector/stage exclusions) and "Value weights" (mission_driven, technical_depth, growth_trajectory, team_diversity, market_timing sliders). Persists `anti_thesis_sectors`, `anti_thesis_stages`, and `value_weights` on `saveInvestorProfile`.
- `frontend/src/pages/SettingsPage.jsx`: added `InvestorThesisEditorCard` in Privacy tab. Investors can toggle anti-thesis sectors/stages and adjust value-weight sliders. Save calls `api.saveInvestorProfile` with all fields.

## Partner Matching (Task #15)

- `cloudflare-worker/sql/migrations/095_partner_accepting_intros.sql`: adds `accepting_intros` column to `partners` (default 1) + composite index on `(accepting_intros, status)`. Also updated `cloudflare-worker/sql/schema.sql`.
- `cloudflare-worker/src/routes/partners.ts`: new `POST /api/partners/match` endpoint. Intent-scoped matching with weights: domain_fit (0.50), track_record (0.25), values_alignment (0.15), availability_capacity (0.10). Domain fit uses `computeRadar` for the requested axis when the partner has a linked user account; otherwise keyword fallback against `specialization`. Excludes partners with `accepting_intros = 0`. Also updated existing `GET /matchmaking/recommend` and `POST /matchPartners` to respect `accepting_intros`.
- `backend/app/models/entities.py`: added `accepting_intros: int = 1` to `Partner` model.
- `backend/app/schemas/scoring.py`: added `intent` field to `MatchPartnersRequest`.
- `backend/app/api/routes/partners.py`: updated `recommend_partners` and `match_partners` to filter `accepting_intros == 1`. Added `POST /match` intent-scoped endpoint (keyword-only fallback; no radar in dev).
- `frontend/src/lib/api.js`: added `api.matchPartners(intent)` and `api.partnerPortal.setAcceptingIntros(value)`.
- `frontend/src/pages/PartnersPage.jsx`: added intent dropdown (8 radar axes) alongside the existing sector search. Displays ranked results with per-component score breakdowns and reasons. Intent selection clears sector input and vice versa.
- `cloudflare-worker/src/routes/partner_portal.ts`: `GET /my-deal` now returns `partner` (id, accepting_intros) so the portal UI can render the opt-out toggle. Added `PATCH /accepting-intros` so partners can toggle their own availability.
- `backend/app/api/routes/partners.py`: added `PATCH /{partner_id}/accepting-intros` for backend parity.
- `frontend/src/pages/PartnerDealPortal.jsx`: added availability toggle card with `Toggle` component. Partners can opt out/in of introductions in real time.

## Radar / Spider-Graph Service (Task #13)

- `cloudflare-worker/src/services/radar.ts`: shared computation module `computeRadar(env, userIds)` that reads blended skill scores (Task #11) and canonical 8-axis taxonomy (Task #10). Returns per-axis normalized scores (0–100), team coverage = max(member scores), and `gap_axes` where coverage < 60. Deterministic output; explicit `has_data` fallback when no profile data exists.
- `cloudflare-worker/src/routes/radar.ts`: Hono route at `/api/radar` with `GET /me` (caller radar) and `POST /team` (ad-hoc team by user id list). 5-minute KV cache keyed on SHA-256 hash of user set + taxonomy version. Worker-only; dev FastAPI lacks `/api/radar`.
- `cloudflare-worker/src/index.ts`: import and mount `radarRoutes` at `/api/radar`.
- `frontend/src/lib/api.js`: `api.radar.me()` and `api.radar.team(userIds)`.

## Personal-Values Assessment (Task #12)

- `cloudflare-worker/sql/migrations/094_user_values.sql`: new table `user_values` (user_id, dimension_id, score, confidence, updated_at) with `idx_user_values_user` index.
- `cloudflare-worker/src/services/skillsTaxonomySchema.ts`: lazy bootstrap `user_values` CREATE TABLE + index on cold path (self-healing pattern).
- `cloudflare-worker/src/routes/values.ts`: Hono route at `/api/values` with `GET /survey` (paired-statement questionnaire), `POST /submit` (deterministic vector scoring + upsert), `GET /me` (vector + plain-English summary). 90-day retake window enforced server-side.
- `cloudflare-worker/src/index.ts`: import and mount `valuesRoutes` at `/api/values`.
- `frontend/src/lib/api.js`: `api.values.getSurvey()`, `api.values.submit()`, `api.values.getMe()`.
- `frontend/src/pages/ValuesAssessmentPage.jsx`: survey UI with 5-step slider, progress bar, results summary (top 3 + secondary), full vector view, 90-day retake gate.
- `frontend/src/App.jsx`: route `/values` (auth-gated, all roles).
- `frontend/src/sidebarConfig.js`: "Values Assessment" entry added under Account group for all roles.

## Author Dashboard & Public Profile (Task #5)

Authors get a personal "My Articles" dashboard with status, view counts, and edit links. Reader pages now show author profiles and an Edit button when the viewer is the author or an admin.

- `cloudflare-worker/sql/migrations/093_article_views.sql`: ALTER TABLE articles ADD views INTEGER NOT NULL DEFAULT 0.
- `cloudflare-worker/src/services/newsSchema.ts`: `ensureNewsSchema` backfills `views` column via PRAGMA check.
- `cloudflare-worker/src/routes/articles.ts`: `publicArticleShape` and `authorArticleShape` include `views` (default 0). GET `/:slug` increments views via fire-and-forget `waitUntil` using slug lookup, placed *before* the cache return so every request counts, not just cache misses.
- `frontend/src/pages/MyArticlesPage.jsx`: authenticated list over `api.articles.mine()` with status badges, word count, view count, "View live" link (published only), and Edit link.
- `frontend/src/pages/AuthorProfilePage.jsx`: public profile page at `/authors/:userId` that loads `api.articles.byAuthor(userId)`; shows author name/role/website + published article cards.
- `frontend/src/pages/ArticleReaderPage.jsx`: author name is now a deep-link to `/authors/:userId`; Edit button visible to author or admin, routes to `/articles/edit/:id`.
- `frontend/src/App.jsx`: routes `/articles/mine` (authOnly) and `/authors/:userId` (public).
- `frontend/src/sidebarConfig.js`: "My Articles" entry added under the Account group for all roles.

## Pro Article Editor Upgrades (Task #4)

Split-pane markdown editor with live preview, inline image upload, SEO fields, live slug preview, debounced autosave, and live word/reading-time stats.

- `cloudflare-worker/sql/migrations/092_article_editor_fields.sql`: ALTER TABLE articles ADD COLUMN excerpt, seo_title, canonical_url (all TEXT, nullable).
- `cloudflare-worker/src/services/newsSchema.ts`: `ensureNewsSchema` adds PRAGMA-based lazy backfill for the three new columns; `createDraft` includes `excerpt`, `seo_title`, `canonical_url` in defaults; `updateDraft` persists all new fields plus optional `slug` override (server-side slugify + auto-dedupe via `slugifyUnique`, returns final slug). Added to `authorArticleShape` and `publicArticleShape`.
- `cloudflare-worker/src/routes/articles.ts`: POST `/:id/image` (owner-only, data_uri JSON, 5MB cap, mime whitelist png/jpeg/webp/gif) → R2 key `articles/:id/img-<uuid>.<ext>` → `{ url }`. GET `/:id/image/:filename` with `isValidArticleImageName` regex gate (pure exported validator); public access for published articles, owner/admin gate for drafts. Cache: published=24h public, unpublished=private+no-store. `bustArticleEdgeCache` on publish/unpublish now lists the `articles/:id/` R2 prefix to purge inline image edge keys.
- `cloudflare-worker/src/services/newsRender.ts`: `renderMarkdown` now allows root-relative image URLs via `/^\/(?!\/)/` regex (blocks protocol-relative `//evil.com` on both image and link branches). `isValidArticleImageName` exported for reuse.
- `cloudflare-worker/test/newsRender.test.ts`: added test cases for `isValidArticleImageName` (accepts valid UUID minted filenames, rejects path traversal/bad extensions) and root-relative image URL rendering.
- `frontend/src/lib/articleMarkdown.js`: verbatim client-side port of `renderMarkdown` + `wordsAndMinutes` + `slugify` (guarantees preview parity with server rendering; no react-markdown dependency).
- `frontend/src/lib/api.js`: added `articles.uploadImage(id, dataUri)` POST helper; `articles` namespace `createDraft`/`updateDraft` payloads transparently pass new fields.
- `frontend/src/pages/ArticleAuthorPage.jsx`: 
  - Split-pane editor on lg screens: left = markdown textarea with drag/paste image upload + inline image picker toolbar; right = live preview via `renderMarkdown`. Toggle `Preview` button for small screens.
  - New fields: Excerpt (≤200 chars, live counter), SEO title, Canonical URL. Slug preview auto-derived from title unless overridden; locks on publish. 
  - Debounced autosave (~2.5s) guarded by `articleRef` capture pattern to prevent stale saves when switching drafts mid-debounce. Save state in header: "Saving…", "Unsaved changes", or "Saved … ago".
  - Live word count + reading time in header bar, computed via `wordsAndMinutes`.
  - Tag picker: sector dropdown + free-form tags (8 max, slugified, deduped).
  - Dark-mode variants on all new hardcoded colors.
- `frontend/src/pages/ArticleReaderPage.jsx`: reader SEO surfacing via `document.title` = `seo_title || title`, `meta[name="description"]` = `excerpt || subtitle`, `link[rel="canonical"]` = `canonical_url || current URL`.
- Verified: `npm run test:drift` (dark-mode + API-drift + worker `tsc --noEmit` — pre-existing `auth_passkey.ts` Uint8Array typing error only), `npm run build`, frontend `npm run build`, `newsRender.test.ts` (10 pass).

## Merge News & Articles admin queues into one Content Queue (Task #3)

The duplicate admin "News Queue" (`/admin/news`) and "Articles Queue" (`/admin/articles`) — both operating over the SAME `articles` table — are consolidated into a single **Content Queue** at `/admin/articles`. Root cause of the duplication: `news.ts`/`admin_news.ts` (Task #2) and `articles.ts`/`admin_articles.ts` (Task #1) were built independently against the same tables; `articles.ts` is a strict superset of `news.ts`.

- `frontend/src/sidebarConfig.js`: removed the `/admin/news` "News Queue" entry; renamed the `/admin/articles` entry "Articles Queue" → "Content Queue".
- `frontend/src/pages/admin/ArticlesQueuePage.jsx`: status tabs expanded to All open / New submissions / In review / Changes requested / Ready to publish / **Published** / **Rejected** (the last two pass an explicit `status` to `/api/admin/articles/queue`, which already supports `a.status = ?`; no backend change). Header copy "Articles review queue" → "Content review queue".
- `frontend/src/App.jsx`: dropped the `AdminNewsQueue` + `NewsAuthorPage` lazy imports; `/admin/news` now `<Navigate>`s to `/admin/articles` and `/news` to `/articles/draft` (the article editor — both retain access since `/articles/draft` is `authOnly`). Deleted `frontend/src/pages/admin/AdminNewsQueue.jsx` and `frontend/src/pages/NewsAuthorPage.jsx` (dead duplicates).
- `cloudflare-worker/src/routes/news.ts` + `admin_news.ts`: kept as DEPRECATED aliases (same `articles` table). Added a `use('*')` middleware that rebuilds each response (cache HITs are immutable) to stamp `Deprecation: true` + `Link: </api/articles>; rel="successor-version"`. `/api/news/:slug` and `/api/news` keep working unchanged for the Jekyll/external public surface.
- `cloudflare-worker/src/services/newsRender.ts`: `bustArticleEdgeCache` now ALSO deletes the legacy `/api/news`, `/api/news/:slug`, `/api/news/cover/:id` edge keys. Without this, once all publish/unpublish flows through `admin_articles`, an unpublished article would keep serving on the 60-day-cached deprecated `/api/news/:slug` URL. Fixes a latent cache-invalidation gap.
- Kept the `news`/`adminNews` namespaces in `frontend/src/lib/api.js` and the `/api/news` + `/api/admin/news` worker mounts so the prefix-level drift checker stays green and back-compat holds.
- Verified: frontend `npm run build`, `npm run test:drift` (dark-mode + API-drift + worker `tsc --noEmit`).

## Clear submit & PII feedback (Task #2)

Submit rejections on the article author page now drive in-UI state instead of a generic toast. Root cause: `request()` in `frontend/src/lib/api.js` attaches the parsed error body to `e.data`/`e.status`, but `ArticleAuthorPage.jsx` read `e?.body?.*` (always undefined) so every 4xx fell through to "Submit failed".

- `frontend/src/pages/ArticleAuthorPage.jsx`: `e?.body?.*` → `e?.data?.*` in save/submit. Split `save()` into `persist()` (returns boolean, no success toast) + `save()`; `submit()` now persists first and ABORTS if the save fails — otherwise the worker lints stale stored text and the returned PII offsets won't line up with the editor. New state `piiFindings`/`rateLimit`/`submitSuccess`, cleared in `loadOne`, on `retract`, and (piiFindings) on body edit. Local `HighlightedTextarea` overlay: a transparent textarea over a scroll-synced backdrop that mirrors the body with `<mark>` spans at each finding's `offset`/`length`; clicking a finding focuses the editor and selects the span. Three render states: non-dismissable PII banner ("remove the highlighted personal data" + clickable findings list), amber rate-limit banner (uses `next_available_at` for "submit again in N days (around …)"), emerald "Submitted — now in review" panel with next steps (gated on status submitted/in_review).
- `cloudflare-worker/src/services/telegramRedactCheck.ts`: `RedactFinding` gains optional `offset?`/`length?`. `scanRegexes` sets them for email/phone (trim-aware)/tax_id/bank_iban/card_like; `lintForSend` recovers offsets for consent_missing/private_in_public via case-insensitive `indexOf`. Additive — the other consumers (`admin_telegram`, `admin_x`, `news`) are unaffected.
- `cloudflare-worker/src/routes/articles.ts` `POST /:id/submit`: the 429 now returns `used` + `next_available_at` (`strftime('%Y-%m-%dT%H:%M:%SZ', datetime(MIN(submitted_at),'+7 days'))`). Also normalized the window comparison to the zone-less space form (`submitted_at` defaults to `datetime('now')`) so the boundary day can't mis-sort (space 0x20 < 'T') and loosen the cap.
- Verified: frontend typecheck + build, worker `tsc --noEmit`, `npm run test:drift` (dark-mode + API-drift) all green. Dev FastAPI has no `/api/articles` route, so the PII path is worker-only (it degrades in dev).

## User skill profile (Task #11)

Per-user skill self-ratings + connection-gated peer endorsements + a blended self+peer aggregate, built on the Task #10 taxonomy. Worker-only (dev FastAPI does not mount `/api/skills`; the page degrades to an error banner in dev).

- `cloudflare-worker/sql/migrations/091_user_skill_profile.sql`: creates `user_skills` (`user_id`, `skill_id`, `self_level` 0–5, `evidence_url`, `years`, `UNIQUE(user_id, skill_id)`, `CHECK self_level 0..5`) and `skill_endorsements` (`endorser_id`, `endorsee_id`, `skill_id`, `level` 0–5, `note`, `UNIQUE(endorser_id, endorsee_id, skill_id)`, `CHECK level 0..5`, `CHECK endorser<>endorsee`), plus indexes. `IF NOT EXISTS` / additive / idempotent. `skill_id` soft-links `skills.id` (house style, no hard FK). NOT yet applied to prod D1 — apply via wrangler (`npx wrangler d1 execute studioos-db --config wrangler.toml --remote --file=…091…`).
- `cloudflare-worker/src/services/skillProfileSchema.ts`: lazy bootstrap `ensureSkillProfileSchema()` (table SHAPE only, per-isolate `_ready`, try/catch `console.warn`) mirroring `skillsTaxonomySchema.ts`. Exports reusable `computeBlendedSkills(env, userId)` + `SELF_WEIGHT`/`PEER_WEIGHT` so the downstream radar/matching code shares the exact blend: `blended = 0.4*self + 0.6*peer_avg` when `peer_count > 0`, else `self`.
- `cloudflare-worker/src/routes/skills.ts` (mounted at `/api/skills` in `index.ts`, after `/api/cofounder`): `GET /taxonomy` (categories + active skills; weak `ETag` from row counts + `MAX(updated_at)`, honours `If-None-Match` → 304, `Cache-Control: private, max-age=300, must-revalidate`); `GET /me` + `PUT /me` (bulk upsert; `self_level <= 0` deletes the row; `evidence_url` must be http(s); validates `skill_id` against active skills); `POST /endorsements` (requires an **active** `cofounder_connections` row between the two users — non-connection → 403 `not_connected`; blocks self-endorsement; upsert on the unique triple); `GET /me/aggregate` + `GET /users/:userId/aggregate` (self | admin | active-connection only, else 403). All endpoints `requireAuth`.
- `frontend/src/lib/api.js`: `api.skills` namespace (`getTaxonomy`, `getMySkills`, `saveMySkills`, `endorse`, `getMyAggregate`, `getUserAggregate`) — literal paths so the API↔Worker drift checker matches the `/api/skills` mount.
- `frontend/src/pages/SkillsProfilePage.jsx` (lazy + auth-gated at `/skills` in `App.jsx` for all roles; linked from each role's "Account" sidebar group in `sidebarConfig.js`): category-grouped tag/level picker with a 0–5 selector per skill, optional evidence link + years, a filter box, dirty-diff Save, and a peer/blended badge where endorsements exist. Loaders fail gracefully via `reportError` + an error banner.
- Verified: migration idempotency + CHECK enforcement via `node:sqlite`; worker `tsc --noEmit` clean (new files); `npm run test:drift` dark-mode + API-drift (CLI + node:test) all green.

## Skills & values taxonomy (Task #10)

Canonical reference data — an 8-axis skill taxonomy + a personal-values taxonomy — as normalized D1 tables that every downstream feature (skill profiles, radar graph, co-founder/partner/investor matching, deck spider autofill) will read from as the single source of truth. Reference data only: no UI, no API routes, no per-user data.

- `cloudflare-worker/sql/migrations/089_skills_values_taxonomy.sql`: creates `skill_categories`, `skills`, `value_dimensions` (`CREATE TABLE IF NOT EXISTS`, additive/idempotent). 8 categories carry `is_radar_axis=1` with equal default `radar_weight=1.0`. `skills.category_slug` is a soft link to `skill_categories.slug` (no hard FK, matching house style); `skills.seniority_levels_json` defaults to the canonical 5-rung ladder `["aware","working","proficient","advanced","expert"]`. Header documents the canonical axes/slugs/weights, the seniority ladder, and the legacy-12-axis mapping.
- `cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql`: `INSERT OR IGNORE` seed — 8 radar categories, 128 skills (16 per category, over the ≥120 floor), 15 value dimensions (10 Schwartz unipolar + 5 founder-specific bipolar: Mission-vs-Profit, Speed-vs-Quality, Risk-Appetite, Growth-vs-Sustainability, Autonomy-vs-Structure). Re-running is a clean no-op.
- `cloudflare-worker/src/services/skillsTaxonomySchema.ts`: lazy bootstrap `ensureSkillsTaxonomySchema()` mirroring `ensureNetworkProfilesSchema()` — creates the table SHAPE only on a cold D1 (deliberately does NOT seed; that's 090's job), with a per-isolate `_ready` flag and try/catch `console.warn`. Exports the canonical `RADAR_AXES` (with legacy-axis mapping), `SENIORITY_LEVELS`, and `VALUE_FAMILIES` constants for downstream code. Not imported by any route yet (downstream tasks wire it in) but typechecked via the worker `tsconfig` `include`.
- The 8 axes (`product`, `engineering`, `design`, `gtm_sales`, `marketing_brand`, `finance_ops`, `legal_compliance`, `capital_network`) cleanly absorb the legacy 12-axis free-text `SKILL_CATALOG` (engineering←Engineering+Technical DD, gtm_sales←GTM+Sales, finance_ops←Finance+Operations, capital_network←Fundraising+Recruiting; rest 1:1). Reconciling/retiring the legacy catalog is a later task.
- Docs added to `GOTCHAS.md` (new "Skills & values taxonomy" subsection) + `replit.md` subsection list. Verified parse/counts/idempotency via `node:sqlite` (8 categories all radar, 128 skills at 16/category, 0 orphan slugs, 15 value dims, identical counts on re-apply). Migrations 089/090 are NOT yet applied to prod D1 — apply via wrangler (`089` then `090`). Note: `INSERT OR IGNORE` means later label/description corrections in 090 won't update already-seeded rows; corrections need an explicit `UPDATE` migration.

## Advisor composer voice-to-text mic (Task #9)

The advisor composer now has a mic button for dictating answers, sitting between the text input and the skip control so it appears in both the embedded card and the fullscreen view (they share `<Composer>`).

- `frontend/src/components/advisor/PersonalAdvisor.jsx`: new `useMicRecorder` hook wraps the `MediaRecorder` lifecycle, a `MicButton` renders the four states, and `blobToBase64`/`micSupported` are local helpers. Composer instantiates the hook and appends (never replaces) the transcript to the current input via `setInput((prev) => ...)`.
- Click requests the mic (`getUserMedia({ audio: true })`) and records; click again stops, builds a `Blob` with the recorder's negotiated mime (webm on Chrome, mp4/aac on mobile Safari — the endpoint accepts both), base64-encodes it, and calls `api.advisor.transcribe(b64, mime)` (Task #8). Mic tracks are stopped on stop and on unmount.
- States: idle (gray mic), recording (red, `animate-pulse`), transcribing (`Loader2` spinner), unsupported (`MicOff`, disabled with explanatory tooltip). Disabled while `busy`/`disabled`. Permission denial or a missing `MediaRecorder`/`getUserMedia` flips to `unsupported` until refresh; all failures route through `reportError` and return to idle.
- Worker-only feature: the dev FastAPI backend has no `/advisor/transcribe`, so live transcription is not exercisable in dev. Verified by `npm run build` (frontend) + review. No worker/backend changes.

## Personal Advisor fullscreen view (Task #7)

The advisor's header maximize button now opens a true fullscreen takeover instead of only toggling state.

- `frontend/src/components/advisor/PersonalAdvisor.jsx`: new `FullscreenView` + `FullscreenHeader` subcomponents render a `role="dialog"` `fixed inset-0 z-50` overlay when `viewMode === 'fullscreen'` (early-returned INSTEAD of the embedded card). It reuses the existing `Transcript`, `CurrentQuestion`, `Composer`, `AdvisorProgressWidget` and a newly-extracted `FocusChips` unchanged — only the layout/height differ (chat column `flex-1 min-h-0` with a scrolling transcript; desktop-only `w-80` right rail scrolling independently).
- Two exit affordances (filled "Back to dashboard" + outlined "Normal view" pills) plus Escape (`useEscapeClose`) return to the card. Persisted `viewMode:'fullscreen'` opens fullscreen on load.
- The two previously-inline handlers (CTA-click progress refresh, queue-item pick) were lifted to shared `handleCtaClick`/`handlePickQuestion` `useCallback`s so the card and overlay stay behaviourally identical; the transcript auto-scroll effect now also depends on `viewMode` so toggling views lands on the latest message.
- Reuses the shared `scrollerRef`; only one Transcript is mounted at a time. No worker/backend changes.

## Article lifecycle is now first-class in the author editor (Task #28)

The author page surfaced no real lifecycle: the left rail was a flat list with a localized date and no copy/view affordances, and the editor showed only a status pill + generic Submit button, so a draft, a submitted article, a changes-requested article, and a published one were hard to tell apart.

- `frontend/src/pages/ArticleAuthorPage.jsx`: the left rail is now three collapsible, counted sections grouped by `lifecycleGroup()` — **Drafts** (`draft`, `rejected`), **In review** (`submitted`/`in_review`/`changes_requested`/`approved`), **Published** (`published`). Each row shows title, colour-coded status pill, word count, and relative updated time (`relativeTime()`); published rows get a copy-public-URL button + "View live" link.
- New top-of-editor status strip shows the status pill + label, a live save-state (`Saving…` / `Unsaved changes` / `Saved <relative>` driven by a `dirty` diff of `editing` vs `article` and a `lastSavedAt` set on save), word/read counts, and — for `changes_requested` — the reviewer's note (latest admin review comment, falling back to latest comment then `rejection_reason`). Published shows a public-link footer with copy.
- State-aware primary action: `published` → "View live", `submitted` → "Retract", `in_review`/`approved` → disabled status label, `draft` → "Submit", `changes_requested`/`rejected` → "Resubmit". Save is disabled when not dirty. A 15s ticker keeps relative times fresh.
- Public URL is `https://axal.vc/articles/{slug}` (`PUBLIC_ARTICLE_BASE`). Deviation from the literal "disabled unless draft/changes_requested": `rejected` keeps Resubmit enabled because the worker allows submit from `rejected` and the in-app banner documents the edit-and-resubmit flow.
- Articles are a Worker-only surface (no FastAPI dev route), so this is verified by `npm run build` + dark-mode guard + review; submit/PII error handling and editor/autosave internals are out of scope.

## Restore admin / monitoring / infra API — remove CF Access worker mounts

Admin, Monitoring and Infra pages rendered empty or returned "Request failed" because the Cloudflare Access perimeter (Task #33) fail-closed the SPA. The Access app is configured on the apex only, but the SPA uses a relative API base (`BASE='/api'` in `frontend/src/lib/api.js`), so `app.axal.vc/api/admin/*` fetches can't carry the `Cf-Access-Jwt-Assertion` header — `requireCfAccess()` then returns 403 to every admin request (see GOTCHAS.md item (h)).

- `cloudflare-worker/src/index.ts`: removed the `requireCfAccess()` mounts on `/api/admin{,/*}`, `/api/monitoring{,/*}`, `/api/infra{,/*}`. These groups keep their in-app `requireAdmin`/`requireAuth` RBAC (the inner perimeter). The `/api/kyc/admin/:userId/document{,/*}` mount stays (admin-only; opened via top-level `window.open`, which survives the SSO 302).
- Re-arming the admin surface requires RE-ADDING the mounts **and** the GOTCHAS item (h) checklist (every gated path registered in the Access app + admin traffic routed to the gated host).
- Worker-only change — takes effect on `npm run deploy`. If the gate is still live in prod, also disable/edit the edge Cloudflare Access application in the dashboard and unset the `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` wrangler secrets.

## Article cover upload now visibly works end-to-end (Task #27)

Fixed cover uploads silently doing nothing in the article editor. Root cause: `GET /api/articles/cover/:id` served covers only when `status='published'`, so a draft's freshly-uploaded cover 404'd in the editor `<img>` even though the worker stored it and returned `{ ok, cover_url }`.

- `cloudflare-worker/src/routes/articles.ts`: the cover endpoint now serves unpublished covers (draft / submitted / in_review / changes_requested / rejected) to the author or an admin, authenticated via the `studioos_auth` cookie (a same-origin `<img>` can't send a Bearer header). Published covers stay public + 60-day-cached; unpublished are `private, no-store` and 404 for non-owners. Added `author_user_id` to the SELECT; imported `getCurrentUser`.
- `frontend/src/pages/ArticleAuthorPage.jsx`: optimistic local-data-URI thumbnail on select, an "Uploading…" button state, reads the worker's returned `cover_url`, cache-busts the stored URL with `?v=updated_at`, and surfaces specific failures (`too_large` / `unsupported_mime` / auth / `r2_unavailable`) in an inline error banner instead of a generic toast.
- Articles are a Worker-only surface (no FastAPI dev route), so this is verified by typecheck/drift + review and takes effect on `npm run deploy`.

## Cloudflare Access re-scoped to the full admin surface (Task #15 ops)

Re-scoped the CF Access perimeter from the eSign document endpoints to the full admin surface, and dropped eSign from the gate (it serves founders/external signers who can't be on a staff SSO allow-list).

- `cloudflare-worker/src/index.ts`: removed the two `requireCfAccess()` mounts on `/api/legal/esign/:id/document{,/*}`; kept `/api/admin{,/*}`, `/api/monitoring{,/*}`, `/api/infra{,/*}` (Task #33) and `/api/kyc/admin/:userId/document{,/*}` (Task #15) under the gate. Added inline warning comments.
- Engagement stays a prod-only switch via the `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` wrangler secrets; `requireCfAccess()` is a no-op when either is unset.
- NOT currently engaged. Arming was verified correct on the canonical apex `axal.vc` (every gated path edge-302s to SSO; subpath inheritance confirmed — a bare `api/admin` Access path covers `/api/admin/users`), then rolled back: the SPA's relative API base (`BASE = '/api'`) means `app.axal.vc/api/*` fail-closes (403) when the Access app is apex-only, and the apex SPA assets are stale (404 on `axal.vc`) so `axal.vc/admin` renders blank. Re-arm after `scripts/git-push.sh` syncs the apex and admin traffic is routed to `axal.vc`.

## Cloudflare Access on sensitive R2 read endpoints (Task #15)

`requireCfAccess()` now sits as an outer perimeter on the two sensitive document routes that stream from R2. Production wrangler secrets (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) engage the gate; dev/preview stays a no-op.

- `cloudflare-worker/src/index.ts`:
  - `app.use('/api/legal/esign/:id/document', requireCfAccess())` and `.../*` wildcard on the signed eSign PDF download endpoint.
  - `app.use('/api/kyc/admin/:userId/document', requireCfAccess())` and `.../*` wildcard on the raw KYC ID document stream.
  - Inline comment notes the future incorporation-packet / certificate-of-formation endpoint must carry the same middleware when wired.
- Existing `cfAccess.ts` middleware (Task #33) is reused unchanged; it soft-no-ops when env vars are unset, so dev/preview remain fully functional.
- In-app RBAC (requireAdmin/requireAuth) still runs per-route after the Access gate.

## Signed-doc lightbox with "Forward to legal partner" (Task #14)

Full-screen lightbox for signed eSign contracts in Legal → Signed. PDF preview in an iframe, metadata sidebar, forward log, and a "Forward to legal partner" sub-modal that emails the signed PDF as an attachment.

- **Frontend** — `frontend/src/pages/AdminPage.jsx`:
  - `SignedDocLightbox` opens only when `sub === 'signed'` and `source === 'esign'`; otherwise the legacy `ContractDetailModal` is used.
  - Layout: flex row with PDF iframe (flex-1) + metadata/forward-log sidebar (80px / 320px on lg).
  - Header: title, status pill, provider badge (DocuSign), Forward button, close.
  - Forward sub-modal: multi-email input (comma/space-separated), optional message textarea, "Include audit/signature page" checkbox (default on). Max 10 recipients, 2000-char message.
  - Forward log: per-envelope `esign_forward_log` rows rendered as cards with status (sent/failed), timestamp, "Audit page omitted" flag, and optional message preview.
  - `useEscapeClose` + backdrop-click dismissal wired.
- **Backend** — `cloudflare-worker/src/routes/esign.ts`:
  - `POST /api/legal/esign/:id/forward` — re-materializes the signed PDF via `materializeSignedPdf` (decrypts if `.enc`), optionally strips the last page using `pdf-lib.removePage()` when `include_audit_page=false`, and sends via Gmail multipart email to each recipient. Logs every forward to `esign_forward_log`. Appends `document_forwarded` audit event. RBAC: admin or envelope owner.
  - `GET /api/legal/esign/:id/forward` — returns `esign_forward_log` rows for the envelope. Same RBAC.
  - `ensureSchema` extended to create `esign_forward_log` table with envelope + forwarded_to indexes.
- **Email** — `cloudflare-worker/src/services/email.ts`:
  - `buildRawEmailWithAttachment()` — MIME multipart/mixed with multipart/alternative inner body (text/html) + application/pdf attachment.
  - `sendSignedPdfForwardedEmail()` — branded HTML template (Axal VC header), optional note block, and the PDF attachment. Returns `{ ok, error }` so callers can log per-recipient failure.
- **Architect-review fixes (Task #14 follow-up)**:
  - `services/email.ts` — replaced PDF attachment base64 encoding via `b64encode()` (UTF-8 text path, corrupted bytes >127) with new `b64encodeBytes()` that iterates raw bytes directly before `btoa()`, ensuring byte-accurate attachment encoding.
  - `routes/esign.ts` — PDF strip-failure no longer silently falls back to full PDF. When `pdf-lib.load/removePage/save` throws, the endpoint returns `500` with `{ error: 'Failed to strip audit page from PDF', detail }`. The `actuallyIncludedAudit` flag is logged/audited instead of the user's request flag, so the forward log and audit trail always reflect the exact content sent.
  - `AdminPage.jsx` — blob URL lifecycle fixed via `useRef` (`pdfUrlRef`) so the exact URL created is the one revoked on unmount; all dark-mode-only colors in the lightbox now have `dark:` variants; silent forward-log fetch error replaced with `reportError`.
- **Migration** — `cloudflare-worker/sql/migrations/087_esign_forward_log.sql` (defensive, matches `ensureSchema` inline definition).
- **API client** — `frontend/src/lib/api.js`:
  - `adminForwardContract(id, data)` — `POST /legal/esign/:id/forward`.
  - `adminGetForwardLog(id)` — `GET /legal/esign/:id/forward`.
  - `adminDownloadEsignDocumentBlob(id)` — `fetch()` wrapper for `/legal/esign/:id/document` returning a `Blob` (for `URL.createObjectURL` iframe preview). Uses the decrypt-aware eSign endpoint so `.enc` files are correctly decrypted before preview.

## 8-page incorporation packet PDF assembler (Task #12)

Builds a single function that assembles the full 8-page incorporation packet PDF in a fixed page order: Certificate of Formation, SS-4 Instructions, SS-4, Statement of Faxed EIN, Form 8821, Confirmation of Information, KYC ID page, and an Audit Trail page with a tamper-evident hash footer. The assembler is consumed by the downstream eSign packet pipeline.

- **Service** — `cloudflare-worker/src/services/incorporationPacket.ts` exports:
  - `renderCertificateOfFormationPdf(inputs)` — jurisdiction-aware certificate (Delaware C-Corp, Delaware LLC, UK Ltd, Singapore Pte, Estonia Oü). Includes entity fields, founder block, jurisdiction-specific boilerplate (Delaware GCL / LLC Act, UK Companies Act 2006, Singapore Companies Act, Estonian Commercial Code), and signature lines.
  - `renderKycIdPagePdf(founderName, kycDocument?)` — embeds a PNG/JPEG image directly; for PDF KYC documents, renders a placeholder note (pdf-lib cannot embed a PDF page onto another page). Graceful fallback when no KYC document is provided.
  - `renderAuditTrailPagePdf(events, bodyHash, envelopeUuid?)` — event list with timestamp, actor, and details; tamper-evident SHA-256 hash block at the bottom.
  - `assembleIncorporationPacket(inputs)` — orchestrates all 7 body pages, computes the body hash (SHA-256 of the raw body PDF bytes), appends the audit trail as page 8. Returns `{bytes, pageCount, bodyHash}` (object shape chosen so the downstream eSign pipeline can access both the PDF and the hash without a separate call).
  - `sha256HexBytes` helper added to `services/pdf.ts` for hashing Uint8Array directly.
- **Reuses** — `services/irsForms.ts` renderers for SS-4 (2 pages), faxed EIN, 8821, and confirmation. Mirrors the existing form geometry (PAGE_W=612, PAGE_H=792, MX=48) and `formFooter` / `sectionBar` / `fieldBox` patterns.
- **Tests** — `cloudflare-worker/test/incorporationPacket.test.ts` (16 tests, node:test, pdf-lib assertions):
  - Certificate renders for all 5 jurisdictions.
  - KYC page renders with/without document.
  - Audit trail renders with hash.
  - Full packet: 8 pages, valid PDF magic, page size verification.
  - Body hash determinism (same inputs → same hash) and sensitivity (different inputs → different hash).
  - KYC image embedding (1x1 red PNG fixture).
  - KYC PDF document graceful handling.
  - 5 MB packet size guard.
  - Added to `test:drift` suite in `package.json`.
- **Out of scope** — Email delivery, signing, and envelope creation (handled by the downstream eSign packet task). Stripe checkout (Task #11).

## Per-jurisdiction Stripe Checkout in the Incorporate wizard (Task #11)

Replaces the free wizard submit with a paid Stripe Checkout flow. Each jurisdiction maps to a Stripe Price ID (operator creates Price in dashboard, stores ID in Worker env). On successful payment, the webhook records a paid incorporation row and enqueues a `incorporation_packet_start` job; the downstream eSign packet pipeline will build the signing packet in a separate task.

- **Migration** — `cloudflare-worker/sql/migrations/086_incorporations.sql` creates `incorporations` (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name/address, amount_cents, currency, stripe_session_id UNIQUE, stripe_payment_intent, status `pending_payment`→`paid`→`packet_processing`→`packet_ready`|`failed`, created_at/updated_at/paid_at) + index on `(user_id, status)`.
- **Service** — `cloudflare-worker/src/services/incorporations.ts` exports `ensureIncorporationsSchema(env)` (idempotent `_migrated` guard), `createPendingIncorporation(env, args)`, `recordPaidIncorporation(env, obj)` (idempotent `UPDATE … WHERE status = 'pending_payment'`, enqueue only if `meta.changes === 1` with deterministic `idempotency_key: 'incorp_packet:' + id`), `startIncorporationPacket(env, id)` (status→`packet_processing`; real packet build is downstream), `getIncorporationForUser(env, id, userId)` (IDOR-scoped).
- **Queue** — `models/jobs.ts` adds `'incorporation_packet_start'` to `JobType`. `services/queueWorker.ts` switch handles it via `startIncorporationPacket`. Not an AI job; no AI-budget gate needed.
- **Worker endpoints** (all in `routes/legal.ts`):
  - `POST /api/legal/incorporate/checkout` — `requireAuth`, ownership (admin/partner OR founder-owns-project; investors blocked), jurisdiction→price env lookup, `mode: 'payment'` Stripe Checkout session with `metadata[kind]=incorporation`, `metadata[incorporation_id]=id`, `metadata[user_id]`, `client_reference_id='incorporation:'+userId`, `success_url=/incorporate/success?incorporation_id=ID`, `cancel_url=/incorporate?cancelled=1`. Dev fallback (no STRIPE_SECRET_KEY/priceId) creates pending row and returns `{url: '/api/legal/incorporate/dev-complete?id=ID', dev: true}`.
  - `GET /api/legal/incorporate/status` — `requireAuth`, `WHERE id=? AND user_id=?` (IDOR).
  - `POST /api/legal/incorporate/dev-complete` — fail-closed via `ENVIRONMENT` allowlist (`development|dev|test|local|preview`); simulates paid webhook, flips status to `paid`, enqueues packet-start job.
- **Worker webhook** — `routes/billing.ts`: `ensureIncorporationsSchema` called in webhook top; `isIncorporation` flag from `metadata.kind` or `client_reference_id` prefix; `recordPaidIncorporation` in `checkout.session.completed` **before** the generic userId/MI-Pro fallthrough (mirrors `isExpertBooking` early-return). `payment_status==='paid'` guard and `amount_total` read from session.
- **Gated legacy endpoint** — `POST /api/legal/incorporate/wizard` is now **admin-only** (`requireAuth` + `role==='admin'`). The free doc-gen logic is retained for downstream packet pipeline reuse; founders must use the paid checkout. This is a behavior change flagged to the user.
- **Frontend** — `api.js` adds `legalIncorporateCheckout` and `legalIncorporateStatus`. `IncorporatePage.jsx` `submit()` calls checkout then `window.location.href = res.url`; button relabeled to "Continue to payment". New `IncorporateSuccessPage.jsx` polls `/api/legal/incorporate/status?id=…` every 3s, shows "Confirming payment" when still `pending_payment`, then "Payment confirmed" / "Packet ready" with the signing-link email message. `App.jsx` lazy-imports + routes `/incorporate/success`.
- **FastAPI parity** — `backend/app/models/entities.py` adds `Incorporation` SQLModel so `init_db()` auto-creates the table. `backend/app/api/routes/legal.py` adds `POST /api/legal/incorporate/checkout`, `GET /api/legal/incorporate/status`, `POST /api/legal/incorporate/dev-complete` with identical validation/ownership rules so dev (`Vite proxy → localhost:8000`) works end-to-end.
- **Env types** — `types.ts` adds `STRIPE_PRICE_INCORP_US_DE_CCORP`, `STRIPE_PRICE_INCORP_US_DE_LLC`, `STRIPE_PRICE_INCORP_UK_LTD`, `STRIPE_PRICE_INCORP_SG_PTE`, `STRIPE_PRICE_INCORP_EE_OY`.

## Live company-name availability check on the Incorporate wizard (Task #10)

Adds a live availability check on the Confirm step of the Incorporate wizard: as the founder types a company name, the worker queries that jurisdiction's official register and reports whether the name looks available, is taken, or couldn't be verified.

- **Service** — `cloudflare-worker/src/services/nameCheck.ts`. `normalizeName()` (NFKD diacritics-strip, lowercase, `&`→`and`, punctuation-strip, trailing legal-suffix-token strip → all-suffix input collapses to `''` = "too generic"); `decideFromCandidates()` (status is `taken` ONLY on an exact normalized match, else `available`); `JURISDICTION_REGISTRY` + `checkCompanyName(env, jurisdictionId, name)` dispatcher with per-jurisdiction adapters: UK via the free Companies House REST search (`COMPANIES_HOUSE_API_KEY`), Delaware via OpenCorporates REST (`OPENCORPORATES_API_KEY`; ICIS needs Puppeteer/CAPTCHA so no browser-drive), Singapore via ACRA data.gov.sg (`SG_ACRA_RESOURCE_ID`), Estonia → verify-manually (needs `BROWSER`). Never throws — any failure/missing-config degrades to `{status:'unavailable'}`. Results cached in the `RATE_LIMITS` KV keyed by `jurisdiction + sha256(normalized_name)`, definitive results only, TTL 3600s; `unavailable` is never cached. Result schema `{status, jurisdiction_id, normalized_name, matches[], source, reason?, checked_at, cached}`.
- **Route** — `GET /api/legal/name-check` in `routes/legal.ts` (`requireAuth`, query-validated, 30 req / 10 min per user via `RATE_LIMITS`), returns `checkCompanyName(...)`. New worker-only endpoint, so the dev FastAPI env returns 404 → the UI shows "couldn't verify". `types.ts` `Env` gains optional `COMPANIES_HOUSE_API_KEY`/`OPENCORPORATES_API_KEY`/`SG_ACRA_RESOURCE_ID` (KV bindings already present in all envs; keys are secrets, no `wrangler.toml` change).
- **Frontend** — `IncorporatePage.jsx`: a `NameAvailability` pill under the company-name input (checking spinner / emerald available / red "taken" box listing up to 3 matches + a "use this name anyway" skip checkbox / amber verify-manually). Debounced 600ms, sequence-guarded so a slow lookup never clobbers a newer one; resets the skip flag on every keystroke; clears when off-step or name < 2 chars. `submit()` and the Generate button are blocked while checking and when `taken` unless the founder ticks the skip box. `api.js` adds `legalNameCheck(jurisdictionId, name)`.
- **Tests** — `cloudflare-worker/test/nameCheck.test.ts` (node:test; `fakeKV` + `jsonFetch` stubs): normalization, exact-match-only `taken`, UK/DE/SG adapter happy paths, non-200 → `unavailable`, definitive results cached / `unavailable` not cached, EE-without-`BROWSER` and SG-without-resource-id → verify-manually. Appended to the `test:drift` TS suite in `package.json`.

## IRS-style forms subsection (SS-4, 8821, Faxed-EIN ack, Confirmation) — programmatic PDFs

Adds Admin → Legal → Forms: four IRS-style forms rendered on the fly as fixed-layout PDFs with three placeholder fields (full legal name, company, date). No reference PDFs were provided, so layouts are rendered from each form's standard structure (only the three fields are required — pixel-perfect IRS replicas are not).

- **Renderer service** — `cloudflare-worker/src/services/irsForms.ts` (pdf-lib, same approach as `services/pdf.ts`). Exports `FormFields` (`fullLegalName`/`company`/`date`), `FORM_PLACEHOLDER_FIELDS`, the `IRS_FORMS` catalog (4 forms: `ss4` pages:2, `form_8821`, `faxed_ein`, `confirmation`), per-form renderers `renderSS4Pdf`/`renderForm8821Pdf`/`renderFaxedEinPdf`/`renderConfirmationPdf`, `sampleFields()`, and the `renderForm(id, fields)` dispatcher (returns `Uint8Array` or `null` for unknown ids). Shared drawing helpers (header, labeled field box, checkbox, section bar) with WinAnsi-safe text escaping. SS-4 renders the form page plus its instructions page (2 pages).
- **Routes** — `cloudflare-worker/src/routes/admin_forms.ts` mounted at `/api/admin/forms` in `index.ts` (before the catch-all `/api/admin`). `GET /` returns the catalog + `placeholder_fields`; `GET /:id/preview` streams `application/pdf` (sample placeholder values by default, true blank when `?blank=1`), 404 JSON for unknown ids. Both `requireAdmin`. New route prefix, so `npm run test:drift` (API-drift) passes once the SPA calls land under it.
- **Frontend** — new `frontend/src/pages/admin/AdminForms.jsx`: responsive card grid (one card per catalog form) with a preview lightbox (iframe over an object URL, sample/blank toggle, download) plus per-card download. Dark-mode variants throughout; object URLs are revoked on unmount. `api.js` adds `adminListForms` + `adminFormPreviewBlob(id, { blank })` (authed `fetch` → `{ blob, url, filename }`, caller owns the object URL). `AdminPage.jsx` `LegalPanel` swaps the `forms` placeholder for `<AdminForms/>`. Worker-only endpoints, so the dev FastAPI env shows an "unavailable in this environment" banner (404).
- **Tests** — `cloudflare-worker/test/irsForms.test.ts` (node:test + pdf-lib `PDFDocument.load`): asserts the catalog has exactly the 4 ids + 3 placeholder fields, every id renders a valid `%PDF` with its declared page count, SS-4 = 2 pages, single-page forms = 1 page, blank fields render without throwing, unknown id → `null`, and `sampleFields()` supplies all three values. Appended to the `test:drift` TS suite in `package.json`.

## Worker-owned legal template store with markdown editor + versioning

Makes the Cloudflare Worker / D1 the canonical store for legal templates, replacing the read-only `TemplatesGrid` on Admin → Legal → Templates with a full CRUD editor backed by two new tables.

- **Schema** — `cloudflare-worker/sql/migrations/084_legal_templates.sql` adds `legal_templates` (`slug` UNIQUE == the existing `doc_type` literal, `title`, `category`, `body_md`, `merge_fields` JSON, `version`, `is_active`, `is_stub`, audit cols) + `legal_template_versions` (per-edit history). `085_seed_legal_templates.sql` seeds the catalog from the FastAPI plain-text templates, the worker `.md` e-sign bodies, and stub rows for every `AGREEMENT_OPTIONS` value (`INSERT OR IGNORE`, idempotent), generated by `scripts/gen-legal-templates-seed.py`. FastAPI `{single}` placeholders are converted to `{{double}}` so `applyMergeFields` works uniformly. `slug` is the existing doc_type literal verbatim (NOT slugified) so it stays the join key for esign `document_type`, usage counts, and `templateKeyForDocType`.
- **Service** — `cloudflare-worker/src/services/legalTemplateStore.ts`: `listTemplates`/`getTemplate`/`listVersions`/`createTemplate`/`updateTemplate`/`softDeleteTemplate` + `getActiveTemplateBody` + lazy `ensureLegalTemplatesSchema`. `merge_fields` is server-derived from `{{tokens}}` (`extractMergeFields`) on every write. Updates snapshot the prior row into `legal_template_versions` and bump `version` atomically.
- **Routes** — `cloudflare-worker/src/routes/admin_contracts.ts` adds 6 endpoints under `/admin/contracts/templates/store` (list `?category`, get `:slug`, get `:slug/versions`, POST create, PUT update/version-bump, DELETE soft-delete + `requireStepUp`). List rows are decorated with `usage_count`/`last_used_at` from the same 4-source union the grid uses. Mounted under the existing `/api/admin/contracts` route — no drift change.
- **Prod doc-generation reads D1 first** — `esign.ts::createAndSendEnvelope` and `legal.ts /templates/:key/generate` (+ incorporation base content) now prefer `getActiveTemplateBody` (via `applyMergeFields` for `{{double}}` tokens) and fall back to the existing hardcoded bodies (legacy single-brace handling kept).
- **Frontend** — new `frontend/src/pages/admin/AdminTemplates.jsx` (default export + `TemplateEditorModal`) renders the catalog grouped by category (gp/fund/portfolio/compliance) with create / edit / soft-delete. Card click opens the dual-pane editor (markdown textarea | `react-markdown` + `remark-gfm` live preview) with auto-detected read-only merge-field chips and a read-only version-history panel (view / restore-into-editor). The "N uses" chip opens the existing `TemplateUsageModal`. `LegalPanel` in `AdminPage.jsx` swaps `<TemplatesGrid>` for `<AdminTemplates>`, drops the legacy `adminContractTemplates` fetch + `templates` state, and removes the now-dead `TemplatesGrid` definition. `api.js` adds `adminTemplateStore{List,Get,Versions,Create,Update,Delete}`. Added `remark-gfm`. Store endpoints are worker-only, so the dev FastAPI env shows the existing `templatesUnavailable` 404 banner.

Ops: `npm run deploy` does NOT auto-apply D1 migrations — run `wrangler d1 migrations apply` (remote) so 084/085 land in prod before the new Templates editor is used.

## Rename admin "Contracts" tab to "Legal"; scaffold Forms + Incorporation sub-tabs

Foundation for the Legal-section overhaul. `frontend/src/pages/AdminPage.jsx` renames the Admin Console "Contracts" tab to "Legal": the tab `data-testid` is now `admin-tab-legal`, the internal `tab` state key is `'legal'` (was `'contracts'`), the mounted wrapper is `admin-legal-panel`, and the exported `ContractsPanel` component is now `LegalPanel`. Two new sub-tabs — "Forms" and "Incorporation" — are added after "Templates", each rendering an empty placeholder (`legal-forms-placeholder` / `legal-incorporation-placeholder`) to be populated by later tasks. The sub-tab `data-testid` prefix changed `contracts-sub-*` → `legal-sub-*`. No backend routes or API URLs changed. Deviation from the task plan: the `api.adminListContracts` / `adminContractStats` / `adminContractTemplates` client methods keep their names (and `/admin/contracts/*` URLs) — renaming was cosmetic-only (drift is URL-based) and risked a confusing near-collision with the existing `adminListLegalTemplates`, plus the downstream template-editor task owns that surface. All existing sub-tabs (All / Pending / Signed / Voided / Pairwise / Partner / Templates) are unchanged.

## Restore passkey sign-in on the login page

Brings back the "Sign in with a passkey" button (removed in the prior change) while leaving the "Email me a sign-in link" magic-link button removed. `frontend/src/pages/LoginPage.jsx` re-adds the `signInWithPasskey` handler, the `passkeyBusy`/`passkeySupported` state, the `KeyRound` lucide import, and the `@simplewebauthn/browser` import (`startAuthentication`/`browserSupportsWebAuthn`). The button is gated on `passkeySupported` (rendered only when the browser supports WebAuthn) and sits directly below "Sign in", above the Google/demo blocks. Backend `/api/auth/passkey/*` routes, the `api.passkey.*` client methods, and the Settings → Security passkey panel were never removed, so no other wiring changed. Magic-link UI stays removed; the `?magic_error=` handler + `MAGIC_ERROR_COPY` remain untouched.

## Hide passwordless login options; fix recovery-page CSRF

Two auth-surface changes.

- **Login page — passwordless options removed (UI-only).** `frontend/src/pages/LoginPage.jsx` no longer renders the "Email me a sign-in link" (magic-link) button + its helper/sent-confirmation branch, nor the "Sign in with a passkey" button. Removed the now-orphaned `sendMagicLink`/`signInWithPasskey` handlers, the `magicBusy`/`magicSent`/`passkeyBusy`/`passkeySupported` state, and the now-unused `Mail`/`KeyRound` lucide imports + the `@simplewebauthn/browser` import. TOTP sign-in, "Continue with Google", and the dev-only quick-login are untouched. Backend routes (`/api/auth/magic/*`, `/api/auth/passkey/*`), the `api.magicStart`/`api.passkey.*` client methods, and the Settings → Security passkey panel are all left in place. The `?magic_error=` URL-param handler + `MAGIC_ERROR_COPY` are intentionally KEPT so a stale magic link still renders a graceful error.
- **Recover page — CSRF header now attached.** `frontend/src/pages/RecoverPage.jsx`'s local `post()` helper sent mutating requests with no `X-CSRF-Token` header, so the Worker's double-submit CSRF check rejected every recovery POST ("CSRF token missing or invalid") whenever a stale auth cookie was present. Added a `csrfHeader()` reader (mirrors the double-submit logic in `frontend/src/lib/api.js::getCsrfHeader` — reads the `studioos_csrf` cookie, echoes it as the header, returns `{}` when absent) and spread it into the `post()` headers, so it applies to ALL recovery POSTs (start, backup-code, sms/start, sms/verify, email/start, trusted-contact/start, admin/escalate, claim). The GET-based email-link verify is unaffected. The email one-time-link recovery option stays present.

## Auto-reload on new deploys (kills stale-bundle blank pages)

A returning visitor whose browser was controlled by an older service worker could be left running a stale in-memory bundle that references asset chunks a later deploy removed, producing a site-wide blank page that survives ordinary refreshes (only incognito / clear-site-data recovered). Two changes make the SW self-heal:

- `frontend/src/lib/pwa.js` — added a guarded `controllerchange` listener in `registerServiceWorker()`: when a newly activated SW takes control of an already-controlled page, reload exactly once. Armed only when `navigator.serviceWorker.controller` already exists (so brand-new first-install visitors are never reloaded) and protected by a one-shot `_reloadingForUpdate` flag against reload loops.
- `frontend/public/sw.js` — bumped `VERSION` `v9-2026-05-27e` → `v10-2026-06-10a` so returning browsers fetch the new SW (the update check bypasses the HTTP cache via the default `updateViaCache:'imports'`), which the existing `skipWaiting` + `clients.claim()` + old-cache purge turn into an immediate controller change → the new reload path fires and the tab lands on fresh HTML/assets.

Net: the v9→v10 transition purges stale caches and serves fresh content on the next refresh; from v10 onward, deploys auto-reload open tabs instead of stranding them on a blank page.

## Fix blank/broken pages across the platform

Three root-cause fixes for the dark-blank-page and broken-page patterns reported across all routes:

**1. Prevent dark FOUC on first paint (`frontend/index.html`)**
Removed `class="dark"` from `<html>`. Added a tiny inline `<script>` (before any CSS or module load) that reads `axal_appearance_v1` from `localStorage`, normalises `'system'` → `'light'` (matching `SettingsContext.normalizeTheme`), and applies `data-theme="dark"` + `class="dark"` only when the user's saved theme is dark. Light-theme users (the default) now see a white background from the very first frame instead of the dark `#0b1220` navy.

**2. Add top-level error boundary (`frontend/src/components/TopLevelErrorBoundary.jsx`, `frontend/src/main.jsx`)**
Created `TopLevelErrorBoundary` — a class component that sits outside `BrowserRouter`, `AuthProvider`, and `SettingsProvider` in `main.jsx`. If either provider throws during init (malformed cached data, API client error), the user now sees a plain-styled "Something went wrong — Reload page" screen instead of a dark blank. Uses inline styles so it has zero dependency on CSS variables or app providers.

**3. Harden chunk-load detection + auto-recovery (`frontend/src/components/RouteErrorBoundary.jsx`)**
Broadened `isChunkLoadError` regex to explicitly cover all browser phrasings: WebKit/Safari "Importing a module script failed." / "module script failed to load", Chrome "Failed to fetch dynamically imported module" / "error loading dynamically imported module", Vite "Failed to load module script", and classic "ChunkLoadError" / "Loading chunk NNN failed". Added `componentDidCatch` auto-reload guarded by `sessionStorage` key `axal:chunk-reload-boundary` (prevents loops). "Reload" button calls `handleChunkReload` which clears the guard and does a true `window.location.reload()`. Both guard keys cleared on successful `load` + 5s delay in `main.jsx`.

## Split `Persistent gotchas` out of `replit.md` into `GOTCHAS.md`

`replit.md` had grown to ~27KB with its "Persistent gotchas" section as the bulk of the file. Moved that section verbatim into a new root-level `GOTCHAS.md` (sibling of `README.md`/`CONTRIBUTING.md`) — every subsection preserved (Migrations & schema, Telegram broadcaster, X broadcaster, Auth blockers, Backend/Worker, Frontend, Ops items still owned by user). No gotcha text was deleted, condensed, or paraphrased; this was a relocation, not an edit pass. `replit.md` keeps a short "Persistent gotchas" stub: a one-line pointer plus a linked index of the subsection headings, so the README stays a scannable overview of live invariants while the detail remains easy to find. Mirrors the 2026-05-21 precedent that moved oversized blocks into this file. Cross-references updated: `CONTRIBUTING.md` ("read `replit.md` first") and `CLAUDE.md` (canonical-docs list) now also point at `GOTCHAS.md`. Internal/engineering change only — no user-facing changelog line.

## Task #13 — Trust / security / misc checks

Two small audit items that didn't fit a PR track: the prod-D1 `pairwise_ndas` existence check (operator-run) and the `Referrer-Policy` discrepancy.

- **NICE-SEC-01 — `Referrer-Policy` reconciled; `no-referrer` is canonical for the app/API.** Decided in favour of the stricter, security-first value rather than relaxing to the checklist's `strict-origin-when-cross-origin`. The authenticated Worker surface (`cloudflare-worker/src/middleware/securityHeaders.ts`) already emits `no-referrer` so authenticated URLs (which carry IDs / query-params) never leak in a `Referer` header — kept as-is, with the comment now recording the canonical decision and the marketing-site exception. The dev FastAPI (`backend/app/main.py`) was flipped from `strict-origin-when-cross-origin` to `no-referrer` so the dev surface mirrors prod. The public Jekyll marketing site (`github.toml`) and the static/Pages header config (`cloudflare.toml`) deliberately KEEP `strict-origin-when-cross-origin` — those pages carry no sensitive URLs and benefit from cross-origin referral attribution; both now carry a comment marking the intentional two-tier split so the value isn't "fixed" back into a contradiction. `BETA_READINESS_AUDIT_2026-06-03.md`'s NICE-SEC-01 row flipped 🟡→🟢 and was added to the close list. No prod runtime behaviour change (the emitted value is unchanged); no user-facing changelog line.
- **NICE-TRUST-01 — `pairwise_ndas` on prod D1 is an operator-run read-only check.** The main agent cannot reach prod D1 (the Worker's D1 store is operator-run via `wrangler --remote`; the dev DB is a different store). Verify with: `export PATH=/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin:$PATH` then `wrangler d1 execute studioos-db --remote --env production --command="SELECT name FROM sqlite_master WHERE type='table' AND name='pairwise_ndas';"`. Safety net regardless of the result: `cloudflare-worker/src/services/trust.ts::ensureTrustSchema()` runs `CREATE TABLE IF NOT EXISTS pairwise_ndas (…)` (plus its three indexes) on the first hit of any trust route, so an absent table self-heals on first use; if the check returns no row, applying `ensureTrustSchema` ahead of a hot path is the only action. No schema change shipped in this task.

## Task #12 (IJ) — Advisor follow-ups

Closes four advisor backlog items: a real admin question bank, a never-run-dry dynamic reflection fallback, a repeat-question regression guard, and the verify/operator docs for the advisor AI-gateway + `/explain` SSE + daily-cap posture.

- **NICE-ADV-01 — admin bank promoted to its own file (≥10).** Extracted the inline admin question into `cloudflare-worker/src/services/advisor/banks/admin.ts` (11 questions via the shared `block(section,page,anchor,rows)` helper, `persona:'admin'`). The original id `admin.preferences.digest_freq` is preserved verbatim (write-router keys on it); the ten new ids use the `admin.<topic>.<n>` namespace. `questionBank.ts` now imports `ADMIN_BANK` (inline copy removed) and registers `admin:10` in `BANK_SIZE_TARGETS`. CI wiring: `cloudflare-worker/scripts/gen-question-ids.mjs` `BANK_FILES += admin`; `scripts/check-advisor-bank-drift.mjs` `BANK_FILES`/`SIZE_TARGETS += admin`; manifest regenerated. `cloudflare-worker/src/services/advisor/no_write_allowlist.json` gains `^admin\.` and `^dyn\.reflect\.` patterns. `writeRouter.ts` routes non-digest `admin.*` ids through `mergeUserExtras` (was a noop), so admin answers persist into `users.advisor_extras_json` instead of being silently dropped.
- **BLOCK-ADV-07 — dynamic reflection fallback so the advisor never runs dry.** `stateMachine.ts` adds a pure `generateDynamicQuestion(persona, answered)` that synthesizes a `dyn.reflect.N` question (persona-aware prompt pool, `section:'REFLECT'`, `importance:'low'`, `skip_allowed:true`, `input_kind:'long'`); `nextDynamicIndex(answered)` derives `N` as `max(answered dyn index)+1`. `nextTurn` falls back to it ONLY when the ranked bank is exhausted (`pickNext` → null) AND `ctx.persona` is present AND `ctx.dynamicFallback !== false`; `NextTurnContext` gained `persona?` + `dynamicFallback?`. `routes/advisor.ts` `/turn` passes `persona: personaFor(user)` (deliberately NOT `/answer` or `/skip`, which keep their legacy "complete" semantics by omitting persona). `questionBank.ts::questionById` synthesizes a generic `Question` for ids matching the strict `DYNAMIC_ID_RE = /^dyn\.reflect\.\d{1,4}$/` ONLY. `writeRouter.ts::routeAnswer` gains an explicit `dyn.*` branch at the very top (before the `questionById` unknown-id check) that routes to `mergeUserExtras` and returns `saved`. `/answer` + `/skip` carry an `isDynamic` bypass on the eligibility gate so a synthesized question id is never rejected as "not in bank".
- **BLOCK-ADV-02 — repeat-question regression test.** `cloudflare-worker/test/advisor.stateMachine.test.ts` adds a guard: a question `X` with a statically-authored `followups:['Y']` is served first; after `X` is answered (and even when two write rows exist for it, the cross-conversation answered set dedupes to one via a `Set`), `X` is never re-served, its peer `Y` is served next, and `X.followups` is preserved. Plus unit coverage for `nextDynamicIndex`, `generateDynamicQuestion` (persona pools + unknown-persona `?? ` fallback + prompt rotation), and the three `nextTurn` dynamic-fallback branches (persona→reflection; `dynamicFallback:false`→null; no-persona→null). State-machine branch coverage stays ≥80% (`scripts/check-statemachine-coverage.mjs`, wired into `npm run test:drift`).
- **NICE-ADV-04 — advisor AI-gateway slug is verified + an operator step.** Confirmed `services/aiRouter.ts::gatewayOptionFor` applies `CF_AI_GATEWAY_SLUG_ADVISOR` (default behavior: only when set) to the `advisor_turn` + `advisor_explain` task classes ONLY, and returns `undefined` (calls fall through un-gatewayed, no breakage) when the env var is missing. Operator step: create the gateway in the Cloudflare dashboard (Workers AI → AI Gateway) with slug `advisor-ongoing`, then set `CF_AI_GATEWAY_SLUG_ADVISOR=advisor-ongoing` so advisor traffic gets its own analytics/cache/rate-limit namespace separate from the onboarding chatbot.
- **NICE-ADV-03 — `/explain` provider SSE wire verified.** `routes/advisor.ts` `/explain` emits the documented `provider` → `delta` → `done` sequence: `provider {model, provider:'workers-ai', fallback_used, cached}`, then a single buffered `delta {text}`, then `done {leaked}`. The React UI renders a "(fallback)" badge off `provider.fallback_used`.
- **NICE-ADV-05 — `/explain` TALC (think-act-leak-check) posture verified.** `/explain` is Workers-AI-only (`provider:'workers-ai'`, no Anthropic in prod) and buffers the full model output so `stripVerbatimLeak` runs over the complete text BEFORE any `delta` crosses the wire — on a leak it swaps in a templated refusal and sets `done.leaked=true`, so leaked text can never stream out token-by-token.
- **NICE-ADV-06 — daily-cap-only burst posture (intentional).** Advisor turns are governed by a per-user daily TURN-COUNT cap in `services/advisor/aiClient.ts` (KV bucket `ai_spend:advisor_turns:{user_id}:{yyyy-mm-dd}`, default 100/day, env `WORKERS_AI_ADVISOR_BUDGET_USD_DAY` with legacy `WORKERS_AI_ADVISOR_BUDGET_PER_DAY` alias), hard-blocking at 100% with refusal `budget_advisor_turns_day` → HTTP 429; the shared `aiRouter` $-budget cap (`budget_user_day` → 429) is the second line. There is deliberately NO per-minute burst limiter on advisor turns — the daily cap is the sole throttle.

## Task #11 (II) — Payments refund + checkout

Adds an admin-only Stripe refund endpoint behind step-up; confirms the checkout → tier-flip path and scopes the live test-mode round-trip as an operator step.

- **BLOCK-PAY-02 — `POST /api/admin/billing/refund`.** New route `cloudflare-worker/src/routes/admin_billing.ts` issues a Stripe refund via the v1 `/refunds` API (reusing `billing.ts::stripeCall` — no Stripe SDK in the Worker) and writes an `admin_audit_log` row (`report_type='billing'`, `action='billing_refund'`) capturing the refund id, status, amount, currency, target charge/PI, and free-text reason. Body takes EXACTLY ONE of `payment_intent` / `charge`, an optional positive-integer `amount` (minor units → partial refund), an optional free-text `reason` (also stamped into Stripe `metadata[admin_reason]`; only mapped to Stripe's closed `reason` enum when it matches `duplicate|fraudulent|requested_by_customer`), and an optional `target_user_id` for audit linkage. Gated `requireFactor('totp')` + `requireStepUp` + `requireAdmin` (mirrors impersonation / billing-checkout step-up). Mounted at `/api/admin/billing` in `index.ts` BEFORE the catch-all `/api/admin` (same precedence trick as `/api/admin/telegram|x|news`), inside the existing `requireCfAccess()` perimeter, and added to `COOL_OFF_PREFIXES` so a freshly-recovered admin account can't move money during the recovery cool-off. Stripe failures surface the upstream status + message (`stripe_error` / `stripe_not_configured` → 400/502/503) instead of a generic 500; the audit insert is best-effort-with-loud-log so a logging hiccup never implies the money didn't move. `ensureAdminAuditLogTable` is now exported from `routes/admin.ts` for reuse (single source of truth for the table schema). **Idempotency** — `stripeCall` gained an optional `{idempotencyKey}` (sends Stripe's `Idempotency-Key` header; existing callers unaffected); the refund route prefers a caller-supplied `idempotency_key` and otherwise derives a deterministic `refund:{admin}:{pi|charge}:{amount|full}` key so an accidental double-click/retry collapses to ONE refund (a deliberate second identical refund can pass an explicit key).
- **NICE-PAY-01 — full test-mode checkout is an operator step.** The checkout → tier-flip path is wired: `POST /api/billing/tier/checkout` mints a Stripe Checkout session with `metadata.kind='tier'`, and `handleStripeEvent`'s `checkout.session.completed` branch flips `users.subscription_tier` + `subscription_status='active'`. A live test-mode round-trip (real `STRIPE_SECRET_KEY` test keys + `STRIPE_PRICE_*` + webhook delivery to the deployed Worker) can't run in this env (dev is FastAPI with no Stripe rails), so it's captured as an operator verification. Receipt emails are Stripe-dashboard-configured (test mode → Customer emails → Successful payments); the app does not send its own checkout receipt. The unused `billing_refund_issued` email template (no callers) is left as a proposed follow-up to wire refund notifications.

## Task #10 (IH) — Stripe/integration data pulls

Mostly a verification track; one real bug fixed. The Stripe MRR pull was wired end-to-end but silently dropped because the project resolver hit a non-existent column.

- **BLOCK-INT-02 — Stripe MRR now actually lands in financials.** `integrations/providers/stripe.ts::resolveProjectId` queried `SELECT id FROM projects WHERE owner_user_id = ?`, but `projects` has no `owner_user_id` column (it is keyed by `founder_id` — see `schema.sql`; migration `034` never added that column). The query threw `no such column`, was swallowed by a bare `catch {}`, and `resolveProjectId` returned `null`, so `sync()`/cron/connect-webhook all skipped `projectMetricsToProject` — the `metrics_snapshots` row (`source='stripe'`) and the `financial_models.assumptions_json` upsert (`_sources.mrr='stripe'` + `_stripe_synced_at`) never wrote. Fixed by mapping `integrations.user_id → users.founder_id → projects.founder_id` (the same join `routes/projects.ts` uses), auto-resolving only when the founder owns exactly one live (`deleted_at IS NULL`) project. The bare `catch` now logs `[stripe] resolveProjectId:` so a real DB error can never hide a broken pull again. The explicit-`config_json.project_id` path and the manual `import-stripe` endpoint (which pass `projectId` directly) were unaffected and keep working.
- **NICE-INT-03 — LinkedIn redirect host confirmed correct (no change).** `routes/linkedin.ts::linkedinRedirectUri` already ignores any stale `*.workers.dev` override in production and falls back to `callbackBase(env)` (→ `app.axal.vc` until provider dashboards flip to `axal.vc`, then `axal.vc`). The OAuth start + token-exchange + callback all derive `redirect_uri` from the same helper, so the consent screen never shows `workers.dev`.
- **NICE-INT-04 — all four tiles confirmed present (no change).** `integrations/registry.ts` REGISTRY already carries HubSpot (`live`), Carta (`coming_soon`), Affinity (`coming_soon`), and DocuSign (`coming_soon`); `IntegrationsPage.jsx` renders `coming_soon`/no-impl providers in its "Coming soon" section, so every audited tile shows.
- **NICE-INT-01 — Stripe Connect OAuth round-trip is an operator step.** A live round-trip needs real `STRIPE_CONNECT_CLIENT_ID` + `STRIPE_SECRET_KEY` Worker secrets and the deployed Worker (dev runs FastAPI, which has no Stripe Connect path). Captured as a follow-up/operator verification rather than agent-runnable.

## Task #9 (IG) — Admin transcripts + ID backfill

Verification track — no prod-contract or frontend behavior change. Both admin transcript surfaces and the public-ID backfill path were already shipped (Tasks #1 DB / #11 / #34); this task confirms the wiring end-to-end and hands off the operator-run prod count.

- **NICE-ADM-02 admin transcript tabs — confirmed wired.** The admin user-detail drawer (`frontend/src/pages/AdminPage.jsx`, opened from the Users table via `setOpenUser`) renders both an **Onboarding** tab and an **Ongoing Conversation** (advisor) tab. Onboarding fetches `api.adminUserOnboardingConversation` → Worker `GET /api/admin/users/:user_id/conversations/onboarding`. Ongoing fetches the list `api.adminUserAdvisorConversations` → `GET …/conversations/advisor` (left-rail with search + date filters), per-conversation drilldown `api.adminUserAdvisorConversation` → `GET …/conversations/advisor/:id`, and the "Download CSV" button calls the message-level export `api.adminUserAdvisorTranscriptExport` → `POST …/conversations/advisor/export`. (The conversation-list CSV helper `api.adminUserAdvisorConversationsCsvUrl` → `GET …/conversations/advisor?format=csv` exists for completeness but is currently unused by the UI.) Every read is audited (`auditConversationView`) and notifies the viewed user (`notifyTranscriptViewed`). Both routes live inside the `/api/admin/*` CF-Access perimeter and gate on `requireAdmin`. `admin_advisor_audit.ts` (`/api/admin/advisor-audit`) is the separate guardrail-audit reader and is intentionally NOT what these tabs consume.
- **NICE-ADM-01 public-ID backfill — operator-run on prod D1.** The idempotent backfill endpoint already exists: `POST /api/admin/maintenance/public-ids/backfill?limit=N` (`routes/admin.ts` → `services/publicIds.ts::backfillPublicIds`, walks `created_at ASC` and assigns `AXF-`/`AXP-` ids; safe to re-run until counts return zero). `esign.ts::createAndSendEnvelope` also auto-assigns at send-time so legal merge fields never expand empty. The main agent cannot reach prod Cloudflare D1 (the database-skill prod replica is Replit-managed Postgres, a different system), so the read-only count is operator-run.

Operator runbook (NICE-ADM-01 — run in Shell, not the agent):
- Use Node 22 for wrangler first: `export PATH=/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin:$PATH`
- Read-only count (predicate mirrors `backfillPublicIds`):
  `wrangler d1 execute studioos-db --remote --env production --command="SELECT (SELECT COUNT(*) FROM users WHERE founder_public_id IS NULL AND (role='founder' OR founder_id IS NOT NULL)) AS founders_missing, (SELECT COUNT(*) FROM users WHERE partner_public_id IS NULL AND (role='partner' OR partner_id IS NOT NULL)) AS partners_missing;"`
- If either count > 0, run the backfill (admin JWT): `POST https://axal.vc/api/admin/maintenance/public-ids/backfill?limit=1000`, re-invoke until `{founders_assigned:0, partners_assigned:0}`, then re-run the count to confirm both are zero. The endpoint writes an `admin_public_ids_backfill` row to `activity_logs`.

## Task #8 (IF) — Mount missing dev API routes

Dev-FastAPI-only parity fix; no prod change (the Cloudflare Worker on D1 already serves both routes). Keeps the error dashboard honest in local dev.

- **`GET /api/pipeline/active`** — `backend/app/api/routes/pipeline_votes.py`: added a dev mirror of the Worker's `pipeline.get('/active')` (`cloudflare-worker/src/routes/pipeline.ts`). Returns the same enriched per-deal shape (`pipeline_stage`, `task_counts`, `latest_metrics`, `latest_gate`, `score`). Role visibility mirrors the Worker (admins/partners/investors see all non-rejected deals; founders see only their own). D1-only enrichment tables (`project_stages`/`mvp_tasks`/`metrics_snapshots`/`decision_gates`) aren't modeled in dev, so those fields return safe empty defaults; `score` pulls the latest `score_snapshots.total_score`. Previously 404'd (only `pipeline_votes.py` was mounted under `/pipeline`).
- **`GET /api/legalcap/capital/lp-portal`** — `backend/app/api/routes/legalcap.py` (new dev shim) + mount in `backend/app/main.py`. Re-exposes the existing `capital.py::lp_portal` handler verbatim at the canonical Worker path the dashboard probes (the frontend itself already calls `/api/capital/lp-portal`). Previously 404'd (no `legalcap` prefix mounted in dev).

## Task #7 (IE) — Ops observability surfaces

- **Traces enabled** — `wrangler.toml` `[observability.traces].enabled` flipped from `false` to `true` so Cloudflare Workers trace data is collected.
- **DLQ admin panel** — `cloudflare-worker/src/routes/infra.ts`: `GET /api/infra/dlq` now supports pagination (`limit`, `offset`), `job_type` filtering, and `source` filtering (`d1` | `cf`). Added `POST /api/infra/dlq/:id/retry` (re-enqueues with fresh `idempotency_key` + removes from both D1 and CF-mirror tables) and `DELETE /api/infra/dlq/:id` (discard from both tables). Added `cron_run_history` table to `ensureInfraSchema()` (lazy bootstrap). Added `GET /api/infra/cron-history` (paginated + trigger filter, returns `triggers` metadata with `last_run_at` and `next_run_at`). Added `POST /api/infra/cron-log` (now `requireAdmin` so perimeter-only users cannot write synthetic audit rows). Added `GET /api/infra/ws-check` (real authenticated WS upgrade probes: DO internal `/ws` with `x-auth-*` headers + synthetic JWT route probe; returns `pipeline`/`onboarding`/`pipeline_route`/`onboarding_route` checks).
- **CF Queue DLQ mirroring** — `cloudflare-worker/src/queue-consumer.ts`: added `dlqConsumer` that writes CF Queue exhausted messages into `cf_dlq_mirror` D1 table. `cloudflare-worker/src/index.ts`: `scheduled()` handler routes DLQ batches to `dlqConsumer`. `cloudflare-worker/wrangler.toml`: added `[[queues.dlq_consumers]]` bindings for top-level, production, and preview environments. `cloudflare-worker/src/routes/infra.ts`: `GET /api/infra/dlq` and retry/delete actions now UNION both `dead_letter_queue` (legacy D1) and `cf_dlq_mirror` (CF Queue mirror) with `source` labels.
- **Cron next-run computation** — `cloudflare-worker/src/routes/infra.ts`: `nextCronRun()` computes the next scheduled time from 5-field cron expressions (handles `*`, `*/step`, comma lists). `GET /api/infra/cron-history` returns `triggers` array with `name`, `expr`, `last_run_at`, `next_run_at` for each configured trigger.
- **Cron run logging** — `cloudflare-worker/src/index.ts`: `scheduled()` handler now records every run into `cron_run_history` with `trigger_name='scheduled'`, `status`, `summary`, and `error` in a `finally` block so partial failures are still captured.
- **Frontend tabs** — `MonitoringPage.jsx`: added `dlq` and `cron` tabs. New `DlqTab.jsx` (paginated DLQ list with retry/discard buttons + `job_type` and `source` filters + source badge). New `CronTab.jsx` (paginated cron history table + triggers schedule grid + WS spot-check panel). `api.js`: added `infraDLQ(params)`, `infraRetryDLQ(id)`, `infraDeleteDLQ(id)`, `infraCronHistory(params)`, `infraWSCheck()`.
- Route mount precedence: `/api/infra` already mounted before `/api/admin` catch-all in `index.ts` — no change needed.

## Task #6 (ID) — Publish public marketing pages

Decision recorded: the **SPA is the public marketing surface for app-owned routes**; the GitHub Pages Jekyll site keeps the apex root (`axal.vc/`) and every path the worker doesn't claim. New top-level public pages are published by adding the SPA route plus TWO path-scoped `[[env.production.routes]]` patterns (exact + `/*`, `zone_name="axal.vc"`).

- **BLOCK-MKT-01/06 front-page copy** — dropped the stale "Three lanes" tagline from `frontend/index.html` (`<title>`, `og:description`, `twitter:description`) and the "Five lanes —" prefix from the `LandingPage.jsx` hero subtitle. The named lanes and the "Five lanes into the network" section heading stay (accurate). No "Three lanes" string remains in the served HTML/meta.
- **BLOCK-MKT-02..05 publish routes** — `/spinout-lab`, `/about`, `/insights`, `/directory` now resolve on the apex. Added 5×2 apex route patterns in `wrangler.toml` (the four named routes **plus `/contact`** — `cloudflare-worker/src/index.ts`'s edge 301 unconditionally bounces every non-`/api` page on `app.axal.vc` → `axal.vc`, so an apex route is the only way an unauthenticated hard-load reaches the SPA; there is no `app.axal.vc` fallback). SPA: added `/about` → `TeamPage` (Guillaume's card) and redirected `/team` → `/about`; added `/insights` → new `InsightsPage`. `PublicNav` + `PublicFooter` link to About + Insights; footer About now points at `/about`.
- **/insights index (Option B)** — new self-contained index `frontend/src/pages/insights/InsightsPage.jsx` lists published, non-internal publications via a new public list endpoint `GET /api/market-intel-public/publications` (`routes/market_intel_public.ts`, outside the CF Access perimeter, strict card-only shape: slug/title/subtitle/section/published_at, `status='published' AND audience != 'internal'`). Cards link to `/insights/public/:slug`, covered by the `/insights/*` apex pattern. `publications.publicList()` added to `frontend/src/lib/api.js`.
- **Anonymous reachability — `isPublicPath` allowlist** — `frontend/src/lib/api.js`'s 401 interceptor force-redirects to `/login` on any non-public 401, suppressed only for an allowlist of public paths. `/about`, `/insights` (bare) and `/contact` were missing (peers `/spinout-lab`/`/directory`/`/roadmap` were already present), so a provider-level 401 for a signed-out visitor bounced these public pages to `/login`. Added `/about` + `/contact` (exact) and broadened `/insights/public/` → `/insights` (covers the new index + existing slug pages). Verified in dev preview: all three render for signed-out visitors — the dev FastAPI lacks `/public/team` and the publications endpoint, so About degrades to the empty card and Insights shows its explicit error state instead of redirecting.
- **NICE-MKT-07 contact round-trip** — verified `routes/contact.ts` creates a GitHub Issue via `GITHUB_ISSUES_TOKEN` (Worker secret) + `GITHUB_REPO_OWNER`/`GITHUB_REPO_NAME` (wrangler `[vars]`), with an explicit 503 `github_token_missing` when the token is unset. Added `cloudflare-worker/test/contact.test.ts` (wired into `test:drift`) covering the honeypot 200 ok-path, the 503 token-missing path, and 400 on missing fields. Live end-to-end create cannot run from CI (the secret is prod-only).

Operator follow-ups (not in code):
- Apex routes only take effect on `npm run deploy`. After deploy, hit `https://axal.vc/{spinout-lab,about,insights,directory,contact}` in a clean session and confirm a 200 SPA render (not a Jekyll 404).
- If Jekyll currently serves exactly `/about` or `/insights`, the worker now shadows it — intended consequence of the origin decision.
- `/team`, `/articles`, `/partners`, `/terms`, `/privacy` remain apex-unrouted (reachable only via in-SPA nav once a routed page is loaded); route them the same way if public hard-load is needed.
- Contact form needs `GITHUB_ISSUES_TOKEN` on the prod Worker (`wrangler secret put GITHUB_ISSUES_TOKEN --env production`); until then `/api/contact` returns 503. Post-deploy: submit one test message on `axal.vc/contact`, confirm the GitHub Issue, then close it.

## Task #5 (IC) — Empty/error QA hardening + 5-ICP walkthrough

QA closure for empty/error states plus a sign-up/core walkthrough across all five ICPs. Net new code is Worker test coverage + dev-only FastAPI parity fixes; the prod Worker contracts were unchanged (locked in by the new tests). Browser walkthrough run via the Playwright runner (founder landing + onboarding/Settings tab pass, light + dark); the remaining ICPs were verified at the API + render-path level after the dev backend was found to 404 on routes the SPA expects (fixes below). Further Playwright runs were capped by the test runner's per-session iteration limit.

- **NICE-500-03 wellbeing authenticated 201** — `cloudflare-worker/test/wellbeing_route.test.mjs`: added cases driving the real `wellbeing.post('/checkins')` closure end-to-end — founder → 201 passthrough, investor → 403 (investor gate) — on top of the existing pure-handler `submitCanonicalCheckin` assertion. Green (11/11).
- **NICE-500-04 projects 404-for-missing** — `cloudflare-worker/test/projects.test.mjs`: sliced the real `projects.get('/:id')` handler and asserted 404 `{error:'Project not found'}` for a missing id with a positive-control 200. Green (7/7).
- **NICE-SET-01 Settings walkthrough** — Settings tabs walked save/reload in light + dark; onboarding/Settings tab render confirmed in-browser both themes. Two dev-backend bugs surfaced during the sweep are fixed below.
- **BLOCK-WALKTHROUGH-01 5-ICP walkthrough** — founder/investor/operating-partner/mentor/admin landing flows exercised. All five render without crashing. Dev-only 404/500 gaps that broke the dev walkthrough were fixed for parity with the Worker. Partner `/capital/*` 403 (matches the Worker's `canViewLpData = admin|investor`) and mentor no-profile 400/404 are correct, gracefully-handled empty states (`PartnerPortal.jsx`/`OfficeHoursPage.jsx` `catch` blocks render empty/draft state), not bugs.

Dev FastAPI parity fixes (dev-only; FastAPI is never deployed → no user-facing changelog line and no drift impact, since `check-api-drift.mjs` compares the SPA against the Worker only):
- `backend/app/api/routes/personas.py` — fixed a 500 by reading from the correct `user_persona_extras` table.
- `backend/app/api/routes/onboarding.py` — added the onboarding checklist endpoints the SPA calls (were 404).
- `backend/app/main.py` — added `GET /api/dashboard` + `POST /api/dashboard/refresh-scores`, mirroring the Worker dashboard shape (zeroed financials, real projects query for proprietary deal flow), so admin/investor `/dashboard` no longer 404s in dev.
- `backend/app/api/routes/kyc.py` (new, mounted in `main.py`) — `GET /api/kyc/status` (always `not_started`) + `POST /api/kyc/submit` (explicit 400 "not available in the dev environment") so investor `/kyc` no longer 404s in dev.

## Task #4 (IB) — Auth blockers: magic-link, passkeys, step-up, sign-out-everywhere

Additive/reversible auth-gap closure on the prod Worker. Re-audit deferred live prod re-test to operator (per architect plan); empty-state routes were code-inspected instead.

- **Schema** — `cloudflare-worker/sql/migrations/083_auth_blockers.sql` (additive, `IF NOT EXISTS`): `magic_link_tokens`, `passkeys`, `webauthn_challenges` tables + `user_sessions` columns `last_step_up_at`, `step_up_due_at`, `assurance_level`. `cloudflare-worker/src/services/authBlockersSchema.ts::ensureAuthBlockersSchema(env)` lazy bootstrap (mirrors `ensureTelegramSchema`), so the tables/columns auto-create on first hit regardless of migration apply.
- **BLOCK-AUTH-01 magic-link** — `routes/auth.ts`: `POST /api/auth/magic/start` (constant 202, rate-limited, 15-min single-use SHA-256-hashed token) + `GET /api/auth/magic/verify` (claims token, find-or-creates the user, mints a LOWER-assurance `factor='magic'` / `assurance_level='email_only'` session with a 7-day **session-scoped** `step_up_due_at`, sets cookies + redirects). Uses `user_sessions.step_up_due_at` — deliberately NOT the prod-broken `users.recovery_step_up_due_at` (migration 060 partial). `auth.ts::getCurrentUser` reads the session-scoped deadline first and auto-relocks past it (additive; recovery-column fallback retained). `LoginPage.jsx` "Email me a sign-in link" button.
- **BLOCK-AUTH-02 passkeys** — `@simplewebauthn/server@13` + `@simplewebauthn/browser@13`. `util/webauthn.ts` (rpID=`axal.vc`, expected origins incl. `axal.vc`+`app.axal.vc`+localhost in non-prod). `routes/auth_passkey.ts` mounted `/api/auth/passkey`: `register-options`/`register-verify`, `auth-options`/`auth-verify` (assertion mints FULL-assurance `factor='passkey'` session), `list`, `DELETE /:id`. Challenges persisted single-use (~5min) in `webauthn_challenges`, atomically claimed. `LoginPage.jsx` "Sign in with a passkey" button + `SettingsPage.jsx` PasskeyPanel (add/list/remove) in the Security tab.
- **BLOCK-AUTH-03 step-up** — `auth.ts::requireStepUp(c, ttl=15)` passes when the session `factor in (totp,passkey)` AND recent (`created_at`|`last_step_up_at` within ttl), else throws `step_up_required` → 403 `{code:'step_up_required', ttl}`. `routes/auth.ts`: `POST /api/auth/step-up {totp_code}` stamps `last_step_up_at`. Applied at existing `requireFactor` sites (billing, KYC approve/reject, admin). SPA: global 403 `step_up_required` interceptor in `lib/api.js` → `StepUpModal.jsx` (TOTP prompt) → retry; modal mounted in `App.jsx`.
- **NICE-AUTH-04** — `auth.ts::bumpJwtMinIat` shared helper; `POST /api/auth/sign-out-everywhere` alias (bumps `users.jwt_min_iat`, writes `sessions_revoked_all` activity); existing `/api/settings/sessions/revoke-all` retained.
- **NICE-500-01/02/07 re-audit** — code-inspected the previously-401 empty-state routes under auth: `GET /api/calendar/events` (200 `{items:[]}`), `/api/projects` (200 `[]`), `/api/capital/portfolio` (200 zeroed `fund_metrics`), `/api/progress/metrics/:projectId` (200 `{items:[],snapshots:[]}` when project exists; 404 if not), `/api/financials/:id` (200 hydrated default model), `POST /api/advisor/explain` (auth-gated SSE, 400 on missing `topic`). Confirmed `/api/pipeline/active` and `/api/legalcap/capital/lp-portal` are mounted and return 200 `[]` (prior 404s were stale). Live prod re-test deferred to operator.
- Worker typecheck + `npm run test:drift` pass.

## Task #8 — Article reader: editorial redesign
- `frontend/src/pages/ArticleReaderPage.jsx` — full rewrite into a long-form editorial layout: `useReadingProgress` hook (fixed 2px violet progress bar, z-60, below nav); `useTOC(bodyRef)` hook scans rendered `h2/h3`, auto-injects slug `id`s for deep-linking, and tracks the active heading via `IntersectionObserver` (`-10%/-70%` rootMargin). Structured hero (`<header>`): category badge (uppercased, bordered), clamped H1 (`clamp(2rem,5vw,3.25rem)`), light-weight subtitle, metadata row (author + optional `author_website` link, role chip, publish date, read time), inline compact `ShareBar`. Reading column capped `max-w-[68ch]`, centred. Desktop sticky TOC `<aside>` in a `xl:grid-cols-[1fr_240px]` two-column grid (`sticky top-24`, active item highlighted, `aria-current`), renders only with ≥2 headings; mobile `<details>` TOC disclosure below the hero. Cover image in `<figure>`, tags as bordered pills, bottom `ShareBar`, refreshed recommended-reading grid (flat tinted cards, no gradient). All new elements carry `dark:` variants and `aria-label`s on icon-only links.
- `frontend/src/index.css` — added scoped `.article-prose` overrides driven by app CSS-vars (`--app-text`/`--app-surface-2`/`--app-border`/`--color-brand`): 1.125rem base / 1.8 line-height, paragraph spacing, H2 (3em top + hairline rule) / H3 (2em top) contrast, styled blockquotes (left accent bar), callout/aside boxes, code/pre, tables, figures/figcaptions, hr, links. Added `details[open] .details-chevron` rotation.

## Task #6 — Brand kit across all 13 pitch deck templates
- `frontend/src/decks/templates/index.ts` — added `brandTheme` field (`'full' | 'accent_only' | 'off'`) to all 13 `TemplateMeta` entries with correct tier mapping.
- `cloudflare-worker/src/services/decks/methods.ts` — mirrored `brandTheme` on all 13 backend specs.
- `cloudflare-worker/src/services/decks/branding.ts` — generalised `applyBrandKitToSlides()` to inject `brandkit_*` paragraph fields (logo, accent, bg, ink, fonts, theme) on the cover slide based on tier: `full` (full palette override), `accent_only` (accent only, neutral bg), `off` (logo only, no palette).
- `cloudflare-worker/src/routes/decks.ts` — wired `applyBrandKitToSlides()` into three generation endpoints (POST /generate, /apply-method, /:id/autofill).
- `frontend/src/decks/DeckBase.tsx` — added `BrandContext` + `BrandProvider` + `useBrandContext()` for reactive brand-value propagation; existing `useBrandKit()` / `brandAccent()` / `brandPalette()` / `brandFont()` helpers unchanged.
- `frontend/src/decks/templates/*.tsx` — all 13 deck components now wrapped in `<BrandProvider>` so child slides can read `brandkit_*` values via context. Accent-only templates (`yc_seed`, `kawasaki`, `minimal_seed`, `investor_appendix`, `demo_day`, `axal_spinout_demoday`) replace hard-coded accent constants with `useBrandContext().accent`. Full-palette templates (`narrative_brand`, `one_pager_teaser`, `partnership_bd`, `sales_commercial`) override bg/ink/accent/font. Off templates (`sequoia_classic`, `series_a_growth`, `series_b_diligence`) skip palette but still receive context for logo.
- `frontend/src/decks/templates/yc_seed.tsx` — `Frame`, `Logo`, `HeroOrb`, `SectionEyebrow` now use brand accent instead of `ORANGE` constant. Regression fix: `HeroOrb`'s gradient called `mix()` which is not exported from `DeckBase`; added a local `normHex/hexToRgb/toHex2/rgbToHex/mix` helper block (mirrors `axal_spinout_demoday_app.tsx`) — was throwing `ReferenceError: mix is not defined` at SSR, caught only by `test:drift`.
- `frontend/src/decks/templates/one_pager_teaser.tsx` — full-palette override: bg, ink, font, accent from brand context.
- Worker typecheck and frontend build both pass.

## Task #5 — Landing page template library

- **`cloudflare-worker/sql/migrations/082_landing_templates.sql`** — additive migration adding `template`, `hero_media_url`, `product_screenshot_url` to `landing_pages`.
- **`cloudflare-worker/src/services/landingTemplates.ts`** — new module. Five complete server-rendered templates (`minimal`, `bold-hero`, `video-first`, `editorial`, `product-mock`) with shared helpers (`escapeHtml`, `audienceTabMarkup`, `waitlistScript`, `svgLogo`, `FontStack`). `renderLandingTemplate()` dispatcher selects the template from the row key and injects the brand kit + audience data into the HTML.
- **`cloudflare-worker/src/routes/brand.ts`** —
  - `GET /brand/templates` returns the five-template registry with metadata (label, description, usesHero, usesProduct) for the UI picker.
  - `PUT /landing/by-project/:pid` upsert now accepts `template`, `hero_media_url`, `product_screenshot_url`; defaults `template` to `"minimal"` for backwards compatibility.
  - `rowToLanding()` includes the three new fields.
  - `buildLandingPageHtml()` replaced with `renderLandingTemplate(row, nonce)` dispatch; five templates reuse the same audience tab + waitlist form + CSP nonce logic.
- **`cloudflare-worker/src/services/landingPageSchema.ts`** — lazy bootstrap updated with `template`, `hero_media_url`, `product_screenshot_url` ALTERs.
- **`backend/app/api/routes/brand.py`** — mirrored schema bootstrap (`ensureLandingTables`), `LandingUpsert` payload, upsert SQL, `rowToLanding` fields, and `GET /brand/templates` endpoint.
- **`backend/app/models/migrations.py`** — `ensure_brand_landing_columns()` extended with `template`, `hero_media_url`, `product_screenshot_url` columns.
- **`frontend/src/lib/api.js`** — added `brandListTemplates` helper.
- **`frontend/src/pages/BrandBuilderPage.jsx`** —
  - Added template picker UI in Step 3 (Layout card) with "Change" toggle that opens a list of 5 templates; selecting updates `draft.template`.
  - Conditional hero-media URL input shows when template `usesHero` is true.
  - Conditional product-screenshot URL input shows when template `usesProduct` is true.
  - Draft state and `brandGetLanding` load path now include `template`, `hero_media_url`, `product_screenshot_url`.
- **Code review fixes** (post-review):
  - All five templates now pass full brand-kit (`color`, `secondary`, `accent`) to `tabMarkup()`; badges, ok/error states, and footer colors use brand tokens instead of hard-coded `#059669`, `#dc2626`, `#94a3b8`.
  - Border colors in inputs and screenshot containers use `${inkColor}22` / `${secondary}` instead of `#e5e7eb`.
  - Brand Builder template picker refactored into a standalone "Step 3" with card previews (thumbnail placeholder, selection checkmark) instead of an embedded inline subsection under Step 4.
  - `sanitizeUrl()` / `_sanitize_url()` applied to `logo_url`, `hero_media_url`, and `product_screenshot_url` at save time in both Worker and FastAPI; rejects `javascript:`, `data:`, and non-https schemes.

## Task #4 — Waitlist audience segmentation + private preview URL

- **`cloudflare-worker/sql/migrations/081_waitlist_audience.sql`** — additive migration adding `audience` to `waitlist_signups`, nine `audience_*` copy columns + `preview_token` to `landing_pages`, plus indexes.
- **`cloudflare-worker/src/services/landingPageSchema.ts`** — lazy bootstrap updated with Task #4 ALTERs (audience columns + preview_token + waitlist audience index).
- **`cloudflare-worker/src/routes/brand.ts`** —
  - `PUT /landing/by-project/:pid` now accepts and persists all nine `audience_*` fields; auto-generates a 16-byte hex `preview_token` on first insert.
  - `GET /landing/by-project/:pid/waitlist` now returns `audience` and supports `?audience=` filter.
  - `POST /landing/:slug/waitlist` now reads and validates `body.audience`.
  - `GET /landing/by-project/:pid/preview-url` added.
  - `renderLandingHtml()` refactored into `buildLandingPageHtml()` shared with `renderLandingPreview()`; HTML now renders three audience tabs (Customer/Partner/Investor) with segmented copy and sends the selected audience back to the waitlist API.
  - `renderLandingPreview()` added — renders unpublished rows by `preview_token`, emits `noindex`.
- **`cloudflare-worker/src/index.ts`** — added `GET /landing/preview/:token` mount alongside existing `/landing/:slug`.
- **`backend/app/api/routes/brand.py`** — mirrored all worker changes (schema bootstrap, `LandingUpsert` + `WaitlistPayload` payloads, audience persistence, preview token generation, `preview-url` route, waitlist list filter).
- **`frontend/src/lib/api.js`** — `brandListWaitlist` now forwards `?audience=` filter; added `brandGetPreviewUrl`.
- **`frontend/src/pages/BrandBuilderPage.jsx`** —
  - Added "Audience copy" section (Step 3b) with three tabs (Customer/Partner/Investor), each with headline/body/CTA fields seeded from defaults.
  - Share section (Step 4) now shows preview URL alongside public URL with a "Private — share for feedback only" label.
  - Waitlist preview now includes an audience filter dropdown and an audience badge next to each email.

## Task #3 — Brand Kit Expansion: logo upload, AI palette, tagline iterator

- **`cloudflare-worker/sql/migrations/080_brand_kit_expansion.sql`** — additive migration
  adding `palette_secondary`, `palette_accent`, `logo_asset_id` to `landing_pages`.
- **`cloudflare-worker/src/services/landingPageSchema.ts`** — lazy bootstrap updated with
  3 new ALTERs so the columns self-heal on prod even if the migration is unapplied.
- **`cloudflare-worker/src/services/aiRouter.ts`** — added `brand_palette` and
  `brand_taglines` to `TaskClass` enum + `ROUTE` map (MID_LLAMA → SMALL_LLAMA fallback,
  mirroring `brand_suggest`). Workers-AI only; deterministic heuristic fallback lives in
  the route layer.
- **`cloudflare-worker/src/routes/brand.ts`** — 3 new POST routes:
  - `/logo/upload` — multipart/FormData, ≤512 KB PNG/JPG/SVG; stores in R2 when `FILES` binding
    is present, else inline base64 data URL. SVG sanitised via `sanitizeSvg()` before storage.
  - `/palette/suggest` — AI palette (5 colours) or deterministic 12-bank heuristic keyed by
    description hash; WCAG AA contrast ratio warnings (text-on-background ≥4.5:1,
    text-on-primary ≥3:1, primary↔background ≥3:1).
  - `/tagline/suggest` — AI tagline iterator (6 candidates) or deterministic template bank
    keyed by tone (bold/warm/technical/playful/authoritative); requires audience + tone +
    market_angle.
  - PUT `/landing/by-project/:pid` updated to persist `palette_secondary`, `palette_accent`,
    `logo_asset_id` alongside existing columns.
  - `rowToLanding` now includes `logo_asset_id`, `palette_secondary`, `palette_accent`.
- **`backend/app/api/routes/brand.py`** — dev FastAPI mirror of all 3 new routes:
  `logo_upload` (inline only), `palette_suggest` (heuristic + WCAG warnings),
  `tagline_suggest` (heuristic templates). `LandingUpsert` schema extended; `ensure_schema`
  updated with new columns in CREATE TABLE + ALTER fallback; `upsert_landing` writes all 5
  palette columns + `logo_asset_id`. `base64` import added.
- **`frontend/src/lib/api.js`** — 3 new helpers: `brandUploadLogo`, `brandSuggestPalette`,
  `brandSuggestTaglines`.
- **`frontend/src/lib/api.js`** — `brandUploadLogo` now accepts a `FormData` body (multipart
  upload) so the browser natively reads the file without base64 client-side encoding.
  `brandSuggestPalette` / `brandSuggestTaglines` remain JSON POST.
- **`frontend/src/pages/BrandBuilderPage.jsx`** — UI additions:
  - Upload logo button (hidden file input, ≤512 KB PNG/JPG/SVG, multipart upload via
    `FormData`).
  - 5-colour palette grid (Primary / Background / Ink / Secondary / Accent) with color
    pickers.
  - "Suggest AI palette" button (runs `brandSuggestPalette` with seed from current primary
    colour; WCAA warnings surfaced inline).
  - Tagline iterator section with audience/tone/market-angle inputs → 6 candidate buttons;
  - selecting one sets both `draft.tagline` and `draft.headline`.

## About page: updated copy, image + name linked to LinkedIn

- **`frontend/src/pages/TeamPage.jsx`** — replaced the About paragraph with the
  new copy (AI acceleration + freeing founders sentence). Wrapped the photo
  and the name in `target="_blank" rel="noopener noreferrer"` links to
  `https://www.linkedin.com/in/guillaumelauzier/`. Removed the `User` icon
  fallback (no icons per request). `photoFailed` still degrades to an empty
  gradient placeholder.

## Contact form: Turnstile bot protection + drop the mailto fallback

- **`frontend/src/pages/ContactPage.jsx`** — removed the "Or email hello@axal.vc
  directly." line + mailto link. Added a Cloudflare Turnstile widget (mirrors the
  RegisterPage/LoginPage lifecycle: bounded ~10s poll for `window.turnstile`,
  `render`/`remove`/`reset`, `theme:'auto'`). Submit now blocks until the token is
  present, passes `turnstileToken` in the POST body, resets the widget on failure,
  and maps the worker's `turnstile_failed` code to a friendly message. Widget only
  renders when `VITE_TURNSTILE_SITE_KEY` is set (prod), so dev is unaffected.
- **`cloudflare-worker/src/routes/contact.ts`** — `POST /api/contact` now calls
  `verifyTurnstile(env, turnstileToken, CF-Connecting-IP)` after field validation,
  returning 403 `{error:'turnstile_failed'}` on failure. Reuses the existing
  `services/turnstile.ts` helper (fails CLOSED in prod when `TURNSTILE_SECRET_KEY`
  is unset, fails OPEN in dev). No new secret — the site key is already in
  `frontend/.env.production`.

## Deps: resolve Dependabot PRs #61–#67 (consolidated bump)

- Brought all four manifests to target versions: frontend/worker npm (react/react-dom 19.2.7, react-router-dom 7.16.0, vite 8.0.16, fuse.js 7.4.1, lucide-react 1.17.0, react-is 19.2.7, @cloudflare/workers-types 4.20260604.1, wrangler 4.96.0) and backend `requirements.txt` (idna 3.17, starlette 1.2.1). Lockfiles regenerated; `npm run build`, worker `tsc --noEmit`, and `npm audit --omit=dev --audit-level=high` (frontend + worker) all green; OSV check of bumped Python pins clean. Closes Dependabot PRs #61–#67.

## Articles reader: fix unreadable bodies + unblock the deploy

The public Articles pages now read like a real publication. Two fixes:

- **Markdown renderer** (`cloudflare-worker/src/services/newsRender.ts`) — heading,
  blockquote and fenced-code detection now tolerate leading indentation, so the
  article bodies (written with a uniform leading indent per line) render as real
  `<h2>`/`<blockquote>`/etc. instead of leaking literal `## ...` text. Paragraph
  lines are trimmed so stray leading whitespace doesn't leak. Also fixed a latent
  blockquote bug: input is HTML-escaped before tokenisation, so the `>` marker is
  `&gt;` by that point — detection/strip/paragraph-break now match `&gt;`. Unit
  coverage added in `cloudflare-worker/test/newsRender.test.ts` (indented heading,
  all levels, indented quote/list, paragraph trim, heading-breaks-paragraph),
  wired into `npm run test:drift`.
- **Reader build break** (`frontend/src/pages/ArticleReaderPage.jsx`) — `lucide-react`
  v1 dropped its brand icons (`Twitter`/`Facebook`/`Linkedin`), which broke
  `npm run build` and is why the already-merged reader chrome (header/footer/share
  bar/linked byline/recommended-reading) never shipped — the prod deploy was stale.
  Replaced the share-bar brand glyphs with local inline SVGs (mirroring
  `PublicFooter`), keeping `Mail` from lucide. Build is green again.

Renderer is the single source of truth for both prod (Worker) and dev — the public
article endpoint re-renders HTML from stored Markdown on every read, so no
stored-content backfill is needed. Ship via `npm run deploy` (user-owned).

## Team page → About page

The public `/team` page is now an "About" page. It keeps the photo, sets the
title to "Managing Partner", and shows a founder statement about why Axal VC
exists. The footer "Company" link label is renamed Team → About (route stays
`/team`).

- `frontend/src/pages/TeamPage.jsx` — rewritten from a team-member grid to a
  single-person About layout. Still fetches `/api/public/team` for the photo
  (first member) and name; title hard-coded to "Managing Partner"; About copy
  inlined as `ABOUT_TEXT`. Graceful fallback (User icon) when no photo.
- `frontend/src/components/PublicFooter.jsx` — Company list link relabelled
  Team → About; `to="/team"` unchanged.


## Brand Builder — names, taglines & logos on Workers AI (OpenAI dropped)

Task #16. The founder Brand & Landing Page wizard now generates brand
names/taglines AND logos via Cloudflare Workers AI (first-party, no external
key). The amber "Using deterministic fallback (no OPENAI_API_KEY configured)"
warning is gone.

- `cloudflare-worker/src/services/aiRouter.ts` — new `brand_suggest` TaskClass
  in the union + exhaustive ROUTE record (MID_LLAMA primary → SMALL_LLAMA
  fallback, mirroring `publication`).
- `cloudflare-worker/src/routes/brand.ts` — `aiBrand()` now routes through
  `aiRouterRun({ task: 'brand_suggest', ... })` (per-user budget, model
  fallback, usage logging) instead of an OpenAI `chat/completions` fetch; new
  `extractJsonObject()` robustly parses small-LLM JSON and each entry is
  normalised/guarded. `aiLogo()` now calls
  `env.AI.run('@cf/black-forest-labs/flux-1-schnell')` behind a 30s
  `Promise.race` timeout and returns a base64 `data:` URL, falling back to the
  inline `svgLogo()` on any failure. `/suggest` passes `user.id`; `/logo`
  `source` label changed `dalle` → `workers-ai`. `heuristicBrand()` retained as
  the deterministic fallback; the `ai_generated` flag is preserved.
- `frontend/src/pages/BrandBuilderPage.jsx` — replaced the amber OpenAI-key
  warning with a neutral gray "Showing starter options" notice (with `dark:`
  variants).
- `backend/app/api/routes/brand.py` (dev FastAPI, never deployed) — removed the
  `_ai_brand`/`_ai_logo` OpenAI calls; `/suggest` + `/logo` now return the
  deterministic heuristic / inline SVG directly (dev has no Workers AI binding).
  Dropped the now-unused `os`/`json` imports.

`OPENAI_API_KEY` is no longer read by any brand code; the binding stays in
`types.ts` for other callers.


## Articles — publication-style reader, social sharing, recommended reading, open authoring

Task #9. The public Articles reader now reads like a real publication and
authoring is open to every signed-in user (no trust-score gate).

- `cloudflare-worker/src/services/authorWebsites.ts` (new) — `ensureAuthorWebsites()`
  bootstraps a side table `author_websites(user_id PK, website_url, ...)` (the
  `users` table is at D1's ALTER-column limit) and seeds Guillaume Lauzier
  (resolved by `gl@axal.vc` / name) → `https://guillaumelauzier.com`.
- `cloudflare-worker/src/routes/articles.ts` — LEFT JOIN `author_websites` into
  the list / by-author / slug queries, expose `author_website` in
  `publicArticleShape`, and call `ensureAuthorWebsites()` on those reads. Slug
  read re-renders from `body_markdown` (fallback to stored `body_html`) and
  fire-and-forget refreshes a stale stored `body_html` via
  `c.executionCtx.waitUntil`. Removed the `canAuthor()` trust gate from POST
  `/draft` and POST `/:id/submit`; PII linter + weekly cap retained.
- `cloudflare-worker/src/services/newsRender.ts` — `renderMarkdown` joins
  single-newline paragraph lines with `<br>` (was a space) so soft line breaks
  survive; mirrored in the FE preview renderer.
- `frontend/src/pages/ArticleReaderPage.jsx` — rewritten: `PublicNav` +
  `PublicFooter` (pt-16), linked author byline (opens `author_website` in a new
  tab), Share bar (X / LinkedIn / Facebook / Email), and a Recommended-reading
  strip (same sector first, then most recent, current excluded). Removed the
  "Write an article" affordance from the reader.
- `frontend/src/pages/ArticleAuthorPage.jsx` — removed the trust badge, banner,
  `trustOk` gate, and `trustMe()` boot fetch; Submit is no longer trust-gated.
- `frontend/src/App.jsx` — `/articles/draft` + `/articles/edit/:id` now use a
  new `authOnly()` wrapper (any authenticated user) instead of the role guard.
- `frontend/src/sidebarConfig.js` — "Write an Article" (`/articles/draft`,
  PenLine icon) added to every role's Account group.

## Spin-Out deck — Brand Kit branding; deck auto-themes from the founder's saved kit

Task #4. The Spin-Out Demo Day deck now auto-themes from the founder's brand
kit. The Brand Builder's kit is extended from a single accent colour to a full
palette (background + accent/theme + ink) plus a typography pairing, and the
deck renders as a default-active "My brand kit" variant when a kit exists, with
4 selectable presets and a contrast-safe fallback to the editorial theme. The
06·BRAND slide was already removed everywhere by the merged Task #1.

- `cloudflare-worker/sql/migrations/079_landing_page_brand_kit.sql` — additive
  ALTERs add `palette_bg` / `palette_ink` / `font_pairing` to `landing_pages`.
- `cloudflare-worker/src/services/landingPageSchema.ts` (new) —
  `ensureLandingPageBrandKitColumns(env)` lazy-bootstraps the three columns so
  prod self-heals regardless of whether the migration is applied (same pattern
  as the other `ensure*Schema` helpers).
- `cloudflare-worker/src/routes/brand.ts` — CREATE TABLE + `ensureSchema` call
  the helper; `rowToLanding` returns the three new fields; PUT validates
  (`HEX_RE` for colours via `cleanHex`, `FONT_PAIRING_IDS` via
  `cleanFontPairing`) and persists on both UPDATE and INSERT.
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` —
  `SpinoutDemoDayData` gains a `brand_kit` object; the builder SELECTs
  `theme_color, palette_bg, palette_ink, font_pairing` from the landing page,
  builds `brand_kit` (`present = !!landingPage`), and the Cover slide emits the
  flat `brandkit_present/bg/accent/ink/fonts` fields the renderer hydrates.
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` — `PRESET_VIBE`
  map + `FONT_PAIRING_OPTIONS` export; `DeckRoot` computes
  `brandKit = buildBrandKitTheme(data.brand_kit)`, defaults the variant to
  `brand_kit` when a kit is present and untouched, restores the stored
  `brand_kit` selection, and falls back to editorial when no kit exists.
- `frontend/src/pages/BrandBuilderPage.jsx` — Tune section gains background /
  text colour pickers and a typography-pairing `<select>`; draft state + load
  carry `palette_bg` / `palette_ink` / `font_pairing`.

## Articles — sector filter is now a compact dropdown; added Robotics, Cybersecurity, Defense, Bio sectors

Task #8. The public Articles page's wrapping row of sector pills is replaced
by a single `<select>` dropdown sitting next to the "All authors" dropdown,
identical on desktop and mobile, defaulting to "All sectors".

- `frontend/src/pages/ArticlesPage.jsx` — pill button row removed; sector
  `<select>` populated from the fetched sectors list, wired to existing
  `sector` state (filtering/pagination unchanged), styled to match the author
  dropdown incl. dark-mode classes.
- `cloudflare-worker/src/data/sectors.ts` — added `robotics`, `cybersecurity`,
  `defense`, `bio` to the canonical `SECTORS` taxonomy (additive only; feeds
  `GET /api/articles/sectors` + server-side validation).


## Spin-Out deck — Cover Lab-activity strip is auto-filled + colour-coded by module; Team & Mentors merged into one People slide; cap-table crash fixed

Task #3. The Cover slide's "LAST 30 DAYS · LAB ACTIVITY" strip
(`cover_activity_log_json`) is no longer a hand-editable JSON textarea and
each day's bar is now segmented by the source module.

- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — the
  activity-log aggregation now buckets per module (`milestone` /
  `interview` / `advisor`) instead of collapsing everything into a single
  `count` with `kind:'lab'`. Advisor answers are dated via the new
  `created_at` column in the `advisor_answers` SELECT (`AdvisorAnswerRow`
  gains `created_at`). Each day carries `{ date, count, modules }` where
  `count` is the per-day total (height scaling) and `modules` is the
  per-module breakdown; the 30-day zero-filled window + 30-day age cutoff
  are preserved. The Cover field is now emitted via a new `autoJsonField()`
  helper (`kind:'auto'`, `source:'auto'`, `readonly:true`) instead of
  `jsonField()`, so the value still round-trips through `buildTemplateData`
  but the editor renders it read-only.
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` —
  `ActivityLogDay` gains an optional `modules` map (and `ActivityModule`
  type); `kind` made optional for back-compat. `ActivityLog30Day` now
  stacks each day's bar into per-module segments (milestone → accent,
  interview → emerald, advisor → gold) with a compact legend listing only
  the modules present in the window. Empty days still render the faint
  skeleton dot. Decks persisted before the breakdown (no `modules`) fall
  back to a single accent bar.
- `frontend/src/pages/PitchDeckPage.jsx` — `FieldEditor` renders
  `readonly`/`kind:'auto'`/`source:'auto'` fields read-only with an "Auto"
  badge and a short "auto-filled from your Lab activity" summary, no input.
- Export parity is automatic: the print/PDF/PPT path
  (`PitchDeckPrintPage.jsx`) renders the same `Template` from the same
  `buildTemplateData` output.

Task #1. The two adjacent people slides of the Axal Spin-Out Demo Day deck
(`methodId === 'axal_spinout_demoday'`) — "Team & venture readiness" and
"Mentors & network" — are collapsed into a single `team_network` slide led by
profile cards (founders + operating partners + advisors + mentors), each card
showing name + role + company, grouped by kind. The slide keeps the READINESS
score bars + SKILL-coverage radar and renders Mentor Sessions + Operating
Partners compactly. The standalone `brand` slide is dropped from the worker
emit + `methods.ts`; its `incorporated` flag is relocated to the `cap_table`
slide. After rebasing onto main (which merged the standalone Product Demo
slide's media into the Solution slide), the canonical **rendered** slide list
is now **10**: cover · problem · validation · market · solution · roadmap ·
team_network · cap_table · ask · review_the_deal. The product-demo media
renders on the Solution slide; its fields remain an editable editor group in
the worker emit + `methods.ts` (so `slide_count` is 10 while the editor still
exposes a Product demo field group).

- **Editable company / affiliation, end-to-end.**
  - Network roster: `network_profiles.company` (migration `077_network_profile_company.sql`,
    additive `IF NOT EXISTS`, mirrored in `ensureNetworkProfilesSchema`). Wired
    through `routes/admin_network_profiles.ts` (sanitise ≤200 chars, POST/PUT,
    GET shape + SELECT) and `AdminNetworkProfiles.jsx` (form input after role,
    payload, `role · company` list display).
  - Founders: `founders.company` (migration `078_founder_company.sql`) with a
    lazy `ensureFounderCompanyColumn()` (WeakMap-guarded `ALTER`) in
    `routes/projects.ts`. PUT accepts `founder_company` → `UPDATE founders SET
    company WHERE id = project.founder_id`; PUT response now includes the linked
    `founder`. `ProjectDetail.jsx` `EditProjectModal` gains a Company /
    affiliation input initialised from `project.founder?.company`.
- **Deck data layer carries company end-to-end.** Worker shaper looks up the
  linked founder's company (name-match → that card, else sole founder),
  founders + network profiles carry `company`; emit adds
  `team_founderN_company` + `mn_*` company fields and `ct_incorporated`.
  Frontend `Founder` + `MentorProfile` types, hydrate, and `SAMPLE_DATA` add
  `company`; `cap_table` type/hydrate/SAMPLE add `incorporated`.
- **Cap-table crash fixed.** `Slide_CapTable` previously read
  `d.brand.incorporated` — now-removed brand object — and crashed, blocking the
  whole deck render. It now reads `c.incorporated` off the cap-table block.
- **Graceful degradation.** Founder company lookup is try/catch wrapped and
  degrades to no company if the column/table is missing; empty people states
  preserved.
- **Tests.** `frontend/test/spinout_demoday_deck.test.mjs` updated: 11 slides /
  11 frames, asserts `team_network` present and `team_readiness` /
  `mentor_network` / `brand` absent.

> Migrations `077`/`078` not yet applied to prod — the lazy
> `ensureNetworkProfilesSchema` / `ensureFounderCompanyColumn` bootstraps cover
> dev and prod first-hit. Apply with the Node-22 `wrangler d1 execute` path when
> convenient.

## Spin-Out deck — deal CTA moves onto the "Review the deal" slide

Task #23. For the Axal VC Spin-Out deck (`methodId === 'axal_spinout_demoday'`)
viewed via a share link, the interactive "Want to review the deal?" card
(the "Join & open the deal" button that starts the join/NDA/deal-pack flow)
no longer renders as a trailing page after the deck — it now renders inside
slide 13 ("Review the deal.").

- `frontend/src/decks/templates/reviewDealSlot.ts` (new) — a tiny React
  context (`ReviewDealSlotContext` + `useReviewDealSlot()`) used to inject
  the share-only card into the otherwise self-contained deck template
  without eagerly bundling the lazy template into the print page.
- `PitchDeckPrintPage.jsx` — builds `shareCtaProps` once; trailing `cta`
  now renders only for non-Spin-Out decks; `reviewDealSlot` (the embedded
  `<ShareDeckCTA embedded />`) is built only in share mode + Spin-Out +
  `!exporting`, and is passed to `PrintStage`, which wraps both the
  fullscreen and normal `<Template>` renders in `ReviewDealSlotContext.Provider`.
- `axal_spinout_demoday_app.tsx` — `Slide_ReviewTheDeal` consumes
  `useReviewDealSlot()` and renders the node below its existing status
  chips (NDA / data-room chips untouched).
- `ShareDeckCTA.jsx` — new `embedded` prop drops the page padding/max-width
  so the card fits inside the slide body.
- `ShareViewerSignupModal.jsx` — modal root now renders via
  `createPortal(..., document.body)` so the fixed overlay escapes the deck's
  CSS-scaled stage (otherwise it would be shrunk/clipped to the scaled stage).
- Export: `reviewDealSlot` is gated on `!exporting`, so the html2canvas/jsPDF
  rasteriser never bakes the interactive button into the exported slide.


## Team — add Guillaume Lauzier to the public roster

Seeded the first `team_members` row in prod D1 (the table was empty;
migration 066 stays unapplied, `ensureTeamMembersSchema()` bootstraps it):
slug `guillaume-lauzier`, name "Guillaume Lauzier", title "Founding
Managing Partner", `social_linkedin =
https://www.linkedin.com/in/guillaumelauzier/`, `display_order=0`,
`published=1`. Headshot uploaded to the FILES R2 bucket at
`team/guillaume-lauzier/<uuid>.png` (served via the private photo proxy
`/api/public/team/:slug/photo`). Both `/team` consumers (the Jekyll
marketing build and the SPA `TeamPage`) read `/api/public/team`, so the
roster now returns him. `TeamPage.jsx` now wraps the headshot in a
LinkedIn anchor (target=_blank, rel=noopener) when `socials.linkedin` is
present, so the photo itself is clickable. Note: the live `axal.vc/team`
is Jekyll-served and reflects the new row on its next marketing-site
build; the data + photo are already live on `/api/public/team`.


## Fix — `/api/articles` 500 in prod (selected nonexistent `users.handle`)

The public + author + admin article surfaces (`routes/articles.ts` list,
`/by-author/:user_id`, `/:slug`; `routes/admin_articles.ts` `loadArticle`)
JOINed `users` and selected `u.handle AS author_handle`. Prod `users` has
no `handle` column (it never shipped, and the table is at D1's
ALTER-rewrite column limit so it can't be added), so every read threw
`no such column: handle` → 500. The bug was latent because the `articles`
table was empty; it surfaced the moment real rows existed. `/api/news`
was unaffected because it never selected `handle`. Replaced the four
`u.handle AS author_handle` references with `NULL AS author_handle`; the
public/author response shapes already treat `author_handle` as nullable
(`row.author_handle ?? null`) and profile deep-links use
`/by-author/:user_id` (by id), so no behavior is lost. Also seeded three
published articles authored by Guillaume Lauzier (`gl@axal.vc`, user 17):
"How AI is changing startup investment and venture support" (sector `ai`),
"Why I avoid consensus and invest early" (sector `other`), "Cybersecurity
and zero-trust systems" (sector `infra`).


## Fix — Telegram admin tabs no longer flicker (stable `useToast` identity)

`useToast()` returned a fresh object literal every render. Callers
(`AdminTelegram` `refresh`, `DraftsTab` `reload`, `ComposeTab`
`loadDraft`, `HistoryTab` `load`) destructure `const toast = useToast()`
and list `toast` in `useCallback`/`useEffect` deps. Each fetch's
`setState` re-rendered the parent → new toast object → new callback
identity → effect re-fired → fetched again: an infinite refetch loop that
flickered the Drafts/Compose/History tab content. Wrapped the hook's
return in `useMemo` (`frontend/src/components/useToast.js`) so the object
identity is stable across renders, changing only when the toast value
itself changes (all methods are already stable `useCallback`s). Fixes the
flicker app-wide for any page using this pattern.


## Task #2 — Spin-Out Demo Day Validation slide: RevenueProofCard replaces decorative bubbles, structured revenue-proof fields

Replaced the decorative `<VoicesBubbles />` quote-bubble graphic on the
Validation slide of the Spin-Out Demo Day deck with a premium
`RevenueProofCard` illustration backed by structured project data
(`total_revenue` reuses `revenue`, plus new `mrr`, `paying_customers`,
`first_payment_date`, `paid_pilot_status` enum
`'paid'|'pilot_paid'|'pilot_signed'|'pre_revenue'`).

- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`:
  extended `RevenueProof` type to always-non-null with `status`,
  `total_revenue`, `mrr`, `paying_customers`, `first_payment_date`
  (plus legacy `amount`/`label`/`signed` retained for back-compat);
  updated `SAMPLE_DATA` to `status:'pre_revenue'`; replaced
  Slide_Validation right-column composition (dropped `VoicesBubbles`
  + standalone `RevenueBadge` pill) with `<RevenueProofCard
  proof={v.revenue_proof} />`; added violet+gold concentric-arcs SVG
  illustration with status pill, hero metric, supporting stats grid,
  and graceful pre-revenue copy (`RevenueProofCard` + `Stat` helpers
  + `fmtUSD`/`fmtFirstPayment` formatters ~line 2366).
  `VoicesBubbles` + `RevenueBadge` kept in-file for back-compat with
  other slides.
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`:
  extended `ProjectRow` type with the 4 new columns; replaced
  `validation.revenue_proof` shape with the structured form (always
  non-null); rewrote `revenueProof` builder to derive `status` from
  `paid_pilot_status` (or infer from numeric signals) and keep the
  legacy pill `amount`/`label`/`signed` fields populated.
- `cloudflare-worker/src/routes/projects.ts`: added
  `ensureProjectRevenueProofColumns()` lazy-ALTER bootstrap (mirrors
  `ensureTelegramSchema` pattern); wired into `GET /:id` and
  `PUT /:id`; extended PUT allowlist with the 4 new fields +
  `revenue`; added input coercion (numbers → null on `""`, enum
  validation for `paid_pilot_status`).
- `backend/app/models/entities.py`: added the 4 new optional fields to
  the `Project` SQLModel (~line 223).
- `backend/app/models/migrations.py` + `backend/app/main.py`: added
  `ensure_project_revenue_proof_columns()` (additive
  `ADD COLUMN IF NOT EXISTS`) and wired into boot — fixes dev
  `demo_seed` `column projects.mrr does not exist` startup warning.
- `frontend/src/pages/ProjectDetail.jsx`: added Revenue section to
  `EditProjectModal` (numeric inputs via new local `RevenueInput`
  helper + date picker + status select) with submit-time coercion;
  added `PAID_PILOT_STATUS_OPTIONS` const.

## Fix — Pitch Deck template registry: explicit list, real header count, defensive loader, SW cache bump

User report: "Pick a deck template" picker in the Pitch Deck Builder
rendered "0 methods" and "No templates registered" in prod even though
`frontend/src/decks/templates/index.ts` defines 13 templates. The
hardcoded "12 templates" header copy disagreed with whatever the
picker produced, which made it look like a stale-copy bug — it wasn't.

Investigation: pulled the deployed `templates-BsP8zbeB.js` chunk from
`app.axal.vc` and confirmed it is byte-identical to a fresh local
build (98,939 bytes, 13 entries, correct `TEMPLATES` / `TEMPLATE_KEYS`
/ `TEMPLATE_LIST` named exports via `Object.values(Q)`). Root cause
in the wild was the service worker's cache-first rule for
`/assets/*.js` (`frontend/public/sw.js` `RUNTIME_STATIC`) holding
a stale chunk from an earlier deploy whose registry actually was
broken — the bundle on disk has been correct for several deploys, but
the SW cache pinned an older one for affected users.

Changes:

- **`frontend/src/decks/templates/index.ts`** — `TEMPLATE_LIST` is now
  an explicit `readonly TemplateMeta[]` literal listing each
  `TEMPLATES.<key>`, instead of `Object.values(TEMPLATES)`. TypeScript
  now fails the build if any key is missing or any `Deck_*` import
  resolves to undefined, instead of silently shipping a short list at
  runtime. New `EXPECTED_TEMPLATE_COUNT = 13` exported alongside; the
  inline integrity check now `console.error`s in **both** dev and
  prod when length or `Component` binding drifts, so the picker's
  empty-state diagnostic has something to surface.
- **`frontend/src/pages/PitchDeckPage.jsx`** — header copy no longer
  hardcodes "12 templates"; new `templateCount` state hydrates via the
  same lazy `loadTemplates()` call the picker uses, falling back to
  "Templates auto-fill from your project, financials, and cap table."
  while pending or on error. Loader hardening from the previous turn
  (default-export interop fallback, `templates_module_empty` diagnostic
  with `namespaceKeys`/`innerKeys`, Retry button in the empty state)
  ships alongside.
- **`frontend/public/sw.js`** — bumped `VERSION` from `v4-2026-05-25`
  to `v5-2026-05-27` so the next service-worker activate cycle drops
  any stale `studioos-static-v4-*` caches that may still hold an
  earlier templates chunk. Vite-fingerprinted asset URLs already
  bypass on hash mismatch, but the bump catches edge cases where an
  old SW survives a deploy.
- **`scripts/check-deck-templates.mjs`** — already wired into
  `npm run test:drift` from earlier work. Re-verified clean against
  the new explicit list (`✓ 13 templates wired correctly`).

Deploy: local `npm run build` passes; `npm run deploy` from this
environment fails with Cloudflare auth (`code: 9109 Invalid access
token`) — the deploy credentials are owned by the user. Run
`npm run deploy` from a shell with `CLOUDFLARE_API_TOKEN` set
(scoped to `Workers Scripts: Edit` on the `studioos` worker) to ship
the new bundle. Once deployed, affected browsers pick up the SW
version bump on next navigation, drop the stale cache on activate,
and fetch the new hashed chunks. Anyone still stuck can hard-reload.

---

## Feature — Task #2 · Project data-room URL is the single source of truth for the Demo Day "Review the deal" CTA

The Spin-Out Demo Day deck's Review-the-deal slide previously stored
the data-room URL + NDA flag in the deck-version JSON only — every new
version started blank and the link couldn't be reused by any other
surface. New columns on `projects` make the project the canonical
home for both fields:

- **`cloudflare-worker/sql/migrations/076_project_data_room_url.sql`**
  — additive `ALTER TABLE projects ADD COLUMN data_room_url TEXT` +
  `data_room_nda_required INTEGER NOT NULL DEFAULT 0`. Apply via
  `wrangler d1 execute studioos-db --remote --env production
  --file=cloudflare-worker/sql/migrations/076_project_data_room_url.sql`
  when convenient.
- **`cloudflare-worker/src/routes/projects.ts`** — exported
  `ensureProjectDataRoomColumns(env)` (WeakMap-keyed per-DB lazy
  bootstrap, mirroring `ensureDiscoveryValidationRatingColumns` from
  Task #14). Called before SELECT * on `GET /:id` and on `PUT /:id` so
  cold isolates self-heal. Both fields added to `baseFields` (owner-
  editable; founders manage their own deal-room link). URL is trimmed
  and empty-string coerces to NULL; NDA flag coerces boolean → 0/1.
- **`cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`** —
  `ProjectRow` type extended with `data_room_url` /
  `data_room_nda_required`. `fillAxalSpinoutDemoDay()` now sources
  `deal_access.deal_room_url` from `p.data_room_url` and respects
  `p.data_room_nda_required` (with the legacy
  `!doneMap.has('incorporation_completed')` heuristic as the fallback
  when the column is NULL on older projects). `data_room_ready` flips
  true whenever a URL exists.
- **`cloudflare-worker/src/routes/decks.ts`** — `PUT /api/decks/:id`
  scans the saved slides for the `axal_spinout_demoday` method's
  Review-the-deal slide and, when the founder has edited the URL or
  NDA flag inline (either via `contact_deal_access_url` /
  `contact_deal_access_nda_required` flat fields OR the legacy
  `contact_deal_access_json` blob), writes the changes back to
  `projects.data_room_url` / `data_room_nda_required` before
  inserting the new deck version. Best-effort: writeback failures
  log + continue so a save can't be blocked by the side-write.
  Absent fields are never clobbered to NULL.
- **`frontend/src/pages/ProjectDetail.jsx`** — new `DataRoomSection`
  component (rendered between the InfoCard grid and the Founder
  card): URL input with http(s) validation, "NDA required" checkbox,
  Save button (disabled until dirty + valid), "Open" external-link
  shortcut. Uses the existing `api.updateProject(id, {...})` binding
  + `useToast` for status feedback.

No migration required to ship — the lazy bootstrap makes the hot
path self-healing. Migration 076 is the canonical apply path for the
metadata catalog.

---

## Feature — Task #1 · Admin-managed mentor & partner network roster (replaces synthesised deck data)

The Spin-Out Demo Day deck's Mentors & Network slide previously
synthesised profiles from `advisor_answers` free-text — admins had no
way to curate the real Axal network and the slide regularly rendered
"Lead, Lead" / unparsed fragments. New admin-managed roster lives at
`/admin/network-profiles`:

- **`cloudflare-worker/sql/migrations/075_network_profiles.sql`** —
  additive `network_profiles` table (`name`, `kind`,
  `role`, `bio`, `linkedin_url`, `photo_r2_key`, `skills_json`,
  `display_order`, `is_active`) plus
  `idx_network_profiles_active_order`. IF NOT EXISTS only.
- **`cloudflare-worker/src/services/networkProfilesSchema.ts`** —
  `ensureNetworkProfilesSchema()` lazy bootstrap (mirrors
  `ensureTeamMembersSchema` / `ensureTelegramSchema`), canonical
  `NETWORK_KINDS = ['mentor','partner','advisor','investor']`, and
  canonical 12-axis `SKILL_CATALOG` (`Legal`, `Finance`, `GTM`,
  `Sales`, `Marketing`, `Product`, `Engineering`, `Design`,
  `Recruiting`, `Technical DD`, `Operations`, `Fundraising`) — single
  source of truth for both the admin picker and the SkillsSpider radar.
- **`cloudflare-worker/src/routes/admin_network_profiles.ts`** — CRUD
  + `POST /:id/photo` (≤2 MB JPG/PNG/WebP, magic-byte check, R2 keyed
  `network/<uuid>.{ext}` on the `FILES` binding) + `POST /reorder`.
  Every mutation writes an `activity_logs` row via the
  `hashEmail`-based actor convention. Sanitisers reject unknown
  `kind` values and silently drop unknown skill labels.
- **`cloudflare-worker/src/routes/network_public.ts`** — public photo
  proxy at `/api/public/network/:id/photo`; only serves rows where
  `is_active = 1`. Mounted under `/api/public` so it bypasses the
  CF-Access perimeter while the R2 bucket stays private.
- **`cloudflare-worker/src/index.ts`** — mounts
  `/api/admin/network-profiles` BEFORE the catch-all `/api/admin`
  router (same precedence trick as `/api/admin/telegram` and
  `/api/admin/team`), and mounts `networkPublic` on `/api/public`.
- **`cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`** —
  new exported `loadNetworkProfiles(env)` runs in parallel with the
  rest of the deck reads. The old `profiles` / `skillBag` /
  `SKILL_AXES` / `skillCoverage` / `networkBreakdown` synthesis block
  is replaced: `profiles` comes straight from the active roster
  (carrying `photo_url`, `linkedin_url`, `kind`), `skillCoverage`
  counts per axis across the 12-axis catalog and normalises 0..1
  against the busiest axis, and `networkBreakdown` is now grouped by
  `kind` (Mentors / Partners / Advisors / Investors). Falls back to
  the catalog-zero view when the roster is empty so older snapshots
  don't break the slide.
- **`frontend/src/decks/templates/axal_spinout_demoday_app.tsx`** —
  `MentorProfile` extended with optional `photo_url` / `linkedin_url`
  / `kind` (back-compat with cached decks). `ProfileCard` renders the
  real photo when present, falling back to the existing initials tile.
- **`frontend/src/pages/admin/AdminNetworkProfiles.jsx`** — admin
  surface: kind dropdown, name/role/bio, LinkedIn URL, 12-axis skill
  toggles (catalog mirrored from worker — keep in sync), photo
  upload, active toggle, drag-to-reorder, hard delete with confirm.
  Uses `useToast` + `useEscapeClose` per the in-house conventions.
- **`frontend/src/lib/api.js`** — new `adminNetworkProfiles` export
  (list/create/update/remove/uploadPhoto/reorder).
- **`frontend/src/App.jsx`** — lazy-loaded `/admin/network-profiles`
  route guarded by `['admin']`. Also surfaced as a `Mentors &
  Partners` tab inside `AdminPage.jsx` (`?tab=network-profiles`) so
  admins discover it via the main Admin Console rail.

Archival semantics: `DELETE /api/admin/network-profiles/:id` is a
soft-delete — it flips `is_active=0` and preserves the row + R2
photo, so a re-render of a historical Demo Day deck stays
reproducible and re-activation is lossless. Hide-from-deck and
archive share the same boolean; there is no hard-delete path.

Deploy notes: migration 075 is additive + `IF NOT EXISTS`; the
worker's lazy bootstrap makes the hot path self-healing, so applying
the SQL via `wrangler d1 execute` is preferred but not required to
unblock the feature.

## Feature — Task #15 · Customer Discovery captures 0–5 solution-fit rating + free-text comment

`frontend/src/pages/DiscoveryPage.jsx` — interview modal now carries
two new fields:

- **`validation_rating`** (integer 0–5 or null) — six-pip `RatingPicker`
  with prompt "How well does this solution address the problem the
  interviewee experiences?" Unrated state renders six **dashed
  outlines** so it never visually reads as "0". Clicking the currently
  selected pip clears back to null, and a small "clear" link sits
  beside the row. `Number.isInteger(value)` guards the rated branch so
  `null` and `0` are visually distinct end-to-end.
- **`validation_comment`** (string ≤240 chars or null) — one-line text
  input appears below the picker only when a rating is set; collapses
  back to null when the rating is cleared.

`emptyInterview()` now seeds `validation_rating: null,
validation_comment: ''`. `handleSave()` clamps the wire payload:
`null` when unrated, else `Math.max(0, Math.min(5,
Math.round(Number(...))))`; empty comment trims to `null`. The worker
also clamps via `asValidationRating()`, but normalising here keeps
the wire payload tight and reproducible. `handleToggleFeatured()`
omits both fields, which is safe — the PUT handler in
`cloudflare-worker/src/routes/progress.ts` already preserves the
existing rating + comment when the keys are absent from the body
(`hasOwnProperty` checks landed with Task #14).

Card-view summary: new `RatingBadge` renders a slim "Fit · • • • • ○ ○
· 4 / 5 · 'quote'" row under the interview notes; hidden entirely
when `validation_rating` is null. Card uses `bg-violet-600` for filled
dots and `bg-gray-200 dark:bg-gray-700` for empties so the badge is
legible in both themes.

Worker / migration: no new work. The `validation_rating` /
`validation_comment` columns + lazy-bootstrap helper
`ensureDiscoveryValidationRatingColumns()` + `asValidationRating()` +
`serializeInterview()` round-trip + "preserve when omitted" PUT
semantics all landed with Task #14 (migration `074`). This task wires
the UI that finally populates them.

Net effect: once a project has ≥1 rated interview, the Demo Day deck's
`RatingDistribution` chart on the Validation slide renders with real
data the next time the founder hits "Fill from project".

---

## Feature — Task #14 · Spin-Out Demo Day deck rebuild (13 slides)

Rebuilt `Deck_axal_spinout_demoday` to the 13-slide layout per the Task #14
spec. Seven changes land together:

1. **Rename Axal → Axal VC** on the Cover eyebrow ("Axal VC · 30-Day
   Spin-Out Lab · Demo Day") and surface copy.
2. **Cover gains an `ActivityLog30Day`** — 30-cell strip rendered from
   `cover.activity_log: ActivityLogDay[]` (`{date, count, kind}`) emitted
   as `cover_activity_log_json` by the worker hydrator.
3. **Problem slide gains `ThemeFrequencyBars`** driven by
   `problem.pain_themes: PainTheme[]`, with new helpers `deckPainPoints()`
   (falls back to raw signals for older payloads) and `shortenPain()`.
4. **Validation slide gains `RatingDistribution` (0–5 histogram) +
   `RevenueBadge`** from `validation.ratings: number[]`,
   `validation.question: string`, `validation.revenue_proof: {amount,
   label, signed} | null`. Founders' answers persist via new column
   `discovery_interviews.validation_rating` (migration `074`).
5. **Team + Venture Readiness merged** into single Slide_TeamReadiness
   (slot 9) — keeps both `team_*` and `vr_*` field keys for backwards
   compat with decks saved pre-merge.
6. **Mentors & network gains `SkillsSpider` + `ProfileCard` stack** from
   `mentor_network.profiles: MentorProfile[]`,
   `mentor_network.skill_coverage: SkillAxis[]`, `mentor_network.network:
   NetworkCategory[]`. Falls back to the existing `NetworkConstellation`
   when fewer than 3 skill axes are present.
7. **Drop Axal Signal slot 12**; **add Product Demo at slot 6**
   (`product_demo_{eyebrow,headline,body,loop_url,screenshot_url,caption}`);
   **rename Contact → Review the deal** with a new
   `contact.deal_access: {deal_room_url, nda_required, data_room_ready,
   cta_label}` CTA block. Lab-week milestones from the dropped slide are
   still emitted as hidden payload on `review_the_deal` for share/PDF
   compatibility.

Touched:
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — extended
  `SpinoutDemoDayData` type, `fillAxalSpinoutDemoDay()` builders,
  `INTERVIEW_SELECT` (now reads `validation_rating`,
  `validation_comment`, `interview_date`), 13-entry SLIDES registry, and
  13-cell `buildAxalSpinoutCoverage()`.
- `cloudflare-worker/src/services/discoveryInterviewSchema.ts` — added
  `asValidationRating()` + `serializeInterview()` + the rating field on
  the canonical interview row.
- `cloudflare-worker/src/routes/progress.ts` — `ensureDiscoveryValidationRatingColumns()` lazy bootstrap (WeakMap-keyed per `DB`), GET/POST/PUT now round-trip `validation_rating`.
- `cloudflare-worker/sql/migrations/074_discovery_validation_rating.sql`
  — additive `ALTER TABLE discovery_interviews ADD COLUMN
  validation_rating INTEGER NULL` (IF NOT EXISTS handled by the lazy
  bootstrap so this stays apply-when-convenient).
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` — new
  exported types (`ActivityLogDay`, `PainTheme`, `RevenueProof`,
  `MentorProfile`, `SkillAxis`, `NetworkCategory`, `DealAccess`), new
  primitives (`ActivityLog30Day`, `ThemeFrequencyBars`,
  `RatingDistribution`, `RevenueBadge`, `SkillsSpider`, `ProfileCard`),
  new slides (`Slide_ProductDemo`, `Slide_TeamReadiness`,
  `Slide_ReviewTheDeal`), Cover/Problem/Validation/MentorNetwork rewires,
  13-entry SLIDES registry. Legacy `Slide_Team`, `Slide_VentureReadiness`,
  `Slide_AxalSignal`, `Slide_Contact` retained (held by `void` refs) to
  keep any in-flight code references intact during rollout.

Both worker and frontend typecheck clean. Migration `074` is additive +
lazy-bootstrapped — safe to apply whenever convenient via
`wrangler d1 execute studioos-db --remote --env production
--file=cloudflare-worker/sql/migrations/074_discovery_validation_rating.sql`.

---

## Feature — Word-count guidance for Problem & Solution copy (editor + Spin-Out deck)

New shared helper `frontend/src/lib/pitchCopyLength.js` exports
`getPitchCopyLengthStatus(text, fieldType)` + `trimPitchCopyToMax()`,
with `PITCH_COPY_CONFIG` as the single source of truth for the two
word-range bands: **problem** `min 25 / ideal 35–60 / max 75`, **solution**
`min 25 / ideal 35–50 / max 70`. Status taxonomy is
`empty | too_short | good | acceptable | too_long`; tone is
`neutral | amber | green | red`; `progressPercent` ramps to 100% inside
the ideal range and stays there (color carries the over-max signal so
the bar never has to display a "wrong direction" fill).

Editor wiring:
- `frontend/src/pages/ProjectDetail.jsx::EditProjectModal` — new local
  `<PitchCopyMeter>` (1px-tall bar + status text + word count, all
  dark-mode aware) rendered immediately below the Problem Statement
  and Solution textareas via a `PITCH_FIELD_TYPE` map keyed by field.
  Save is **not** blocked when too long — meter is guidance only.
- `frontend/src/pages/ProjectsPage.jsx` — Add-New-Project form's
  Problem/Solution `<Input>`s replaced with a new `<PitchInput>` that
  upgrades to a textarea + the same meter pattern (the previous
  single-line `<input>` for a 25–75 word field was itself a UX bug).

Deck wiring (`frontend/src/decks/templates/axal_spinout_demoday_app.tsx`):
- `Slide_Problem` and `Slide_Solution` now wrap `p.body` / `s.body` in
  `trimPitchCopyToMax(text, 'problem'|'solution')` before passing to
  `<SlideHeading size="xl">` so an 80+ word paragraph can no longer
  render as a wall-of-text headline (the bug from the screenshot that
  triggered Task #12). When `getPitchCopyLengthStatus(...).status ===
  'too_long'`, a small muted-mono footnote ("Trimmed to N words for the
  slide — edit … in Projects to refine.") appears below the headline.
- Empty-body branches unchanged: the existing italic placeholder
  heading + `<Nudge>` cue still fire when `isUnfilled(body)` is true.

Worker / schema unchanged — guidance is editor + render only.
Files: `frontend/src/lib/pitchCopyLength.js`,
`frontend/src/pages/ProjectDetail.jsx`,
`frontend/src/pages/ProjectsPage.jsx`,
`frontend/src/decks/templates/axal_spinout_demoday_app.tsx`.

## Feature — Slack bus Phase 1 (org-wide channel poster)

New `cloudflare-worker/src/services/slackBus.ts` — bot-token-based poster
that routes platform events to 5 named Slack channels by `ChannelKey`
(`ops` | `founders` | `review` | `signals` | `launch`). Resolves channel
IDs from env (`SLACK_CHANNEL_OPS`/`_FOUNDERS`/`_REVIEW`/`_SIGNALS`/`_LAUNCH`)
so renames are cost-free and typos can't silently drop messages. In-isolate
30s dedupe per `(channel, payload-hash)` so retry storms / crash loops
can't blow Slack's Tier-3 quota. Best-effort: missing token, missing
channel ID, or Slack 4xx all return `{ok:false, reason}` and NEVER throw
or propagate to the caller.

Wired two emit points in Phase 1:
- `routes/customer_chat.ts` — Help → "Chat with Axal team" now posts to
  `#axal-founders` via slackBus when `SLACK_BOT_TOKEN` +
  `SLACK_CHANNEL_FOUNDERS` are set; falls back to the legacy
  `AXAL_TEAM_SLACK_WEBHOOK_URL` incoming-webhook path otherwise so
  delivery is uninterrupted through the cutover. Bot path uses real
  `ts` returned by `chat.postMessage` for `thread_ts` (no more
  `pending:` placeholders); legacy path still synthesises a placeholder
  for the `/slack-reply` Events handler to rewrite.
- `routes/tickets.ts` — every `POST /api/tickets` now posts a Block Kit
  card to `#axal-review` with title/body/submitter/priority/GitHub-link
  fields and an "Open ticket" CTA. Wrapped in try/catch — Slack failures
  cannot block ticket creation.

New admin status route at `/api/admin/slack` (mounted BEFORE catch-all
`/api/admin`, inside the existing `requireCfAccess()` perimeter):
- `GET /status` — `{token_configured, bus_configured, channels: {key:
  {configured, channel_id}}, legacy_webhook_configured}`.
- `POST /test/:channel` — fires a verification card to the named channel
  (admin role enforced; writes `slack_bus_test_ok`/`_failed` to
  `admin_audit_log`).

Env additions in `types.ts`: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_OPS`,
`SLACK_CHANNEL_FOUNDERS`, `SLACK_CHANNEL_REVIEW`, `SLACK_CHANNEL_SIGNALS`,
`SLACK_CHANNEL_LAUNCH`, plus formalising the legacy
`AXAL_TEAM_SLACK_WEBHOOK_URL` + `AXAL_TEAM_SLACK_CHANNEL`. All optional;
worker boots fine with none set (slackBus is then a structured no-op).

Required ops to activate in prod: create Axal StudioOS Slack App with
`chat:write` + `chat:write.public` + `files:write` + `reactions:write`
bot scopes, install, invite to the 5 channels, then
`wrangler secret put SLACK_BOT_TOKEN --env production` plus
`wrangler secret put SLACK_CHANNEL_FOUNDERS --env production` (etc) for
each channel ID. Verify via `curl https://axal.vc/api/admin/slack/status`
behind CF Access and `POST /api/admin/slack/test/founders`.

Phase 2 (deal pipeline / KYC / DD / signups / spin-out / market intel)
+ Phase 3 (5xx + auth failures → `#axal-ops`) + Phase 4 (GitHub App
webhook receiver → `#axal-ops`) tracked separately.

## Feature — Axal Spin-Out deck: 14-cell Fill-from-project coverage grid

Task #8 of the 3-task Spin-Out deck rebuild. Replaces the one-line
"X% covered" toast-only feedback on the Axal VC Spin-Out template with
a per-slide coverage grid that maps directly onto the 14 demo-day
slides (cover, problem, validation, market, solution, roadmap, brand,
venture_readiness, team, mentor_network, cap_table, ask, axal_signal,
contact). Each card shows a green/red dot, the exact source table(s)
the slide reads (`discovery_interviews.pains_json`,
`spinout_lab_milestones`, `roadmap_okrs`, `score_snapshots`,
`cap_table_holders`, `financial_models.inputs_json`, etc.) and a
short count badge ("3/5 interviews", "0 holders", "score: ✓").

Worker: new `buildAxalSpinoutCoverage(data)` export in
`cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` derives the
14 cells entirely from the `SpinoutDemoDayData` already returned by
`fillAxalSpinoutDemoDay()` — no additional D1 queries. The two
`axal_spinout_demoday` branches in `cloudflare-worker/src/routes/decks.ts`
(`POST /apply-method` and `POST /:id/autofill`) now ship a `coverage`
array alongside the existing `coverage_pct` scalar. Other templates'
responses are unchanged.

Frontend: `frontend/src/pages/PitchDeckPage.jsx` captures `r.coverage`
in `applyMethod()` and `fillFromProject()`, clears it on version
restore so stale grids don't bleed across versions, and renders the
grid below the toolbar gated on `activeMethodId === 'axal_spinout_demoday'`
— every other template keeps its existing UX.

Drift: Task #1's spec assumed the worker already returned the coverage
payload; it didn't. The minimal additive shape above closes that gap
without touching `fillAxalSpinoutDemoDay()` itself.

## Feature — Axal Spin-Out deck: 12 slides rebuilt as two-column right-rail layouts

Task #7 of the 3-task Spin-Out deck rebuild. All visual slides in
`frontend/src/decks/templates/axal_spinout_demoday_app.tsx` now render
as 12-column grids with a content column on the left and a dedicated
right-rail anchor (illustration or skeleton-aware chart) on the right.
No slide can collapse to whitespace at first paint regardless of which
Lab fields the founder has filled.

Rewritten: `Slide_Cover` (6+6 with `JourneyArc`), `Slide_Problem`
(7+5 with `ProblemEcho` + evidence card), `Slide_Validation` (5-up
interview cards with ghost slots until five are logged), `Slide_Market`
(5+7 with `MarketCircles` rail), `Slide_Solution` (7+5 with
`MvpBlueprint` rail), `Slide_Roadmap` (`OkrBoard` always rendered +
`FourWeekTicks` footer), `Slide_Brand` (7+5 with
`BrandPaletteIllustration` rail + status `Pill`s), `Slide_VentureReadiness`
(5+7 with composite-score block + `ScoreBars`), `Slide_Team` (3 founder
cards with gradient initial avatars + ghost rows), `Slide_MentorNetwork`
(5+4+3 with `NetworkConstellation` middle rail + operating-partner
list), `Slide_CapTable` (8+4 with `CapTablePie` + `LegalScroll` + docs
checklist), `Slide_Ask` (7+5 with stat cards, `UseOfFundsBar`,
`RocketTrajectory` rail + next-milestones card). Ask headline forced to
"What we are raising — and what it buys." per the brand-voice spec.

Added two slide-local helpers at the top of the slide layer:
`cardStyle(V, soft?)` (inline-style equivalent of the branch's `<Card>`)
and `<Pill tone="neutral|accent|gold|emerald|rose">` (inline-style
equivalent of the branch's `<Pill>`). Both stay private to the slide
section so the PDF pipeline never has to chase Tailwind classes through
the export — every visual byte is inline styles + V-token reads, same
PDF-safety contract as Task #6.

`Slide_AxalSignal` and `Slide_Contact` are intentionally untouched —
they already have right-rail anchors (4-card lab-week grid) and minimal-
intent layout respectively. Data shape in `SpinoutDemoDataT` is
unchanged; worker payload contract preserved.

`npm run test:drift` clean (13 templates wired correctly). Default
variant stays `'editorial'` (violet · Axal brand).

Architect-review fix-ups landed in the same task:

- `Slide_Cover` no longer collapses to a single column for the
  `manifesto` variant — the `JourneyArc` right-rail card stays mounted
  for every variant; the cinematic headline weight now comes from
  font-size/weight only.
- `Slide_Validation` rebuilt as strict 7+5: 3 quote cards on the left
  (with dashed "Interview N pending" slots until 5 are logged) + a
  right rail with the existing `VoicesBubbles` illustration + a
  3-up Week-1 scoreboard (interviews / distinct pains / quotes).
  This finally wires the previously-dead `VoicesBubbles` export from
  the Task #6 primitives port.
- `Slide_Roadmap` rebuilt as 8+4: `OkrBoard` on the left, right rail
  carries a "30-day cadence" card around `FourWeekTicks` + an "OKR
  coverage" 3-up (Now/Next/Later counts).
- `Slide_Team` rebuilt as 7+5: 3 horizontal founder cards (gradient
  avatar + bio) on the left, right rail with a team-intro card
  (skeleton bars when unfilled) + a "Cap-table coverage" 3-up
  (founders / holders / mentors).
- `Slide_MentorNetwork` rebuilt as strict 7+5: mentor sessions +
  operating-partners grid + optional body on the left, right rail
  hosts `NetworkConstellation` with a footer caption.

## Feature — Axal Spin-Out deck: skeleton-aware charts + 9 SVG illustrations

Ported the 14 visual primitives from branch
`claude/add-missing-sidebar-options-tmCKz` into
`frontend/src/decks/templates/axal_spinout_demoday_app.tsx` (Task #6 of
3-task deck-rebuild plan; Tasks #7 / #8 follow). The Spin-Out deck no
longer collapses to whitespace at chart positions when a founder's
project is empty — every chart renders a designed skeleton instead of
the previous one-line `<Nudge>` bail-out.

Components landed (all theme-aware via a new `useV()` adapter shim that
maps the existing `PALETTES`/`FONTS` to the branch's `V.accent`/`V.line`/
`V.card`/etc. tokens, so component bodies stay byte-close to the branch
source):

- **Charts (5)**: `MarketCircles` (TAM/SAM/SOM nested circles; dashed
  rings when all three are 0), `ScoreBars` (six dashed sub-score bars;
  total-score header reads "—/100" when not scored yet), `OkrBoard`
  (Now / Next / Later kanban; two ghost cards per empty column),
  `CapTablePie` (donut + ownership table; 4-slice dashed donut at
  50/30/12/8 when total ownership = 0), `UseOfFundsBar` (stacked bar +
  legend; 3 striped ghost segments at 55/30/15 when buckets are empty,
  with optional `fallback` prop for the raw string).
- **Illustrations (9, decorative SVG)**: `JourneyArc`, `FourWeekTicks`,
  `MvpBlueprint`, `VoicesBubbles`, `NetworkConstellation`, `LegalScroll`,
  `RocketTrajectory`, `BrandPaletteIllustration`, `ProblemEcho`.

Slide wiring (minimal; full slide redesigns are Task #7's territory):
the five empty-state branches in `Slide_Market`, `Slide_Roadmap`,
`Slide_VentureReadiness`, `Slide_CapTable`, `Slide_Ask` now render the
matching chart (with empty data) instead of the literal `<Nudge>` toast.
Populated-state rendering byte-for-byte unchanged so real-data renders
don't drift. Adapter signatures consume the existing
`SpinoutDemoDayData` shape directly — no changes to `sample.ts`,
`PitchDeckPrintPage.jsx::buildTemplateData`, or `methods.ts` wiring.

Two small helpers added: `usdShort` for MarketCircles axis labels and
`parseSize` to coerce TAM/SAM/SOM string values (`"$8.4B"`, `"1.2M"`)
back to numbers for the radius math.

Verified: `node scripts/check-deck-templates.mjs` passes (13 templates
still wired correctly); `vite build` succeeds (axal bundle 541 kB).

Files: `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`.

---

## Fix — Telegram admin: aggregator drafts persist + Open works for older drafts

Two regressions in `/admin/telegram`:
1. **Aggregator drafts appeared to "disappear"** when navigating away from the
   Drafts tab and only "came back" after another Run aggregator click.
2. **Clicking Open on a draft did nothing visible** — the post only surfaced
   when the user manually clicked the Compose tab afterwards.

Root cause (1): `useToast()` in `frontend/src/components/useToast.js` returns
`{ toast, showToast, dismissToast }`, but every admin call site (34 in
`AdminTelegram.jsx`, plus `AdminX.jsx`, `AdminNewsQueue.jsx`,
`ArticlesQueuePage.jsx`, `ArticleAuthorPage.jsx`, `NewsAuthorPage.jsx`) calls
`toast.success(msg)` / `toast.error(msg)`. Those methods are undefined →
`TypeError` thrown synchronously inside the `try`/`catch`, so e.g. in
`DraftsTab.runAgg` the `toast.success(...)` after a successful
`api.runAggregator(...)` aborted control flow before `reload()` could fire,
leaving the list stale until the next tab remount.

Root cause (2): `ComposeTab.loadDraft` did
`api.listPosts({ limit: 200 }).find(p => p.id === id)`. Once aggregator
history grew past 200 rows the target draft fell outside the newest-first
window and `setPost(null)` rendered "Draft not found." Manually clicking
Compose appeared to "work" only when the draft happened to still be in the
top 200.

Fixes:
- `frontend/src/components/useToast.js`: add `success(msg, ms?)` and
  `error(msg, ms?)` aliases that wrap `showToast({ kind, msg })`. Backward
  compatible; fixes silent breakage across all five pages.
- `cloudflare-worker/src/routes/admin_telegram.ts`: add
  `GET /api/admin/telegram/posts/:id` returning a single post via
  `loadPost(env, id)`. Admin-gated, schema-bootstrapped, 404 on miss.
- `frontend/src/lib/api.js`: add `adminTelegram.getPost(id)` binding.
- `frontend/src/pages/admin/AdminTelegram.jsx::ComposeTab.loadDraft`:
  switch to `api.getPost(id)`, add explicit catch with `toast.error`.

No migration. No new env. Worker route is purely additive.


## Fix — Task #2 — Deck library exports: real PDF + image-mode PPTX, drop PNG cover

PDF was returning `502 pdf_render_failed` because the prior implementation
called the Browser Rendering binding with raw HTML and no auth, and the
SPA route it tried to point at required a session cookie. PPTX was
emitting a text-only generic deck (`pptxgenjs` programmatic shapes) that
didn't match the rendered slides at all. PNG (cover) was a footgun next
to those two and is now removed end-to-end.

**Worker — `cloudflare-worker/src/routes/decks.ts`**
- New HMAC token pair `signDeckPrintToken(env, deckId, ttlSec)` /
  `verifyDeckPrintToken(env, token)` keyed on `JWT_SECRET`, payload
  `deck-print|<id>|<exp>`, b64url(payload).b64url(sig). Reuses the
  hoisted `b64url` / `b64urlDecode` already in the file — no duplicate
  helpers.
- New public route `GET /api/decks/print-export/:token` (no `requireAuth`)
  returns the same `rowToDeck()` JSON shape the editor uses, gated only
  by the HMAC token. This is what the headless Browser Rendering session
  fetches.
- `POST /:id/export` rewritten:
  - rejects `format='png'` with `400 png_export_removed`;
  - mints a deck-print token (TTL 180s for PDF, 300s for the per-slide
    PPTX fan-out) and calls `https://browser/pdf` with
    `url=<publicBase>/deck/print-export/<token>?print_mode=pdf` at
    `1920×1080`, `deviceScaleFactor: 2`, `waitUntil:'networkidle0'`;
  - for PPTX, fans out N `https://browser/screenshot` calls with
    `&slide=N` to capture one PNG per slide, then calls the new
    `renderDeckPPTXWithImages()`;
  - preserves the existing `503 browser_rendering_unavailable` path so
    the client-side `downloadDeckPdf()` fallback still triggers in dev.
- `publicBase` derived via `stripTrailingSlashes(env.PUBLIC_BASE_URL ||
  env.APP_URL || 'https://axal.vc')` so it follows the canonical-host
  switch from Phase 2.

**Worker — `cloudflare-worker/src/services/decks/pptx.ts`**
- New `renderDeckPPTXWithImages(deck, pngs[], opts)` builds a 16:9
  PPTX with one full-bleed image per slide
  (`12192000 × 6858000` EMU, no margin) plus a `notesMaster` and a
  per-slide notes part carrying the slide's text content via the new
  `slideToNotesText(slide)` helper. Adds `png` to `[Content_Types].xml`
  Defaults, and wires `rId2=image`, `rId3=notesSlide` on each slide rel
  with a matching `notesSlide{N}.xml.rels` pointing back to the slide
  + the shared notesMaster.
- Legacy `renderDeckPPTX()` retained as a fallback (still called from the
  503 path) but the export route prefers the image-mode renderer.

**Frontend — `frontend/src/pages/PitchDeckPrintPage.jsx`**
- New `exportMode` prop (wired via the new `/deck/print-export/:token`
  route) reads `print_mode` + `slide` from the query, fetches the deck
  via `api.deckPrintExportRead(token)` (no auth), and renders a
  no-chrome native `1920×1080` stack with `@page { size: 1920px 1080px
  landscape; margin: 0 }` and per-frame `page-break-after: always` so
  CF Browser PDF gets one slide per page at native scale.
- New `SingleSlideStage` component (used when `slide=N` is present) puts
  the full template stack inside a 1920×1080 `overflow:hidden` viewport
  and `translateY`s the track to the measured top of the requested
  `[data-slide-frame]` — exact pixel-snap via `ResizeObserver` so the
  screenshot lands flush at the top regardless of template-specific
  frame heights.

**Frontend — `frontend/src/App.jsx`**
- New unguarded route `/deck/print-export/:token`
  → `<PitchDeckPrintPage exportMode />`. Mounted alongside the existing
  `/deck/share/:token` and `/share/deck/:token` share routes.

**Frontend — `frontend/src/lib/api.js`**
- New `deckPrintExportRead(token)` cookieless helper.
- Updated `deckExport` doc-comment: format ∈ `{pdf, pptx}` only.

**Frontend — `frontend/src/pages/PitchDeckPage.jsx`**
- Removed the "PNG (cover)" menu button, the `FileImage` import, and the
  `format === 'png'` branch of the extension picker. The export menu is
  now PDF + PowerPoint only.

Drift / typecheck: `cloudflare-worker tsc --noEmit` clean;
`check-api-drift`, `check-deck-templates` clean. `test:drift` does flag
two pre-existing dark-mode violations in
`frontend/src/pages/LandingPage.jsx:264` that are unrelated to this task
(file untouched here — last touched by commit `6c6d547`).

## Feature — Task #17 — Spin-Out Lab → Demo Day deck CTA + deep-link auto-apply

In-product hint that points Spin-Out Lab founders at the new Demo Day
template (Task #15). `SpinoutLabPage.jsx` Dashboard renders a violet
CTA banner above the milestones list whenever `week === 4` OR the
`pitch_deck_v1` milestone is still unchecked; the banner copy /
button-label flip between "Generate" and "Open / Refresh" once the
milestone is done. The CTA links to
`/build/deck?method_id=axal_spinout_demoday`.

`PitchDeckPage.jsx` now reads `?method_id=` via `useSearchParams`. A
new effect — gated by `autoAppliedRef` so back/forward doesn't re-fire
— waits for both the methods catalog and the active project to load,
validates the id against `methods[]`, strips the query param via
`setSearchParams({}, { replace: true })`, then calls the existing
`applyMethod(id)` path. Paywall / unknown-method behaviour is
unchanged — same 402 toast as a manual click in the picker.

Files: `frontend/src/pages/SpinoutLabPage.jsx`,
`frontend/src/pages/PitchDeckPage.jsx`. No worker / migration / drift
changes.

## Feature — Task #18 — Founder-curated quotes on the Demo Day deck

Founders can now pick which discovery interviews surface as quotes on
the Demo Day deck's "Early signal" slide instead of always getting the
three most-recent.

- New `discovery_interviews.featured INTEGER NOT NULL DEFAULT 0` column
  added by `cloudflare-worker/sql/migrations/072_discovery_interview_featured.sql`
  (additive ALTER + partial index `idx_discovery_interviews_project_featured`).
- `cloudflare-worker/src/services/discoveryInterviewSchema.ts` —
  `ensureDiscoveryInterviewFeaturedColumn()` lazy bootstrap (mirrors
  `ensurePartnerDirectoryColumns()`), called from every read/write path
  in `routes/progress.ts` so the worker is self-healing on
  environments where 072 hasn't landed yet.
- `routes/progress.ts` — `INTERVIEW_SELECT` + `serializeInterview()` +
  POST/PUT now round-trip `featured`. Update path treats `featured` as
  optional and preserves the prior value when the field is omitted, so
  the legacy modal save can't accidentally clear a star.
- `services/decks/axalSpinoutDemoDay.ts` — the interview query orders
  `COALESCE(featured, 0) DESC, id DESC`. Quote selection now keeps only
  starred candidates when at least one exists, otherwise falls back to
  the original recency-based top 3. Empty-takeaway / unnamed rows are
  still filtered out so an empty star doesn't push real signal off the
  slide.
- `frontend/src/pages/DiscoveryPage.jsx` — star toggle on each
  interview card (Lucide `Star`, filled amber when active). Toggling
  uses an optimistic update and reverts on PUT failure. `aria-pressed`
  + title/`aria-label` describe both states.

## Feature — Task #15 — Axal 30-day Spin-Out Lab "Demo Day" deck (13th pitch-deck template)

13th pitch-deck template, sized for Axal-network investors + partners
reviewing Spin-Out Lab graduates. 14 fixed slides (cover, thesis,
problem, insight, product, market, early signal, 30-day sprint,
business model, GTM, landscape, team, ask, thank you) bound 1:1 to
canonical Lab tables — no fabricated numbers. Four visual variants
(`editorial`, `product_first`, `data_dense`, `manifesto`) switchable in
the author surface; the user's choice is persisted to
`localStorage['axal:deck:axal_spinout_demoday:variant']` and baked into
share / print / export renderings.

Files:
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` — self-contained adapter (~1100 LOC) with SAMPLE_DATA, `mergeShape()` (object/non-object guard mirrored from `investor_appendix_app.tsx`), VariantSwitcher, and bespoke SVG artwork (SunRise hero, SparkArc week-progress, ProductFrame, MarketTriangle, scatter landscape).
- `frontend/src/decks/templates/index.ts` — registers `axal_spinout_demoday` (free tier, `category: 'fundraising'`); bumps sanity check from 12 → 13.
- `cloudflare-worker/src/services/decks/methods.ts` — adds `'axal_spinout_demoday'` to `DeckMethodId`; appends `DECK_METHODS` entry (informational slide list — autofill is special-cased in the route handler).
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — `fillAxalSpinoutDemoDay(env, userId, projectId)` builds `SpinoutDemoDayData` from `projects`, `users`, `spinout_lab_milestones`, `discovery_interviews`, `roadmap_okrs`, `score_snapshots`, `financial_models`, `cap_table_holders` in one parallel `Promise.all`. `buildAxalSpinoutDemoDaySlides()` shapes it into 14 slides where each slide carries one JSON-encoded paragraph field keyed `axal_spinout_section_<name>`; slide 0 also carries the `meta` section. All payloads fit comfortably under `sanitizeFields`' 4000-char paragraph cap.
- `cloudflare-worker/src/routes/decks.ts` — branches both `/apply-method` (line 928) and `/:id/autofill` (line 1032) when `method_id === 'axal_spinout_demoday'`: calls `fillAxalSpinoutDemoDay()` → `buildAxalSpinoutDemoDaySlides()` → `sanitizeSlides()` → `insertVersion()` / UPDATE. Coverage_pct returned as 1.0 when project has name+sector, else 0.5 — kept honest so the picker's "filled" badge doesn't lie.

Data flow: the adapter receives the flattened `data` dict from `PitchDeckPrintPage::buildTemplateData`, which yields `{ axal_spinout_section_cover: '<json>', axal_spinout_section_thesis: '<json>', … }`. `hydrate()` walks those keys, JSON-parses each, and merges onto SAMPLE_DATA via `mergeShape()`. Missing rows render as `'—'` placeholders with inline `<Nudge>` cues pointing the founder at the right Lab page to populate.

Sample / authored / shared parity: SAMPLE_DATA's `meta.is_sample=true` triggers a "Sample data" badge on the cover; the worker autofill always writes `is_sample=false`. Variant choice is only visible behind `editable`, so investor / share renderings cannot accidentally flip variants.

Pattern reuse: `mergeShape`'s `if (typeof incoming !== 'object' || Array.isArray(incoming)) return base;` guard is copied verbatim from `investor_appendix_app.tsx` lines 2877–2899 to keep primitive overrides from clobbering nested sub-trees. Lab milestone catalog is duplicated (small, stable) in `axalSpinoutDemoDay.ts::WEEK_CATALOG` rather than imported from the worker's `services/spinoutLabCatalog.ts` to keep the deck builder self-contained.

No DB migration required — autofill consumes existing tables only.


## Fix — bump PWA service-worker cache version to evict stale share-link bundle

- After fixes #1/#2 to `mergeShape` and `previewDataFor` landed, share links
  on prod kept crashing on different decks (`moat.pillars`, `features.modules`)
  because the prod SPA bundle hadn't been redeployed AND returning visitors'
  service worker (`frontend/public/sw.js`) was holding cache-first hashed
  assets from before the patch.
- Bumped `VERSION` in `frontend/public/sw.js` from `v2-2026-05-13` to
  `v3-2026-05-24` so the next prod deploy's `activate` step drops the
  three old cache buckets (`studioos-precache-v2-…`, `-static-v2-…`,
  `-api-v2-…`) and forces a fresh fetch of the new Vite-hashed JS.
- Ran `npm run build` — clean. Pending: `npm run deploy` (Cloudflare Worker)
  by user. Until that ships, the prod share-link crashes persist regardless
  of code changes here.
- Re-verified the underlying `mergeShape` guard against 14 malformed
  `moat`/`features` shapes via code execution — every plausible bad shape
  falls back to `SAMPLE_DATA`'s structural defaults; no crash path remains
  in the source code.

## Fix — `mergeShape` type-mismatch crashed share-link viewer on app-template decks

- Share-link route (`/share/deck/<token>`) for `narrative_brand` crashed
  with `undefined is not an object (evaluating 'd.proof.stat_strip.map')`.
- Root cause in all six self-contained registry adapters
  (`narrative_brand_app`, `investor_appendix_app`, `partnership_bd_app`,
  `series_b_diligence_app`, `demo_day_app`, `sales_commercial_app`):
  when `mergeShape(SAMPLE_DATA, data)` received an `incoming` whose
  value at a given key was a *primitive* but `base` had a typed object
  (e.g. `data.proof = "The Proof"` from `PitchDeckPrintPage.buildTemplateData`'s
  flat-field blob), the final fall-through `return (incoming as T) ?? base`
  replaced the whole `proof` object with the string, so `merged.proof.stat_strip`
  became `undefined` and the first `.map` deref threw.
- Added a single-line type-mismatch guard inside the object branch of
  each `mergeShape`: if `base` is an object but `incoming` isn't a plain
  object, keep `base` (same defensive stance as the existing
  empty-array branch). Identical patch applied to all six files so the
  six adapter copies stay in lock-step. Build clean.

## Fix — `previewDataFor` fallback crashed `investor_appendix` + `narrative_brand` thumbnails

- `frontend/src/decks/sample.ts::previewDataFor()` had no explicit branch
  for `investor_appendix` or `narrative_brand`, so both templates fell
  back to `SAMPLE_PREVIEW_DATA`. That dict carries top-level *strings*
  for `company` / `team` / etc., which `mergeShape` then clobbered over
  each template's nested `SAMPLE_DATA` shapes (`company.{name,tagline}`,
  `team.members[]`, …). First slide that dereferenced `d.company.name`
  threw, the Thumbnail boundary surfaced "Failed to render investor_appendix".
- Added explicit branches returning each template's exported
  `SAMPLE_DATA` (same pattern as `series_a_growth_app`,
  `partnership_bd_app`, `sales_commercial_app`). Build clean.

## Task #13 — Narrative — Brand-led: cinematic 4-act upgrade

- **Replaces** the old 14-slide big-type `Deck_narrative_brand` stub with
  the self-contained `narrative_brand_app.tsx` shipped on PR #53 — 19
  frames across 4 acts (15 content chapters + 4 full-bleed act
  dividers; I · The World, II · The Belief, III · The Solution,
  IV · The Future), editorial typography (Playfair Display +
  Source Serif Pro + JetBrains Mono), warm-cream paper with ember/gold/
  sky/dusk palette, and custom SVG artwork on every content slide
  (HorizonScene, FragmentedGlass, VoicesSilhouette, SunTrail,
  ConstellationCommunity, OpenLandscape, WaveOfLight). No charts, no
  stock photos.
- `frontend/src/decks/templates/narrative_brand_app.tsx` — dropped in
  verbatim from `attached_assets/Pasted--narrative-brand-app-tsx-Narrative-driven-brand-present_1779618630769.txt`,
  then appended the standard registry adapter (`mergeShape` + array→
  dot-string `onEdit` bridge + `<Slide16x9>` per-slide wrapper). Mirrors
  the Task #1/#3/#5/#6/#10/#12 pattern so the print pipeline
  (`PitchDeckPrintPage.jsx`) finds every slide via `[data-slide-frame]`.
- `frontend/src/decks/templates/narrative_brand.tsx` — collapsed to a
  one-line re-export of `Deck_narrative_brand_app` as
  `Deck_narrative_brand`. Registry key `narrative_brand` unchanged, so
  decks saved with `method_id='narrative_brand'` continue to resolve.
- `frontend/src/decks/templates/index.ts` — bumped
  `narrative_brand.slide_count` from `14` to `19` (the source file's
  header docstring says "15 in 4 acts" but the actual deck shell pushes
  the 4 act dividers as standalone slides — 15 content + 4 dividers =
  19 frames). Adapter uses `const total = factories.length` so footer
  step/total chrome stays in sync with whatever the array contains;
  description now reads `'4 acts · 15 chapters + 4 dividers · cinematic
  · custom SVG artwork'`. Tier (`studio`) and category (`commercial`)
  unchanged.
- PR #53 (`claude/add-missing-sidebar-options-tmCKz`) was already
  CLOSED upstream; left a comment noting the work landed via this task,
  same convention as Tasks #9 / #12.

## Task #12 — Investor + Appendix: 42-slide editorial upgrade

Replaced the 23-slide placeholder `investor_appendix` template (12-slide
stub + 10 plain "Appendix · X" pages with the giant `[Company]` cover)
with a 42-slide institutional-grade variant from PR #53 — 12-slide core
investor deck + 30 appendix pages across nine sections (A Market ·
B Product · C Traction · D Customer insights · E Unit economics ·
F Go-to-market · G Defensibility · H Team & operations · I Financials).
Editorial crimson / navy / gold palette, Source Serif Pro headlines,
hand-built SVG diagrams (TAM/SAM/SOM rings, cohort heatmap, moat
pentagon, positioning matrix, funnel, capital-allocation bars) plus
full Recharts library (ARR area, NRR line, channel-mix bars,
composed P&L). Mirrors the in-place swap pattern from Task #2
(Series A), Task #3 (Series B), Task #5 (Demo Day), Task #6
(Partnership/BD), and Task #10 (Sales) — registry slot stable
(`investor_appendix`), drift count unchanged at 12 templates.

- **`frontend/src/decks/templates/investor_appendix_app.tsx`** — new
  self-contained ~2985-line template dropped in verbatim from
  `attached_assets/Pasted--investor-appendix-app-tsx-…`. Exports
  `InvestorData` type + `SAMPLE_DATA` (`Loopline`, $25M Series A,
  18-month ARR series, four-cohort retention grid, six-bucket org
  plan, three-year P&L). Standalone `InvestorAppendixDeckApp` viewer
  with framer-motion shell, dot nav, deck/appendix toggle, and `A`
  hotkey to jump to the appendix divider. Inline mapping comment at
  the bottom documents the future worker autofill binding
  (`projects.*`, `financial_models.*`, `cohort_grids`,
  `pipeline_snapshots`, `customer_success_stories`,
  `competitive_matrix`, `financial_plans`, `hiring_plans`,
  `capital_allocation_plans`, `partnerships`, `compliance_certs`).
- **Registry adapter** appended to the same file:
  `Deck_investor_appendix_app: React.FC<RegistryDeckProps>` runs
  `mergeShape()` to deep-merge incoming `data` over `SAMPLE_DATA`
  field-by-field (arrays only override when non-empty, objects merge
  per-key) so partial autofill payloads don't nuke the defaults the
  slide internals rely on. Bridges the template's array-path `onEdit`
  signature to the registry's dot-string signature. Wraps each of the
  42 slides — 12 `<SnXxx>` core slides + 9 `<AppendixDivider>` letter
  pages + 30 `<A1…A30>` appendix slides — in `<Slide16x9>` so the
  print pipeline (`PitchDeckPrintPage.jsx`) finds them via
  `[data-slide-frame]` and per-slide page breaks fire during PDF
  export.
- **`frontend/src/decks/templates/investor_appendix.tsx`** — collapsed
  from the 96-line stub to a one-line re-export
  (`export { Deck_investor_appendix_app as Deck_investor_appendix } from './investor_appendix_app';`)
  so the registry key `investor_appendix` stays stable, persisted
  decks with `method_id=investor_appendix` continue to resolve, and
  the `check-deck-templates.mjs` drift guard keeps finding the
  canonical `Deck_<key>` import from `./<key>`.
- **`frontend/src/decks/templates/index.ts`** — bumped to
  `slide_count: 42` + description `'12 core + 30 appendix (A–I) ·
  editorial · with charts'`. Tier (`studio`) and category
  (`fundraising`) unchanged.

PR #53 closed via the GitHub integration with the comment "Landed via
internal task — closing this PR."

Verified `node scripts/check-deck-templates.mjs` → `12 templates wired
correctly`; `npx vite build` → clean build, new chunk
`investor_appendix_app-*.js`.

Out of scope (kept per the task spec): the worker
`heuristicSlides()` branch + appendix-supporting migrations
(`cohort_grids`, `pipeline_snapshots`, `financial_plans`,
`hiring_plans`, `capital_allocation_plans`, `partnerships`,
`case_studies`, `compliance_certs`) — the inline mapping comment at
the bottom of `investor_appendix_app.tsx` is the spec for the future
worker branch. Until those land the deck renders against `SAMPLE_DATA`
field-by-field, which is exactly the merge behaviour above.


## Task #11 — Share-link fullscreen one-slide presentation + real direct-download PDF

Fixed the two long-standing rough edges in the one-time deck share
viewer (`/share/deck/:token`) and authenticated print preview
(`/deck/:id/print`):

1. **Fullscreen now shows exactly one slide at a time**, 16:9
   letterboxed on a black background, instead of the previous scrolled
   stack (where the next slide was always peeking through the bottom).
2. **"Save as PDF" downloads a real 1920×1080 landscape PDF directly**
   for all 12 advanced templates, bypassing the browser's print dialog
   (and the margins / headers / "where do you want to save" detour it
   forced on users). No more `window.print()` for the advanced path.

Mechanics:

- **`frontend/src/lib/deckRasterPdf.js`** (new) — exports
  `downloadRasterDeckPdf(deck, {stageEl, onProgress})`. Lazy-imports
  `html2canvas` + `jspdf`, walks every `[data-slide-frame]` in the
  live DOM, captures each at native 1920×1080 at 2× DPI, and assembles
  a single landscape jsPDF document with one slide per page (zero
  margins). The viewer applies `transform: scale()` on
  `.deck-print-inner` to fit-to-width; the rasteriser uses html2canvas's
  `onclone` hook to neutralise that transform on the cloned document
  only (also resets `.deck-print-scaler`, `.deck-print-stage`,
  `.deck-print-frames`, `[data-fullscreen-viewport]`,
  `[data-fullscreen-track]`) so we always capture at native pixel size
  regardless of viewport or fullscreen state. Output is JPEG @ 0.92
  (visually indistinguishable from PNG on slide-grade content, ~6×
  smaller on disk). Filename: `${slugified-title}-v${version}.pdf`.
- **`frontend/src/pages/PitchDeckPrintPage.jsx`** — substantial refactor
  with state isolated to the page so behaviour is identical for
  share-mode and authenticated preview:
  - New state: `currentIdx`, `slideCount`, `overlayVisible`,
    `exportProgress`. `slideCount` is reported up from `PrintStage`
    via a `MutationObserver` on the slide track so templates that emit
    more slides than `deck.slides.length` (Series B's 32 vs the editor's
    22, Sales Commercial's 18, etc.) still bound the keyboard nav
    correctly.
  - `toggleFullscreen()` now anchors `currentIdx` to the slide whose
    rect-top is nearest the chrome line BEFORE requesting fullscreen,
    so the user lands on the slide they were already reading instead
    of slide 1.
  - Keyboard listener branches on `document.fullscreenElement`: in
    fullscreen it updates `currentIdx` (Arrow/Space/PageDown/Home/End,
    plus `j`/`k`/`f`/`F`); outside fullscreen it keeps the legacy
    `scrollIntoView` behaviour for the scrollable stack. Esc is the
    native exit. Tab order untouched (`tabIndex={-1}`).
  - Auto-hiding fullscreen overlay (`.opacity-0` after 2.5s mouse-idle,
    re-shows on `mousemove`/`keydown`): bottom-left slide counter
    `1 / N`, bottom-right `← → navigate · Shift+Space back · Esc to
    exit`, plus circular prev/next chevrons vertically centred on the
    left/right edges (disabled at deck ends so they never push
    `currentIdx` out of bounds). `Shift+Space` is wired in the
    keyboard handler as the presenter convention for previous-slide
    (Space alone still pages forward).
  - `exportPdf()` now calls `downloadRasterDeckPdf` for the advanced
    path, exposes per-slide progress in the chrome ("Rendering slide
    X of N…"), disables both chrome buttons while exporting, and on
    failure raises an inline bottom-right toast (red banner with the
    error message + a one-click "Use browser print as fallback"
    action that triggers `window.print()`). The share route renders
    outside `ProtectedLayout`, so there's no global `useToast` context
    — the toast is local to `PitchDeckPrintPage`. Legacy purple-card
    decks (no recognisable `method_id`) still use the
    `@react-pdf/renderer` primitive path because they don't carry the
    `data-slide-frame` contract at native 1920×1080.
  - Filename: `{slugified-title}-{YYYY-MM-DD}.pdf` (local-tz date),
    per spec.
- **`PrintStage`** rewritten with two render modes selected by the new
  `isFullscreen` prop. Both modes share the same `.deck-print-stage` /
  `.deck-print-scaler` / `.deck-print-inner` / `.deck-print-frames`
  class chain so the rasteriser onclone hook + the legacy `@media print`
  rules behave identically. Fullscreen mode wraps the scaler in a
  `[data-fullscreen-viewport]` clip with `overflow: hidden, width:
  1920×s, height: 1080×s`, scales by `min(vw/1920, vh/1080)` so the
  whole 16:9 frame is visible (letterboxed on the dominant axis), and
  pages between slides via `transform: translateY(-currentIdx ×
  1080px)` on `.deck-print-frames` (inside the scale wrapper, so the
  native-px translate scales to exactly one screen-slide-height). 250ms
  ease transition.
- **Legacy `@media print` rules retained** for users who still hit
  Ctrl/Cmd+P — the print stylesheet now also resets fullscreen-mode
  inline styles (`position:static`, `transform:none`,
  `[data-fullscreen-viewport]{overflow:visible}`) so the browser-print
  fallback still produces the same one-page-per-slide 1920×1080 PDF
  it always did.
- **Dependencies**: `frontend/package.json` adds
  `html2canvas@^1.4.1` and `jspdf@^4.2.1` (v4 chosen over v2 because
  v2 transitively pinned a vulnerable `dompurify`; v4 dropped that
  dep entirely — `npm audit --omit=dev --audit-level=high` reports
  zero vulnerabilities). Both are lazy-loaded from
  `deckRasterPdf.js` so the viewer's initial chunk stays at 32 KB
  gzipped; the heavy libs (`html2canvas` 47 KB gzip, `jspdf.es.min`
  127 KB gzip) only ship to users who actually click Save as PDF.

Out of scope (per the task spec): server-side PDF rendering, PPTX
export, editing-in-fullscreen, the legacy `@react-pdf/renderer` path
for non-advanced decks, and any in-page scrollable preview changes.

Verified: `node scripts/check-deck-templates.mjs` → `12 templates
wired correctly`; `npx vite build` → clean build with new
`html2canvas-*.js` and `jspdf.es.min-*.js` async chunks.


## Task #10 — Sales — Customer-facing: 18-slide enterprise-commercial upgrade

Replaced the 15-slide simple `sales_commercial` template with an
18-slide self-contained enterprise customer-facing deck across five
sections (Customer Context · Solution · Value · Implementation ·
Commercials). NOT an investor deck — outcome-first, ROI-anchored,
security-credible, implementation-realistic. Hand-built SVG product
screens (dashboard / workflow / analytics) and diagrams (forces,
pains, KPI gaps, ROI build, competitive matrix, deployment phases,
security controls, pricing tiers). Mirrors the in-place swap pattern
from Task #2 (Series A), Task #3 (Series B), Task #5 (Demo Day), and
Task #6 (Partnership/BD) — registry slot stable (`sales_commercial`),
drift count unchanged at 12 templates.

- **`frontend/src/decks/templates/sales_commercial_app.tsx`** — new
  self-contained ~2280-line template with `SalesData` type,
  `SAMPLE_DATA` mirroring the worker `heuristicSlides()` field names
  documented inline at the bottom (`meta.*`, `executive.outcomes`,
  `industry_trends.forces`, `challenges.pains`, `business_impact.kpis`,
  `solution.capabilities`/`transformation`, `how_it_works.steps`,
  `features.modules`, `use_cases[].screen`, `roi.components`,
  `case_studies.studies`, `competitive.criteria`, `deployment.phases`,
  `integration.layers`/`integrations`, `security.controls`/
  `certifications`, `pricing.tiers`/`services`, `next_steps.pilot`/
  `timeline`). Appends `Deck_sales_commercial_app: React.FC<RegistryDeckProps>`
  adapter that `mergeShape`s incoming `data` over `SAMPLE_DATA`
  (shape-safe: empty arrays don't nuke defaults), bridges the
  template's array-path `Edit` signature to the registry's dot-string
  `onEdit`, and wraps each of the 18 `<Sn…>` components in
  `<Slide16x9>` so the print pipeline (`PitchDeckPrintPage.jsx`)
  finds them via `[data-slide-frame]` and per-slide page breaks fire.
- **`frontend/src/decks/templates/sales_commercial.tsx`** — collapsed
  to a one-line re-export
  (`export { Deck_sales_commercial_app as Deck_sales_commercial } from './sales_commercial_app';`)
  so the registry key `sales_commercial` stays stable and the
  `check-deck-templates.mjs` drift guard keeps finding the canonical
  `Deck_<key>` import from `./<key>`.
- **`frontend/src/decks/templates/index.ts`** — bumped to
  `slide_count: 18` + description `'18 slides · customer-facing · SVG
  product screens'`. Tier (`growth`) and category (`commercial`)
  unchanged.
- **`frontend/src/decks/sample.ts`** — added `sales_commercial` branch
  in `previewDataFor()` returning `SALES_COMMERCIAL_APP_SAMPLE` so the
  template-picker thumbnail receives the nested `meta.*` /
  `executive.outcomes[]` / `use_cases[].screen` /
  `competitive.criteria[].scores[]` shapes the slides expect instead
  of the legacy `SAMPLE_PREVIEW_DATA` strings (which would crash the
  thumbnail the same way the old `series_b_diligence` and
  `partnership_bd` shapes did).

Verified `node scripts/check-deck-templates.mjs` → `12 templates
wired correctly`.

Out of scope (kept per the task spec): backing schema migrations for
the sales-specific tables (`customer_opportunities`,
`customer_success_stories`, `pricing_plans`, `deployment_phases`,
`security_controls`, `compliance_certs`, `competitive_matrix`) and
the per-template `heuristicSlides()` branch that would read them.
Like every prior `_app.tsx` upgrade (Series A/B, Demo Day,
Partnership/BD), the deck renders against `SAMPLE_DATA` until those
side tables land — `mergeShape()` preserves the defaults field-by-
field for anything autofill doesn't provide. The inline mapping
comment at the bottom of `sales_commercial_app.tsx` is the spec for
the future worker branch.

## Task #6 — Partnership / BD: 12-slide executive-consulting upgrade

Replaced the 11-slide simple `partnership_bd` template with a 12-slide
self-contained executive-consulting variant (McKinsey / Bain /
Accenture / AWS tone). Hand-built SVG diagrams throughout (hero
convergence, industry-shifts chart, 2×2 opportunity quadrants,
ecosystem diagram, architecture stack, impact chart, roadmap gantt,
revenue-flow Sankey, risk heatmap, future-state arrow), executive
blue + gold palette, Source Serif Pro for headlines. Mirrors the
in-place swap pattern from Task #2 (Series A), Task #3 (Series B),
and Task #5 (Demo Day) — registry slot stable (`partnership_bd`),
drift count unchanged at 12 templates.

- **`frontend/src/decks/templates/partnership_bd_app.tsx`** — new
  self-contained 1960-line template with `PartnershipData` type,
  `SAMPLE_DATA` mirroring the worker `heuristicSlides()` field names
  (`meta.*`, `executive_summary.three_pillars`, `industry_context.shifts`,
  `partner_challenges.challenges`, `shared_opportunity.quadrants`,
  `solution_overview.*_responsibilities`, `product_platform.layers`,
  `business_benefits.kpis`, `implementation_roadmap.phases`,
  `case_studies.studies`, `commercial_structure.economics`,
  `governance_risk.bodies`/`risks`, `next_steps.pilot`/`timeline`).
  Appends `Deck_partnership_bd_app: React.FC<RegistryDeckProps>`
  adapter that `mergeShape`s incoming `data` over `SAMPLE_DATA`
  (shape-safe: empty arrays don't nuke defaults), bridges the
  template's array-path `Edit` signature to the registry's dot-string
  `onEdit`, and wraps each of the 12 `<SlideN…>` components in
  `<Slide16x9>` so the print pipeline (`PitchDeckPrintPage.jsx`)
  finds them via `[data-slide-frame]` and per-slide page breaks fire.
- **`frontend/src/decks/templates/partnership_bd.tsx`** — collapsed
  to a one-line re-export
  (`export { Deck_partnership_bd_app as Deck_partnership_bd } from './partnership_bd_app';`)
  so the registry key `partnership_bd` stays stable and the
  `check-deck-templates.mjs` drift guard keeps finding the canonical
  `Deck_<key>` import from `./<key>`.
- **`frontend/src/decks/templates/index.ts`** — updated description
  to `'12 slides · executive consulting · SVG diagrams'`. Slide count
  (12), tier (`growth`), and category (`commercial`) unchanged.
- **`frontend/src/decks/sample.ts`** — added `partnership_bd` branch
  in `previewDataFor()` returning `PARTNERSHIP_BD_APP_SAMPLE` so the
  template-picker thumbnail receives the nested `meta.*` /
  `executive_summary.three_pillars` / `industry_context.shifts[]` /
  `implementation_roadmap.phases[]` shapes the slides expect instead
  of the legacy `SAMPLE_PREVIEW_DATA` strings (which would crash the
  thumbnail the same way the old `series_b_diligence` shape did).

Verified `node scripts/check-deck-templates.mjs` → `12 templates
wired correctly`.

## Task #5 — Demo Day: render fix (Pill violet tone)

`Slide10Market` rendered `<Pill tone="violet">` but `Pill`'s palette
only had `accent | electric | emerald | neutral`. `palette[tone]`
returned `undefined`, then reading `.bg` threw at render time and
`ThumbnailBoundary` surfaced "Failed to render demo_day" in the
template picker preview.

- **`frontend/src/decks/templates/demo_day_app.tsx`** — extended `PillTone`
  with `violet | amber | rose` (the three remaining `C.*` accents) and
  added a `?? neutral` fallback on the palette lookup so unknown tones
  degrade gracefully instead of crashing. Also hardened two related
  partial-payload paths flagged by code review: `FeatureSlide` now
  normalizes per-field (not just per-index) so a feature object with
  only `{name}` no longer null-derefs on `bullets.map` / `name.toLowerCase`;
  `Slide8Love` avatar initials now coerce `t.author ?? '—'` before splitting.

## Task #5 — Demo Day: 12-slide product-first upgrade

Replaced the 11-slide screenshot-stub `demo_day` template with a
12-slide product-first self-contained variant. Hand-built SVG product
mockups (dashboard / before-after workflow / split editor / kanban /
analytics / mobile), warm Demo-Day orange (`#FF5A1F`) accent, no
recharts. Mirrors the in-place swap pattern from Task #2 (Series A)
and Task #3 (Series B) — registry slot stable (`demo_day`), drift
count unchanged.

- **`frontend/src/decks/templates/demo_day_app.tsx`** — new file
  (~1828 lines). Local `SlideFrame` chrome, 12 slide components
  (Cover / Problem / Solution / Walkthrough / 3× Feature deep-screen /
  Love / Traction / Market / Team / Fundraise), standalone
  `DemoDayDeckApp` viewer with framer-motion shell + dot nav, plus
  `mergeShape()` helper and registry adapter `Deck_demo_day_app` that
  wraps each slide in `<Slide16x9>` so the print pipeline finds them
  via `[data-slide-frame]` and per-slide page breaks fire during
  `window.print()`. Exports `DemoDayData` type + `SAMPLE_DATA`
  (`Loopline`, $12M Series A ask, 12-month ARR series). Adapter
  bridges demo_day's array-path `onEdit` signature to the registry's
  dot-string signature.
- **`frontend/src/decks/templates/demo_day.tsx`** — rewritten as a
  single-line re-export: `export { Deck_demo_day_app as Deck_demo_day }
  from './demo_day_app';`. Keeps `method_id=demo_day` stable and
  satisfies `scripts/check-deck-templates.mjs` (it still finds
  `Deck_demo_day` exported from `./demo_day`).
- **`frontend/src/decks/templates/index.ts`** — `demo_day` entry
  bumped from `slide_count: 11` / `'11 slides · screenshot-heavy'` to
  `slide_count: 12` / `'12 slides · product-first · SVG mockups'`.
- **`frontend/src/decks/sample.ts`** — added `DEMO_DAY_APP_SAMPLE`
  import and a `templateKey === 'demo_day'` branch in
  `previewDataFor()` so the thumbnail / preview surfaces use the new
  nested shape (`company.{name,logo_mark}`, `cover.metric_strip`,
  `features[]`, `traction.monthly_arr_series`,
  `fundraise.use_of_funds`, etc.). Same pattern as Series A/B.
- Verified: `node scripts/check-deck-templates.mjs` → 12 templates
  wired correctly; `npx vite build` → clean build, new chunk
  `demo_day_app-*.js` (247 KB / 59 KB gzip).

## Task #3 — Series B Diligence Pack: 32-slide board-grade upgrade

Replaced the 1-slide `series_b_diligence` placeholder with a 32-slide
(22 main + 10 appendix) self-contained variant in the Snowflake /
Datadog / Atlassian visual register — board / IC quality, Recharts +
framer-motion + SVG. Sections: Opportunity, Product, Traction, GTM,
Defensibility, Organization, Investment, plus appendix
(financials, cohorts, segmentation, funnel, pricing, architecture,
security, risks, governance, three-year plan). Mirrors the Series A
pattern from Task #2 (registry slot stable, drift count unchanged).

- **`frontend/src/decks/templates/series_b_diligence_app.tsx`** — new
  file (~2700 lines). Local `SlideFrame` chrome, 22 main slide
  components + 10 appendix components, internal `SLIDES` array used
  by both the standalone `SeriesBDiligenceDeckApp` and the registry
  adapter. Source SAMPLE_DATA was truncated mid-object in the
  attachment; closed cleanly — slide internals already guard with
  `g.X?.length ? g.X : [...]` fallbacks so each slide renders the
  baked-in defaults when a field is missing.
- **Registry adapter** appended to the same file:
  `Deck_series_b_diligence_app` maps every `SLIDES[i]` through
  `<Slide16x9>` from `../DeckBase` so PitchDeckPrintPage's
  `[data-slide-frame]` selector + per-slide `pageBreakAfter` fire
  for keyboard nav AND `window.print()` PDF export.
- **`mergeShape()`** — shape-safe deep merge preserves SAMPLE_DATA
  defaults when autofill ships partial data (arrays only override
  when non-empty, objects merge field-by-field). Identical pattern
  to `series_a_growth_app.tsx`.
- **`frontend/src/decks/templates/series_b_diligence.tsx`** — collapsed
  to a one-line re-export so the drift regex `Deck_<key>` from
  `./<key>` stays green and `method_id=series_b_diligence` is stable
  for already-persisted decks (no migration needed).
- **`frontend/src/decks/sample.ts`** — added `series_b_diligence`
  branch in `previewDataFor()` so the picker thumbnail + preview
  pull the richer SAMPLE_DATA shape (`platform_layers`,
  `retention_cohort`, `financial_statements`, `three_year_plan`, …)
  instead of the legacy string-shape `SAMPLE_PREVIEW_DATA`.
- **`frontend/src/decks/templates/index.ts`** — metadata bumped to
  `slide_count: 32` + description "22 main + 10 appendix ·
  board-grade" (was 26). Registry still 12 entries;
  `scripts/check-deck-templates.mjs` green.
- Share-link CTA routing (Task #6) unchanged — `category: 'fundraising'`
  → auto-generated deal-pack + e-sign flow at deck end.

## Task #21 — Minimal Seed deck: Linear/Stripe/Figma-aesthetic upgrade

Replaced the bare 6-slide Minimal Seed template (the ~40-line "big
type on white" stub) with a richly-illustrated 6-slide deck in the
Linear / Stripe / Notion / Figma visual register — one accent
(`#5E6AD2`), one mono pairing, SVG-only illustrations (product
window mockup, friction-grid illustration, before/after flow,
gradient area charts, expertise radar, donut, timeline). One
investor question per slide; designed to walk through the entire
company in under three minutes.

- **`frontend/src/decks/templates/minimal_seed.tsx`** — fully rewritten
  (~1380 lines). Six slide components (`Slide1Company`, `Slide2Problem`,
  `Slide3Solution`, `Slide4Traction`, `Slide5Team`, `Slide6Ask`) +
  shared `SlideFrame` chrome (eyebrow, investor question, footer with
  company name + "Confidential"). `SlideFrame` carries
  `data-slide-frame=""`, a fixed `1920 × 1080` box, and
  `pageBreakAfter: 'always'` — exactly the contract `Slide16x9` in
  `DeckBase.tsx` exposes — so `PitchDeckPrintPage.jsx`'s keyboard
  nav / page-break / PDF export pipeline picks the new slides up with
  zero changes on the consumer side.
- **`Deck_minimal_seed` registry adapter** — accepts the registry-wide
  `DeckProps` from `DeckBase`, merges incoming Axal `data` (built by
  `PitchDeckPrintPage.buildTemplateData`) over a rich `SAMPLE_DATA`
  block **field-by-field**, then emits the 6 slides as a fragment.
  Field-by-field (rather than whole-object) merge guarantees that any
  field the founder hasn't filled in still renders with a plausible
  default, so the deck never collapses to placeholder text mid-pitch.
  Object-valued fields listed in `NESTED_OBJECT_FIELDS` (currently
  just `problem_stat`) are **deep-merged** per subfield so a partial
  Axal payload like `problem_stat: { value: '$2B' }` keeps the
  sample `.label` instead of nuking it. Arrays-of-objects (`founders`,
  `milestones`, `roadmap`, `use_of_funds`, …) stay "replace if
  provided" — a partial array from Axal means "render exactly what I
  gave you," not zip-merge by index. Legacy editor field `ask_amount`
  is normalised to `ask_amount_usd` so Kawasaki-style records keep
  rendering.
- **`MinimalSeedDeckApp` standalone shell** — also exported, with
  Framer Motion `AnimatePresence` + `useReducedMotion` page transitions,
  keyboard nav, and dot pagination. Not used by the print pipeline; kept
  for any caller that wants the live single-screen viewer.
- **`frontend/package.json`** — added `framer-motion` (React 19
  compatible). Print pipeline does not depend on it; only the
  standalone viewer does.
- **Local-prop rename** — the paste's local `DeckProps` type renamed
  to `SlideProps` so it doesn't shadow the registry-wide `DeckProps`
  re-exported by `DeckBase.tsx`.

No registry, slide-count, or filename changes — the template is still
keyed as `minimal_seed`, still declares `slide_count: 6`,
`required_tier: 'free'`, `category: 'fundraising'`, and `Deck_minimal_seed`
is still the named export. `frontend/src/decks/templates/index.ts`
needs no edits.

Out of scope (not landed here): the platform-side autofill columns
referenced by the paste's "How to wire it" note
(`problem_stat_json`, `before_state_json`, `differentiators_json`,
`customer_logos_json`, `expertise_axes_json`, `expertise_values_json`,
`team_timeline_json`, `closing_line`, etc.) — they live in the
separate `DECK_AUTOFILL_AUDIT.md` migration thread. Until those land,
the deck falls back to `SAMPLE_DATA` per-field for the unmapped
columns, which is exactly the new field-level merge behaviour above.


## Task #15 — Keyboard arrows in fullscreen for one-time link decks

Pitch-deck share viewer (`/share/deck/:token` and legacy
`/deck/share/:token`) now reliably advances slides via
`→ / ← / ↑ / ↓ / PageDown / PageUp / Space / j / k / Home / End` (and
`f` to toggle fullscreen) **while in fullscreen** for every registered
deck template — Kawasaki, Sequoia, YC Seed, Series A/B, Sales,
Partnership BD, One-Pager Teaser, Narrative Brand, Minimal Seed,
Investor Appendix, Demo Day, plus the legacy purple-card fallback.

Root cause was a focus / event-routing bug, not a missing handler.
Task #11 already wired a window-level keydown listener and the
`data-slide-frame` markers on both render paths; what was missing
was that some browsers (Safari, Firefox) route keys to the
fullscreen element before they reach `window`, and the stage was
not focusable, so the browser's default scroll handler swallowed
arrow keys before our handler ran.

- **`frontend/src/pages/PitchDeckPrintPage.jsx`**:
  - `toggleFullscreen()` now calls `stageRef.current.focus({preventScroll:true})`
    immediately after `await requestFullscreen()` so the stage div
    becomes `document.activeElement` in fullscreen.
  - Both render branches (advanced + legacy fallback) on the
    `ref={stageRef}` div now carry `tabIndex={-1}` (programmatically
    focusable, stays out of the Tab order) and `outline-none` so the
    focus ring doesn't render around the stage chrome.
  - Keydown listener moved from `window` to `document` to also catch
    keys routed to the fullscreen element on Safari / Firefox.
  - All existing guards preserved (skip when an editable element is
    focused, skip when modifier keys are held, fullscreen-aware
    current-slide anchor, advance via `scrollIntoView`).

No changes to the build/preview surface (`PitchDeckPage.jsx`), no
new dependencies, no schema or worker changes. Verified every
template in `frontend/src/decks/templates/*.tsx` routes through
`Slide16x9` (which already carries `data-slide-frame`); the legacy
gradient fallback already had the marker.


## Task #1 — Force Google account picker + atomic one-Google-to-one-Axal guard

Calendar / Integrations "Connect Google" now always renders Google's
account chooser and refuses — atomically, even under concurrent connects —
to bind a Google identity that already belongs to a different Axal user.

Hardening pass after code review:

- `ensureCalendarOAuthSchema` now also creates a **partial UNIQUE INDEX**
  `idx_google_oauth_tokens_google_sub_unique` on
  `google_oauth_tokens(google_sub) WHERE google_sub IS NOT NULL`. Two
  concurrent callbacks for the same `google_sub` on different `user_id`s
  can both pass the pre-check, but only one INSERT/UPDATE wins — the
  loser surfaces a `UNIQUE constraint failed` which the callback maps
  back to the same `google_already_linked_other_user` redirect.
- `/api/calendar/google/callback` persistence logic extracted into a
  pure exported helper `persistGoogleCallbackTokens(env, args)` for
  testability.
- `user_google_links` insert is no longer `INSERT OR IGNORE` (silent
  no-op on UNIQUE) — it now checks for an existing self-row first
  (same-user reconnect stays idempotent) and otherwise INSERTs with an
  explicit UNIQUE catch that returns the same explicit collision
  reason. Stops the failure mode where a different-user racer left
  calendar tokens for one user but a sign-in link for another.
- Tests: callback-level coverage in
  `cloudflare-worker/test/calendar.google-oauth.test.ts` for (a)
  token-side collision rejection, (b) link-side collision rejection,
  (c) same-user reconnect idempotency, (d) racer-past-pre-check →
  UNIQUE-catch → collision reason.

- **`cloudflare-worker/src/services/calendar.ts::buildGoogleAuthUrl`** —
  `prompt` flipped from `consent` to `select_account consent`; new
  optional 3rd arg `loginHint` is attached as `login_hint=` so the
  chooser pre-selects the row matching the signed-in Axal user.
- **`cloudflare-worker/src/routes/calendar.ts::buildGoogleOAuthStartResponse`**
  takes the new `loginHint` arg; the `startGoogleOAuth` Hono handler
  passes the JWT user's email down (lower-cased, trimmed) so the
  chooser always has the right hint at connect time.
- **`/api/calendar/google/callback`** — before any write, looks up
  the incoming `google_sub` in both `google_oauth_tokens` and
  `user_google_links`; if either row exists with a different
  `user_id`, short-circuits via
  `failureRedirect(env, 'google', 'google_already_linked_other_user', returnTo)`.
  Lookup → reject → upsert ordered inside the single request so a
  concurrent connect can't slip past. Existing strict email-match
  guard for `returnTo=integrations` is unchanged.
- **`frontend/src/pages/IntegrationsPage.jsx`** — new
  `google_already_linked_other_user` reason maps to a tile-local
  red inline error: "That Google account (...) is already connected
  to another Axal user — disconnect it there first, then try again."
- **`frontend/src/pages/CalendarPage.jsx::humanizeOAuthReason`** —
  same code, plus the previously-unmapped `email_mismatch` /
  `email_unverified` reasons, are now rendered as human sentences in
  the `/calendar` page's connect-result banner.
- **Tests** — `cloudflare-worker/test/calendar.google-oauth.test.ts`
  gains two assertions: (1) `prompt=select_account consent` is set
  and `login_hint` is absent when not supplied; (2) `login_hint`
  attaches verbatim when an email is passed. The existing redirect_uri
  / start-response tests still pass unchanged.
- **`replit.md`** — Calendar OAuth bullet extended with the
  Task #1 contract.

Out of scope (kept per the task spec): Google's "unverified app"
interstitial (ops/Google Cloud Console matter), Microsoft OAuth flow,
backfill of any pre-existing `google_oauth_tokens` rows that already
share a `google_sub` across users.


## Task #7 — Mask integration keys + promote to Cloudflare Worker secrets

Admin Integration Keys panel no longer leaves long-lived encrypted DB
rows. Save / Rotate now push directly to the live Worker script as
real Worker secrets via the Cloudflare API, the encrypted
`provider_oauth_keys` row is dropped on success, and `client_id` is
masked as `first4••••last4` everywhere it surfaces.

- **`cloudflare-worker/src/services/cloudflareSecrets.ts`** (new) —
  `setSecret(env, name, value)` + `deleteSecret(env, name)` wrap CF's
  `PUT/DELETE /accounts/{id}/workers/scripts/{script}/secrets`.
  Returns a typed `{ok, status, code, error}` with stable codes
  `cloudflare_api_token_missing` / `cf_api_forbidden` / `cf_api_failed`.
  Reads `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (+ optional
  `CF_WORKER_SCRIPT_NAME`, default `studioos`). Never logs token
  values. Idempotent delete (404 → ok). Also exports the shared
  `maskClientId()` helper.
- **`cloudflare-worker/src/services/providerOauthKeys.ts`** —
  `listProviderKeyStatus()` now masks `client_id_preview` via
  `maskClientId()` for both env and DB sources. Added
  `deleteOauthCredsRowOnly()` that drops the row WITHOUT cascading
  `integrations.status='disconnected'` — used after a successful CF
  push so existing user OAuth tokens stay valid.
- **`cloudflare-worker/src/routes/admin_integration_keys.ts`** —
  PUT pushes ID then SECRET; if SECRET fails, ID is rolled back via
  `deleteSecret()` so no half-set pair survives. Only after both
  succeed does `deleteOauthCredsRowOnly()` clear the DB row. Rotate
  pushes the SECRET half and clears the row. Delete removes both
  Worker secrets then runs the existing
  `deleteOauthCredsAndDisconnect()` cascade. Every push/rotate/delete
  writes an `admin_audit_log` row with `report_type='integration_keys'`
  and action `integration_key_cf_secret_{push,rotate,delete}` (same
  shape as `telegram_pii_override`). When the token is unset, Rotate
  falls back to the legacy encrypted-DB path so admins aren't locked
  out; Save returns 503 `{error:'cloudflare_api_token_missing'}`.
- **`cloudflare-worker/src/types.ts`** — `CLOUDFLARE_API_TOKEN?` and
  `CF_WORKER_SCRIPT_NAME?` declared on `Env`.
- **`frontend/src/pages/AdminPage.jsx`** — Integration Keys card
  renders `row.client_id_preview` verbatim (no client-side
  truncation). The Edit/Rotate modal already never pre-filled the
  field, so no UX regression on rotate.

**Ops to-do (user)** — see `replit.md` item (f). Create a Cloudflare
API token scoped to `Workers Scripts: Edit` on the studioos worker
and `wrangler secret put CLOUDFLARE_API_TOKEN --env production`.
Until then, Save returns the actionable 503; existing rows already in
`provider_oauth_keys` keep working until an admin re-saves them
(lazy migration, no destructive backfill).


## Task #4 — Admin X (Twitter) posts + aggregator

Twin of Task #3 (Telegram). Admins link one or more X accounts via OAuth 2.0
PKCE, compose tweets / threads in a 280-char composer (live counter, X-style
preview, media + alt-text via Workers AI LLaVA), and broadcast through the
same PII-redaction gate as Telegram (`telegramRedactCheck.lintForSend` with
`audience='public'` — the strictest setting). Per-day cap is 20 sends per
account per day (KV `x_quota:{account_id}:{yyyy-mm-dd}`, TTL 36h, override
via `X_DAILY_CAP`). Threads send head-first, then children anchor via
`thread_continuation_of`; partial failures are recorded so a half-sent thread
can be inspected. Aggregator reuses the six canonical audiences from Task #3
and appends hashtags, persisting head + child rows.

**Schema (`cloudflare-worker/sql/migrations/068_x_twitter.sql` — pending apply)**
- `x_accounts` (handle, x_user_id UNIQUE, scopes, access_token_ct,
  refresh_token_ct, expires_at, status). Tokens are AES-GCM via `cryptoBox`.
- `x_posts` (account_id, status `draft|approved|scheduled|sent|failed|retracted`,
  body, media_keys JSON, thread_continuation_of, scheduled_at, sent_at,
  remote_tweet_id, override_reason, override_findings, created_by).
- Worker carries `ensureXSchema()` lazy bootstrap (same pattern as
  `ensureTelegramSchema` / `ensureNewsSchema`), so the tables auto-create on
  first hit if the migration hasn't been applied yet.

**Worker routes (`/api/admin/x`, mounted BEFORE `/api/admin` catch-all)**
- Accounts: `GET /accounts`, `POST /accounts`, `DELETE /accounts/:id`,
  `POST /accounts/:id/test` (GET `/users/me` round-trip).
- OAuth: `GET /oauth/start?account_id=` (PKCE, KV `xstate:{state}` TTL 10m),
  `GET /oauth/callback` (redirects to `/admin/x?x_oauth_linked|error=`).
- Posts: list/create/update/delete drafts, `/lint`, `/approve`, `/schedule`,
  `/send` (daily-cap compare-and-set + head→children + PII override path
  requiring `override_reason ≥8 chars`), `/retract` (X API DELETE).
- Media: `POST /posts/:id/media` (R2 `x/{account_id}/{post_id}/{uuid}.{ext}`,
  magic-byte sniff, ≤5 MB, ≤4 per tweet), `POST /posts/:id/alt-text`
  (Workers AI `@cf/llava-hf/llava-1.5-7b-hf`).
- Aggregator: `POST /aggregator/run` (6 audiences, hashtag append, persists
  head + child rows; never auto-sends).

**Frontend (`/admin/x`)**
- 5 tabs: Accounts / Compose / Drafts / History / Aggregator.
- Composer: live 280-char counter, thread mode (auto-split via
  `splitIntoThread`), media uploader, alt-text generator, override modal,
  X-style preview pane.
- Surfaces `?x_oauth_linked` query param as a success toast after callback.

**Envs / secrets**
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_BEARER_TOKEN` — Worker secrets only
  (push via `wrangler secret put`, never `.replit`).
- `X_DAILY_CAP` — optional override (default 20). When OAuth secrets are
  unset, all send paths return 503 `{code:'x_config_missing'}`; draft +
  linter still work.

**Reuses**
- `telegramRedactCheck.ts` (Task #3) — no duplication; X is always public so
  callers pass `audience='public'` unconditionally.
- `cryptoBox` AES-GCM at-rest encryption (same 100k PBKDF2 + 200k legacy
  fallback as Telegram and the calendar tokens).
- `hashEmail` for `admin_audit_log.actor` (`x_account_*`, `x_post_*`,
  `x_pii_override`, `x_post_retracted`, `x_aggregator_run`).


## Task #2 — News with author proposals + admin review queue

Public `/news` reader (Jekyll-side, separate repo — out of scope here)
backed by a new author/admin workflow inside StudioOS. Trusted members
(`trust_score >= 70`) write articles in markdown, submit them for
review, iterate on comments, and watch admins approve → publish to the
60-day edge cache. PII linter is shared with Task #3 — emails, phone
numbers, IDs, and cross-user mentions all block submit (no admin
override on the author side; admins can still post-edit).

**Schema (`cloudflare-worker/sql/migrations/068_news_articles.sql` — pending apply)**
- `articles` (slug, title, subtitle, body_markdown, body_html, sector,
  tags JSON, status `draft|submitted|in_review|changes_requested|approved|published|rejected`,
  author_user_id, reviewer_user_id, submitted_at, reviewed_at, approved_at,
  published_at, rejected_at, rejection_reason, cover_r2_key, cover_mime,
  word_count, read_minutes). Slug unique; status+published_at and
  status+submitted_at indexed for the public list and admin queue.
- `article_revisions` — snapshot on every state transition + manual save.
- `article_review_comments` — admin comments with optional `anchor`
  (paragraph index) and resolve toggle.
- `article_submission_log` — feeds the 3-per-week rate limit.

Worker carries `ensureNewsSchema()` lazy bootstrap mirroring
`ensureTelegramSchema()` / `ensureTeamMembersSchema()`, so the four
tables auto-create on first hit when 068 lands unapplied. Apply via
`wrangler d1 execute studioos-db --remote --env production
--file=cloudflare-worker/sql/migrations/068_news_articles.sql`.

**Trust score (`services/newsTrust.ts`)**
Computed at read time (the `users` table is at the D1 ALTER column
limit — see `replit.md`). Per the spec formula: base 50, admin=100,
KYB+15, signed partner deal +10, Spin-Out Lab grad +10, 90-day-clean
+10, KYC + verified email +5, cap 100. `90-day-clean` requires
account age ≥ 90d and no rejected article or flagged scoring alert in
that window. Surfaced to the author via `GET /api/news/trust/me`.

**Routes (`routes/news.ts`)** — mounted at `/api/news`, outside the
admin perimeter so the public GETs work:
- Public: `GET /` (list), `GET /:slug`, `GET /cover/:id`. CORS-open to
  `axal.vc` / `www.axal.vc`; served from Cloudflare's edge cache
  (`caches.default`) with `max-age = s-maxage = 60 * 86400`. Publish +
  unpublish bust the three cache keys (`bustEdgeCache()` in
  `services/newsRender.ts`).
- Author (auth + trust gate): `POST /draft`, `GET /draft/:id`,
  `PUT /:id`, `POST /:id/submit` (rate-limited 3/week + PII linter),
  `POST /:id/retract`, `POST /:id/cover` (R2, 5 MB, jpg/png/webp),
  `GET /mine`, `GET /trust/me`.

**Admin queue (`routes/admin_news.ts`)** — mounted at
`/api/admin/news` **before** the catch-all `/api/admin` (same
precedence trick as `/api/admin/telegram`). Inside the existing
`/api/admin/*` CF-Access perimeter; per-route `requireAdmin`. Endpoints:
queue list (with status filter), single-article detail (article +
revisions + comments), start-review / approve / publish / unpublish /
request-changes / reject (the last two require a reason ≥ 8 chars and
are sent to the author via the notification fanout), and comment
CRUD with resolved-state toggle.

**Notifications (`services/newsNotify.ts`)** — seven state-transition
events via the existing `notify()` channel (in-app + email): submit
confirms to the author, alerts every admin; in-review / changes
requested / approved / rejected / published all email the author.

**Markdown renderer (`services/newsRender.ts`)** — in-house sanitised
renderer (no new bundle deps). Input is HTML-escaped first, then
tokenised: headings, bold, italic, links (forced
`rel="noopener nofollow" target="_blank"`), unordered + ordered
lists, blockquotes, fenced code blocks, inline code, paragraphs.
Anything else passes through as text — no attacker-controlled HTML
can survive. The same helper computes `word_count` + `read_minutes`
(220 wpm).

**Frontend**
- `frontend/src/pages/NewsAuthorPage.jsx` (route `/news`, gated to
  `admin|founder|partner|investor|mentor`) — sidebar of own drafts,
  markdown editor + live preview, title/subtitle/sector/tag inputs,
  cover upload, save / submit / retract, inline view of reviewer
  comments and rejection reasons, trust-score chip with min-required
  hint.
- `frontend/src/pages/admin/AdminNewsQueue.jsx` (route
  `/admin/news`, admin-only) — status tabs (new / in review /
  changes requested / ready to publish / all open), three-pane review
  layout with body, comment thread, and revision history. Prompt
  modals for request-changes + reject (reason required).
- API helpers `news` and `adminNews` added to
  `frontend/src/lib/api.js`.

**Public Jekyll surface** — the `/news` index and per-article pages
on `axal.vc` are templated in the separate `axalnetwork.github.io`
repo and remain out of scope for this task. Their build curls
`https://app.axal.vc/api/news` and `…/api/news/:slug` (CORS-open) at
publish time; once that repo is updated, no further StudioOS change
is needed.

**Persistent gotcha** — when adding new admin sub-routers in future,
keep the `app.route('/api/admin/<sub>', …)` mounts **above** the
catch-all `app.route('/api/admin', admin)`; otherwise Hono matches
the catch-all first and the sub-routes 404 inside the generic admin
router.


## Task #3 — Admin Telegram channels + aggregator + PII linter

Admin-only system to broadcast curated digests to the public `@axalvc`
channel + five invite-only cohort channels (founders, investors,
mentors, operating partners, alumni). Drafts are produced by an
aggregator from existing platform signals; admin reviews, edits, and
sends. No automatic posting without admin approval; PII linter blocks
leaky drafts unless the admin supplies a typed override reason
(recorded in `admin_audit_log`).

**Schema (`cloudflare-worker/sql/migrations/067_telegram.sql` — pending apply)**
- `telegram_channels` (slug, label, chat_id, audience, is_invite_only,
  enabled, last_test_at, last_error). Seeds the six canonical channels
  with `chat_id = NULL` so the admin can paste real IDs after the
  bot is added.
- `telegram_posts` (channel_id, status `draft|scheduled|sent|failed`,
  body_md, media_r2_key, scheduled_for, sent_at,
  telegram_message_id, telegram_link, source `manual|aggregator`,
  source_kind, body_hash, send_error, override_reason,
  override_findings, created_by).
- `telegram_aggregations` (audience, kind, payload_json, period_start,
  period_end, draft_post_id) — dedup + audit trail for aggregator runs.
- `user_promotion_consent` (user_id PK, consented, consented_at,
  source) — side table because `users` is at the D1 ALTER limit.
- Worker carries lazy `ensureTelegramSchema()` bootstrap so routes
  keep working if 067 lands unapplied.

**Worker — Telegram client + breaker (`services/telegramClient.ts`)**
- Wraps `sendMessage` / `sendPhoto` / `sendDocument` / `getChat` with
  in-isolate circuit breaker (5 consecutive failures → 60s recovery),
  exponential retry on 5xx, and 429 retry honouring `retry_after`.
- Typed errors: `TelegramTokenMissing` and `TelegramError` with
  code-based mapping (`telegram_token_missing`,
  `telegram_chat_not_found`, `telegram_rate_limited`,
  `telegram_forbidden`, `telegram_breaker_open`,
  `telegram_upstream`). Never a silent 500.
- MarkdownV2 escape helper + public-channel/private-channel permalink
  builder.

**Worker — PII linter (`services/telegramRedactCheck.ts`)**
- Regex scan for email / phone / SSN-ish tax ID / IBAN / 13-19 digit
  card-like sequences. Tax-ID and card hits are masked in findings.
- User-mention scan: matches body against `users` by email and by
  full-legal name; emits `consent_missing` when the user has no
  `user_promotion_consent` row, OR `private_in_public` when the
  channel audience is `public` (the public channel is aggregate-only).
- Returns `{ ok, findings[] }` — the route layer enforces the gate.
  Shared module so Task #4 LF (LinkedIn auto-poster) can reuse it.

**Worker — aggregator (`services/telegramAggregator.ts`)**
- Per-audience builders (`public`, `founders`, `investors`, `mentors`,
  `partners`, `alumni`) read counts from `projects`, `mentor_sessions`,
  `introductions`, `matches`, `deals`, `portfolio_updates`,
  `partner_deals`, `partner_office_hours`, `refer_earn_payouts`.
- Public-channel drafts use a k-anonymity gate (counts < 5 are
  suppressed).
- Every counter wrapped in `safeCount()` so missing tables degrade to
  zero instead of 500.
- `runAggregator()` inserts one draft per audience that has an
  enabled channel and writes a row to `telegram_aggregations`.

**Worker — admin routes (`routes/admin_telegram.ts`, mounted at
`/api/admin/telegram` — BEFORE the catch-all `/api/admin` per the
route-precedence invariant; sits behind the existing
`/api/admin/*` Cf-Access perimeter)**
- Channels: list, create, update (label / chat_id / enabled /
  is_invite_only), delete (refuses when sent posts exist — disable
  instead), test (calls `getChat` + sends a Markdown hello probe,
  records `last_test_at` / `last_error`).
- Posts: list (`?status=&channel_id=` with `clampLimit` + offset),
  create draft, edit (forbidden once sent), delete (forbidden once
  sent), media upload (data-URI body, R2-backed at
  `telegram/{channel_id}/{post_id}/{uuid}.{ext}`, 8 MB cap, photo
  jpeg/png/webp or document pdf/csv/txt), lint preview, schedule
  (status → `scheduled` with `scheduled_for`), send.
- Send path: runs lint → if findings and no `override_reason` (≥8
  chars) returns 422 `{ code: 'pii_linter_blocked', findings }`. With
  override: persists `override_reason` + `override_findings` and
  audits `telegram_pii_override` before the actual send. On success
  persists `telegram_message_id`, `telegram_link`, sha256 `body_hash`.
- Consent: GET/PUT `/consent/:user_id` for admin override; UPSERT
  honours `consented_at` only when flipping to true.
- Audit: every channel create/update/delete/test, every post
  create/edit/delete/media/schedule/send + every PII override writes
  `admin_audit_log` with `report_type='telegram'`, JSON `filters_json`
  carrying `post_id` / `channel_id` / `body_hash`, and SHA-256
  `email_hash` actor when the column is present (lazy PRAGMA check
  matches `admin_publications.ts`).

**Worker wiring**
- `types.ts` — `TELEGRAM_BOT_TOKEN?: string` added to `Env`. Never
  committed; provisioned via
  `wrangler secret put TELEGRAM_BOT_TOKEN --env production`. When
  unset, send endpoints return 503 `{code:'telegram_token_missing'}`
  — schema + admin UI remain fully usable for draft authoring.
- `index.ts` — imports `adminTelegram` and mounts it at
  `/api/admin/telegram` BEFORE `app.route('/api/admin', admin)`.

**Frontend — `/admin/telegram` (`pages/admin/AdminTelegram.jsx`)**
- Four tabs: Channels / Drafts / Compose / History.
- Channels: table with inline chat_id editing, enable/disable toggle,
  test-connect button (sends "hello" probe), add-channel modal with
  slug/label/audience/chat_id/invite-only fields.
- Drafts: aggregator panel (period-days input + run button) listing
  every open draft; cards show channel, audience, source badge,
  3-line body preview, edit + delete.
- Compose: full-page composer with title, MarkdownV2 body
  (4000-char counter), media attachment (lucide icon, native file
  picker), inline lint button + colour-coded findings panel,
  schedule input, send-now button. PII findings inline → override
  textarea (min 8 chars) → "Override and send" button.
- History: paginated sent-post list with audience badge, override
  badge, Telegram permalink, body-hash prefix.
- Toasts via `useToast`, modals via `useEscapeClose`, lucide icons
  + inline brand SVG only (no brand-icon packages), full `dark:`
  variants.
- API surface in `lib/api.js` as `adminTelegram` namespace mirroring
  the worker routes.
- Route registered in `App.jsx` as
  `guard(['admin'], <AdminTelegram />)` at `/admin/telegram`.

**Ops to-do (user)**
- Create the bot via BotFather, add it as admin (with
  "Post Messages") to all six channels, paste the real `chat_id`
  values in the admin UI.
- `wrangler secret put TELEGRAM_BOT_TOKEN --env production`
- Apply migration 067 against prod D1.


## Task #5 — Post-login redirect to axal.vc + onboarding-first routing

Completed the Phase 2 canonical-host flip and wired the post-login
onboarding gate for new users.

**Canonical-host flip (`wrangler.toml`)**
- `APP_URL` and `PUBLIC_BASE_URL` flipped to `https://axal.vc` in both
  `[vars]` and `[env.production.vars]`.
- Added `OAUTH_CALLBACK_BASE_URL = "https://app.axal.vc"` so all
  OAuth `redirect_uri` registrations (Calendar, LinkedIn, HubSpot,
  Salesforce, DocuSign, Carta, Slack, Stripe, Calendly) remain on
  `app.axal.vc` until provider dashboards are updated.

**`cloudflare-worker/src/util/url.ts`**
- New `callbackBase(env)` helper: `OAUTH_CALLBACK_BASE_URL → APP_URL →
  'https://app.axal.vc'`. All integration providers and LinkedIn/
  calendar OAuth redirect URIs now route through this helper instead of
  reading `APP_URL` directly.

**Worker routes / services updated to use `callbackBase()`**
- `integrations/providers/carta.ts`, `stripe.ts`, `slack.ts`,
  `salesforce.ts`, `hubspot.ts`, `docusign.ts`, `calendly.ts`
- `routes/linkedin.ts` (both `redirectUri()` and `redirectBack()`)
- `services/calendar.ts` — `appBase()` now checks
  `OAUTH_CALLBACK_BASE_URL` first

**`cloudflare-worker/src/routes/auth.ts`**
- `sendVerification()` now builds the verification URL from
  `PUBLIC_BASE_URL || APP_URL` instead of bare `APP_URL`, so
  email verification links point at `axal.vc`.

**Frontend (already complete — no changes needed)**
- `LoginPage.jsx` already uses relative `/dashboard` post-login.
- `RegisterPage.jsx` already uses relative `/onboarding/chat` for new
  signups.
- `RequireAuth` in `App.jsx` already has the full onboarding-chat gate
  (flow='chat', completed_at=NULL → redirect to /onboarding/chat,
  bypassed for admin/impersonation/limited accounts).

**Deployed**: Worker Version `251076e7-5c73-4b01-8b42-1eb0ab301769`.


## Admin Integration Keys — 7 new providers

Added LinkedIn, Calendly, Stripe, Carta, Crunchbase, Affinity, and
Telegram to the Admin Console → Integration Keys panel so an admin
can rotate / test / remove their OAuth or API credentials from the UI
without redeploying the worker.

- **`cloudflare-worker/src/services/providerOauthKeys.ts`** —
  `ManagedProviderKey` union + `MANAGED_PROVIDERS` array + `PROVIDER_ENV_VARS`
  map extended with the 7 new providers. OAuth providers (linkedin,
  calendly, stripe, carta) use the natural `CLIENT_ID`/`CLIENT_SECRET`
  pair. API-key providers (crunchbase, affinity, telegram) reuse the
  same two-field schema: the `id` slot holds a public account label
  (`CRUNCHBASE_USER_KEY_ID` / `AFFINITY_TEAM_DOMAIN` /
  `TELEGRAM_BOT_USERNAME`) and the `secret` slot holds the actual
  token (`CRUNCHBASE_API_KEY` / `AFFINITY_API_KEY` /
  `TELEGRAM_BOT_TOKEN`). Env-var precedence over DB still applies.
- **`cloudflare-worker/src/services/providerOauthTest.ts`** — per-provider
  dry-run probes added so the panel's "Test" button works for each.
  OAuth providers use the same invalid-grant probe as Slack/HubSpot.
  Stripe probes `GET /v1/account` with the secret key. Crunchbase uses
  a known org GET with `user_key`. Affinity uses `GET /auth/whoami`
  with HTTP Basic. Telegram uses `GET /bot<token>/getMe`. The exhaustive
  `switch` on `ManagedProviderKey` ensures the type system flags any
  future provider that forgets a probe.
- **`frontend/src/pages/AdminPage.jsx`** — `PROVIDER_LABELS`,
  `PROVIDER_HINTS`, and `PROVIDER_ENV_NAMES` extended for the 7 new
  providers. Hints for the API-key providers explicitly call out the
  two-field convention so admins know what to paste where. No other
  UI plumbing needed — the panel and `api.js` wrappers are generic
  over the provider catalog.
- **Runtime credential loaders refactored to use `loadOauthCreds()`**
  so admin-saved keys actually flow to live OAuth/API code paths (not
  just the admin "Test" button). Affected files:
  - `integrations/providers/calendly.ts` — `ensureCreds()` now async
    via `loadOauthCreds(env, 'calendly')`; 3 call sites awaited.
  - `integrations/providers/stripe.ts` — same pattern for `stripe`;
    3 call sites awaited.
  - `integrations/providers/carta.ts` — same pattern for `carta`;
    4 call sites awaited.
  - `routes/linkedin.ts` — replaced sync `configured(env)` with async
    `loadLinkedinCreds(env)`; oauth/start, oauth/callback, and the
    /status endpoint all consume the loaded creds.
  - `services/dueDiligence.ts` — Crunchbase connector now resolves the
    API key via `loadOauthCreds(env, 'crunchbase')` (key lives in the
    `secret` slot) instead of reading `env.CRUNCHBASE_API_KEY` directly.
  Affinity and Telegram have no runtime consumers yet — their admin
  panel rows are pre-provisioning slots for the upcoming
  partner-comp Affinity sync and Telegram broadcast features.

Notes:
- For Stripe, the `client_id` field stores the public Connect Client ID
  (ca_…); the secret field stores the platform `sk_live_…` / `sk_test_…`.
  The test probe only validates the secret key — Stripe doesn't have a
  standalone "is this ca_ valid" endpoint, but a valid secret key on a
  Connect-enabled account is sufficient for the OAuth flow to work.
- Telegram is not OAuth at all — it's a single bot token. The bot
  username is stored alongside purely so the UI can show "configured
  for @axalvc_bot" and so the existing two-column schema doesn't need
  a migration.
- Deleting a provider's keys still cascades `integrations.status =
  'disconnected'` for any active user connections (existing behaviour
  in `deleteOauthCredsAndDisconnect`). Same audit trail as the
  original 4 providers.


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
