# DECISIONS.md

Decisions taken during the Axal VC canvas-integration work, and the open ones
that need a call before Phase 0/1 starts. Each entry records what was decided,
why, and what evidence it rests on, so a later reader can reverse it knowingly
rather than by accident.

---

## Part 1 — Decisions

D1, D2, D4, D5 and D7-D11 are resolved. Only D3 remains open; D6 is now
closed by D11, which repaired the last two of the four live defects the audit
found.

### D1. Studio Ops — re-integrate, or honour the deletion?

`Studio Ops.dc.html` is a Lab tool by subject: in the master workspace canvas it
is a Week-2 unlocked tool, a Week-2 deliverable ("Studio Ops cadence set"), and a
Week-2 "what unlocks" item.

But on 2026-08-25 — the day before the canvases were pushed — Studio Ops was
deleted in full: `routes/studioops.ts` (469 lines), `services/studioOpsCadence.ts`
(255), its worker test (141), `StudioOpsPage.jsx` (401),
`SpinoutLabStudioOpsPage.jsx` (525), `lib/spinout/studioOps.js` (209), 16
`studioOps*` methods from `api.js`, and the `/studio-ops` handlers inside
`spinout_lab.ts`. `frontend/test/studio_ops_removed.test.mjs` now asserts all of
it stays gone, alongside sibling guards `founder_portal_removed` and
`spinouts_page_removed`.

So the OUT-OF-SCOPE reading ("already built, skip it") does not apply — there is
nothing built. Re-integrating would break a test written specifically to prevent
it. One extra wrinkle: the canvas lists Studio Ops as a **top-level Products nav
item** beside Deal Flow and Cap Table, which suggests it was drawn as a platform
surface, not only a Lab tool.

**RESOLVED — honour the deletion; drop the canvas.** The removal was deliberate,
made one day before the designs landed, and is guarded by a test. Re-integrating
would reverse a product decision and require deleting
`studio_ops_removed.test.mjs`. `Studio Ops.dc.html` is therefore not a work item
in any phase. If Studio Ops returns later it should be scoped fresh as a
platform surface, not restored from this canvas.

### D2. Which palette wins — the spec sheet or the canvases?

`System Sheet.dc.html` is a self-describing token sheet declaring the palette as
literal constants (`INK '#241f38'`, `MUT '#6b6577'`, `HAIR '#e8e6ee'`, …). The
brief's baseline palette is a verbatim transcription of it. **But only ~8 of 107
canvases implement it.** The corpus splits into two generations:

- **spec family** (~7–8 canvases): 1080px frame, violet ink, mono labels
- **legacy family** (~99 canvases): 1440px frame, Tailwind zinc ink, Inter labels

Measured conflicts (canvas counts):

| Role | Spec value | Majority value | Ratio |
| --- | --- | --- | --- |
| hairline | `#e8e6ee` (21) | `#ececf1` (91) | 4.3× |
| ink | `#241f38` (14) | `#18181b` (80) | 5.7× |
| faint | `#8b8798` (13) | `#a1a1aa` (28) | 2.2× |
| lavender | `#f4f0fe` (11) | `#f5f3ff` (22) | 2× |

Nothing in the baseline was *absent* — every claimed literal exists. The question
is only which wins. `tokens.json` records the spec value as `value` and the
frequency winner as `majority` with counts, so this is reversible either way.

**RESOLVED — spec palette for brand colours, corpus majority for neutrals.**
The brand violets cost nothing under this rule: `#7c3aed` (73 canvases) and
`#6d28d9` (81) were already the corpus majority. Applied in `tokens.json`:

| Token | Was (spec) | Now (majority) | Margin |
| --- | --- | --- | --- |
| `ink` | `#241f38` | `#18181b` | 80 vs 14 |
| `hairline` | `#e8e6ee` | `#ececf1` | 91 vs 21 |
| `faint` | `#8b8798` | `#a1a1aa` | 28 vs 13 |

`muted` and `ground` stay on the spec value: `muted` has no real majority (six
competing values, the largest at 42 of 107) and `ground` is near-tied (52 vs 45).
Both keep their competing value under `majority` so the call can be revisited.
Every flipped token retains its spec value under `spec`, so this is reversible.

### D3. What is the AI feature called?

Three mutually exclusive product voices across the eight rail canvases:

