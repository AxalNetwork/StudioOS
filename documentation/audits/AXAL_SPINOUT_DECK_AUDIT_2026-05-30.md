# Axal VC Spin-Out · Demo Day Deck — Audit + Replit Task Prompts
**Date:** 2026-05-30 · **Reviewer perspective:** VC / growth / minimalist design · **Deck under review:** `axal_spinout_demoday` (13 slides)

This document has two parts:

1. **Audit** — slide-by-slide findings on data fidelity, visual coherence, and illustration quality.
2. **Replit task prompts** — nine self-contained prompts. Each one is scoped to a single PR, references the exact files and line ranges to touch, and lists acceptance criteria a reviewer can check without re-reading this doc.

Authoritative sources used:
- Frontend renderer: `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`
- Worker data shaper: `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`
- Builder UI: `frontend/src/pages/PitchDeckPage.jsx`
- Brand backend: `cloudflare-worker/src/services/decks/branding.ts` + `cloudflare-worker/src/routes/decks.ts` (lines 1393–1417)
- Registry: `frontend/src/decks/templates/index.ts` (entry `axal_spinout_demoday`)

---

## Part 1 — Audit

Order matches the live deck (slide numbers shown match the eyebrow labels even when they no longer match the slot index, which is itself a finding).

### Slide 1 · Cover
- ✅ Activity-log sparkline on the right is genuinely data-driven (reads `cover.activity_log` from the project).
- ✅ "Idea → Solution → Validate → Incorporate" arc as a single-line motif is on-brand and minimalist.
- ⚠️ The right-side hero card has a heavy yellow glow at week 4 (the milestone sun). With every other slide rendered on `#FAF7FF` paper, the gradient feels like it belongs to a different system.
- ⚠️ Three meta chips ("Sector / Stage / Founder") are bottom-aligned in the *left* column. With the title `VJs TV — Demo Day` already large, the chip block reads as a third typographic level. Consider promoting them to small caps under the sub-line to free vertical space.

### Slide 2 · Problem
- 🔴 **The `<ProblemEcho>` illustration on the right (tangled red lines resolving into one violet node labelled "INSIGHT") is decorative, not data-driven.** From a VC perspective, this is the most expensive slide square-inch in the deck — it should show evidence, not abstraction. See **Task 4**.
- ✅ Three "Pain 0X" cards on the left are data-bound to `problem.signals[]`.
- ✅ "Evidence backing this" KPI strip (Themes / Pain mentions / Interviews) at the bottom is genuinely sourced.
- ⚠️ `ThemeFrequencyBars` (clustered pain themes) is rendered *below* the decorative SVG. The data signal is buried under the illustration. Inversion fixes this.

### Slide 3 · Validation
- 🔴 **The "weird quote-node illustration" in the middle of the right rail is `VoicesBubbles` (lines 1274–1297 of `axal_spinout_demoday_app.tsx`) — 5 purple speech bubbles connected with dashed lines.** It is *exported* but the code path no longer renders it; the slide currently composes `RatingDistribution + RevenueProofCard + Week-1 scoreboard` (lines 1673–1696). Either the deployed bundle is stale or there is a rendering branch that still reaches `VoicesBubbles`. Either way, the export is dead weight and the user is correctly flagging that the right column reads as "art, then chart". See **Task 5**.
- ✅ `RevenueProofCard` IS the right answer: hero metric (MRR or revenue), status pill (Pre-revenue / Pilot signed / Pilot paid / Paid), supporting stats. It just needs to be the *prominent* element, not buried between two other cards.
- ⚠️ Validation Rating histogram renders as a near-flat row when `ratings.length === 0`. Bars at height 4px look like a horizontal scale, not a histogram. Add an explicit empty-state ("Log Week-1 ratings to populate") instead of the misleading flat bars.

### Slide 4 · Market
- ✅ Concentric TAM/SAM/SOM circles are simple, classic, on-brand.
- ⚠️ The three cards on the right (`TAM · Total addressable / SAM · Serviceable / SOM · Obtainable`) carry no numbers in the sample state. With `DASH` placeholders they read as "we didn't fill this in". Either render a Nudge ("Add TAM in Market sizing") or hide them until populated.
- ⚠️ The `why_now` field is a paragraph hint ("Fill why_now on your project to explain the timing") — should be a bulleted list with concrete signals to copy the Sequoia / Kawasaki why-now convention.

