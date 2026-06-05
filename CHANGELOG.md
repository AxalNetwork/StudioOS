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
- `frontend/src/decks/templates/yc_seed.tsx` — `Frame`, `Logo`, `HeroOrb`, `SectionEyebrow` now use brand accent instead of `ORANGE` constant.
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
