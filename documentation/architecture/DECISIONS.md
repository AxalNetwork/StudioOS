# DECISIONS.md

Decisions taken during the Axal VC canvas-integration work, and the open ones
that need a call before Phase 0/1 starts. Each entry records what was decided,
why, and what evidence it rests on, so a later reader can reverse it knowingly
rather than by accident.

---

## Part 1 — Decisions

All thirty-one decisions are now resolved. D6 is closed by D11, which repaired
the last two of the four live defects the audit found; D12 corrects D9's own
per-tab table and closes out the Research row. D13 to D17 are Phase 4's, and
D14 corrects a false statement this work had itself recorded.

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

**Status: RESOLVED — "Eadwyn".** Not the ForgeRail canvas's own name, by
decision of the product owner. ForgeRail's mechanics carry over unchanged —
model **recommended** not inherited, the "Axal VC margin" disclosure, the scope
chip, and the hard boundary — only the word spoken in the product changes. The
governing copy is now *"Eadwyn never sends, signs or voids; every outbound
action is a human click."* The other seven rails collapse into the same
component under this one voice, per the AssistRail consolidation (Phase 1d).

References to "ForgeRail" elsewhere in this repo name the source canvas file
(`design/canvases/ForgeRail.dc.html`) and are left as-is — that file's name
does not change. Only the AI's spoken name changes, everywhere it appears as
product copy: `ROUTE_MAP.md`, `design/pattern-census.md`,
`frontend/src/ui/AssistRail.jsx`.

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

**This table was itself wrong for two rows — see D12.** "news → real" and
"ai → real" matched the tab's NAME against a router's name. `news.ts` is the
platform's own article authoring pipeline; `assistant.ts` is conversational
chat. Neither serves the material its tab rendered. D12 withdrew all four
remaining tabs on the reasoning D9 had already applied to the funds tab.
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

### D12. The Research row is /market-intel and nothing else

**RESOLVED.** Four tabs remained under `/advisor/research/*` after D8 redirected
market and D9 withdrew funds: **companies, AI research, news, documents**. All
four are withdrawn, on exactly the reasoning D9 gave for the funds tab.

**This required correcting D9's own table.** D9 recorded `news` and `ai` as
having real backends. Verified against the material each tab actually rendered,
they do not:

| Tab | D9 recorded | Verified |
| --- | --- | --- |
| news | `news.ts` (11) — "real" | `news.ts` is the platform's **article authoring** pipeline: draft, submit, retract, cover image, slug. The tab rendered a **third-party industry feed** — Barron's, InvestmentNews — with per-item sentiment and company tagging. Same word, different material. |
| ai | `assistant.ts` (9) — "real" | `assistant.ts` is **conversational chat**: message, conversations, feedback, retention. The tab rendered SWOT analyses, market maps, company reports and comparables. Its own fixtures are named `AI_ANALYST_SAMPLES`, `SWOT_SAMPLES`. |
| companies | "partial" | Accurate, and worth stating precisely: **one of thirteen** datasets is served, and that one (`competitors.ts`, `crunchbase.ts`) is *per-project competitor analysis*, not a research database. STARTUPS, ENTERPRISE_COMPANIES, CUSTOMERS, PARTNERS, UNICORNS, PUBLIC_COMPANIES, EXITS and FUNDING_ROUNDS have nothing. |
| documents | "thin" | Understated. `files.ts` has one endpoint, `/dl/:token` — a signed **download** primitive. There is no document store to list. |

Both wrong rows failed the same way: a router was matched against a tab by
**name**, not by what it serves. That is the same error shape D9 itself caught
in D7 ("Research is the clearest case" — true of one tab in six), one level
down. Recorded here because the correction is the useful part: a per-tab table
is only worth what its per-tab verification was.

**What changed.** Four routes withdrawn; `/advisor/research` now redirects to
`/market-intel`; twenty nav rows removed across five role navs; admin's Research
group dropped entirely (it was left empty, and admin already links
`/market-intel` from its own row); `pages/advisor/research/` (6 files) and
`data/advisor/research.js` (54KB, 39 exports) deleted.

The four are **removed, not redirected to `/market-intel`**. That page has no
company, document or news data either — pointing "Companies" at it would trade a
blank surface for a misleading one. `/advisor/research` itself redirects because
the *section* still exists; the individual tabs do not.

They return when a PitchBook/Crunchbase-class source is licensed — the same
condition D9 set. Guarded by
`frontend/test/research_tabs_withdrawn.test.mjs`.

**Not in scope: the five Advisory Practice tabs.** `/advisor/advisory/*`
(opportunities, clients, engagements, delivery, contracts) reads a 42KB fixture
and has the same absence — `advisory.ts` is founder-facing (find an advisor,
ask, diligence, financial-plan), not advisor practice management. Its real home
is the Advisory Practice work against `partner_office_hours.ts`, which is task
**#124** and is blocked while `/office-hours` is on this pass's do-not-touch
list. Withdrawing it now and rebuilding it there would be churn, so it stays as
it is, labelled, until #124 unblocks.

**UPDATE 2026-09-02 — #124 is unblocked and this was wrong twice.** D31 below
corrected the first error (the backend is `advisors.ts`, not
`partner_office_hours.ts`). The second is here: the tabs' real home was never
`/office-hours`. That page is now retired and `/practice/*` is minted, with the
same five tabs plus Sessions and Earnings. See UNRESOLVED_ITEMS U4.

### D13. The model menu is removed, not disabled

`AssistRail` drew a model picker in all eight source canvases. It has nowhere
to point: `services/aiRouter.ts` selects the model from the **task class** —
`llama-guard-3-8b` for `safety`, `bge-base-en-v1.5` for `embed`,
`qwen2.5-coder-32b` for `tool_call`, `llama-3.3-70b` for `advisor_turn` — and
degrades down a per-task fallback chain under load. A user preference could
only offer answers that are wrong for the task, or duplicate the one the router
would have picked anyway.

Three options were weighed: remove it, make the router honour a validated
preference, or render it disabled with an explanation. **Removed.** Disabling
it keeps a permanently dead control on every rail, and a control that cannot
change anything reads as a setting the user has already made — worse than no
control. Making the router honour a preference is real work with a safety edge
(a caller must never be able to route a `safety` call away from the guard
model) and belongs to its own change if it is ever wanted.

What replaced it is better than either: the card now reports the model that
**actually ran**, from `ai_usage_logs`, and says so when the router fell back
to a smaller sibling. The old card asserted a configured name over runs that
may not have used it.

Reversible: the ROUTE map is the only thing that would have to change, and the
component's own header records why the menu went.

### D14. "There is no eadwyn AI Gateway yet" was false

Recorded because it survived a whole phase boundary and shaped a plan.

`AssistRail.jsx` and `ui/index.js` both said the gateway did not exist and that
Phase 4 would build it. `cloudflare-worker/src/services/aiRouter.ts` is that
gateway and predates the claim: sixteen task classes, a fallback chain, a
llama-guard safety pass, content-hash caching, per-user $/day and $/month KV
caps, an org kill switch, and a row in `ai_usage_logs` per call, with ten
consumers already routing through it.

The error was made on a **name**. Nothing in the tree is called `eadwyn`, so
the gateway looked absent — the same failure mode as D9's "news → news.ts →
real", where a module was matched on its name rather than on what it serves.

The actual Phase 4 gap is narrower and different: nothing exposed the gateway
to the person spending the money. The only rollup over `ai_usage_logs` was
`/api/monitoring/ai-usage`, behind `requireAdmin`, so the rail's spend meter
took its numbers as props. `GET /api/ai/me/spend` is the correction.

Still genuinely missing after that: per-page mode persistence
(`useAssistMode(pageKey)`), and the rail is mounted on zero pages — placement
is now settled as "surfaces that actually reach the router", which is seven
pages (advisory ×2, brand ×2, onboarding chat, market/competitors, deck
reviewer).

