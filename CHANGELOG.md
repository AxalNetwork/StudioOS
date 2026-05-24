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