- **"Worker AI"** — AIRail, InvRail, AdminRail, AdvRail (model shown as chosen)
- **"Worker AI", inherited** — DetailRail, EmberRail (model inherited from parent)
- **"Forge"** — ForgeRail: model **RECOMMENDED** not inherited, an explicit "Axal
  VC margin" disclosure, a scope chip, and a stated hard boundary — *"Forge never
  sends, signs or voids; every outbound action is a human click."*

The brief mandates "Forge" everywhere. That is compatible with the ForgeRail
canvas and incompatible with the other seven as drawn.

**Status: OPEN** — but low risk. Recommend Forge, with ForgeRail's boundary
sentence as the governing copy, and treat the other seven as the same component
with different wording.

### D4. Persona-root URLs — the prohibition stands

The brief forbids `/founder`, `/investor`, `/advisor`, `/partner` as persona
roots, giving as its reason that `/founder` was already occupied by a live,
admin-only Founder Portal. That reason has evaporated: `FounderPortal.jsx` (351
lines), the route element and the sidebar row were all deleted in `f3af4536`, and
`frontend/test/founder_portal_removed.test.mjs` guards the removal.

Two corrections to how that was first written up:

- **`/founder` is not unclaimed.** The *portal* is gone, but `/founder/post-need`
  is still mounted (`App.jsx`). The bare root is free; the namespace is not.
- **The bare root was never the question.** `/advisor/*` carries ten-plus live
  routes. Adopting persona roots would not be claiming free URLs — it would be
  migrating live ones, with redirects, for every advisor surface.

**RESOLVED — keep the prohibition.** Losing an argument *against* persona roots
is not an argument *for* them, and three arguments against survive on their own
merits:

1. **`CompanySwitcher` already scopes everything beneath it.** A persona segment
   in the URL either duplicates that scoping or goes stale the moment the user
   switches company — at which point the URL asserts something untrue.
2. **An account can hold more than one role.** A founder who also angel-invests
   has one session and sees the union of both navs. A persona root forces a
   single-persona reading of a multi-role account and makes "which URL am I
   supposed to be at" a question the product has to answer.
3. **It is a migration, not a greenfield.** See the correction above.

Persona is expressed where it already is: the sidebar's role-gated rows. URLs
stay function-first. The four persona shells the canvases assume are a SIDEBAR
change, not a routing one.

Enforced by `frontend/test/route_namespace_policy.test.mjs` rather than by
memory — the prohibition outlived its original justification once already.

### D5. Inter has never rendered in production

`frontend/src/index.css:72` sets `body { font-family: 'Inter', system-ui, … }`,
but there is no `@font-face`, no `@import` and no `<link>` for Inter anywhere in
`frontend/`. Every page falls through to `system-ui`. Separately, Roboto Mono is
loaded by a render-blocking `@import` on `index.css:1` — the exact pattern the
Space Grotesk block at `index.html:175-183` was written to avoid — and ships
weights 500/600/700, missing the 400 that 43 canvases request.

Fixing this changes the appearance of every page in the product, so it is not a
silent repair.

**RESOLVED — fix in Phase 1, alongside the token work**, so the visual shift
happens once and deliberately rather than as an isolated surprise deploy. Both
faces get the non-blocking treatment already used for Space Grotesk
(`index.html:175-183`: preconnect x2 with `crossorigin` on gstatic, `preload
as=style`, `stylesheet media="print" onload="this.media='all'"`, `<noscript>`
duplicate, `&display=swap`), with the union axes the canvases actually request —
Inter `400;500;600;700;800`, Roboto Mono `400;500;600;700`. The render-blocking
`@import` on `index.css:1` goes away in the same change. Note `font-mono` is used
233x in `frontend/src` and currently resolves to Tailwind's default stack, so
defining `--font-mono` restyles all 233 at once.

### D6. Four live defects — fix now, or fold into the canvas work?