### D15. The rail goes where a user spends their own budget

Placement was settled as "surfaces that actually reach `aiRouter`", traced from
`run()` call sites through the route files to the pages. That gave seven. One
of them is excluded on a second clause: **reaching the router is necessary, not
sufficient.**

`OnboardingChatPage` reaches it — `/api/profiling` routes `role_detect` — and
is deliberately left out. It is a signup-funnel step for a user whose role is
still `pending`, on a centred single-column card; the call there is the
platform profiling THEM, not them spending anything. A dollar meter on a
first-touch screen misdescribes whose money is moving and is the worst possible
place to put one.

The six that remain are `AdvisoryPage`, `SpinoutLabAdvisorsPage`,
`BrandBuilderPage`, `SpinoutLabBrandPage`, `SpinoutLabMarketPage` and
`DeckReviewerPage` — surfaces where a user deliberately runs AI work and can be
shown what it cost.

### D16. The run estimate is measured, not modelled

Every rail canvas carried invented token counts — `tin: 1800, tout: 600` and
similar — with no source. There is no honest source: nothing knows how many
tokens a deck review takes before it takes them.

So the estimate is not modelled at all. It is the caller's **own observed
average** for that task class, from their `ai_usage_logs` rows via
`/api/ai/me/spend`. That is a real number about real runs, it sharpens as they
use the surface, and when they have no history it is honestly absent.

`eadwynConfig` therefore sets `tin`/`tout` to zero on purpose, and `AssistRail`
prefers `observed` → modelled → **null**, never zero. `runCost()` of zero
tokens is `0`, and rendering that would price the run at free. "Not recorded"
is worth more than a number nobody measured — the same rule the fund surfaces
follow, applied to cost.

### D17. No mode toggle until a page branches on the mode

The canvases draw a per-surface assist toggle labelled "Remembered per page",
and the rail's own header carried this as unfinished work: a
`useAssistMode(pageKey)` hook that did not exist yet.

It is not unfinished, it is unwarranted. **No page branches on an assist
mode.** Turning the switch off would change nothing any of the six surfaces
does, so shipping it — with or without persistence behind it — puts a control
on screen that cannot affect the product, and then remembers the user's
setting of it. That is D13's objection to the model menu, one control over, and
it applies with more force here because persistence would make the dead control
look deliberate.

`eadwynConfig` therefore declares every surface `kind: 'fixed'` and the toggle
does not render. `AssistRail` still supports it: a surface that ever grows real
manual behaviour — a brand page where "off" means "I write the copy myself" is
the plausible one — declares `kind: 'choice'` and passes `mode`/`onModeChange`,
and `pc.manualNote` already exists to say what "off" means. The hook is worth
building at that point and not before.

### D18. A quota check that cannot read its ledger denies, and the ledger exists

`workflows`, `workflow_tasks` and `shared_services_log` were queried by four
route files and created by nothing — no migration, no `ensureSchema`, no dev
model. Not "not yet migrated": never written. Six more tables were named for
something that does not exist (`scoring_runs` for `score_snapshots`,
`market_intel_personas` for `market_intel_indexes`, `partner_deal_redemptions`
for `partner_referral_redemptions`) or belong to features with no store at all.

Two decisions come out of it.

**The tables are created, not the references removed.** The dashboard reads
`workflow_tasks` for a real panel, the spin-out route composes a real five-item
founder checklist, and the marketplace intro has no record of itself other than
the workflow task it writes. This is a feature that was built and never given a
schema, not dead code. Migration 177 defines the three tables; the column set is
the union of what the four routes actually select, insert and join on, and
nothing speculative is added. `services/workflowSchema.ts` mirrors it for the
unapplied-migration case — one module rather than four `ensureSchema` copies,
because four copies of a definition is how the definitions drift, and a rate
limiter counting rows in a table whose shape depends on which router ran first
is not a rate limiter.

**The AI quota gate fails closed.** Three routers each carried a private
`checkAiQuota` over the same ledger with the same 60/hour ceiling, and the three
disagreed about the only case that mattered: legalcap caught the read failure
and returned "under the limit"; pipeline and networkfx did not catch it and
500'd. Since the table did not exist, in production the limiter was either
absent or fatal — never a limiter. `services/aiQuota.ts` replaces all three.
"Cannot tell" answers **503**, matching what `middleware/rateLimit.ts` already
does for its `failClosed` buckets, and distinct from the 429 that means the
caller really is over. Collapsing the first into the second turns an outage into
a documented bypass.

The generalisation is `scripts/check-sqlite-tables.mjs`, in `test:guards`. It
reads table references out of SQL string contents — blanking SQL literals first,
because `'requests from the operator marketplace.'` otherwise contributes a
table called `the` — and fails on any reference nothing creates. The three
remaining gaps are recorded in `sqlite-tables-baseline.json` with what each
query returns today; the gate also fails on a baseline entry that has since been
created, so the ledger cannot rot into fiction.

None of this was visible before. `tsc` does not read SQL, and a D1 stub that
matches on SQL text answers whatever it was taught, so it cannot notice that a
table is absent. Nearly every call site sat in a swallowing `catch`: the failure
mode of a missing table is not an error, it is a feature that quietly returns
nothing. That is the third time this repo has been wrong about something because
a check matched a name instead of the material (see D9, D14).

### D19. The async scorer gets its own table, and the harvest gets tested

D18's table check has a sibling one level finer: columns. Fourteen INSERTs
named a column that does not exist — every one inside a swallowing `catch`, so
every one a row that has never been written. The assistant's activity log, the
Slack admin audit row, an imported pitch deck, the audit `actor` seven admin
routers probe for, and the queue consumer's own error-reporting path, whose
comment says it exists to "surface the bug in `error_logs`" and which surfaced
nothing.

Thirteen were mechanical: three renames onto the columns that do exist
(`entity_type`/`entity_id`, `admin_user_id`/`filters_json`, dropping a
`pitch_decks.updated_at` neither definition has), and migration 178 adding the
two sets that were genuinely absent.

**The fourteenth was not, and it is the decision.** `queueWorker`'s `ai_scoring`
job wrote into `score_snapshots` under five wrong names. Correcting them looked
like the obvious repair and was the wrong one: the two scorers are different
instruments. `routes/scoring.ts` produces 6 dimensions on 0–100 with sub-scores,
runs `detectAnomalies` **before** the insert — its own comment warns that the
other order silently swallows the flags — and stamps integrity, sandbox and
official-week provenance. `ai-workers/scoring.ts` produces 4 category totals on
a 0–75 scale with none of that. `score_snapshots.tier` is NOT NULL against
thresholds of 85 and 70, which a 0–75 total can never reach, so every async row
would be `rejected` by arithmetic rather than judgement — and seventeen
consumers read that table, including deal memos, the Spin-Out Lab deck and the
public pages.

So migration 179 gives it `ai_score_drafts`, deliberately with **no `tier`
column**: a tier is a decision and this scorer is not equipped to make one. The
scales live in the column names (`total_0_75`) so nobody reads them as the
canonical dimensions. Nothing consumes the table yet, which is the point — it
is queryable evidence of what the async scorer produced, not an input to
anything that decides. Same instinct as the funds honesty rule: an unaudited
number is not a cheaper version of an audited one.

**The harvest is now tested, because it was wrong six times.** Every fault
made the guard name something that exists, except the last, which made it stop
reading: `--` comments unstripped; then stripped *after* the comma split, so a
comment containing a comma swallowed the columns below it; `KEY` treated as a
constraint when SQLite has no such table constraint, so a column named `key`
vanished; DDL built by `'…' + '…'` read only to its first fragment; `ALTER
TABLE ${table}` unresolvable; and an apostrophe inside a `--` comment opening a
string scan that ate the rest of the statement. The reported count fell 106 →
27 → 20 → 18 → 16 → 14 as each was fixed, and the fourteen that survived were
each confirmed by reading the DDL. `test/schema_guards.test.mjs` pins all six.