### Slide 5 · Solution
- ⚠️ The right-rail `MVPBlueprint` motif (Experience / Workflow / Data · AI rounded rectangles) is also decorative. Acceptable as a brand-coherence prop *only* if the three boxes hold the actual capability strings from `solution.capabilities[]`. Right now they are static text labels. Bind them to data.

### Slide 6 · Product demo
- 🔴 **No way to paste a YouTube / Vimeo URL.** Today the slide reads `product_demo.loop_url` and renders a `<video>` tag — that only works for direct .mp4/.webm. Founders will overwhelmingly drop a YouTube share link, see no video, and conclude the slide is broken. See **Task 7**.
- ⚠️ The grey play-triangle empty state ("DEMO LOOP PENDING") is great. Keep it; just make the URL field accept embedable hosts.

### Slide 7 · Roadmap
- ✅ Three columns (Now / Next / Later) are data-bound to `roadmap.now/next/later[]`.
- ✅ The 30-day cadence W1–W4 dot strip on the right is the clearest in the deck and earns its space.
- ⚠️ "OKR coverage" footer reads "NOW / NEXT / LATER" with dashes — when all are empty it just looks like a label row. Show counts inline ("Now · 0", "Next · 0", "Later · 0") so the empty state is unambiguous.

### Slide 8 · Brand
- 🔴 **This slide should not exist in a fundraising deck.** Investors don't care about your colour palette specimen — they care about your brand from how you talk about the company. Type / colour belongs to the *deck chrome*, not a slide of its own.
- 🔴 **Replace the slide entirely with a per-deck "Custom Branding" panel in the Pitch Deck Builder** (right rail), gated to method_id `axal_spinout_demoday`. See **Task 3**.

### Slide 9 · Team & venture readiness
- ✅ Score bars (Market / Team / Product / Capital / Fit / Distribution) on the right are genuinely data-driven (`vr.breakdown`).
- ⚠️ "Founder 1 pending / Founder 2 pending / Founder 3 pending" placeholders read as bare cards — they should be visibly *card slots* with the founder slug + a "Fill in Team page" affordance.

### Slide 10 · Mentors & network
- 🔴 **Today's slide leads with "Mentor sessions" (a 3-row list) and "Operating partners on call" (Legal / Design / Recruiting / Technical DD / Finance / GTM as bullets) — both occupy ~60% of the slide for low-signal content.** The right rail has the SKILL COVERAGE radar (good!) and optional profile cards (good, when present).
- 🔴 **Merge this slide into Slide 9 (Team & readiness).** The story is "here is the team plus the people that surround the team". One slide, one narrative. See **Task 1**.

### Slide 11 · Cap table
- ✅ Empty pie ring with "EMPTY" caption is honest; the legal-scroll motif on the right with "83(b)" / "Founder signature" + a documents-on-file checklist is the right composition.
- ⚠️ The pie chart is *always* empty pre-incorporation (Week 3 milestone). At that point it competes for attention with the documents card. Consider replacing the empty pie with a vertical milestones bar ("Week 3 · Cap table · Week 4 · Incorporate") to give Week 1–2 viewers something signal-bearing.

### Slide 12 · Ask
- ✅ Use-of-funds bullets + funding curve on the right are good.
- ✅ "Next milestones" panel is honest in its empty state.
- ⚠️ The funding curve (`OKRTrendCard` SVG) has no axis labels other than "DAY 1" and "18 MO". Add the dollar amount at the peak so the curve teaches something.

### Slide 13 · Review the deal
- 🔴 **The "Review the deal" CTA is rendered as a *static* button-shaped pill, not an `<a>` to anything.** When `deal_access.deal_room_url` is set, it should be a real link the investor can click (currently it *is* an `<a>` at lines 2756–2763, but the empty-state vs. populated-state needs polish: founders rarely fill `deal_room_url`, so the "review" CTA appears inert for most decks). See **Task 6**.
- ⚠️ The body slot is a long DASH. Either populate from `ask.next_milestones[]` or hide the body when empty.