Four surfaces call worker routes that do not exist (see `ROUTE_MAP.md` → "Live
defects"). Two of them are answered by canvases already in scope: Trust Center v2
converts exactly the broken KYB/Accreditation/NDA cards to read-only, and the
Network canvases sit on the broken `/advisor/network/*`. The other two —
`/marketplace` (11 dead calls) and `/legal`'s document generation — have no
canvas covering them.

**Status: OPEN.** Recommend fixing `/marketplace` and `/legal` independently of
this work, since nothing in the canvas set will otherwise touch them.

### D7. The fixture layer — wire what has a backend first

**RESOLVED.** Roughly 26 sidebar-reachable tabs render from static fixtures with
zero API calls — 2,949 lines across seven modules under `frontend/src/data/`
(`growth.js`, `advisor/research.js`, `advisor/advisory.js`,
`partner/operations.js`, `advisor/network.js`, `fundAnalytics.js`,
`portfolioAnalytics.js`). `growth.js` says so in its own header: *"This is a UI
shell only — everything here is sample data."*

This inverts §3's premise for those surfaces: the UI exists and the wiring does
not, so they are builds, not reskins. The approach is to wire the ones with a
live backend first, highest value per unit of work:

1. **Research** — the clearest case. `/market-intel` is a rich live
   implementation (~32 API calls) of the same material, sitting unused beside a
   mock shell that five role navs link to. `market_intel.ts` has ~30 endpoints.
2. **Portfolio Growth / Fund Performance / Fund Accounting** — `positions.ts`
   and `funds.ts` already serve marks, distributions, KPI compliance and per-LP
   reports; several of those endpoints have no consumer at all.
3. **Network** — `introductions.ts` and `contacts.ts` are live, but the pages
   call `/api/network-introductions/*` and `/api/organizations*`, which do not
   exist. Decide first which of the two parallel Network surfaces survives
   (`/network`, wired, vs `/advisor/network/*`, broken but linked everywhere).
4. **Advisory / Partner Operations** — thinnest backend coverage; treat as
   genuine builds scoped from their canvases.

### D8. /market-intel is the one market surface

**RESOLVED.** `/advisor/research/market` and `/market-intel` were two surfaces
over the same material. The Research tab was a mock shell reading
`data/advisor/research.js` with **zero** API calls; `MarketIntelPage.jsx` is
2,992 lines wired to 30 `api.*` methods over the 31 endpoints in
`market_intel.ts`.

The old URL now redirects. The four role navs that linked the Research tab
(founder, partner, investor, advisor) point at `/market-intel` instead; admin
already linked it directly, so that duplicate row was dropped rather than
repointed. `MarketPage.jsx` is deleted.

This is the same "two parallel surfaces" shape the audit flagged for Network
(`/network` wired vs `/advisor/network/*` broken but linked everywhere). The
Network pair still needs the same call.

### D9. The Funds research tab is withdrawn, pending a data provider

**RESOLVED.** The tab wanted a directory of external funds, fund managers,
fundraises, unicorns, public comparables, exits and funding rounds. Nothing
serves any of it: `grep` across `cloudflare-worker/src/` finds no fund
directory, no managers, no fundraises, no unicorns and no comparables, and
`funds.ts` is Axal's *own* fund administration, not third-party research data.

It is not a wiring task — it needs a PitchBook/Crunchbase-class source and a
licence before a single row of it is real. The route, the five nav entries and
`FundsResearchPage.jsx` are removed rather than shipped blank or shipped
fabricated; the funds honesty rule that governs `vc_funds` ("Not recorded",
never invented) is the same principle. It returns when a source is licensed.

**Correction to an earlier recommendation.** D7 named Research "the clearest
case" for wire-what-has-a-backend-first. That was true of one tab in six, not
of the row. Verified per tab:

| Tab | Backend | Reality |
| --- | --- | --- |
| market | `market_intel.ts` (31) + a 2,992-line live page | full live twin → D8 |
| companies | `crunchbase.ts` (3), `competitors.ts` (11) | partial |
| news | `news.ts` (11) | real |
| ai | `assistant.ts` (9) | real |
| documents | `files.ts` (1) | thin |
| funds | none | no data source → D9 |

### D10. /network is the one network surface

**RESOLVED.** The same two-surface split as D8, inverted: here the **broken**
one owned the nav and was the more ambitious design.

| | `/advisor/network/*` | `/network` |
| --- | --- | --- |
| nav rows | 12 (founder, partner, investor, advisor) | 5 (admin only, pre-change) |
| size | 1,428 lines | 1,066 lines |
| Introductions | 841 lines → `/api/network-introductions/*` — **0 mounts** | 592 lines → `introductions.ts` ✓ |
| Relationships | 257 lines, **0 API calls** — fixture only | 200 lines → `partnernet.ts` ✓ |
| Organizations | 330 lines → `/api/organizations*` — **0 mounts** | (no counterpart) |
| Contacts | — | 274 lines → `contacts.ts` ✓ |

Every tab of the surface four roles linked was non-functional; the one that
worked throughout was reachable only from the admin nav. The three routes now
redirect (`introductions` and `relationships` onto the matching tabs,
`organizations` onto the default — it never returned data, so nothing is lost),
each role's three broken rows collapse to one working row, and the dead stack
is deleted.

**Why not build the missing backends.** Making the richer UI real is a backend
project, not wiring: `introductions.ts` already covers credits and
accept/decline, but `candidates`, `messages`, `sendMessage`, `invite`, `get`
and `create` have no equivalent and a message thread needs a new D1 table.
`organizations` has no route file, no service and no table — it is a whole
domain. That option stays open; this change stops shipping four roles a Network
section where nothing loads.

**Side effect worth having:** removing `api.networkIntros.*` and the three
`organizations` methods retired **17** entries from
`scripts/api-drift-baseline.json`, taking the known-drift ledger from 58 to 41.

**One thing deliberately left behind.** `pages/advisor/network/kit.jsx` stays
where it is. Despite the path it is not part of the Network stack — it is a
shared component library imported by 8 unrelated pages (portfolio, pipeline,
fund accounting, partner operations). Deleting the folder wholesale broke all
eight; it was restored. It belongs in `frontend/src/ui/` and should move as
part of that consolidation, where the 8 import rewrites can be done and tested
as their own change rather than smuggled into a Network PR.

### D11. /marketplace redirects to /services; two misrouted clients repaired

**RESOLVED.** Three findings, one pass.

**The dead surface.** `/marketplace` was 645 lines with 11 `api.marketplace*`
calls, none of which the worker mounts — a partner-provider directory with
inquiry threads and reviews, implemented only in the dev-only FastAPI.
Discovery is already served by surfaces that work — `/services` (services.ts),
`/needs` (needs.ts), `/partners` (partners.ts) — so the route redirects to
`/services`, two nav rows go, and the page is deleted. Inquiry threads and
provider reviews have no backend anywhere and leave with it.

**`/legal` document generation was misrouted, not missing.** `LegalPage`'s
generate dialog called `POST /legal/documents/generate`, which the worker has
never mounted. But `legal.ts:784` serves exactly that operation as
`POST /legal/templates/:key/generate`, and the form's `doc_type` **is** the
template key. Repointed — the feature works again rather than being deleted.
Two worker behaviours now surface correctly: a contract-type template returns
409 `use_esign_envelope` (contracts must go through the e-sign flow), and the
document is named from the template. The dialog's Title input was therefore
inert, so it is gone — a control that silently does nothing is worse than no
control.

**Stripe Connect was broken on a working page — nearly deleted by mistake.**
`getMyStripeStatus`, `startStripeOnboarding` and `refreshStripeStatus` pointed
at `/marketplace/providers/me/stripe*`. They are called by `ServiceCatalogPage`'s
Stripe tab, which is live on `/services` and `/build/marketplace`. `needs.ts:575`
and `:588` serve those operations, deliberately as typed stubs — *"Stripe
Connect onboarding is owned by AO; return a typed empty status so the SPA's
check renders without crashing"* — returning
`{connected:false, detail:'stripe_connect_not_configured'}` and a 503. Because
the client used the wrong prefix, partners got a hard "Request failed" instead
of the not-configured state the tab was built to render. Repointed. There is no
`/refresh` endpoint anywhere, so refreshing re-reads status, which is what the
caller does with the response regardless.

That last one is the reason to grep callers before deleting: these three sat in
the same `/marketplace/*` block as the dead code and would have been swept out
with it, removing a fixable bug instead of fixing it. Three sibling methods with
zero callers (`setPartnerFeatured`, `setProviderKyb`, `listProviderReviews`)
were genuinely dead and did go.

**Ledger:** 18 more baseline entries retired — `scripts/api-drift-baseline.json`
falls **41 → 23**. Across D10 and D11 the known-drift ledger has gone 58 → 23.

---

## Part 2 — Decisions taken

### T1. Scoring Engine v1 and v2 are both kept — v2 does not supersede v1

They are two products sharing a name. `Scoring Engine.dc.html` is the Spin-Out Lab
**founder readiness** tool, already shipped at `/spinout-lab/scoring`
(`SpinoutLabScoringPage.jsx:1-4` names it; components in `components/scoring/`).
`Scoring Engine v2.dc.html` is the **fund-side diligence console** for
`/scoring` (guarded admin/partner/investor) — six tabs adding an editable rubric,
blind four-partner panel scoring with divergence resolution, cohort-matched
benchmarking, rubric-versioned history and a composed IC memo. Different persona,
different route, different data model. Neither is deleted for the other.

### T2. Trust Center v2 supersedes v1

Same route, same six role-gated tabs, same persona — v2 is the newer draft. It
converts Identity/Entity/Accreditation from editable forms to read-only status
reports pointing at Account Settings, adds a multi-company selector, gives
obligations provenance and expiry, groups agreements, and adds optional
name/DOB/nationality overrides to sanctions screening. Independent confirmation:
the endpoints v1's editable cards POST to **do not exist on the worker**, so v2's
read-only reframing is the fix for a live defect, not just a redesign. v1 is
archived; do not build from it.

### T3. The eight `*Rail` canvases are not navigation

The brief calls for consolidating them into one `RailNav` and sourcing mobile
bottom-tabs from the same config. Verified false: all eight contain **zero**
route links; they are the right-hand AI control rail (mode, model, token spend
meter, guardrails). The consolidation target is an `AssistRail`/ForgePanel
component, and it belongs to the Forge workstream, not routing. The left nav is a
separate element, and the live `SidebarNav` already beats the canvas version on
collapsed mode, search, tier locks and persistence — it gets lifted into `ui/`,
not rebuilt.

### T4. Tailwind v4 — there is no config file to extend

The brief says to extend the existing Tailwind config. There isn't one. The
frontend is Tailwind v4 via `@tailwindcss/vite`, themed from an `@theme` block at
`frontend/src/index.css:16-31` which defines 11 colour tokens and nothing else —
no font, radius, size, weight, tracking or spacing tokens. Exactly one overlaps
the census (`--color-brand-dark: #7c3aed`, which is the census's *primary*
violet — a naming inversion to resolve). Token work targets that `@theme` block.

### T5. `CLAUDE.md`'s deploy fact was wrong and has been corrected

It read: deploy via bare `npx wrangler deploy`, "**not** `--env production`, see
`PRODUCTION.md`". `PRODUCTION.md:56-63` says the opposite and carries a dated
verification (2026-05-06, checked against the live worker's bindings API), and
`package.json`'s `deploy` script is `wrangler deploy --config ../wrangler.toml
--env production`. The canonical doc was citing a source that contradicted it.
The hazard is not the flag — both paths target the same worker name with
identically mirrored bindings, which is what hid the error — but that running
wrangler by hand skips the `predeploy` hook applying D1 migrations, shipping the
worker ahead of its schema.

### T6. Two audit findings were rejected on verification

Recorded so they are not re-raised:

- *"The three duplicate migration prefixes (011, 068, 118) have no deterministic
  apply order."* False. `compareMigrations`
  (`scripts/lib/migrationPlan.mjs:35-40`) sorts on the numeric prefix and then
  breaks ties on the full filename.
- *"Bindings are asymmetric between the top-level and `[env.production]`
  wrangler tables."* False. All 19 binding tables are declared in both with
  identical values. The only differences are deliberate
  (`EXTRA_DEV_ORIGINS = ""` in production only) or inheritable Wrangler keys
  (`[[rules]]`, `[observability]`).

### T7. Two conventions the brief states as absolute are not

- **Money is not uniformly integer cents.** 15 `*_cents` INTEGER columns exist
  across 11 SQL files, but ~50 money-ish `REAL` float columns exist elsewhere in
  the older capital/fund/portfolio code. A money-float CI grep would fail on
  existing code today.
- **API parity is baselined, not absolute.** `scripts/api-drift-baseline.json`
  currently blesses 58 `missing_route` entries — SPA calls with no worker route
  that ship and pass CI. The gate fails only on *new* drift.

Both remain correct as forward rules for new code. Neither describes the
existing tree.