**One of those faults was in a shipped guard.** `sqlStrings` skipped only
whitespace between `.prepare(` and the opening quote, so a query introduced by
an explanatory comment was invisible to *every* check built on it — the dialect
guard included. Six such strings existed; writing a seventh is how it surfaced,
when a probe that should have failed passed instead. That is the argument for
probing a guard rather than trusting it: the blind spot was not in the finding,
it was in the instrument, and only a deliberate injection could show it.

### D20. The column check covers UPDATE too, and stops there

D19's check read INSERT column lists only. `UPDATE … SET` is the other place a
column is named with the table certain — no alias, no join, no expression — so
it is checkable on exactly the same terms, and extending to it cost about
twenty lines. It found two more.

**`projects.pipeline_stage` exists on no table in this schema**, and two
spin-out endpoints write it. The instructive part is what SQLite does with an
unknown column: it rejects the whole statement rather than ignoring the one
term. So

    UPDATE projects SET pipeline_stage = 'spun_out', stage = 'spun_out', …

lost the `stage` write as well, and a spun-out project was never moved out of
the main pipeline. The catch above it reads *"Schema may differ — ignore
non-existent column"*: right about the cause, wrong about the consequence, and
that mistaken confidence is why it sat there. The second site wrote
`pipeline_stage` alone and returned `ok: true, decision: 'continue_iterate'`
for a write that recorded nothing. Both now write `stage`, which exists and
already takes exactly the values in question — `committed`, `mvp`, `spun_out`.

**`users.organization` never existed, and its absence broke a second question.**
`writeRouter` handles three role-detection answers identically: write to a
`users` column, then read it back to decide whether to ask again. `role`,
`headline` and `bio` are all fine. The `organization` write threw into a catch
that told the user their answer was *"remembered for later"* — nothing
remembered it. Worse, the answered-check is a single
`SELECT organization, headline FROM users`, which throws on the first unknown
column and returns null for the row, so `headline` was marked unanswered too
despite being stored correctly. One missing column made the advisor re-ask two
questions forever. Migration 180 adds it, and the hint now says what actually
happened rather than making a promise the code cannot keep.

**The scope stops at SET.** A column in the `WHERE` is not attributed, because
`UPDATE … FROM` and correlated subqueries can put another table's columns
there, and a check that guesses is a check nobody trusts — the same line D19
drew at SELECT lists. `setClause` therefore terminates at the first top-level
`WHERE`/`RETURNING`/`FROM`, skipping SQL strings so prose like
`SET note = 'ask them WHERE they are'` cannot end it early. Both properties are
pinned by test, and the boundary was probed the same way the finding was: a bad
column in the SET fails the build, a bad column in the WHERE does not.

### D21. Reads are checked where one table can own the column, and nowhere else

D19 declined to check SELECT lists because attributing a column to a table
there is usually a guess. That is true in general and false in one common case:
a SELECT with exactly one table, no join, no set operation, no subquery and no
`*` has only one candidate owner for every bare name in its list. 773 of the
worker's SELECTs are that shape, and checking them found six more defects —
all of them reads, which is where the damage had been hiding.

The sharpest is `SELECT user_id FROM founders`. `founders` has no `user_id`;
the link runs the other way, through `users.founder_id`. That `.first()` is
unguarded, so the route did not degrade — it 500'd. The rest degrade silently
in the now-familiar way: `activity_logs.target_type`/`target_id` (the read half
of the write D19 corrected, still wrong here), `calendar_events.location` on a
table that models location as a kind plus a URI, `integrations.provider_name`
where migration 016 says `provider_key`, `queue_jobs.fund_id` where the fund id
lives in the payload JSON, and `score_snapshots.score` where the column is
`total_score` — so every portfolio row reported a null scoring driver.

**The check declines more than it judges, on purpose.** A join, a union, a CTE,
a subquery or a `*` makes ownership ambiguous, and the scanner returns nothing
rather than picking a table. Probed both ways: a bad column in a single-table
SELECT fails the build, the same bad column behind a JOIN does not.

**Thirteen tables are skipped entirely, and the count is printed.** They are
extended at runtime by a loop over a literal list —
`for (const [col, type] of KYC_COLUMNS) ALTER TABLE users ADD COLUMN ${col}
${type}` — so the column name never appears anywhere this harvest can attribute
it. Binding a loop variable back to its array is real static analysis; guessing
at it would put the check back in the business of inventing findings, and every
`users.kyc_*` column reads as missing while being perfectly present. Skipping
is uniform across INSERT, UPDATE and SELECT so the soundness rule stays one
rule, and `test:guards` prints "13 tables skipped as runtime-extended" so the
blind spot is stated rather than implied. That number is the honest measure of
what this check cannot speak for, and it is the obvious next thing to shrink.

The measurement ran 17 candidates down to 6 by reading the DDL for each one
before writing a line of fix — four `users.kyc_*` and three `partners` columns
were the runtime-extended false positives that motivated the skip rule, and
`SELECT 1 FROM t` briefly registered as a column named `1` because `\w` matches
digits. Seventh parser fault in this family; every one of them so far has
invented a finding rather than missed one, which is the failure direction that
destroys trust in a guard.

### D22. The blind spot D21 declared is closed, and it was hiding six defects

D21 skipped thirteen tables whose columns are added by a loop over a literal
list, printed the count, and called shrinking it the obvious next work. It is
now zero.

**The arrays were always readable.** Every such loop in the worker is one of
two shapes — `for (const col of ['notes TEXT', …])`, where the name is the
first word, or `for (const [col, type] of [['bio','TEXT'], …])`, where it is
the first element — and which one applies is read off the loop's own
destructuring rather than guessed. That is reading literal data sitting in the
source, which is the same standard the DDL harvest already meets; the earlier
skip was caution about a problem that turned out to be tractable, not an
intrinsic limit.

**Closing it surfaced six defects the skip had been hiding**, and one of them
is the largest single surface this family has found. All four role variants of
the dashboard's deal-flow query — admin, founder, investor, partner — selected
`projects.score` and `projects.ai_decision`, and `projects` has neither. Every
one sat in `safeQuery`, so `proprietary_deal_flow` has been empty **for every
role**. Only two variants were single-table and therefore caught by the check;
reading found the other two, which is the intended division of labour between a
guard and a person.

The rest: `partners` has `email` and `company`, not `contact_email` and
`organization`, and no `user_id` at all — the link runs through
`users.partner_id` — so the office-hours calendar invite resolved neither the
partner's address nor its owner's. And `partners.kyb_status` exists on no table
in this schema; the KYB flow lives behind `/trust/kyb/*` and writes no such
column, while `trust.ts` selects the same phantom from `corporate_profiles`.
That one is **not** given a column: `kyb_verified` becomes `null` rather than
`false`, because "we have no record" and "this partner is not verified" are
different claims and a trust signal is exactly where the difference matters.

**Two invented facts came out of the shipped guard on the way.** `ADD COLUMN
${col}` makes the optional `COLUMN` group backtrack and hand back the word
COLUMN as the column name, which had planted a phantom `column` on fourteen
tables; and `ALTER TABLE ... ADD COLUMN` written in prose had created a table
called `...`. Neither produced a false positive — nothing is named `column` —
but both were the harvest asserting something untrue, which is the property
this whole family exists to eliminate. Both are now rejected and pinned by
test.

Eighth parser fault, and it was predicted before it was found: an apostrophe in
`// at D1's 100-column limit` opened a string scan in the new JavaScript
bracket walker and ate the rest of the file — the identical fault the SQL
scanners carried, one language over. Knowing the shape of your own recurring
mistake is worth more than any individual fix.