### Cross-deck coherence
- ⚠️ Three slides still self-eyebrow with the old number from before the Brand removal: `06 · Product demo` (should be 06), `08 · Team` (correct), `10 · Mentors & network` (correct after removing 06 Brand only if Brand is dropped). When Brand goes, all the eyebrows downstream need re-numbering. **Centralise the eyebrow numbers as `SLIDE_NUMBERS` so they cannot drift again.**
- ⚠️ The builder lets the user add or remove slides for *every* method, including Axal Spin-Out. The whole point of a curated 13-slide demo-day template is that the order is fixed. See **Task 8**.
- ⚠️ Field editor in the builder shows the field label only — no explanation of *where in the slide* the value lands. New founders don't know that "problem_body" appears as the hero paragraph vs. the pull-quote. See **Task 9**.

---

## Part 2 — Replit task prompts

Run these prompts one at a time on the branch `claude/inspiring-volta-TErm7`. Each prompt is self-contained: it doesn't reference earlier task numbers and it lists the files to touch. Treat each one as a separate PR.

---

### Task 1 · Merge Team and Mentors slides into "Team & network"

**Goal.** Today the Axal Spin-Out deck has two adjacent slides — `team_readiness` (slot 8) and `mentor_network` (slot 9) — that tell halves of the same story. Investors read them as a duplicate. Merge them into one slide titled "Team & network" that surfaces profile cards for every human around the table.

**Files.**
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` — `Slide_TeamReadiness` (line 2679) and `Slide_MentorNetwork` (line 2045), plus the `SLIDES` registry (lines 2801–2815).
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — slide emit (lines 1255–1295), coverage map (around line 1474), and the worker-side data type if you add new profile fields.
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` `SAMPLE_DATA` (lines 260–268) — collapse `team` + `mentor_network` blocks.

**Spec.**
1. Replace the two slides with one slide `team_network` titled **Team & network**. Eyebrow `08 · Team & network`. Renumber `cap_table → 09`, `ask → 10`, `review_the_deal → 11`. Final deck = 12 slides (was 13).
2. Layout (16:9, 1920×1080):
   - **Left column (8 cols)** — header "Founders, partners, advisors, mentors" then a 2-column grid of **profile cards**. Each card: 36 px avatar (photo if `MentorProfile.photo_url`, else gradient initials), bold name, role line, and a small monospace line listing the companies the person is currently part of (new field `companies: string[]` on `MentorProfile`, joined with " · ", truncated to 38 chars). Founders are seeded from `team.founders[]`; partners / advisors / mentors are seeded from `mentor_network.profiles[]`, sorted by `kind` (founder → partner → advisor → mentor).
   - **Right column (4 cols)** — stacked top→bottom:
     1. **Readiness card** — keep the existing `ScoreBars` for `venture_readiness.breakdown` plus the `12/100` headline. This card stays at its current visual weight.
     2. **Skill coverage card** — keep `SkillsSpider` for `mentor_network.skill_coverage`. Smaller size (`size=160`).
     3. **Compact network strip** — single one-line row: `Mentor sessions · {n} logged   ·   Operating partners · {n} on call`. Drop both the "Mentor sessions" list and the "Operating partners on call" 2-column grid. This is now a footnote, not a section.
3. Honesty contract — if all four profile categories are empty, render one centered Nudge: *"Add founders in Team, mentors via Office Hours."* Do not fabricate placeholders.
4. Worker side:
   - Extend `MentorProfile` (worker + frontend type) with `companies: string[]`.
   - Emit new slide `spec_id: 'team_network'` carrying every field both old slides emitted (so legacy decks restore cleanly via mergeShape). Keep the `team_*` and `mn_*` field keys verbatim — do **not** rename.
   - Coverage map: replace the two cells with one cell that has `has = founders.length > 0 || profiles.length > 0`.

**Acceptance.**
- `npm run typecheck` clean in `cloudflare-worker/` and `frontend/`.
- `npm run test` passes (update any snapshot tests that compare slide counts).
- Open a project with both founders and mentors populated → see 4–8 profile cards on the merged slide.
- Open a project with neither → see one Nudge, no orphan card chrome.
- The eyebrow numbers `09`, `10`, `11` re-number downstream slides; no slide still reads `10 · MENTORS & NETWORK`.

---

### Task 2 · Drop the Brand slide and re-number the deck