### D23. A join makes the query ambiguous, not the reference

D21 declined joins wholesale, on the grounds that attributing a column to a
table across one is a guess. That was too broad. A qualified `alias.column` is
attributable the moment the FROM/JOIN clauses bind that alias to one table —
which they almost always do. The ambiguity a join introduces belongs to the
*bare* names in the select list, not to the qualified ones.

Across 160 join queries and 1694 qualified references, eleven were wrong.

`corporate_profiles.kyb_status` was the one that prompted this: it was found by
reading, on the previous pass, and the obvious question was whether a check
could have found it. It can, and did.

The sharpest of the rest is a **second copy of a query whose first copy was
already fixed**. `admin_contracts.ts` carries two `partner_deals` reads with the
same three wrong names — `partner_user_id` for `user_id`, a `granted_tiers` that
does not exist, an `updated_at` the table lacks. D18 corrected one of them. The
other was a join, so nothing looked at it. Fixing one instance of a broken query
does not fix its duplicates, and only a check that reads every site will say so.

Two more are worth naming because of what they guard rather than what they show:
an ownership gate in `imports.ts` that could not evaluate at all (`founders` has
no `user_id`; the link is `users.founder_id`), and a Telegram **redaction check**
that scanned nobody and passed silently because `users.full_name` is
`full_legal_name`. A check that cannot run is not a check that fails safe.

**Where the fix would widen exposure, it was not taken.** The coach directory
filtered on `u.show_in_directory`, which is not a column on `users` — but it
*is* one on `user_settings`. Dropping the filter would have listed every coach;
joining the table it actually lives on preserves the opt-out exactly. Reaching
for the schema before reaching for the delete key is the whole difference there.

**And where no fix exists, none was invented.** `corporate_profiles.kyb_status`
is the single baselined entry, with its reason recorded: nothing anywhere writes
a KYB decision. `/trust/kyb/start` upserts entity fields and sets the obligation
to `in_review`; there is no provider callback and no admin approve/reject.
Adding the column would leave the reconciliation loop reading NULL forever, so
it stays a documented gap and a product question — which store, which values,
who writes them — rather than a migration that looks like progress.

The scope still declines what it should: an alias bound to two tables in one
statement maps to null and is skipped, and bare names in a join are left alone.
Both probed — a bad qualified column fails the build, the same column under an
ambiguous alias does not.

### D24. The predicate was the last place a wrong column could hide

D21 checked what a statement writes and D23 what a join names. Neither read the
`WHERE`. That left the largest surface in the worker unexamined: **1914
single-table statements carrying 3007 predicate references** — more than the
INSERT lists, the SET clauses and the qualified join references put together.

It is also the surface where a wrong column does the most damage quietly. A bad
column in an INSERT loses a write; a bad column in a filter loses *the whole
result set*, and the feature above it reports "nothing found" rather than an
error. Both defects this pass turned up are exactly that:

- `dd_external_sources.source_kind` — the table names the connector
  `connector`. `source_kind` is the sibling column on `dd_findings`, defined
  fourteen lines earlier in the same migration file, which is how the name got
  borrowed. The Crunchbase enrichment therefore never saw a prior response.
- `documents.signer_email` — `documents` has no per-signer email at all. The
  column belongs to `esign_audit_events`; the canonical per-recipient link is
  `esign_recipients.recipient_email`. `routes/trust.ts` had already made that
  exact substitution, for that exact reason, with a comment saying so.

The second one earns its own note. `documents.signer_email` sits in
`execTool()` in `routes/assistant.ts`, a function with five D1-backed tools —
and **three of the other four already carry fix comments for this same bug
class**: `recentActivity` (`entity_type`/`entity_id`, not `target_*`),
`upcomingMeetings` (`calendar_events` has no bare `location`), `scoringSummary`
(`score_snapshots`, not `scoring_runs`). Three prior passes read that function
and left the fourth in place, because each of them fixed what it could see and
what none of them could see was the `WHERE`. Coverage is not attention. A guard
that reads one clause will keep finding defects the readers of the other
clauses walked past.

**Two more parser faults, both over-reporting, both instructive.**

Counting `SELECT` keywords is how the earlier passes rejected subqueries, and
it is wrong for `UPDATE` and `DELETE`: they contain no `SELECT` of their own,
so a statement like `UPDATE users … WHERE id IN (SELECT id FROM users …)`
counts exactly one and passes the test, after which the subquery's `FROM` is
read as a column of the outer table. The check now declines on any `(SELECT`.

And `COUNT(*) AS n … GROUP BY n` names a *result*, not a column. Twenty-one of
the first twenty-nine findings were aliases like this — `AS day`, `AS bucket`,
`AS total_cost`, `AS n` — every one legal SQL. Harvesting the `AS` names ahead
of the predicate and excluding them took the list from 29 to 2, and both
survivors were real.

That ratio is the entry itself. Eleven parser faults have now been found across
these three guards and **every single one over-reported** — invented a column or
a table by matching prose, a comment, a keyword, or a name that was never the
material. The failure mode of a checker is not missing things. It is confidently
naming things that are fine, until nobody reads its output any more.


### D25. `${…}` is not a reason to stop reading

Every column pass so far began with the same line:

```js
if (body.includes('${')) continue;   // interpolated — column list is not literal
```

That was true of one construct and false of the other, and nobody had
separated them. `.prepare(\`…\`)` splices raw text into SQL, so an
interpolation there really can be an identifier and the string really is
unreadable. But `sql\`…\`` is the tagged template in `src/db.ts`, and it does
this:

```js
strings.forEach((str, i) => { sql += str; if (i < values.length) sql += '?'; });
await db.prepare(sql).bind(...values).all();
```

Every `${…}` becomes a bound `?`. The **structure** of those queries is
entirely literal. There were **833 of them — a fifth of all the SQL in the
worker — and no column check had ever read one.**

Ten defects were in there. Substituting `${…}` → `?` and running the existing
four passes over the result found all ten, and the guard now reports its own
coverage — 3797 strings read, 286 skipped as raw-interpolated — so the size of
the remaining blind spot is a number in the build log rather than an
assumption.

**The most expensive one is an entire feature that has never worked.**
`advisorBookingEvents` and `partnerOfficeHourEvents` in `services/calendar.ts`
read `scheduled_start`, `scheduled_end`, `requester_user_id`, `meeting_uri`,
`questions` and `project_id` off the booking rows. None of those columns exist
on `advisor_bookings` or `partner_bookings`, which carry
`(slot_id, advisor_id|partner_id, founder_user_id, topic, notes, status)` — the
time lives on the slot. The status filter was wrong too: it looked for
`'requested'`, and both booking routes write `'pending'`. The function's own
catch handles `isMissingColumnError` by returning `[]`, so **office-hour
bookings have never appeared on anyone's calendar**, and the calendar reported
that as "no events" rather than as a fault.

The rest are single names, but three of them repeat lessons already recorded:

- `admin_contracts.ts:729` is the **third** copy of the `partner_deals` join.
  D18 fixed the first, D23 the second, and the third was invisible because it
  sat inside a tagged template. Three passes, three copies, one query.
- `dashboard.ts:82` filters the founder's own deal list on
  `projects.submitted_by`, which is a `tickets` column. The comment directly
  above it describes a previous repair to that same query's **select list**.
  The `WHERE` was left wrong, so the list stayed empty — D24's lesson, in the
  file D24 did not reach.
- `scoring.ts:316` reads `SELECT user_id FROM founders`, the same
  non-existent link `imports.ts` used. Here it means the founder is **never
  notified when a score lands on their project**.

One column was added rather than re-targeted: `calendar_sync_records.last_error`
(migration 181). That is the opposite case to `corporate_profiles.kyb_status`
and the distinction is worth keeping. Here the writer exists and knows the
value — `services/calendar/sync.ts` stamps the failure reason into it, inside a
catch whose own comment reads *"last_error column may not exist yet — drop
silently"*. The author suspected and shipped it anyway. There is a value, a
writer, a stated consumer, and five sibling tables already using that exact
column name. `kyb_status` has none of those: nothing anywhere decides a KYB
outcome, so a column would read NULL forever. A column is warranted when
something already knows what to put in it.


### D26. A routed column is a column, even when the SQL never says its name

`check-sqlite-columns` cannot see the advisor writeRouter's writes, and it is
right not to try. They are `UPDATE <table> SET ${col} = ?`, where `col` comes
out of a literal map at runtime — the SQL text carries no column name at all,
so the string is skipped as raw-interpolated. But the map beside it does carry
the name, and `check-write-router-coverage` was already reading that file for a
different property: that every bank question is **routed** somewhere. It never
checked that the destination is **real**.

Three were not. Migration 042 ends with

```sql
ALTER TABLE mentors ADD COLUMN topics_willing_json TEXT;
ALTER TABLE mentors ADD COLUMN topics_unwilling_json TEXT;
ALTER TABLE mentors ADD COLUMN weekly_hours_band TEXT;
```

and **there is no `CREATE TABLE mentors` anywhere in this repository.** The
naming settled on `advisors`; 042 was written against the earlier word, and
those three statements have failed since the day they shipped. The router
writes the same three names to `advisors`, and the answered-check reads them
back from `advisors`. Migration 182 puts them where both already assume they
are.

The failure is quiet in a specific, worse-than-usual way. Each of these writes
has a fallback: on error the answer is merged into a `*_extras_json` sidecar.
So the answer is not lost, **the caller is told `status: 'saved'`**, and the
typed column the product reads stays empty. The answered-check then reads the
name off the row, gets `undefined`, and asks again — every session, forever.
An advisor is asked the same three questions indefinitely while being told each
time that the answer was saved.

One thing kept it from being much worse, and it was luck rather than design:
the answered-check selects `*` rather than a column list. Had it named its nine
columns, one unknown name would have taken the whole row down and re-asked all
nine — the compounding shape D-recorded for `users.organization`. `SELECT *`
is usually the sloppier choice; here it contained the blast radius.

**Two parser faults, and one of them was the guard reporting success while not
looking.** The first version bound each `UPDATE` to the nearest preceding map
declaration, which handed `partnerMap`'s six columns to `explorer_needs` and
invented six defects — proximity is not identity, so maps are now resolved by
name through the variable the UPDATE interpolates. The second is sharper: the
declaration matcher looked for `= {` with `[^=\n]*` in between, and these maps
are declared `Record<string, { col: string; coerce?: (v: string) => number }>`.
The `=>` inside the type annotation is an `=`. Two maps of six resolved, the
other four silently produced no columns, and **the guard printed a tick over
the three defects it exists to catch.** That is the failure mode this file
keeps naming, committed by the check itself: over-reporting is loud and gets
fixed, under-reporting looks exactly like success. The guard now prints how
many maps it resolved and how many it could not, so "0 unresolved" is a claim
it has to keep making.


### D27. Two definitions, one table: what the column guard cannot see

`check-sqlite-columns` **unions** every definition of a table it finds, because
nothing static can know which one D1 actually holds. That is the right default
for a check that must not over-report, and it has a consequence nobody had
written down: **249 tables in this worker are defined more than once, and where
those definitions disagree, the union hides it.** `capital_calls` reads as
nineteen columns wide. No version of it has ever had more than thirteen.

The narrow, provable question is not "do the definitions differ" — they differ
constantly and usually harmlessly, a `.ts` `ensureSchema` mirroring a migration
plus the columns later ALTERs filled in. It is whether two definitions are
**mutually fatal**: each requiring a `NOT NULL` column, with no default, that
the other has no column for. Then no single table can satisfy both, D1 holds
one table per name, every definition is `IF NOT EXISTS` so the first to run
wins — and one of the two code paths is dead. **Eight tables are in that
state.**

Two of them are provably broken *without knowing which shape is live*, because
the worker's own writers disagree with each other:

- **`metrics_snapshots` has three incompatible writers.** `(scope, scope_id,
  metric_name, value)`, `(project_id, snapshot_date, mrr, arr, …)`, and
  `(deal_id, key_metrics, traction_score, created_by)`. Each names columns the
  others lack. At most one of the three is writing rows.
- **`capital_calls` has two.** `routes/legalcap.ts` inserts `deal_id,
  syndicate_id, amount_cents`; `routes/funds.ts` and `routes/capital.ts` read
  `WHERE limited_partner_id = ?`, the shape
  `sql/consolidate_capital_rebuild.sql` builds — which has no `deal_id` and
  requires an `amount REAL NOT NULL` legalcap never binds.

**Which shape is live is not knowable from this repository, and it was not
guessed.** `scripts/migrate-d1.mjs` enumerates only `sql/migrations/*.sql`;
the top-level `sql/*.sql` files are applied by hand, so file order settles
nothing. `advisor_bookings` is the worked example that the numbered file does
not always win: bookings are written in the `t13_t14_t15.sql` shape and that
flow works, so `schema.sql`'s six-column version is the dead one — which is why
the office-hours calendar repair in D25 targeted the t13 shape rather than
`schema.sql`'s. Reading production takes one `PRAGMA table_info` per table, the
baseline names the command, and it is a thing the user can run and this session
cannot.

So the deliverable here is a guard and a ledger, not a rewrite. Rewriting
`capital_calls` or `metrics_snapshots` against a guessed shape would be the
exact error this file has been cataloguing for twenty-six entries — acting on a
convenient reading of the material instead of the material. Eight entries are
recorded with what is provable about each; the gate fails on a ninth, and fails
equally on an entry that has since been converged, so the ledger cannot quietly
go stale.


### D28. Money in cents, going forward — the legacy dollars are a ledger, not a lint fix

The integration brief asks for money as integer cents, property-tested, with CI
grepping money fields for float parsing. The survey that preceded the guard
changed what it should be:

**This schema already speaks both dialects.** Thirty-one `*_cents` columns
exist — orders, syndicates, commissions, payouts, liquidity events, expert
bookings, events, marketplace rates — and **every one is correctly declared
INTEGER**. Alongside them sit fifty-two REAL dollar columns, and they are not
the peripheral ones: LP commitments, called capital, capital calls,
distributions, NAV, portfolio marks, cap-table and 409A share prices.

So there was no defect to fix, and converting the fifty-two is not a lint fix.
It is a data migration over live fiduciary records that needs a rounding
decision and a cutover of every reader, on a database this session cannot read.
Doing it unasked would be the opposite of the funds honesty rule.

What the guard buys instead is that **the split stops growing**. Two rules,
both narrow enough to be facts: a `*_cents` column must be INTEGER, and a new
column holding currency must be `*_cents INTEGER` or be on the ledger. Fifty-two
entries are recorded, the gate fails on a fifty-third, and it fails equally on
an entry that has since been converted — so the ledger cannot go stale, and
finishing the conversion is a matter of deleting lines from it.

**The classification was the whole difficulty, and it was wrong in both
directions first.** A regex over column names matched 138 "money-ish" columns
and was confidently wrong about a fifth of them. `score_snapshots.capital_total`
and its eight siblings are *scores*. `vc_funds.carried_interest` defaults to
0.20 and `management_fee` to 0.02 — they are *fractions*. `fx_rates.usd_rate`
is an *exchange rate*. `cap_table_vesting.total_shares` is a *count*.
`fund_distributions.distributed_at` is a *timestamp* that happens to contain the
word "distributed", and `event_notifications.principal_key` is a *security
principal*. A check demanding cents of any of those would be demanding nonsense,
and would have been ignored within a week.