**Goal.** Remove slide 8 (`brand`) from the Axal Spin-Out deck. Brand chrome (palette, typography, tagline) is a *deck-level* setting and belongs in the builder rail, not in a slide of its own.

**Files.**
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` — drop `Slide_Brand` from the `SLIDES` array (line 2809) but keep the component function exported so any in-flight imports survive. Add `void Slide_Brand;` to the retained-legacy line near 2817.
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — drop the `brand` slide block (lines 1243–1254) from `SLIDES`. Keep `data.brand` in the type so the rest of the deck (incorporation badge on the Cap Table slide, etc.) still resolves.
- `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — drop the matching coverage cell.
- `frontend/src/decks/templates/index.ts` — update `slide_count: 14` to the new count once Tasks 1 and 2 both land.

**Spec.**
1. Final deck after this task + Task 1 = 11 slides: cover, problem, validation, market, solution, product_demo, roadmap, team_network, cap_table, ask, review_the_deal.
2. Update every eyebrow (`SAMPLE_DATA.<slide>.eyebrow`) to its new number. Centralise the numbers in one `const SLIDE_NUMBERS = { problem: '01', validation: '02', … }` so a future re-order is one edit, not eleven.
3. The brand vision string (`brand.tagline`) was the only first-class brand sentence in the deck. Preserve it: render it under the cover sub-line ("Sub" of the cover slide) when `tagline !== DASH` and `tagline !== sub`.