Two narrowings fixed it. The exclusions are an explicit list, each carrying its
reason, rather than a cleverer pattern nobody can audit. And the rule applies
only to columns declared with a **float type** — a TEXT column named
`revenue_range` or `cost_to_mvp` is a label or a sentence, not an amount stored
badly. That one distinction removed every remaining false positive at a stroke.

The float-parsing half of the brief found nothing worth a rule. There are ten
`parseFloat` sites in the worker; they parse FRED and BLS economic series,
LinkedIn profile text, and a partner rating filter. The one that touches money —
`advisor.profile.hourly_rate_usd` in the writeRouter — is parsing into a REAL
column that legitimately holds dollars today. When that column moves to cents it
becomes wrong, and the ledger entry above is where that will be noticed.


### D29. A fixed parser finds more work, not less

The row generic is the easiest source of truth in this worker to check against:

```ts
await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
  .bind(id).first<{ id: number; name: string; founder_id: number }>();
```

`founder_id` is not in the select list, so it is `undefined` at runtime, and
TypeScript says nothing — the generic is an assertion about a value the type
system never sees. Same class as everything else here: a field that reads as
empty rather than as an error. The generic sits inches from the SQL, it is a
literal, and it is written by the same hand in the same breath.

**No generic is currently wrong.** 169 of 207 are checked and all 169 agree
with their SELECT. That is the whole finding, and it is worth a gate precisely
because it is currently true and will not stay true by itself.

What makes this entry worth writing down is the four parser faults, because
**three of them under-reported, and under-reporting is the one that ships.**

The first over-reported in the familiar way: a lazy `([\s\S]*?)\1` for the SQL
body can run past its own closing quote to a later one, so a bind-less
`.first()` in one statement was paired with the generic of a different
statement further down. Three defects reported, none real.

Then three quiet ones:

- `typeFields` counted the type's own outer `{` as depth, so every field sat at
  depth 1 and the depth test skipped all of them. **The check reported a clean
  pass over a type it had not read.** It was caught only because an injected
  phantom field failed to trip it — which is the only reason to inject one.
- The same walker treated `<` and `>` as brackets. The `>` in an arrow type,
  `(v: string) => number`, drove the depth negative and every field after it
  was skipped.
- `selectKeys` tested the whole select list for `*` before looking at aliases,
  so every aggregate query — `COUNT(*) AS n` — was declined wholesale.

Each fix raised the numbers rather than lowering them: 173 pairs to 207, and
97 checked to 147 to 169. **A correct fix here found more real work; a
suppression would have found less.** That is the cheapest available test of
whether a parser change is a repair or a silencing, and it is the one to reach
for next time, because fourteen parser faults into this exercise the pattern is
no longer a surprise — the surprise is only ever which direction it fails in.

The check declines four shapes and prints how many: a select list with a star,
an expression with no alias, a named interface rather than an inline literal,
and any interpolated SQL. Thirty-eight of the 207 are declined on those grounds
and the number is in the build output, so the size of what it cannot speak for
is visible rather than assumed.


### D30. A comment cannot fail a build

The brief asks that every new wrangler binding go into **both** tables. That
rule is already written down — in `wrangler.toml` itself, in a comment added
after the incident it caused:

> Every binding must be re-declared under `[env.production.*]` or the
> `--env production` deploy will produce a worker with NO bindings — which
> breaks every DB-touching route (login, /me, etc.) and is exactly why
> 2026-05-05 login outage happened.

**Parity is correct today.** Twenty-nine bindings across fifteen tables, all
present in both. So this guard finds nothing, and that is the entire reason to
write it: the rule is currently obeyed by memory, the comment explaining it is
forty lines above the block it governs, and the cost of the next person missing
it is a login outage rather than a warning.

**Identity, not presence.** Comparing section names would pass the case that
actually happens: a `[[kv_namespaces]]` table that gains a second namespace at
the top level and not in production. The section is present in both; the new
binding is in one. So each table is reduced to the set of identities it
declares, using the key that names the binding for that table type — `binding`
for most, `queue` for a queue consumer, `service` for a tail consumer, `name`
for a durable object, `crons` for triggers. Probed both ways: adding a third KV
namespace at the top level alone fails the build and names it.

**An unrecognised table type fails rather than being skipped.** A binding kind
this file has never seen — Cloudflare adds them — is precisely the one that
would slip through a guard that shrugs at what it does not know. Adding
`[[pipelines]]` fails with a message saying to teach the guard its identity key.

**What was checked and deliberately left alone.** Three things:

`observability` sits at the top level and not under `[env.production]`, which
looks exactly like the drift this guard exists to catch. It is not:
`wrangler.toml`'s own comment lists `observability` among the keys that DO
inherit. Reading the file before believing the pattern is the difference
between a guard and a nuisance, and this is the second time in this exercise
that the material contradicted the shape.

`[env.preview]` is missing `assets`, `tail_consumers` and `vectorize`. That is
left unchecked and unfixed, because whether preview is meant to serve the SPA
at all is a question for its owner, not an assumption for a guard.

And `Forge` appears in five files, which looks like a violation of D3's naming
rule until you read them: it is `Forge Analytics`, a fictional company in the
advisor demo fixtures. The AI is named correctly everywhere.

The regulated-wording lint the brief also asks for is **not** built here. Unlike
binding parity, it has no objective test — "advisor" is a legitimate word for a
person in this product, and a check that cannot tell the role from the
regulated claim would flag the whole codebase on its first run. It needs a
decision about which surfaces the rule governs before it can be written.


### D31. `advisors.ts` was the advisor practice backend all along — D12 checked the wrong router

**RESOLVED — the five `/advisor/advisory/*` tabs are wired.**
**UPDATE 2026-09-02: `/office-hours` (#124) is no longer frozen — it is retired.**
The freeze lifted, and the page was not worth upgrading: it read five keys the
DTOs never emitted and gated Confirm/Decline on a status the worker has never
written, so an advisor could not accept a booking there. Storefront moved to
`/expertise/*`, booking to `/practice/*`. See UNRESOLVED_ITEMS U4.

D12 scoped these tabs out with a claim that was half right:

> `advisory.ts` is founder-facing (find an advisor, ask, diligence,
> financial-plan), not advisor practice management. Its real home is the
> Advisory Practice work against `partner_office_hours.ts`, which is task
> **#124** and is blocked while `/office-hours` is on this pass's do-not-touch
> list.

The first sentence is correct and was verified again here. The second does not
follow, and it is wrong: it names `partner_office_hours.ts` as the *only*
possible home without checking **`advisors.ts`**, a different router carrying
the entire advisor side:

| Tab | Backend it now reads | Endpoint |
| --- | --- | --- |
| Opportunities | pending bookings + availability CRUD | `GET /advisors/me/bookings?status=pending`, `GET /advisors/:uid/slots`, `POST/DELETE /advisors/me/slots` |
| Clients | derived from the advisor's own bookings | `GET /advisors/me/bookings` |
| Engagements | confirmed/past sessions + lifecycle | `.../confirm`, `.../complete`, `.../no-show`, `.../cancel` |
| Delivery | held sessions + the reviews clients filed | `GET /advisors/bookings/:id/reviews` |
| Contracts | the advisor's e-sign envelopes | `GET /legal/esign` (server-scoped) |

**This is D12's own failure mode, one level down.** D12 was written to record
that "a router was matched against a tab by **name**, not by what it serves" —
and then matched `advisory.ts` to the Advisory tabs by name, found it
founder-facing, and stopped. Checking the adjacent router would have shown the
material was there the whole time. Worth stating plainly because the lesson is
not "D12 was careless": it is that *ruling a surface out* needs the same
per-router verification as ruling one in, and only the second half got it.

**#124 is untouched and still blocked.** `/office-hours` is a different route,
a different canvas (Advisory Practice: session pricing, take-rate, paid booking,
earnings ledger) and a different backend (`partner_office_hours.ts`). Nothing in
this change reads or writes it. The two were conflated by the shared word
"advisory"; they are separate work.

**One honest gap remains, and is labelled in the product.** The canvas asks
Delivery for a document deliverable trail with versions and opened/unopened
receipts. No such store exists — `deliverable_snapshots` (migration 156) is
cohort timing, not advisory — so the tab covers the post-session loop that *is*
recorded and says on-screen that deliverables are not tracked yet. Pinned by
`frontend/test/advisor_advisory_live.test.mjs`, which also fails if that notice
is deleted without a store appearing.


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
meter, guardrails). The consolidation target is an `AssistRail` component — the
brief's working name was "ForgePanel", now "Eadwyn" per D3 — and it belongs to
that workstream, not routing. The left nav is a
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

---

### D32. A Network zone renders its own zone, and the tab follows the path

**RESOLVED.** `/network/relationships`, `/network/introductions` and
`/network/organizations` became real routes when the four shells were wired, and
all three rendered the same component. `NetworkPage` reads its active tab from
`?tab=` and **never from the pathname**, and its fallback for a role that cannot
see Contacts is Introductions — so an advisor clicking **Relationships** got the
Introductions tab under a heading saying Relationships, and Organizations did
the same. A founder got Contacts under all three. The route said one thing and
the body showed another, on two licences at once.

Two changes, deliberately different in kind:

- **Advisors get three real bodies** (`pages/advisor/network/`), dispatched on
  the slug the shell has already resolved. Relationships reads
  `partner_relationships` and, beside it, the referral pipeline; Introductions
  reads the propositions an advisor may actually answer; Organizations is an
  honest card. They compose `pages/advisor/expertise/kit.jsx` — the one
  four-state body — rather than a fourth copy of it.
- **`NetworkPage`'s tab now falls back to the pathname**, beneath `?tab=` and
  above the hardcoded default. `?tab=` still leads because notification deep
  links (`?tab=introductions&intro=<uid>`) depend on it. This fixes founders and
  operators too; it was not scoped to advisors because the bug was not.

**The rail was wrong in the other direction, which is the same defect.** It said
*"This view … does not draft outreach, send messages, or change records"* above
a relationship editor and an Accept button that spends an introduction credit,
and it called Organizations covered on licences with no organisation store at
all. A rail must never be more confident than the body beside it, and never less
— #399 fixed the *less* on five Expertise and Practice zones for the same
reason. The stance now separates the rail (which acts on nothing) from the page
(which acts on a click), and Organizations reports its gap.

**Referral state is a count, not a per-row chip.** The advisor canvas draws
referral state on the relationship card. `referral_submissions` (migration 175)
stores `referred_name` and `referred_org` as **free text** and carries no
referred-user id — checked against the migration and every later ALTER — so
there is no join key to a relationship. Matching on a typed name would sooner or
later credit one person's referral to another. The counts are real and ship; the
attribution is not drawn, and the page says why.

**`/referrals` was opened to advisors, and that is a guard change worth naming.**
Network · Relationships reads `referral_submissions`, and the only surface that
creates one guarded `['admin','founder','partner','investor']`. That was not a
policy: `ReferralsPage` has no role branch anywhere in its 779 lines, and every
endpoint it calls (`/refer-earn/overview`, `/submissions`, `/submissions/:uid`,
`/strategic-access`) is `requireAuth` and scoped to `referrer_user_id`. Leaving
it shut would have made the new section permanently empty with no way to fill
it. A guard test now fails if that page ever grows a role branch, because the
reasoning for opening it would no longer hold.

**Deliberately not built: an organisations store.** The zone needs one edge —
person to organisation — and no advisor-reachable source has it.
`/api/contacts` is `requireRole(c, 'founder')` and `'advisor'` is not a member
of that guard's parameter union, so the role is unrepresentable in it rather
than merely excluded. `GET /api/companies` is readable but is a global directory
of self-registered profiles with no connection to the reader; pointing the zone
at it would answer "which organisations do I know?" with "all of them" — the
reasoning D12 gave for removing the withdrawn Research tabs rather than
redirecting them at the nearest page.

---

### D33. `chromeless` is a layout flag; `embedded` is a lock. They are not the same prop

**RESOLVED.** `workspaces/ResearchWorkspace` mounted `<SignalsPage embedded />`
and `<CompetitorAnalysisPage embedded />`. `SignalsPage` destructures
`{ user }`, so **both** props were dropped; `CompetitorAnalysisPage` took no
props at all. React reports neither.

The consequence on Markets was not cosmetic. `SignalsPage` derives `mode` from
`user?.role`, and `user` was `undefined`, so **`mode` resolved to `'founder'`
for every role on that route** — including a real advisor. The advisor ordering
(`?mode=advisor`), the advisor helper strip and `signals.advisor_note` never
rendered, and `advisor_note` is a field the engine has been returning all along,
seed corpus included. `isAdmin` was false for admins on the same route, hiding
Refresh. Only `/signals` passed `user`, which is why the advisor view appeared
to work whenever anyone checked it.

`SignalsPage` now takes `user` **and** an explicit `mode`, because they answer
different questions and re-deriving one from the other is wrong in a real case:
an admin previewing the Advisor role has `user.role === 'admin'`, so the shell
would be advisor and the body underneath would order itself for a founder.

**Forwarding `embedded` to `CompetitorAnalysis` would have been a regression,
which is why `chromeless` exists.** On that component `embedded` means "locked
to the startup I was handed": it skips the project fetch, defaults the mode to
`startup` and hides the mode toggle. Passing it from a workspace that has no
project would leave an advisor — whose project list is empty by design, since
`projects.ts` excludes advisors from the privileged read — with a picker of
nothing and no way back to the custom-market box they get today. `chromeless`
drops the page furniture and nothing else.

A guard scans every `embedded`/`chromeless` mount **inside
`frontend/src/workspaces/`** — the components that provably draw the chrome —
and fails if the target never reads the prop. It is deliberately not repo-wide:
ten other mounts pass `embedded` to children that draw no shell, h1 or rail, so
the prop is inert there rather than dropped, and failing them would flag a
tidiness issue in the words of a correctness one.

---

### D34. The Worker serves `axal.vc`; Cloudflare Pages is a mirror — and `CLAUDE.md` fact 4 said otherwise for two days

**RESOLVED.** `axal.vc` and `app.axal.vc` are both whole-host Workers Custom
Domains of the `studioos` Worker: `wrangler.toml` binds each `pattern` with
`custom_domain = true` in `[[routes]]` (top level) and again in
`[[env.production.routes]]`, and the Worker answers every path on either host
— `/api/*` from Hono, everything else from its own `[assets]` copy of `docs/`
(`directory = "./docs"`, `not_found_handling = "single-page-application"`,
`run_worker_first = ["/api/*", "/landing/*", "/p/*", "/assets/*"]`). One
build sits behind both hosts and they ship together on every `wrangler
deploy`: in CI, `.github/workflows/cloudflare-worker-deploy.yml` on every push
to `main` (build → `node scripts/migrate-d1.mjs --remote` → `wrangler deploy
--config ../wrangler.toml --env production`), or by hand with the root
`npm run deploy` (predeploy migrations, postdeploy `check-spa-live`).

**The evidence is a deploy log and a dashboard, not a document.** GitHub
Actions run 33740754882 (2026-09-03 09:48Z) ends with `Deployed studioos
triggers: axal.vc (custom domain), app.axal.vc (custom domain)`, and the
Cloudflare Pages dashboard's Production card lists only
`studioos-2p8.pages.dev` under Domains — a Pages custom domain on `axal.vc`
would appear there, and would have blocked the Worker binding. Those two
lines are what settle who serves a host. Prose never does, and this entry is
prose: if it ever disagrees with them, it is the thing that is wrong.