**Acceptance.**
- Picker thumbnail of `axal_spinout_demoday` no longer contains the Brand slide.
- Re-applying the template to an existing deck does not throw; old `brand_*` fields are tolerated as unused.
- `EXPECTED_TEMPLATE_COUNT` in `frontend/src/decks/templates/index.ts` remains correct (registry size doesn't change).
- The "06 · Brand" slide is gone from PDF / PPTX export.

---

### Task 3 · Custom branding panel in the Pitch Deck Builder (Axal Spin-Out only)

**Goal.** Where the Brand slide used to live, give the founder a *deck-level* branding panel: background colour, accent colour, and a display-font selector. Persist per-deck. Apply to print / share / export. Limit to `method_id === 'axal_spinout_demoday'`.

**Files.**
- Backend
  - New migration `cloudflare-worker/sql/<next>-deck-branding-overrides.sql`:
    ```sql
    CREATE TABLE IF NOT EXISTS deck_branding_overrides (
      deck_id INTEGER PRIMARY KEY,
      bg_color TEXT,
      accent_color TEXT,
      display_font TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
  - Apply via `wrangler d1 execute studioos-db --file=cloudflare-worker/sql/<n>-deck-branding-overrides.sql`.
  - New routes in `cloudflare-worker/src/routes/decks.ts`:
    - `GET /decks/:id/branding-overrides` → `{ bg_color, accent_color, display_font } | null`.
    - `PUT /decks/:id/branding-overrides` → upsert. Only allow when the deck's `method_id === 'axal_spinout_demoday'`. Return 409 with `{ error: 'branding_locked_to_axal_spinout' }` otherwise.
    - `DELETE /decks/:id/branding-overrides` → clear.
  - Validate inputs: colours must match `/^#[0-9a-f]{6}$/i`; font must be one of a static allow-list (`Playfair Display`, `Inter`, `Source Serif Pro`, `IBM Plex Sans`, `JetBrains Mono`, `Fraunces`, `Space Grotesk`). Reject anything else with 400.
- Frontend builder
  - `frontend/src/lib/api.js` — add `deckGetBrandingOverrides(id)` / `deckSetBrandingOverrides(id, body)` / `deckClearBrandingOverrides(id)`.
  - `frontend/src/pages/PitchDeckPage.jsx` — replace the existing "Branding" right-rail card (lines 691–717) with a new `<DeckBrandingPanel deckId={deck.id} methodId={activeMethodId} />`. Old card content (the Studio watermark) stays inside the same panel but is rendered *below* the per-deck overrides.
  - New `DeckBrandingPanel` component: three inputs — background colour swatch picker (`<input type="color">`), accent colour swatch picker, and a `<select>` of the seven allow-listed fonts. Show "Custom branding is locked to the Axal VC Spin-Out template" copy if `methodId !== 'axal_spinout_demoday'`. On save, debounce 500 ms.
- Frontend renderer
  - `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` — accept `data.branding_overrides` (post-`hydrate()`) and *override* the matching keys in the variant palette / fonts before rendering. Take care to keep the four-variant palette structure: overrides apply on top of the currently selected variant.
- Print page
  - `frontend/src/pages/PitchDeckPrintPage.jsx` — when assembling `templateData`, fetch the overrides (via `api.deckGetBrandingOverrides(deck.id)`) and merge in as `branding_overrides`.

**Spec.**
1. Brand overrides apply to **every** rendering surface: builder preview, share link, PDF, PPTX. Worker must inject them into the headless Browser Rendering session as URL query (`?bg=%23…&accent=%23…&font=Inter`) so the print page picks them up. The print page reads the query before falling back to the API.
2. When the override is set, the four-variant switcher is still visible but switching now produces *the chosen variant with the founder's accents on top*. Document this in a tiny "Overrides applied" pill on the switcher.
3. Clearing overrides (Reset button) restores variant defaults.
4. Studio-tier watermark editor stays in the same panel — do not duplicate.

**Acceptance.**
- New panel only appears with action affordances when `methodId === 'axal_spinout_demoday'`. Other templates show the read-only "locked" message + the watermark editor.
- A founder who sets `#0F172A / #F59E0B / Fraunces` sees those values in: builder centre preview, share link, PDF export, PPTX export.
- D1: `SELECT * FROM deck_branding_overrides` shows one row per customised deck; deleting the deck cascades the override (write a `BEFORE DELETE` trigger or just clean up in the deck-delete route).
- Curl test: `PUT /decks/:id/branding-overrides` with a bad colour returns 400.

---

### Task 4 · Replace `ProblemEcho` with a data-driven pain-points graph

**Goal.** The right-side illustration on the Problem slide is decorative. Replace it with a chart that shows *the pain-point frequency from real discovery interviews* — a horizontal bar chart of `problem.pain_themes[]` ordered by `mentions` descending.

**Files.**
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`:
  - Remove `ProblemEcho` usage at line 1602 (keep the export so any external reference still resolves, but mark with `// @deprecated — use PainPointGraph`).
  - Slide_Problem layout change — the right rail becomes:
    1. **Top card (flex 1, ~55%)** — `<PainPointGraph themes={themes} />` — horizontal bar chart, one bar per theme, bar length = `mentions / max`, value label at the bar end, theme label at the bar start. Use the variant accent colour. Sort desc. Cap to top 6 themes; if more, append "+N more".
    2. **Middle card** — Empathy tally: discovery-call N · interviewees N · unique pains N. Same numbers that are in the "Evidence backing this" footer today — pull them up so the right rail is *all* data.
    3. **Bottom card** — the existing 3-up KPI strip (Themes / Pain mentions / Interviews) — kept as the receipts row at the bottom.
- Empty state: if `themes.length === 0`, show a Nudge that says "Log 3+ discovery calls and tag pain themes to populate this chart." No decorative SVG fallback.

**Spec.**
1. `PainPointGraph` is a pure SVG component, no Recharts dependency. Implement next to `ThemeFrequencyBars` (which already exists for this exact data — extend it instead of starting fresh). The differences vs. the existing `ThemeFrequencyBars`: bars are taller (24 px), value labels are right-of-bar not on top, theme text uses `V.display` not mono.
2. Keep `ThemeFrequencyBars` exported because the Validation slide may want it later.
3. Honesty: bar lengths are always `(mentions / maxMentions) * 100%`. Do not normalise to an arbitrary maximum.

**Acceptance.**
- For a project with 4 themes [`pricing opacity (8 mentions)`, `tooling sprawl (5)`, `onboarding (3)`, `compliance (1)`], the chart shows four bars of widths 100% / 62% / 38% / 12%.
- Empty state shows the Nudge, no SVG residue.
- Builder preview, share, PDF, PPTX all render the chart identically (Browser Rendering screenshot is pixel-comparable to in-app preview).

---

### Task 5 · Make `RevenueProofCard` the right-rail hero on Validation; delete `VoicesBubbles`

**Goal.** Investors on slide 3 should see *one* signal: are these founders converting interviews into pilots / revenue? Today the user reports a "weird quote node illustration" — that is `VoicesBubbles` (lines 1274–1297). It is exported but the Slide_Validation code path no longer renders it. Delete the dead export, restructure the right rail so `RevenueProofCard` takes the dominant slot, and tighten the empty state on `RatingDistribution`.

**Files.**
- `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`:
  - Delete `VoicesBubbles` entirely (lines 1274–1297). It is unused; the original Task #2 refactor left it as a stub.
  - Slide_Validation right-column layout (lines 1673–1696) becomes:
    1. **Top** — `RevenueProofCard` (~55% height). Promote the hero metric font from 38 → 48 when populated; keep 30 when not.
    2. **Middle** — `RatingDistribution` — *only when `ratings.length > 0`*. When empty, render a 1-line Nudge "Log Week-1 ratings in Customer Discovery." Do not render the flat-bar histogram.
    3. **Bottom** — Week-1 scoreboard (unchanged, but values pulled from real counts).
- Confirm nothing else in the repo imports `VoicesBubbles` (`rg VoicesBubbles` should return zero hits after this task).

**Spec.**
1. The card's decorative concentric arcs (lines 2422–2451 of the existing `RevenueProofCard`) stay — that is the signature illustration for this slide. It is data-aware (gold accent when "money in" is true, violet otherwise).
2. When `proof.status === 'paid' || 'pilot_paid'`, the hero value reads MRR or total revenue; otherwise "Pre-revenue · Path to first dollar". Existing logic at lines 2394–2401.
3. Status pill copy stays as-is.

**Acceptance.**
- `rg -n VoicesBubbles frontend cloudflare-worker` returns zero matches.
- Validation slide in a brand-new project shows `RevenueProofCard` in pre-revenue state, no `RatingDistribution` bars, and the Week-1 scoreboard with all zeros.
- Validation slide in a project with `mrr = 4200, status = paid` shows `$4.2K · MRR` in 48 px gold and a `✓ Paid · live revenue` pill.

---

### Task 6 · Interactive "Review the deal" CTA

**Goal.** The CTA on slide 13 (Review the deal) should be a clickable link to the actual deal room. Today the slide renders an `<a>` only when `deal_access.deal_room_url` is populated, but founders rarely fill that field manually. Surface the deal room URL automatically when the project has a deal published, and treat the empty state as "publish your deal in Capital".

**Files.**
- Worker
  - `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts` — `buildAxalSpinoutDemoDayData` (where `contact.deal_access` is constructed): if `project.deal_id` resolves and the deal is `published`, set `deal_access.deal_room_url = ${origin}/deals/${deal_id}` (or whatever the existing public deal route is — confirm by grepping `routes/deals.ts`), `deal_access.data_room_ready = true` when the deal has at least one document attached. `nda_required` reads the deal's NDA flag.
- Frontend renderer
  - `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` `Slide_ReviewTheDeal` (line 2735): when `da.deal_room_url` is empty render an *enabled* button that links to the in-app `Capital → Publish deal` page (with `window.parent` postMessage if the deck is embedded). Button copy: "Publish the deal room →". When populated, keep the current external-link button.
  - Add a third pill next to "Data room ready" — `{n} documents` — pulled from a new `deal_access.doc_count` int.

**Spec.**
1. Open the deal in a new tab (`target="_blank" rel="noopener noreferrer"`); the existing link already does this.
2. Track click as an engagement event via the same view-tracking pipeline used for share links (`api.shareViewEvent` or the worker's `/api/decks/share/track` endpoint — confirm in `routes/decks.ts`).
3. In share mode, the button must work for unauthenticated viewers — the deal-room URL is public; the *publish* fallback (when URL is empty) is hidden in share mode because anonymous viewers can't publish.

**Acceptance.**
- Project with a published deal → slide 11/12 (post-renumber) shows a violet "Review the deal →" button that opens the deal page.
- Project with no deal → slide shows "Publish the deal room →" linking to `/capital/deals/new`.
- Share viewer → only the live link variant is visible.
- Click event lands in `deck_engagement_events` (or whatever the share-tracking table is called) with `event_type = 'cta_click'`.

---

### Task 7 · YouTube / Vimeo URL support on the Product Demo slide

**Goal.** Today `product_demo.loop_url` is rendered through a raw `<video>` tag. Founders almost always paste a YouTube share URL. The slide should detect the host, render the right embed iframe (YouTube `embed/`, Vimeo `player.vimeo.com/video/`, otherwise fall back to `<video>` for direct media URLs).

**Files.**
- Frontend renderer
  - `frontend/src/decks/templates/axal_spinout_demoday_app.tsx` `Slide_ProductDemo` (line 2641): new helper `resolveDemoEmbed(url)` returns `{ kind: 'youtube' | 'vimeo' | 'video', embedUrl }`. Render iframe for YouTube/Vimeo; `<video>` for direct media.
- Builder field editor
  - `frontend/src/pages/PitchDeckPage.jsx` — extend the `FieldEditor` (line 782) to handle `field.kind === 'video_url'`. Renders a single text input with inline validation (red ring + tiny error text if the URL isn't a recognised host or direct media). Below the input, render a tiny preview card showing the resolved thumbnail (YouTube `https://img.youtube.com/vi/<id>/mqdefault.jpg`; Vimeo via `https://vumbnail.com/<id>.jpg`).
- Worker
  - `cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts`: change the `product_demo_loop_url` field kind from `paragraph` to `video_url` (line 1227). Keep the value shape as a string — only the editor's render changes.

**Spec.**
1. URL parsing handles:
   - `https://www.youtube.com/watch?v=ID`
   - `https://youtu.be/ID`
   - `https://www.youtube.com/embed/ID`
   - `https://vimeo.com/ID`
   - `https://player.vimeo.com/video/ID`
   - Any other URL ending in `.mp4 | .webm | .mov`.
2. Iframe attributes: `allow="autoplay; encrypted-media; picture-in-picture"`, `allowFullScreen`, `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`.
3. Hosts other than the above show the "Demo loop pending" empty state plus a small caption "Unsupported host — paste a YouTube, Vimeo, or .mp4 URL."

**Acceptance.**
- Paste `https://youtu.be/dQw4w9WgXcQ` in the builder → preview thumbnail appears under the input → slide preview renders the YouTube iframe.
- Paste a malformed URL → red ring, tiny error, slide preview shows the empty state.
- PDF export uses the *thumbnail* (because Browser Rendering can't capture an autoplay video frame deterministically) — wrap the iframe with a `<noscript>` fallback that renders an `<img>` of the thumbnail. The Browser Rendering session uses `print_mode=pdf`; respect that and swap to thumbnail during printing.

---

### Task 8 · Disable add / remove slides for the Axal Spin-Out template

**Goal.** The Axal Spin-Out deck has a fixed 11-slide (post Tasks 1+2) demo-day structure. Founders should not be able to add a 12th slide or delete the cover. Hide the Plus / Trash icons when the active deck's `method_id === 'axal_spinout_demoday'`.

**Files.**
- `frontend/src/pages/PitchDeckPage.jsx`:
  - Derive `const isAxalSpinout = useMemo(() => slides.some((s) => s.method_id === 'axal_spinout_demoday'), [slides]);` near where `activeMethodId` is computed (line 174).
  - Conditional render the **Plus** button at line 527 — hide when `isAxalSpinout`. Show a tiny info pill next to "Slides" label instead: *"Locked · 11 slides"*.
  - Conditional render the **Trash** icon at line 576 — hide when `isAxalSpinout`.
  - Drag-to-reorder also disabled for Axal Spin-Out — set `draggable={!isAxalSpinout}` and remove the cursor-grab affordance.
- Worker
  - `cloudflare-worker/src/routes/decks.ts` `PUT /decks/:id` (deck update route) — when the existing deck's slide payload uses `method_id === 'axal_spinout_demoday'`, reject any change that adds / removes / reorders slides. Compare `incoming.slides.map(s => s.spec_id)` to the canonical 11-slide order and 409 otherwise.

**Spec.**
1. Server-side enforcement matters because a power user could still POST a custom payload via the API.
2. The lock pill ("Locked · 11 slides") gets a help-cursor tooltip: *"The Axal VC Spin-Out template has a fixed demo-day structure. Switch templates to add or remove slides."*
3. Title editing is **still allowed** (per-slide title rename). Per-slide `appendix` toggle is still allowed.

**Acceptance.**
- Open an Axal Spin-Out deck → no Plus, no Trash, no drag handle visible.
- Open a YC Seed deck → Plus / Trash / drag all present.
- Curl `PUT /decks/<id>` with a 12-element slides array on an Axal Spin-Out deck returns `409 {error: 'axal_spinout_slides_locked'}`.

---

### Task 9 · Info-icon affordance on every editable field

**Goal.** Each editable space in the builder should tell the founder *what slide section the value populates and where it appears visually*. Today the field label ("Body", "Headline", "Quote") gives no spatial guidance. Add a hoverable `<Info />` icon next to every field label that opens a tiny popover with two lines: (a) **What:** semantic role in the slide, (b) **Where:** the part of the slide it occupies.

**Files.**
- `frontend/src/pages/PitchDeckPage.jsx`:
  - Extend `FieldEditor` (line 782) — accept a `helpText` object `{ what: string; where: string }`. Render an `<Info className="w-3.5 h-3.5 text-gray-400 hover:text-violet-500" />` inline with the label. Open a `<Popover>` (use existing project popover or roll a small one with positioning) showing `what` then `where`. Use `aria-describedby` for accessibility.
  - Source the help text from a new map `FIELD_HELP_AXAL_SPINOUT` keyed by `(spec_id, field.key)`. Live in a new file `frontend/src/decks/templates/axal_spinout_field_help.ts`. Example entries:
    ```ts
    export const FIELD_HELP_AXAL_SPINOUT: Record<string, Record<string, { what: string; where: string }>> = {
      problem: {
        problem_body: { what: 'The pain narrative.', where: 'Top-left hero paragraph below the eyebrow.' },
        problem_headline: { what: 'The headline you lead with.', where: 'Top-left, set in 56–72 px display.' },
        // …one entry per editable field key, ~50 total
      },
      validation: { /* … */ },
      // …
    };
    ```
  - For *non*-Axal templates, the icon is still rendered but the popover shows a generic message ("This value appears on the slide.") so the affordance is consistent.
- `frontend/src/decks/templates/axal_spinout_field_help.ts` — new file with the map. Cover every editable field for the 11-slide post-merge deck.

**Spec.**
1. Popover positions to the right of the icon, anchors to top-right, has 8 px arrow, 240 px max-width.
2. Closes on `Esc` and on click-outside (reuse `useEscapeClose`).
3. Keyboard: Tab onto the icon → press Enter → popover toggles. Tab again to dismiss.
4. The map lives in the same folder as the template renderer so a future field rename is a single PR.

**Acceptance.**
- Every editable field on every Axal Spin-Out slide shows the `<Info />` icon.
- Hovering icon on the Problem slide's `problem_body` field shows *"The pain narrative. — Top-left hero paragraph below the eyebrow."*
- Tabbing through the builder reaches every icon; `Enter` toggles.
- Non-Axal template fields still show the icon with the generic message.

---

## Out of scope (recommended for a later sprint)

- **Cover hero** redesign — replace the yellow milestone glow with a single muted accent dot. (Cosmetic.)
- **Market slide** — wire the three placeholder cards to the project's market sizing entries so they auto-fill from Financials.
- **Cap Table empty pie** — replace with a Week-3 / Week-4 milestone strip during pre-incorporation.
- **Ask funding curve** — add the dollar-amount peak label.
- **Eyebrow re-numbering** — once Tasks 1+2 ship, centralise `SLIDE_NUMBERS` so future re-orders stay coherent.

---

## Branch + commit convention

All nine tasks land on `claude/inspiring-volta-TErm7` as separate commits with subjects:

```
deck(axal-spinout): task 1 — merge team + mentors into team_network
deck(axal-spinout): task 2 — drop brand slide, renumber eyebrows
deck(axal-spinout): task 3 — per-deck branding overrides panel
deck(axal-spinout): task 4 — pain-point graph replaces ProblemEcho
deck(axal-spinout): task 5 — RevenueProofCard hero, drop VoicesBubbles
deck(axal-spinout): task 6 — interactive review-the-deal CTA
deck(axal-spinout): task 7 — YouTube / Vimeo embed for product demo
builder(axal-spinout): task 8 — lock add/remove/reorder slides
builder: task 9 — per-field info popovers in the editor
```

Each task closes on a draft PR; squash-merge after review.