**How the file that wins every disagreement lost this one.** The timeline,
verified from git:

- 2026-08-31 10:51Z — `e1de44c2f` ("Stop apex Pages and Worker asset skew")
  wrote the **Pages** cutover's route table: `app.axal.vc` as a custom domain
  plus three path routes, `axal.vc/api/*`, `axal.vc/landing/*` and
  `axal.vc/p/*`. Cloudflare Pages served the apex.
- 2026-08-31 15:20+04 — #371 (`3788db408`) wrote `CLAUDE.md` fact 4 against
  that table. Correct at the time.
- 2026-09-01 09:08Z — `1d320dda9`, author "Replit Agent", message "Remove
  stale documentation asset files". It touched `wrangler.toml` (48 lines),
  `scripts/build-frontend.mjs` and 287 files under `docs/`, and **no
  documentation**: it replaced the three path routes with a whole-host
  `axal.vc` custom domain in both tables. The apex moved back to the Worker
  in a commit whose message does not mention it.
- 2026-09-01 22:03+04 — #374 (`118342710`) rewrote the two guard tests,
  `cloudflare-worker/test/apex_cutover_bootstrap.test.mjs` and
  `frontend/test/apex_route_coverage.test.mjs`, to match the toml ("the toml
  is the deployed truth") — but their comments credited the flip to
  `e1de44c2f`. That attribution was wrong; both files now name `1d320dda9`
  (corrected 2026-09-03, from git).

So from 2026-09-01 until 2026-09-03 fact 4 — the one passage every other
document defers to — described a topology that the deployed config, both
guard tests and every deploy log contradicted. The hazard was never the stale
sentence itself. It was that someone "fixing" `wrangler.toml` to match
`CLAUDE.md` would have taken the apex down.

**What 2026-09-03 added.** The deploys after #413 (Actions run 33734906029)
and #414 (run 33738772717) failed in the migration step, so `wrangler deploy`
never ran and **both** hosts stayed at run #27's build (`96a6e5769`) — while
`cloudflare-pages-deploy.yml` advanced the Pages mirror twice. Its dashboard
showed "Production" deployments for commits whose Worker never shipped, and
that misled the operators for a morning. The Pages project `studioos`
(`studioos-2p8.pages.dev`) still exists and receives a Direct Upload of a
freshly built `docs/` on every push to `main` (`eda67173d`, 2026-09-02), but
it serves no production hostname: it is a mirror. Its "disconnected from your
Git account" banner refers to the dashboard-side Git integration retained for
previews and has no bearing on `axal.vc`. Whether to retire the mirror and
its workflow is `UNRESOLVED_ITEMS.md` U9 — deliberately not decided here.

**What `CLAUDE.md` says now.** Fact 4 names both hosts as Workers Custom
Domains, the `[assets]` binding, the one-build-behind-both-hosts rule and the
two deploy paths; dates the shape to `1d320dda9`; calls Pages a mirror whose
dashboard proves nothing about what the Worker shipped; keeps the ban on
path-scoped apex routes; and points at U9 and U10 instead of asserting
either. `GOTCHAS.md` carries the general lesson: a deployed-config change can
arrive in a commit whose message is about something else, so who serves a
host is read from the deploy log's "Deployed studioos triggers" lines and the
Pages dashboard's Domains line, never from prose.
`frontend/test/apex_truth_doc.test.mjs` fails if fact 4 stops naming both
hosts as Workers Custom Domains, if it claims Pages or GitHub Pages serves
the apex, if `wrangler.toml` stops binding both hosts with `custom_domain =
true`, or if a live document reclaims the apex for Pages on a line that does
not mark itself as history.

**What stays true.** The 2026-08-31 incident — Pages-served HTML paired with
a different Worker asset build, the entry module 404ing, the `?__reboot=`
watchdog looping — is still the reason no path-scoped apex route may exist:
with whole-host custom domains an `axal.vc/*` or `axal.vc/assets/*` zone
route would take those URLs away from the assets binding and break the SPA
fallback, and both guard tests still refuse them. `docs/` stays committed by
hand, for review and for `scripts/check-docs-fresh.mjs`; both CI deploy
workflows rebuild it from source at deploy time and never commit it, so the
committed bytes are what reviewers read, not necessarily what ships
(`documentation/operations/DEPLOY.md` §2.1). GitHub Pages is decommissioned
as the apex; if the repository still has it enabled, the auto-generated
`pages-build-deployment` workflow publishes `docs/` to a host nothing routes
to.

**Deliberately not asserted.** On the Worker-served hosts, requests for paths
outside `run_worker_first` are answered by the assets binding without
invoking the Hono app, so whether the apex HTML carries the security headers
that `docs/_worker.js` sets on the Pages mirror and
`middleware/securityHeaders.ts` sets on API responses cannot be read from
this repository. That is U10, with its one-line live check
(`curl -sI https://axal.vc/login`); this decision claims neither answer.
### D35. The Super Admin is an elevation on `admin`, held by one account, with a per-browser HQ view

**RESOLVED (2026-09-03; #413, #414, #415, #416, #417, #418).** The brief asked for
a "Super Admin profile with full authority" and for the HQ dashboard to be
integrated, with the single authority assigned to `guillaume.lauzier@axal.vc`.
Four decisions were taken to deliver that without breaking what exists.

1. **An elevation, not a role.** 468 call sites across the worker check
   `role === 'admin'` by exact equality. A seventh `users.role` value would fail
   every one of them and lock the franchisor out of the admin product. The role
   stays `admin`; the elevation is a row in `super_admins` (migration 199) and
   `auth.ts hydrateSuperAdmin` copies it onto the user object `isSuperAdmin`
   reads. `requireSuperAdmin` fails closed: a surface that forgets it stays
   admin-only. **A side table, not a column**, because `users` sits at D1's
   100-column ceiling — the first version of 199 was an `ALTER TABLE users`
   and it failed the first migrating deploy (GOTCHAS records both incidents
   of that morning; #414 and #415 are the repairs).
2. **One holder, by name.** Migration 207 seeds `guillaume.lauzier@axal.vc`
   and removes every other row; the other admin account stays a plain admin.
   Changing the holder afterwards is a console act — `/api/admin/super-admins`,
   behind the impersonation write bar (TOTP session → recent step-up → the
   elevation), audited, never self, never the last active holder — not a
   migration.
3. **The HQ shell is a view, not a permission.** `shellRoleFor(role, user,
   hqView)` names a sidebar; `'super_admin'` appears in no `guard([...])`
   array. A holder switches between the eight-row HQ shell and the plain
   subsidiary shell through View-as, per browser (`hqView`), so the franchisor
   can check what a licensee sees without impersonating anyone. HQ-only pages
   render a stated notice for an admin without the elevation; the worker still
   re-checks every call.
4. **Unscoped facts are Not recorded.** The canvases draw accounts, MTD
   revenue, backlog and token P&L per subsidiary. No row names its licence
   (U1), so `/hq` and `/admin/security` render those as Not recorded with the
   reason, and the `/hq` tenant switcher narrows the loaded payload
   client-side and says so beside the control. The `security_events` ledger
   the Security canvas calls "the one real backend build" was deliberately
   not built this pass; its zone says so.

Two things the apex audit of the same day caught before #417 and #418 went up
are recorded here so they are not re-learned: `WorkerRail` destructures
`unavailable` entries as `[title, detail]` pairs (a bare string renders as its
first two characters), and a tile's note must never assert a state — "none",
"every admin enrolled" — while the read behind it failed. Both are guarded.

