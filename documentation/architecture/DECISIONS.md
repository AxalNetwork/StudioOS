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

**UPDATE 2026-09-07 — `/research/funds` has returned, and not on the condition
this decision set.** No source was licensed. Migration 216 `research_funds`
backs a zone that is a different object from the one withdrawn here: the funds
a founder records for THEMSELVES — who they are talking to, at what stage,
through which warm path — not a directory of external funds bought from a
vendor. D9 withdrew the second and still does; the first needs no licence,
because every row in it is the founder's own. That is the same line D37 drew
for Library and Ask, and D55 records it. The table row below still reads
`| funds | none | no data source → D9 |`, which remains true of the tab this
decision withdrew and is not true of the zone that now stands at that path.

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

**Update, later on 2026-09-03.** U9 is decided: D36 retires the mirror, its
workflow and `_worker.js`, restores `frontend/public/_headers` as the
mechanism for the static headers, and turns U10 into a measurement made by
`scripts/check-spa-live.mjs` on every shell route. The paragraphs above stay
as the record of what was true when this was written.

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

### D36. Workers Static Assets is the only host: the Pages mirror is retired, `_headers` carries the static security headers, and pull-request previews are bindings-free Workers

**RESOLVED (2026-09-03; #422, then the preview PR).** Asked
what the plan was for hosting the website and platform on Cloudflare Pages
"and not Jekyll pages ever again", the owner chose Workers Static Assets — the
shape production has had since `1d320dda9` (D34) and the one Cloudflare's own
documentation now recommends for new projects. Three consequences.

1. **The mirror is gone.** `.github/workflows/cloudflare-pages-deploy.yml`,
   `frontend/public/_worker.js` (the Pages Advanced Mode entry that ran only
   there) and the `.assetsignore` step that hid it from the Worker upload are
   deleted; U9 is resolved. The Pages project (`studioos-2p8.pages.dev`) is
   deleted from the dashboard by the owner — it shares the name `studioos`
   with the Worker, so the entry of type *Pages* is the one to remove. The
   GitHub-Pages-only remnants nothing reads went with it: `build-pages.sh`,
   `frontend/public/404.html` and the `?p=` path-restore shim in
   `frontend/index.html`, which rewrote any `/x?p=…` URL to a different path
   before React booted (no live link carried `?p=`; `?ref=`, `?lane=`,
   `?plan=` and `?next=` do). `CNAME` and `.nojekyll` stayed until GitHub
   Pages was switched off, which the owner did on 2026-09-03 (`gh api
   …/pages` returns 404 where it had read `main:/docs` with CNAME
   `axal.vc`); both files went with it, and `docs/` no longer carries them.
2. **`_headers` is the mechanism, and the smoke check is the proof.** Workers
   static assets read `_headers` natively and apply it to every response the
   `[assets]` binding serves — the SPA shell on every path outside
   `run_worker_first` — and not to responses the Worker script generates,
   which already carry `securityHeaders.ts`. `frontend/public/_headers` is
   restored from the copy #371 deleted, with the same values `_worker.js` set
   (HSTS, nosniff, `X-Frame-Options: DENY`, the laxer `Referrer-Policy` the
   two-tier rule requires, the Permissions-Policy) and, deliberately, no CSP
   (nonce-based on the Worker; an inline boot watchdog in the shell).
   `frontend/test/apex_truth_doc.test.mjs` pins the values to the
   middleware's so they cannot drift a third time, and
   `scripts/check-spa-live.mjs` asserts them on every shell route, so U10 is
   answered by a run rather than a sentence. A `/assets/*` rule would be
   inert (those responses come from `index.ts`) and is not written.
3. **Previews are a per-PR Worker with no bindings, not preview URLs.** The
   option first offered — Workers preview URLs through Workers Builds — does
   not apply here: Cloudflare states that preview URLs are not generated for
   Workers that implement a Durable Object, and `studioos` exports
   `PipelineRoom` and `OnboardingChat`; Workers Builds' pull-request comment
   depends on the same URLs. What can exist with nothing provisioned and no
   production data in reach is a Worker per pull request (`studioos-pr-<n>`
   from `wrangler.pr-preview.toml`: no bindings, `docs/` with the
   single-page-application fallback, and a script of a few lines —
   `scripts/pr-preview-worker.mjs` — that does two things: turn the
   fallback HTML for a missing `/assets/*` file into a real 404, as
   `index.ts` does on production, and answer `/api/*` with a JSON 404,
   because an assets-only Worker serves the shell for every unmatched path,
   navigation or not), deployed on open and deleted on close by
   `.github/workflows/pr-preview.yml`, its `workers.dev` URL posted as one
   sticky comment. `/api/*` is a 404 there, exactly as it was on the
   mirror; `frontend/test/pr_preview.test.mjs` keeps the config
   binding-free. A full-stack preview needs the `[env.preview]` placeholders
   provisioned (D1, two KV namespaces, R2 buckets, and a queue a second
   Worker could not share as a consumer) plus a rule for one shared preview
   database across branches; that is unbuilt, not forbidden.


---

### D37. Research · Library and Ask are the FIRST-PARTY half of what D9/D12 withdrew, and the type that indexes them is deliberately absent from global search

**Date:** 2026-09-05 · **Supersedes nothing; narrows D12.**

D9 and D12 withdrew four `/advisor/research/*` tabs — companies, AI research,
news, documents — because each rendered a fixture with no API behind it, and
set one condition for their return: a licensed PitchBook/Crunchbase-class
source. That condition was written about **third-party** research data, and it
still holds: nothing here searches the web, a company database, or a market
feed.

It never governed the other half. The advisor canvas asks for Ask over *a
client's own shared documents, a library of client histories and the advisor's
playbooks* — first-party material the product simply had no store for.
`ResearchWorkspace.jsx` has said "unbuilt, not forbidden" since that
distinction was drawn. This decision records building it.

**What shipped.** `research_documents` (migration 213) plus
`routes/research.ts`: upload, list, one-time signed download, delete, and
`POST /ask`. On **all four licences** — `library` and `ask` are in every
`RESEARCH_ZONES` list, and they were 8 of the 16 unbacked zone slots left in
the product.

**Ask refuses rather than guesses.** Retrieval runs first; the model is called
only when a passage clears a documented score floor. Below it the response is
`no_source` with the score the closest passage actually reached — a 200, not
an error, because the question was understood and "nothing here answers this"
is the true answer. A `model_unavailable` outcome is kept separate, so a model
failure is never reported as an empty library. An Ask box that falls back to
general knowledge in a cited answer's voice is precisely what D12 pulled a tab
for.

**The decision most likely to be undone by someone doing the right thing.**
`routes/search.ts` read `const VALID_TYPES = ALL_ENTITY_TYPES`, and the hourly
re-index sweep iterates that same array. So adding `research_doc` to
`ALL_ENTITY_TYPES` — which is what makes a type indexable at all — would also
have published every user's private documents to every other user's global
search box, in one line that looks exactly like following the existing
pattern. The two lists are now separate and literal, and
`cloudflare-worker/test/research_search_isolation.test.ts` fails if they
re-converge.

**Isolation is three layers because only two of them are ours.** `search.ts`
has an everything-is-allowed shortcut that queries with no type filter and no
namespace. Whether a namespace-less Vectorize query returns namespaced vectors
would decide whether that path leaks, and it could not be confirmed from here
(the docs do not state it; `developers.cloudflare.com` is blocked by this
environment's egress proxy). So nothing rests on the answer: `searchSemantic`
drops owner-private types unless asked for by name, the namespace partitions,
and `owner_user_id` is re-checked per hit. The isolation test's fake Vectorize
ignores namespaces deliberately, proving the two layers that are ours.

A separate Vectorize index would make the leak structurally impossible rather
than filtered, and remains the stronger option. It was not taken because it
needs a new binding in three wrangler tables plus an index provisioned before
deploy, and a deploy against a missing index fails — the failure mode this
repo already hit once at the migration step.

**What is still not possible, and is stated on the page rather than implied:**
nobody can send you a document. A founder sharing their own file needs a grant
type the product has for investors (`data_room_grants`) and for no one else.
Adding one is a decision about a founder's privacy, not a schema change, and
it is what `/research/client-prep` also waits on.

**UPDATE 2026-09-07 — the paragraph above is superseded and the decision it
called for was taken.** Migration 218 `advisor_client_grants` added exactly that
second founder-to-outsider grant type, scope by scope, and
`/research/client-prep` no longer waits on anything: it reads a brief under the
grant and names in `withheld[]` every scope the founder did not open. D50
records it and says "D37 is narrowed, not retired" — this is that narrowing,
written on the side that gets read first. The rest of D37 stands: Ask still
answers only from documents the caller uploaded themselves, and still refuses
rather than answering from general knowledge.

---

### D38. The Spin-Out Lab is not a pre-incorporation programme, and never was in code — only in prose

`/spinout-lab` led with a 76px `28 days` and "From idea to incorporated". Every
doc, comment and admin error message around it said the same thing: a
pre-incorporation sprint. **The code has never implemented that.**
`users.is_incorporated` is written in exactly three places —
`routes/spinout_lab.ts` `recordMilestone` (the week-4 milestone), `exitLab`
(the escape hatch), and `services/advisor/writeRouter.ts`'s graduation write —
and all three mean *has been through the Lab*. No path sets it for a founder
who arrives with a company; the apply form's "Are you already incorporated?"
answer lands in `spinout_applications.incorporated`, a different column that
gates nothing.

So an externally-incorporated founder has always been able to apply, be
admitted and start. The only thing stopping them was a page that told them not
to bother.

**The two 409s stay.** `startLab()` and the admin `spinout-admit` handler both
refuse a user with `is_incorporated = 1`, and both were read — including in the
plan for this change — as the exclusion. They are not: they are re-entry
guards, and removing them would let an alumnus re-open a sprint whose week is
already 4 against a workspace `spinout_lab_active = 0` deliberately closed.
What changed is the wording. The refusal now says "This account has already
been through the Lab", and every restatement of "pre-incorporation founders"
in the worker, the SPA, the dev backend and the user-facing explainer went with
it.

**The page now names three starting points** — Form, Find fit, Launch a line —
as presentational emphasis over one arsenal. A track re-orders which of the
nineteen tools lead. It does **not** change the gates: `MILESTONES` is one list
enforced identically for everyone, `LabGates` takes no track prop so that is
structural rather than remembered, and the page says so in words. Nothing
records a track either, so the apply link deliberately carries no `track=`
param — `RegisterPage` reads only `lane` and `product` and would drop it in
silence, which is a choice that looks remembered and is not.

**The cohort feed is gate-level, not milestone-level.** `GET /cohort` is public
and already publishes every active company's working name, sector and week, so
`GET /shipped` reporting *when* a week turned adds a timestamp to a transition
whose state is published. Individual milestone keys are a different class of
fact: `section83b_filed`, `founder_stock_issued`, `fundraise_ask_locked`,
`investor_intros_secured` and `revenue_proof_added`, tied to a named company,
are material corporate and financial statements about a private company, and
nothing in the application flow asks a founder's consent to publish them. The
limit lives in `weekClearsFor` rather than in the handler, and the route is
auth-gated as defence in depth. The logged-out surface states it instead.

**What the canvas asked for and did not get**, because no store holds it: the
per-track gate definitions, the "already in your workspace" tags, three sample
founder-to-founder asks, four sample cohort companies, and a seat count. Also
deleted on the way past: `PHASE_STATUS = ['done', 'active', 'future',
'future']`, which drew gate 1 complete and gate 2 live on a **public** page for
a cohort the visitor is not in, and whose own comment conceded "the logged-out
page has no cohort" — the same defect as the sample companies, already shipped.

**The theming guard is a test, not the script.** `scripts/check-dark-mode.mjs`
pairs six bare utilities and has no opinion about `bg-[#faf9fc]` or
`style={{ background: '#141118' }}`, which is exactly the shape a faithful port
of a light-only canvas takes — it passes `test:drift` and fails on a reader's
screen. `frontend/test/spinout_lab_intro.test.mjs` asserts the hex is not
there, that every theme-dependent token carries its `dark:` counterpart, and
that no colour reaches the page as `var()` in a style attribute (Tailwind v4
tree-shakes any `@theme` token no utility references).

**Still open, and stated on the page rather than implied:** graduation has
exactly one definition — `incorporation_completed`, read in ten places
including certificate issuance, the public graduate list, `/stats` and
`/fund-metrics`. A founder who runs four excellent weeks on the Find fit track
and never files is, to all ten, a non-graduate. Opening the door was a page;
letting them finish is a ten-site change that has to land at once.

### D39. `/settings` is `/account` and `/tickets` is `/help`; the old paths redirect permanently, because the worker sends them

Two renames the product asked for, and one policy that makes them safe.

**The names.** `User Settings` becomes `Account` and `Support` becomes
`Help Center` in the top-right menu, with the routes moving to match. The
rename is scoped to that menu: the super-admin sidebar's `Support` row keeps
its label, because the HQ canvas names it and the ask named the dropdown.
`MessagesPage` still links to "Tickets" for the same reason — a ticket is
still a ticket; only the destination moved.

**The policy: the redirects are permanent, and they carry the query and the
hash.** Not a migration shim to delete in a release or two. The worker emits
`/settings/*` into places this repo does not control the lifetime of:

| Emitter | What it sends |
| --- | --- |
| `routes/notifications.ts`, `templates/email/layout.ts` | `/account/notifications` in outbound email, one per digest |
| `routes/auth_google.ts` | the post-link OAuth callback path |
| `routes/auth_recover.ts` | `#security-recovery-codes`, an anchor |
| `services/advisor/banks.manifest.json` | 12 `page_target` entries — GENERATED, regenerated here via `cloudflare-worker/scripts/gen-question-ids.mjs`, never hand-edited |
| `routes/tickets.ts`, `routes/github.ts` | `link: '/help'` on notification rows, and `path: /help/<id>` on the "Open ticket" CTA |

Mail already sent still points at the old path. A `<Navigate to="/account">`
would land those readers on the page but drop the section, the tab and the
anchor that made the link worth sending, so both redirects read
`useLocation()` and forward `pathname`, `search` **and** `hash`;
`/settings/:section` forwards the section too.

**One live 404 fixed on the way past.** `tickets.ts` has always emitted
`path: /tickets/<id>` for its "Open ticket" CTA while `App.jsx` declared no
`/tickets/:id` route, so that link has been landing on the catch-all. `/help/:id`
exists now, and `/tickets/:id` redirects to it with the id intact.

**Two defects the test suite could not see**, found by opening the page in a
browser after `test:drift` went green — the same lesson as D38's contrast
failures. `SettingsPage`'s URL-sync effect canonicalises an alias to its
section id, which is long-standing and correct; but it navigated to a *bare
pathname*, so it **dropped the query and the anchor** on every such hop — which
is precisely what the OAuth callback and the recovery redirect send. And the
landing pane's section id is `account`, so after the rename it wrote
`/account/account`. Both fixed; both pinned in
`frontend/test/account_canvas_coverage.test.mjs`, which is the only place a
DOM-free suite can hold them.

**Perks joins the menu as its first role-conditional entry**, for founders,
partners and admins. `/perks` itself stays open to all six roles: the catalogue
is a marketplace an investor or advisor may legitimately browse, and what
narrows is the invitation, not the page. Claiming is a founder's verb and
offering is a partner's; admin sees it because the review queue is a tab on the
same page.

**And the partner half of Perks was not gated at all.** `GET /partner`,
`POST /partner`, `PATCH /partner/:uid` and `GET /partner/:uid/stats` were
`requireAuth` only, so any signed-in account — founder, investor, advisor,
`exploring` — could put a listing into the admin review queue and read its
view/claim funnel. The submit handler's own comment says *"A partner cannot
publish to founders directly"*, and it was right that the row is forced to
`in_review`; nothing checked the submitter was a partner. Only the UI tab was
gated, which is a `&&` in JSX against a URL. All four now take `requireRole(c,
'partner')`, which admits admin unconditionally — the console and the queue
read the same rows.

"Operator Partner" is `users.role = 'partner'`. There is no partner sub-type
column anywhere in the schema — `partner_type`, `partner_tier` and
`partner_kind` return zero hits — and the operator/service-provider distinction
lives in `personas.ts` as a label whose `role_alignment` is `partner`. The role
is the whole gate.

### D40. Company Settings shows who may edit, acknowledges each field, and refuses the one danger-zone action that has no endpoint

The canvas asked for four things the page did not have. Three were free — the
data was already on the wire — and the fourth is the interesting one.

**Who may edit.** `GET /company/:uid` has always returned `members[]` with each
member's `role_in_company` and `is_primary_admin`, and the page rendered
editable inputs to everyone regardless. A member whose role is "CTO" — a label
the worker does not recognise — could type into the company name, blur, and
watch the value snap back with a red toast. The rule existed; only the page did
not know it. `useMyRights` now mirrors `canEdit` (`company.ts:114-118`) from the
members list already in hand: platform admin, or the caller's own link is
primary admin, or its `role_in_company` is one of Owner / Admin / Founder.

**A mirror is not a boundary**, and the comment beside it says so. The server
still gates every write and 403s a non-editor who gets past the UI. What the
mirror buys is honesty on screen — showing a value as a value is the difference
between "you may not" and "that didn't work". Because two copies of an
authorisation rule drift, `company_settings_members.test.mjs` parses the role
list out of BOTH files and fails when they disagree.

**Per-field acknowledgment.** Every field saves on blur, so a page-level "Saved"
said only that *something* saved — a guess on a form of eleven fields, and on
failure it named no field at all. The word now lands beside the input you left,
and the error carries the server's own sentence. One field is refused client-side
before the request: a blank company name, because that string is what every
other surface calls this workspace.

**The danger zone ships two of the canvas's three actions.** Transfer primary
admin is real (`PATCH members/:userId {is_primary_admin: true}`, primary-admin
only) and the card points at the existing "Make primary" control rather than
shipping a second write. Leave company is real (`DELETE members/:userId` on your
own id, with the last-primary-admin guard). **Delete company does not exist** —
`company.ts` declares eleven routes and deletion is not one of them.

The canvas gives Delete a type-the-name confirmation, which is the right design
for a real destructive action and the wrong thing to ship over a route that
404s: a confirmation dialog is a promise that something will happen. The limit
is stated instead, with where to ask. Building the endpoint is deletion across
the cap table, the raise, the data room and the metrics, and it deserves its own
decision rather than arriving as UI polish. The test asserts `r.delete('/company/:uid')`
still does not exist, so the day someone adds it the card is reconsidered.

**The empty state's four cards each name something real** — roles are
`role_in_company` plus migration 191's title/authority/carry; the growth fields
say in their own description that they feed investor matching; every workspace
narrows on the `X-Company-Id` header the switcher sets; `GET /company/memberships`
returns a list because more than one company is normal. No card may say
"invite": membership is granted from the other side, which is the same trap the
add-member copy already avoids.

**Not built here, and not for want of a route.** `corporate_profiles` is a
per-account KYB record — encrypted tax id, UBOs, directors, sanctions flags —
and `GET/PUT /settings/profile/legal-entity` is live with `api.getLegalEntity` /
`api.updateLegalEntity` on the client and **zero consumers**. It is tempting to
call that the canvas's missing "Legal entity" card and wire it here. It is not:
that card is company-scoped, `company_profiles` has no `entity_id`,
`jurisdiction` or `registered_address`, and `account_canvas_coverage.test.mjs`
pins all three so the card is reconsidered the day the link exists. The
per-account record belongs beside the obligations that read it, in Account and
Trust.

### D41. The Trust Center's three legacy cards: two were unreachable dead code, one was reachable and wrong on both sides

`scripts/api-drift-baseline.json` suppressed nine `/trust/*` paths the SPA
called with no worker route behind them — which is exactly why CI stayed green
over them for however long they have been there. Reading each against
`routes/trust.ts`'s eighteen declared routes gave **three different answers**,
and the difference is the whole decision. "Three broken forms" was the wrong
summary, and correcting it changed what to do about each.

**`KybCard` and `AccreditationCard` were unreachable.** Each rendered only on
the true branch of `legacy?.kyb ? <KybCard …>` / `legacy?.accreditation ?
<AccreditationCard …>`. `legacy` has exactly one source, `GET /trust/summary`,
and that handler returns both as **literal nulls** with a comment explaining
why: *"Task AH leaves the KYB+Accred cards out of scope, so they are surfaced
via /api/kyc/\* and the obligation matrix."* Both ternaries have always taken
the false branch; both tabs have always rendered `<ObligationList>`. So nobody
ever hit their 404s — the dead endpoints were dead code's dead code. Deleted,
along with their client methods.

Nothing is lost. `POST /trust/kyb/start` is real, and it is what the KYB
obligation's Start action already calls through `ObligationList` →
`startObligation`; it upserts `corporate_profiles` and moves `kyb_v1` to
`in_review`, which is the whole write the deleted card's "Submit" was reaching
for. Accreditation evidence has no upload route on either side, so the tab
**states that** rather than drawing a file input that cannot POST.

**`NdaCard` was reachable, and wrong twice over.** It was fed `summary.ndas` —
`pairwise_ndas` rows: `{id, party_a_user_id, party_b_user_id, intermediary,
nda_envelope_uuid, status, valid_until}` — while reading `it.role`, `it.title`
and `it.signed_at`. None of those exist on that row, so every entry rendered a
blank title, "role: undefined", and keyed React on `undefined`. And it signed
through `GET /trust/nda/:role/preview` and `POST /trust/nda/sign`, neither of
which exists.

The fix needed no new endpoint and no new client method, because the page was
**already fetching the right data and throwing it away**: `(async () => { try {
await api.getRequiredNdas(); } catch {} return api.getTrustSummary(); })()`.
`GET /trust/nda/required` returns `obligation_key`, `status`, `expires_at`,
`evidence_envelope_uuid` and an `open` flag. It is a third settled promise now
and the card reads it.

Signing goes through `api.trustMySigningUrl`, whose route
(`GET /agreements/:envelope_uuid/my_signing_url`) exists and is what the
Agreements tab already uses. **The worker returns a LINK into the e-sign flow,
not an acceptance** — so the typed-name modal was never the right shape, and
the card now opens the signing URL instead of pretending to take a signature.

**Measured outcome: the drift baseline goes from 22 entries to 14.** Nine dead
client methods removed, and the ninth — `getNdaStatus`, banked and with zero
call sites — was found by the guard written for this change, not by reading.

**The guard that could not be written.** The first draft asserted every client
`/trust/*` path against every declared route and drowned in normalisation;
`check-api-drift.mjs` already does that properly and runs in the gate. What
that matcher *cannot* tell you is the thing that let this rot: **a path already
banked in the baseline is suppressed forever**, so drift stays green while the
SPA calls something that 404s. The test asserts the narrower, durable rule —
the Trust Center may not call a path the ledger records as having no route.

**Also fixed: an investor saw two `<h1>`s.** `/trust` is wrapped by
`InvestorWorkspacePage`, which draws `<h1 className="investor-title">Trust</h1>`,
and the page then drew `<h1>Trust Center</h1>` inside it. `chromeless` — D33's
prop for "drops the page furniture and nothing else" — suppresses the inner
one for investors only. The trust score badge stays in both cases: it is
content, the answer the page exists to give, not furniture.

**Kept, deliberately, against the canvas.** `tabsForRole` still derives tabs
from the server's obligation matrix rather than the canvas's hardcoded list,
which disagrees with `ROLE_MATRIX` for three of four roles; the role still
comes from `/trust/me` with `localStorage` as a first-paint fallback only; and
both `Promise.allSettled` loads survive, so one dead endpoint degrades a card
rather than blanking the page. The canvas's `roleTabs` and `stateTabs` are demo
switchers and are asserted never to land.

### D42. The Corporate block was designed, half-written and never rendered; the page told the user it was already there

D40 ended by saying the per-account entity record "belongs beside the
obligations that read it, in Account and Trust". This is the Account half. It
needed no endpoint, no migration and no client method — all three already
existed.

**What was already built.** `corporate_profiles` (one row per user, `user_id`
is the PRIMARY KEY) carries entity name and type, registration number, a tax
id encrypted at rest, the registered address, signing authority, UBOs,
directors, insurance carriers and two screening flags.
`GET/PUT /settings/profile/legal-entity` serves it with real validation: 26
entity types, ISO country checks, per-country postal rules, an email check, a
UBO validator that derives `ubo_disclosed` from any holding at or above 25%,
and a cross-field guard that refuses `entity_type` without a
`registration_number`. Every failure is a 400 naming the offending field.

**What was missing was the card.** Three separate people left a marker for it
and none of them finished:

- `SettingsPage.jsx` carries the comment `Profile sub-tabs (Personal /
  Corporate / Verification)`. There were two tabs.
- `ENTITY_TYPE_OPTIONS` — 27 lines mapping each type to a printable label
  ("gmbh" → "GmbH") — was written and never read.
- `api.getLegalEntity` / `api.updateLegalEntity` had zero callers.

**And the page said otherwise.** `VerificationStubCard`'s footnote read *"The
Identity and Legal entity blocks above are already used to auto-fill
contracts"*. There was no Legal entity block, and there never had been. A
reader who went looking for it found the sentence, not the card. That is worse
than an absent feature: an absence is discoverable, a false claim is not.

**Two judgements in the build.**

*The array columns save explicitly, not on blur.* Every scalar field saves on
blur, matching `PersonalIdentityCard` beside it. UBOs and directors do not:
the worker takes the whole array in one PUT and revalidates every row, so a
per-row autosave would race its own siblings against a single endpoint. One
Save per list, and adding a row is asserted not to write on its own.

*`ubo_disclosed` is shown, never edited.* It is derived server-side from the
rows above it. Drawn as a toggle it would invite a user to contradict their own
table, and the next PUT would silently overrule them.

**What is stated rather than drawn.** `insurance_carriers` is stored and
validated but has no editor here; an empty table would claim "you have no
carriers" when the truth is "this page cannot record them". The two screening
flags — `aml_high_risk_jurisdiction` and `sanctions_last_checked_at` — render
read-only, with an unset date reading "Not recorded", because screening sets
them and this page does not. The canvas's "Registered agent" has no column on
this table and is not drawn.

**The company-scoped card is still absent, and that is a different object.**
`account_canvas_coverage.test.mjs` used to be titled "Legal entity is absent on
BOTH sides"; it now names the two records apart and still fails the day
`company_profiles` gains `entity_id`, `jurisdiction` or `registered_address`.
The account's entity is who signs your contracts; the company's is who the
workspace belongs to. They must not drift into each other.

A test parses the entity-type values out of both files and fails when the
picker and the worker disagree — the same client/worker drift guard D40
introduced for `EDIT_ROLES`, for the same reason: two copies of an enum drift,
and a select option the worker rejects is a control that 400s.

### D43. The Trust Center's status colours were an enumeration, and the platform writes more statuses than it enumerated

The `/trust` canvas asked for a restyle. Porting its visual vocabulary turned
up a live defect underneath, and the defect is the reason to record this.

**Three real statuses drew as "unverified".** `STATUS_PILL` was a status → CSS
class map with eleven entries. `pairwise_ndas.status` carries `active`,
`revoked` and `cancelled` — `trust.ts:708` branches on the first two by name —
and none of the three was listed, so all three fell through to the map's
`unverified` grey. An NDA **in force** and an NDA **revoked** rendered
identically to one nobody had started. Opposite ends of the spectrum, drawn the
same, on the page whose whole job is to say where you stand.

**Four tones do not fix that by themselves.** The canvas maps statuses to four
severity tones rather than eleven classes, which reads better and is the right
shape — but its own `toneOf` lists satisfied/signed/verified/clear/none and
misses `active`, `revoked`, `cancelled` and `waived` exactly as the shipped map
did. A prettier enumeration is still an enumeration.

What fixes it is deriving the map from the vocabulary the worker actually
writes, and then guarding that: `trust_center_contract.test.mjs` parses the
status literals out of `routes/trust.ts` and fails when one of them has no tone.
Two response-shape values (`already_active`, `envelope_issued`) are named in an
explicit exclusion list, so ignoring them is a decision on the record rather
than a silent gap. Deleting any of `revoked`, `cancelled` or `expired` from the
map fails the suite; that was checked, not assumed.

**`waived` now reads `ok`.** `computeTrustScore` counts waived alongside
satisfied, so a grey pill sat beside a green score saying two different things
about one row. The pill still prints "waived" — the reader can tell a waiver
from a completion. It is the TONE that has to agree with the score.

**The canvas's score model was refused.** It proposed partial credit for
in-review, a −10 gate penalty per open requirement and a −5 penalty per lapsed
optional one. The shipped number comes from `computeTrustScore`, which mirrors
`GET /trust/score/:userId` character for character
(`satisfied+waived / required`, `trust.ts:157`). Adopting the canvas formula
would have put `/trust` at odds with the server AND with the same badge on
`/account`, where SettingsPage renders it from the same helper. A page may
present a number differently; it may not compute a different one.

**Expiry is a state, not a date.** `expires_at` was already on the wire and
already rendered — as `expires 3/14/2027`, which reads the same whether it is
two years out or lapsed last month. `expiryNote()` says "Expired 34 days ago" /
"Expires in 12 days" / "Expires <date>", and the first two carry their tone.
This is the canvas's best idea and it needed no new data.

**What did not land, and why.** The canvas's per-role score history
(`PREV_SCORE`, "+8 since last month") has no table behind it — there is no score
history anywhere. Its `roleTabs` / `stateTabs` are demo switchers; the real role
comes from `/trust/me` and the real state from the matrix. Its `83b` key is not
an `ObligationKey`. Its obligation lists disagree with `ROLE_MATRIX` for three of
four roles. Its fixture names and envelope ids are fixtures. All of it is
asserted absent, for the same reason `design/incoming/README.md` exists.

The tab badges and the tone counts are both derived from the obligation array
already in hand — no second fetch, no second source, and a count of zero is
omitted rather than drawn, because "0 blocked" reads as an achievement when the
truth is that no such row exists.

### D44. A zone pill takes its accent from the URL, never from being first in the DOM

**What shipped.** Four founder landing desks marked the reader's current zone
from CSS position alone — `.validate-anchors a:first-child`,
`.raise-anchors a:first-child`, `.a5-grow-hero nav a:first-child`,
`.a6-hero a:first-child`. There was no route logic anywhere in those strips. So
landing on `/validate` lit **Interviews**, `/raise` lit **Status**, `/grow` lit
**Focus** and `/network` lit **Relationships**, while the reader sat on the
bucket overview — which is *above* the zones and is not one of them. Measured on
the built bundle in Chromium before the fix: one accent pill on each of those
four roots, in light mode.

**It also leaked past its own page.** All seven `/grow/*` zone pages import
`founderGrowDesk.css` beside their own stylesheet and reuse its `.a5-grow-hero`
header, so `/grow/talent` rendered **two** accent pills at once — "Focus" from
the desk's `:first-child` and "Talent" from the page's own `is-active`. That was
measured, not reasoned: chunk load order decides whether the desk's stylesheet
is present, so it had to be seen.

**And the mirror defect counted too.** `founderResearchDesk.css` styled
`.a7-anchors a.active` — a class `FounderResearchDesk` never set — and
`.build-anchors` had no active rule at all, so those two desks could never mark
a zone even when they were on one. Six strips, three different wrong answers.

**The rule.** A pill is current when `NavLink` says the pathname matches it, and
the class it gets is `is-active` — the vocabulary six zone-page stylesheets had
already settled on (`.fr-status-zone-nav a.is-active` and five siblings). One
shared helper, `frontend/src/pages/founder/deskZoneNav.js`, so the rule has one
definition. `NavLink` matches on pathname, so the `?project_id=` these links
carry rides along without affecting the match, and it sets `aria-current="page"`
— which these strips previously had no way to convey except by colour.

**`zoneForPath`'s `|| bucket.zones[0]` fallback is unchanged and is not the
bug.** It is correct on a zone route, `ZoneNav` already honours an explicit
`activeSlug={null}`, and `partner_bucket_overview.test.mjs` pins the contract
that makes opting out the caller's job. Every `WorkspaceShell`-framed root was
already opting out correctly; the desks simply never went through `ZoneNav`.

**Positional active-marking was a habit, not an incident**, which is why the
guard bans the selector *shape* rather than the four rules that existed. The
same idea sat in three investor stylesheets — `.investor-deals-hero nav
a:first-child` (inert only because `ZoneNav` sets its colours inline, so it
would have resurfaced the moment those moved to classes) and the fully dead
`.inw-anchors` / `.ir-anchors` blocks — and in `AdvisorWorkspaceShell`, whose
`anchors` strip marked item 0 active and which no caller ever rendered. All
removed. A test naming the four founder rules would have passed the day someone
wrote a fifth.

**Dark mode was a second, quieter bug.** Each desk stylesheet ends with a
`.dark … nav a{…}` idle rule at *equal* specificity to the positional accent but
later in the file, so it won: no desk had ever shown an accent pill in dark
mode. The new `.dark … a.is-active` rules out-specify it, and each was measured
at 5.90:1 against its own ground — above AA, and checked by computing relative
luminance rather than by observing that a dark variant exists.

---

### D45. The model menu returns, on the condition D13 set for it — and the condition is an empty list, not a check

**D13 removed the menu and wrote down what would have to be true for it to come
back:** *"making the router honour a validated preference is real work with a
safety edge (a caller must never be able to route a `safety` call away from the
guard model) and belongs to its own change if it is ever wanted."* This is that
change, and the product owner asked for it in as many words: *"multi model
selection options, only one model appears while there should be many other
options."*

**The safety edge is answered structurally.** `RouteEntry` grows `alternates` —
the models a caller **may pick**, primary first — and `safety` and `embed`
declare none, so there is no value of `opts.model` that reaches them. A test can
hold an empty list shut in a way it cannot hold a conditional shut, and
`ai_router_prices.test.mjs` fails if a future edit gives either task a list.

**`alternates` is not `fallbackChain`.** One is what the router degrades *to*
when a model fails; the other is what a person may *choose* while everything
works. A model belongs on one and not the other more often than not — the
deprecated 8b was a fallback for years and was never something to offer.

**An unlisted model refuses rather than substituting.** New `RefusalReason`,
`model_not_offered`. The rail remembers a founder's choice in their browser; a
model retired from the list months later would otherwise run as something else
and report success, and they would read one model's rate beside another model's
answer. It is distinguished from a spent budget because the fix is different —
re-running it unchanged fails identically — and the rail acts on it by dropping
the saved choice.

**What is typed and what is derived.** Which models exist, their ids and their
rates come from `GET /api/ai/pricing`, which reads the router's own tables. The
display name, the one-line why and the recommendation are editorial judgements
with nothing to derive them from, and live in `frontend/src/ui/railModels.js`,
which may not contain a price. The canvas's own why-sentences were **not**
transcribed: its Validate entry for the 70b describes reading across interviews
with Whisper, which is not the work `workspace_explain` does.

**D16 is untouched, and is the reason for one visible departure from the
design.** The canvas prints an estimate inside each recommended model's card.
`/api/ai/me/spend` groups by **task**, not by model, so an average printed there
would attribute a figure across every model the caller has used to whichever is
selected. It sits below the menu instead, saying what it is, and is absent until
they have run once.

**No exemption was added to the regulated-wording lexicon for the RECOMMENDED
badge, and none was needed.** `scripts/check-regulated-wording.mjs` treats a
literal as prose only when it contains a space, on its own stated rule that "a
literal that looks like an identifier is not prose". A bare badge passes; the
moment the word appears inside a sentence it is prose and the scanner is right
to flag it. `worker_rail_models.test.mjs` keeps it that way, so the lexicon
still has no exceptions to reason about.

---

### D46. "AI fills the blanks" ships with the branch D17 required, off by default, and names two things rather than the canvas's three

> **Two rules below are superseded by D82.** "Two capabilities, not three" counted
> capabilities on one surface, and there are three surfaces now; and match-back is
> no longer the only honesty mechanism — a `sourced` fill keeps a citation instead,
> because a market size has nothing in the project to match against. Everything
> else here still holds, including the invariant that `apply` calls the function
> the manual form calls, which D82 generalises rather than replaces.

**D17 refused this toggle** because *"no page branches on an assist mode.
Turning the switch off would change nothing any of the six surfaces does, so
shipping it puts a control on screen that cannot affect the product"* — and
noted that a surface *"that ever grows real manual behaviour declares `kind:
'choice'`"*. Founder Validate now branches: off writes no proposal and spends
nothing; on offers proposals a founder accepts or discards.

**The switch appears only where it branches.** Forty-seven pages mount
`WorkerRail` and one has proposals. The surface declares the capability; the
host passes `fills` to say this page has any. A globally-rendered toggle would
be exactly the dead control D17 refused, one page over.

**Off is the default, and the canvas draws it on.** Every run spends the
founder's own budget against their own monthly cap, so a mode that is on before
they chose it spends money they did not agree to spend. `useAssistMode` defaults
to `false` — the hook D14 listed by name as still genuinely missing, now that
something reads it. It is a module store rather than per-component state because
two components read one answer: the rail draws the switch, the page decides
whether to offer proposals, and `useState` in each would leave the page as it was
until a reload.

**Two capabilities, not three.** The canvas's mode note reads *"Transcribes
uploads, tags quotes to pains, drafts hypothesis cards."* Tagging and drafting
back onto stores that exist — `pain_group_aliases` (106) and `hypotheses` (211).
Transcription does not: `discovery_interviews` has no transcript, recording-key
or duration column, no R2 allowlist in the worker admits an audio MIME, and
`PRICE_USD_PER_1M_TOKENS` cannot express a per-audio-minute rate. So the note
names what runs, and the rail says under "Unavailable here" where the third one
is missing. It joins the sentence in the migration that gives it a column.

**A model proposes; it never decides, and it never names a theme.** Every item
is matched back against something that exists in the project before it can become
a row — an invented phrase, a hallucinated `pain_group_id`, a claim that restates
one the founder already has, and a claim they already threw away are all dropped.
The tagger sorts phrases into themes the founder wrote and cannot create one:
naming the thing the venture is about is not a thing to hand over, and the page
has said "founder-curated" for as long as it has existed. Two on-screen strings
that were true before this and are false after it were corrected in the same
change rather than left standing.

**`validate_proposals` records which model wrote each proposal**, which
`decision_gates` — the shape it copies — does not: that table returns a
hardcoded model string in its HTTP response and stores none, so the name can
drift from what ran. Since the rail now lets a founder choose a model, and since
the router falls back to a smaller sibling under load, "which one wrote this"
stopped being trivia. It is written from the router's usage metadata, so it is
the model that actually ran rather than the one that was asked for.

**Accepting and typing produce the same row.** `insertHypothesis` and
`upsertPainAlias` are the single writers, called by both the manual routes and
the accept path. The `H1, H2 …` allocation reads the highest code ever used so a
retired H2 is never reissued; a second insert with its own idea of that rule is
how it would quietly start handing out duplicates. The accept path claims the row
with `WHERE id = ? AND status = 'pending'` before applying it — `decision_gates`'
own idiom — and puts it back to pending if applying fails, because D1's HTTP API
has no transaction to wrap the two together.

**Nothing proposes on its own.** The band reads existing proposals when the mode
is on and writes none until the founder presses the run button. A component that
proposed on mount would bill a founder for opening a page, once per navigation,
with a creeping spend meter as the only symptom.

---

### D47. Whisper is billed by the minute, so the router grew a second price table rather than a fabricated token rate

**The third thing D46 could not ship.** Migration 215 gives `discovery_interviews`
its recording and transcript columns, `routes/founder_validate.ts` the upload and
transcribe routes, and the mode note its third clause. The "Unavailable here"
entry that named transcription is gone — a gap the product has since closed is
as false as a promise it cannot keep, pointed the other way — and is replaced by
the one that is genuinely still open: Whisper returns speaker turns and
timestamps, and this product stores neither because it has nowhere to show them.

**The structural problem, and why it could not be papered over.**
`PRICE_USD_PER_1M_TOKENS` is the router's only price table, and
`estimateCostUsd` answers **0** for a model that is not in it. Whisper has no
token rate anywhere — it is sold per audio minute — so the obvious
implementation makes a transcription free, which is the exact failure
`ai_router_prices.test.mjs` was written for: *"a model in ROUTE with no price
row bills as zero, and a spend cap that counts zero never trips."* A founder
could have transcribed all day against a cap that never moved.

Three options were weighed. Inventing a per-token rate for Whisper puts a
number on the rail that Cloudflare does not publish, which is what this whole
sequence of changes has been correcting. Special-casing the task inside
`estimateCostUsd` hides a pricing fact inside a control-flow branch. So:
`PRICE_USD_PER_AUDIO_MINUTE`, consulted **first**, because a per-minute model
has no token rate to find. The price guard now accepts a model priced in either
table and fails if one is priced in both — a model in both would bill by
whichever branch runs first, with the other figure sitting there looking
authoritative.

**Minutes come from the bytes, never from the request.** A browser can measure a
clip's duration exactly, and `recording_duration_sec` stores what it measured —
for the screen. Billing reads `audioMinutesFromBytes` over the stored byte
length instead, because a number the client chooses must not decide what a run
costs: a caller could otherwise transcribe an hour and report a minute. The
bitrate assumption (32 kbps, the top of what a browser's MediaRecorder produces
for speech) makes it an estimate, and it sits one function below the token
estimator that calls itself *"crude — ≈ 4 chars/token"*. It under-estimates
rather than over-bills, and it is never zero.

**`transcribe` offers no choice and no fallback, and both are deliberate.**
`whisper-large-v3-turbo` is faster and more accurate than the base model at the
same $0.0005 per minute, so a menu between them is a control that cannot change
anything — D13's own objection. A fallback between two models at one price
doubles the bill for a clip that is going to fail twice. The base model stays
priced because `routes/advisor.ts`'s composer mic has been calling it since that
feature shipped and those runs still have to cost what they cost.

**The advisor mic is metered for the first time.** It called `env.AI.run`
directly for its whole life: no per-user day or month cap, no org kill switch,
no fallback, and — the one that mattered most — **no row in `ai_usage_logs`**, so
every transcription a user ran was invisible to the spend meter that claims to
show what they have spent. It goes through the router now, at the same rate.

**Attaching audio is data entry; transcribing is an AI run.** The upload is
offered whatever the rail's switch says. Transcription sits behind it, so a
founder who turned "AI fills the blanks" off finds no control on this workspace
that still runs a model — and the off state names the switch rather than
disabling a button with no explanation.

**An empty transcript is an answer.** NULL means never transcribed; an empty
string means transcribed, and the clip had no speech in it. Folding the two
together would offer "Transcribe" forever on a silent recording and charge for
it every time.

### D48. A zone header's actions are the canvas's own list, and an action nothing performs is a sentence rather than a button

**The request was that every subpage carry its data-entry options** — Validate's
"Log an interview / Export transcripts" existed on the canvas and nowhere on the
screen, and the same was true across the profile. The obvious way to satisfy it
is to draw every label the canvases name. That is also the way to fail it
silently: a page then *looks* finished and does nothing, which is worse than the
empty header it replaced, because the reader now believes they tried.

**So the labels come from the design and the behaviour comes from the code, and
the two are allowed to disagree in public.** `founderZoneActions.js` lists, for
each of the founder's twenty-one zones, exactly the `ops:` array of its artboard
in the canvas's own order — nothing invented, nothing dropped. Each entry is one
of three things:

- **an export that runs here**, over the rows the page has loaded;
- **a link to a route that already performs it** and that a founder is allowed to
  open;
- **a stated gap** — rendered as text, never as a control.

Fifty-eight actions: fifteen, seventeen and twenty-six.

**A gap names what the reader can do instead, and never names a path.** Prose is
not checked by anything, so a sentence saying "go to /matches" is an unchecked
link wearing a sentence — and `/matches` is exactly the route a founder cannot
open. Notes name surfaces the way a person would; the checked `to:` field carries
the path, and every one of them is re-verified against `App.jsx`'s guard on each
build.

**Four labels lost their link during that verification**, which is the clearest
evidence the check earns its place: `/matches` (where the introduction request
lives) is admin, partner and investor only; `/contacts` redirects to a Network
tab a founder's desk does not read; `/build/discovery` renders the Validate page
for a founder, so the waitlist invite panel behind it is not theirs to reach; and
`/build/team` renders the Grow desk rather than the team page. A link that lands
somewhere the reader may not open is the same broken promise as a dead button,
only slower to discover.

**The export is client-side, and says so on the button.** Twenty worker routes
for twenty zones would be twenty chances for a count on screen to disagree with a
count in a file. `lib/csvExport.js` writes the rows the page has loaded, which on
most zones is a capped page — so the label reads "Export this view" and the
filename carries the row count. "Export" over a truncated list with no hint of
the truncation is how a founder pastes twenty-five of two hundred rows into an
investor update. Its escaping is the worker's, character for character; two older
copies in this repo leave a bare carriage return unquoted, which splits a record
for any RFC 4180 reader.

**Two defects here were invisible to the whole suite and obvious in a browser**,
and both now have an assertion. The Network zones' action row was placed inside
their `{!embedded && <header>}` block, which is false on the only route that
mounts them, so it rendered nowhere on three pages while every source assertion
passed. And one page was handed `project?.name` when it has no `project` — a
ReferenceError that blanks the route at render, which esbuild bundles happily and
no lint step exists to catch.

**The investor pass says the same thing about a much emptier profile**, and
correcting it taught the sharpest lesson in this entry. Fourteen zones,
forty-two actions, ten of which run. The investor SCREENS are read-only —
`InvestorDealsWorkspace` calls `listDeals` and two invitation methods,
`FundOpsWorkspace` calls `capitalCalls` and `fundsLpPortal`, and
`InvestorFundCalls` and `InvestorFundAccounting` call no API at all.

**A read-only screen is not a missing capability, and the first version of these
notes conflated the two.** `api.fundAddLP` and `api.fundCapitalCall` exist and
reach worker routes that serve them, so "Add LP" and "New call" are missing a
form rather than a store — but their notes said "nothing writes an LP" and
"never issued", read off the pages' imports without following the chain one step
further to `api.js`. That is the same one-step-short reading this whole entry is
against, committed inside it, and it is the reason a gap note now describes the
SCREEN rather than asserting what the product cannot do. The guard ties both
notes to those two API methods, so removing either makes the note wrong in the
other direction and fails the build.

The other ten Deals and Fund gaps are gaps in the store as well: no rubric, no
minutes, no conditions, no wire record, no journal source, no reconciliation
state.

**The same label is not the same answer across profiles, which is why the tables
are per profile and only the builder is shared.** `/network/*` serves every
licence and the investor artboard's ops are word-for-word the founder's — but
`/matches`, where `introductionsRequest` lives, is guarded
`['admin', 'partner', 'investor']`. "Request an intro" is therefore a working
link on the investor's zone and a stated gap on the founder's identical one. Four
copies of the builder would have been four places for "what an empty export says"
to drift; four copies of the answers would have been wrong.

**The partner pass is the mirror image of the investor's, and shows the rule
cuts both ways.** Ten zones, thirty actions, and every one of the ten can export
what it is showing — Delivery and Offers have had real stores since migrations
208 and 209. The twenty gaps are all writes, and each one is refused for a
reason its own zone already documents rather than for want of a route: a
deliverable's `opened_at` is the client's to set, so "Chase unopened" would be
the firm writing a metric about itself; no cadence is stored, so "Draft all" has
nothing to schedule. An honest pass is not a pessimistic one — it reports what is
there as readily as what is not.

**Where the row goes is decided by where the rows are.** Seven partner zones
share `ZoneBody`, which now renders the action row above all four of its states:
a stated gap is as true while a store is loading, or failed, or empty, as it is
with rows on screen, and an export with nothing loaded says so itself. Two more
are shared pages (`ServiceCatalogPage`, `PerksPage`) that take the row as a
RENDER PROP called with the rows their tab loaded — the caller decides, and the
shared page learns nothing about licences. The alternative, wiring from the
bucket router, would have cost every one of those exports its rows.

**The advisor pass is four zones, and the shape of what is missing is the whole
story.** Only one advisor artboard set carries an `ops:` array; Practice's five
zones and Cohorts' five have no header actions in any canvas, so there was
nothing to copy and nothing was invented. `expertise/visibility` is the one zone
excluded outright: it is not a body but a card whose entire page already states
the gap it would repeat. The exclusion is listed in the guard, which checks the
excluded set exactly, so a second zone cannot join it quietly.

**The shared surfaces close it, and they are why the tables are per profile.**
`/network/*` and `/research/*` are one component each, answering four licences.
The bodies are identical; the actions are not — `/research/markets` says "Cite in
deck" to a founder, "Cite in a memo" to an investor, "Add source" to an advisor
and "Attach to proposal" to a partner, from one line of code. So the body stays
shared and `zoneActionsByRole.js` picks the table by the role the shell resolved,
returning an EMPTY list for a role it does not know: a header quietly showing one
licence's actions to another is the same broken promise as a dead button and far
harder to spot. Six shared bodies take the row as a render prop called with the
rows they loaded, so each learns nothing about licences and the routes that are
not zones (`/signals`, `/build/competitors`, `/relationships`) pass nothing.

**Across the four profiles: sixty-seven zones, a hundred and ninety-six actions,
seventy-five of which run.** The other hundred and twenty-one are sentences. That
ratio is the deliverable — a reader now knows, on every zone, which of the things
the design promised they can actually do.

**Seven zones are excluded and each exclusion is checked, not asserted.** Six are
cards whose entire page already states the gap their actions would repeat. The
seventh, partner `network/organizations`, was recorded as a live bug and is not
one: `NetworkPage` catches a slug it has no tab for and suppresses every body, so
that route already renders its own heading above a card stating the gap. The
claim that it "lands on contacts" was wrong twice over — a partner has no
contacts tab either — and came from reading the `activeTab` fallback without the
twenty lines below it that gate every body. A profile's excluded list is compared
exactly against what its canvases specify, so an exclusion cannot grow by
accident.

**Two canvases give no actions to record**, and nothing was invented for them:
`Pages · Partner Pipeline` and `Advisor Detail · Practice` carry no `ops:` array
on any artboard. The gap is written down in `ROUTE_MAP.md` instead. Inventing an
action for a zone whose design asks for none is how a header grows a button
nobody specified and nothing backs — the failure this entry exists to prevent.

---

### D49. A bucket root the canvas composed renders a board; one it did not renders the card grid

**2026-09-06.** Every bucket root rendered `BucketOverview` — a three-column
grid of link cards carrying a label, an archetype badge and one blurb. Two
canvases draw something else: `Partner Operator Canvas` P3–P7 and
`Advisor Canvas` V3–V6 draw a root as an h1 (the bucket's **tagline**), a
sub-line, and one section per zone, each with a real count in its header, a
short table of that zone's real rows, and a footnote.

`BucketBoard` renders that, for the nine roots the corpus composes.
`BucketOverview` is **kept, unchanged**, for the six it does not — advisor
`/cohorts`, whose own canvas (`Pages · Advisor Cohorts.dc.html`) draws its five
zones and deliberately no root, plus every founder and investor bucket. These
are not two ways of doing one thing: a card grid is the honest surface for a
root nobody designed, a board for one they did. `boardFor(role, prefix)`
returning null is what gives the six theirs, with no condition naming them.

**The boards read the endpoints the zone pages already read.** One aggregate
endpoint per bucket was the obvious build and is the wrong one, because the
honesty rule here does not live in the component — it lives in the worker,
attached to the absence. `partner_offers.ts` returns `views: null` beside
*"No impression is recorded anywhere in the product, so a view count would be
invented rather than measured"*; `partner_pipeline.ts` returns `mrr_cents`
null-or-counted beside its basis and its note; `partner_delivery.ts` returns
`unrated_note` — *"Silence is not good news."* An aggregate endpoint would
re-derive those figures or re-copy those sentences, and `partner_delivery.ts`
already refuses the first in as many words. Reading the same endpoint makes the
board's number the zone's number **by construction**. It also means the feature
adds no route, no query and nothing for `check-api-drift.mjs` to see.

**A section cannot print a count it cannot source**, and that is a property of
the signature rather than of anyone's care: `summary`, `rows` and `footnote`
take the section's payload as their **only** argument, so a section with no
`source` is handed nothing. `gap` and `source` are mutually exclusive, and a
`gap` is *imported* from `workspaces/noStoreCopy.js` — the same object the zone
page renders — so a board can never be gentler than the page behind it.
`frontend/test/bucket_board.test.mjs` fails the build on an inline gap literal,
on a section slug list that is not its bucket's zones in order, and on **any
digit in a registry string**: every canvas hardcodes its figures, and those are
the designer's placeholders rather than the reader's numbers.

**Eight canvas claims are drawn on an artboard and refused in code**, each
replaced by the worker's own reason rather than dropped: the capacity cap, the
per-surface conversion rate, "shipped and acknowledged", the advisor platform
cut, engagement renewals, relationship staleness grading, satisfaction in
health, and "slots open" over a billing zone. The anchor pills the canvases draw
are **not** rebuilt — `ZoneNav` already renders one pill per zone, and
`ZoneNav.jsx:8-15` exists precisely because the canvas pills were inert.

---

### D50. An advisor reads a client's record only under a grant the founder makes, scope by scope

**2026-09-06.** Task #55. `/research/client-prep` had said the same thing since
it existed: half a client brief was present — the topic and the questions the
client wrote when they asked for the session — and the other half was the
client's own record, **closed by rule rather than absent**.
`canAccessFounderResource` admits admin, partner and the owning founder; an
advisor matches no branch. No table was missing. A decision was.

Migration 218 adds `advisor_client_grants`, shaped on `data_room_grants` — the
product's only founder→outsider content grant — rather than generalising it:
that table's column is `investor_user_id` and its reads are wired into the NDA
path, so widening it would put the advisor case inside the investor case's
blast radius for no gain. Keyed on `users(id)` and not `advisors(id)`, for the
reason migration 206 argues about cohort assignments — the read is
authorisation, and an advisor with no practice profile would otherwise be
ungrantable for a reason a founder could never discover.

**Three scopes, not one switch.** Opening the project record is not the same as
opening the data room, and neither is the same as showing an advisor which
*other* advisors this founder works with. One boolean would force the most
sensitive in order to grant the least. `scope_project` defaults on because it is
the half the brief lacks; `scope_data_room` and `scope_sessions` default off,
and the granting screen names each in the words that describe what it exposes.

**The gate is two parts and neither is sufficient**, copying `advisors.ts:1410`:
the grant is the founder's decision, and the **role is re-checked on every
read** — without it, a demoted advisor keeps an active row and keeps reading
indefinitely. Granting to a non-advisor is refused at the door, because such a
grant would be inert and a founder who ticked three scopes deserves to be told.

Three smaller properties are load-bearing: a missing project and a missing grant
answer identically, so the endpoint cannot enumerate projects; the data room
stays behind `pairwise_ndas` for an advisor exactly as for an investor — a
count, never the names; and the brief **names every scope it did not read**.

**`pairwise_ndas`'s "party_b is the investor" is a comment, not a constraint.**
The schema says only `UNIQUE(party_a_user_id, party_b_user_id)`,
`getPairwiseNda` is a two-column lookup with no role assertion, and every other
reader is symmetric. The convention is restated as *party_a is the founder,
party_b is the counterparty*; no migration was needed.

**D37 is narrowed, not retired.** At the time of this decision a founder still
could not push a document to an advisor: `advisor_client_document_shares` had a
reader — a shared document appears in the brief — and no writer, so
`LibraryZone` said nobody can send you a document. What changed then was the
reason, from "the mechanism cannot exist" to "the control has not been built".
`searchSemantic` is never widened; a shared document is resolved by id, and
`research_search_isolation.test.ts` stays green.

> **SUPERSEDED IN PART, 2026-09-08 (task #104, D64).** The control has now been
> built, so the second sentence above is history rather than current state. The
> isolation half stands exactly as written: the writer resolves a document by
> id, adds nothing to any namespace, and its test asserts `routes/search.ts`
> still never mentions the share table.

---

### D51. A filter is a claim about the data, so a filter with no store is a sentence — and the one that looked live was worse than the four that looked dead

**D48** settled the right-hand half of a zone header: the canvas's `ops:` list,
verbatim, with anything nothing performs rendered as prose. This is the
left-hand half — the `filters:` list on the same rule-bordered row — and it
needed the same rule for a sharper reason.

**A dead action does nothing visible. A dead filter returns an empty set, and
an empty set reads as an answer.** `/grow/customers` shipped a live "Stalled"
chip whose predicate was, literally, `return []`. Selecting it told a founder
they had no stalled accounts. Nothing in this product stores customer activity
at all, so the honest statement is that the question cannot be asked — and the
page said the opposite, in the product's own voice, using the product's own
empty-state styling. That is absent-is-not-empty failing in the one place where
the failure is indistinguishable from data.

The four `disabled` buttons on `/raise/capital` were the visible version of the
same problem and cost less, because a greyed control at least admits it does
nothing. They were also the more embarrassing find: `load()` was already making
three parallel calls whose results — the SAFE inputs, the compare variants, the
409A read — are exactly what those buttons promised, sitting in scope, unused.

**Seventy-five canvas labels across eighteen founder zones: forty-six are chips
that narrow real rows, twenty-three are sentences, two are groups filled from
the store.** `/raise/status` had simply omitted its fourth filter rather than
state it, so a reader hunting for the canvas's "Timeline" found neither the
control nor the reason.

**A sample figure in an artboard label is that artboard's mock data, not a
count.** `All 14`, `All 14 mo` and `Aug 2026` would state a number this
account has not got. A live entry writes `{n}` and the page supplies the real
figure; with no figure the clause is dropped, so the chip reads `All` rather
than `All 14`. Rendering added the zero case: an empty ledger produced
`All 0 months`, which is not a filter name but a broken string, and the count
that is genuinely absent already has a place to be said in the stat strip.

**`Backend`, `GTM`, `Distributed SaaS`, `Agencies` and `Enterprise` are sample
NAMES for one-chip-per-record groups**, so the pages supply the roles, sources
and stages they actually hold. Customers is the one where the substitution
changes the meaning: the canvas names market segments and a customer record
stores the source it was captured from. Those are different things, and the
sentence saying so is a **standing** clarification rather than a fallback —
it is needed most precisely when the chips are present to be misread. It
originally disappeared at exactly that moment; a guard assertion caught it,
which rendering would not have, because the page looked fine either way.

**The guard takes nothing on trust that it can check.** It re-derives all
seventy-five labels from the canvases, and — after mutation-checking showed it
believed `key:` without evidence — it also requires every live key to appear in
the page that would have to implement it, with the mount itself stripped first
so a declaration cannot satisfy the search for its own key. Turning "Stalled"
back on now fails the build. What it still cannot prove is that a predicate is
*correct*, only that the page knows the key exists; that limit is written into
the test rather than left for a reader to discover.

### D52. A filter cannot be called dead until the store has been checked, and three of the five that looked dead were reading columns the page had already loaded

**D51** settled what to do with a filter nothing backs: it becomes a sentence
naming what is missing, because an empty set reads as an answer. Carrying that
rule onto the investor profile turned up the opposite failure, and it is the
more expensive one.

**"Nothing is stored" is itself a claim about the data, and it is the easier
claim to get wrong.** Writing a chip is work; writing a sentence that says the
question cannot be asked is free, and it retires the question. Five of the
investor labels checked here would have shipped that sentence falsely:

- `/funds/calls` — `api.capitalCalls()` exists and calls **are** recorded. What
  does not exist is a link from a call to a fund register, which is what the
  page's own empty state had been saying in one word all along: *fund-scoped*.
- `/deals/pipeline` — `Unassigned` reads `deals.lead_partner_id`, a column the
  list query already selects; `Stale` reads `days_in_stage`, computed and
  returned on every row; `Passed` reads `status = 'rejected'`, written through
  `POST /api/deals/:id/pass` with a reason from a CHECKed taxonomy. Three
  filters, all live, on a board that had no filter row at all.
- Deals' three decision zones would have needed four more such sentences, and
  every one is false: `ic_decisions` and `ic_votes` exist with `api.icList`
  investor-callable, `dd_findings` carries a severity enum through `critical`,
  `api.dealDocuments(id)` is a method, and `pass_reason` is the same taxonomy
  the pipeline zone now reads. They are deferred in the guard's `excluded` set
  with those facts written down, rather than closed with prose that lies.

**So the rule is a sequence, not a judgement:** find the column, find the write
path, find the client method — and only then decide which of the three
outcomes a label gets. Absent is not empty (D51); unchecked is not absent.

**A third outcome the founder table never needed: already scoped.**
`/deals/pipeline`'s `Mine` is neither live nor missing. The board loads
`scope=mine`, so a chip would narrow nothing while appearing to, and "no owner
is recorded" would be false with `Unassigned` reading that very column beside
it. The sentence says the question has already been answered upstream.

**A bucket whose zones are sections of one page narrows to the zone rather
than scrolling to it.** `/deals/{pipeline,screening,commit,closing}` rendered
one component and differed only in what a `useEffect` polled for and scrolled
to — up to twenty times, at 100 ms, because the workspace loads its deals
before it renders them. It now passes a `zone` prop and renders one section per
route, which is what `InvestorNetworkWorkspace` already did and said why:
*"the pills moved, the page did not"*. Narrowing is not splitting — one
component, one `api.listDeals` call, and `/deals` still stacks all four.

Four action rows repeated on a scrolling page is noise. Four FILTER rows is
four stateful controls making four different claims about what the reader is
looking at, with the counts above them unmoved when the wrong one is clicked.
That is what made the routing decision urgent rather than cosmetic.

**A passed deal was being counted as live.** The stage ladder in
`normalizeDeal` had no branch for `rejected`, so a passed deal fell through to
Commit or Diligence, sat in the funnel, and was included in the "N live deals"
the section header prints — and could be the deal on the screening desk. The
`Passed` filter is what made the gap visible; a passed deal has no stage, so it
is now excluded from the funnel and rendered as a list with its recorded
reason rather than as a card under a stage it is not in.

**Mutation-checking found the guard's own hole again, and it was the same
shape as last time.** D51 recorded that the live-key check requires every key
to appear in the page that would implement it. Declaring `/deals/pipeline`'s
`Mine` live passed anyway, because `api.listDeals(undefined, 'mine')` puts that
literal in the file for an unrelated reason. The check now strips `api.*` call
arguments first: a literal that appears only inside a request is the page
asking the server to narrow unconditionally, not a view a reader can select. A
genuinely server-filtered chip still passes, because the page has to hold the
value in state to send it.

## D53 — A shared surface's header row is per licence, or it is absent

**2026-09-07.** `ResearchWorkspace` and `NetworkWorkspace` each render one
component for founder, investor, advisor and partner. Their filter halves were
deferred twice for one reason both times: a header row that appears on one
licence and not another, out of the same file, reads as a bug and is one. So a
shared zone's four tables land in the same commit or none of them does.

**The tables stay four, and this pass is the argument for that.**
`/research/library` is one component reading one column — `research_documents.
kind` — through one write path and one client method. Run the four-step check
per licence and the answers are not close: partner and advisor get four live
chips each, founder and investor get one out of five. The difference is
entirely the fourth check. `kind` is free text with no CHECK, so the column, the
write path and the client method all pass for every label; then the writer
settles it, because the upload form offers exactly `Document`, `My playbook`
and `About a client` and the worker coerces anything else. `Reports`, `Legal`
and `Diligence` name values no row can carry. `Client docs` and `Reusable` are
exact. One shared table with a role switch would have had to encode that split
anyway, in a place where nobody would read it.

**A filter builder reaches a shared body as a BOUND BUILDER, not a render
prop.** Actions need only the rows: `zoneActions={(rows) => zoneActionsFor(role,
key, { view })}` is a one-argument function the body calls. Filters need `value`
and `onChange`, which are the body's own state and cannot be supplied by the
workspace. So the workspace passes `zoneFilters={(opts) => zoneFiltersFor(role,
key, opts)}` and the body calls it with its own state. The body also needs
`role`, for the accent — and `roleMountVerdict` in the guard enforces the
consequence: a shared body must pass `role={role}`, while a page under
`pages/investor/` must still name its licence outright.

**A filter that matches everything is as dishonest as one that matches
nothing.** D51 was written about the empty set, and this pass found the other
end of the same axis five times: `/research/diligence`'s `Granted` over a query
that selects only grants, `/research/markets`'s `Active` over a feed that reads
`WHERE status = 'active'`, `/research/benchmarking`'s `Saved` over rows with no
draft state, and `/research/client-prep`'s `Founder-sourced` over rows that all
carry one source. None of them narrows; each would tell a reader they had
confirmed something. They render as prose naming what is already true of the
list, which is the same treatment `/deals/pipeline`'s `Mine` established.

**Two filter rows were live and matching nothing when this pass reached them**,
which is D51's own defect shipped twice more. `ClientPrepZone`'s `Mine only`
filtered on a `source` value nothing writes. `FundsZone`'s `Right stage`, `Warm
path` and `Passed` read three columns the schema has, the worker validates and
the PATCH route accepts — and that no surface in the product ever set, because
`api.research.fundUpdate` had no callers. The second one is why the check
sequence has a fourth step at all: three of them pass on a column whose only
possible value is NULL. Where the vocabulary is already settled and only a
control is missing, the repair is the control.

**A label is relabelled when the canvas's word promises a record that does not
exist**, and the predicate is unchanged: `Session docs` → `About a client`
(nothing links a document to a session), `Peer set` → `Compared` (no shared peer
set exists; the ops half of the same row says so), `Requested` → `Partly staged`
(the artboard's own code calls that set `partial`), `Best fit` → `All funds` (no
fit score is stored). The canvas string stays in `canvas:` as provenance, so the
guard still re-derives every one of them.

## D54 — A filter row is where a body's dead predicate becomes visible

**2026-09-07.** `/network/*` was the last shared surface to get its filter half,
and it was not an additive pass. Three defects were already shipped there, all
three in bodies, and all three were found by writing the header row rather than
by any test.

**Founder Introductions filtered on a field the API has never returned.**
`direction(row)` read `row.direction`; `propositionDto` returns ten fields and
that is not one of them, `intro_propositions` has no such column, and every row
is loaded `WHERE user_id = ?` — the reader is always the addressee, so direction
is not merely unreturned, it is not a fact the model holds. `Asked` matched zero
rows on every account and rendered "No asked introductions are recorded. This
filter contains no stored ledger entries." `Offered` matched all of them. A
`Direction` column printed `Offered` in the table and in the CSV export, a stat
read `N / 0` under "More offered than asked", and three prose lines asserted the
opposite of the truth. D51's canonical failure and its already-scoped inverse,
side by side in one card.

**Organizations grouped on a column that does not exist**, on both licences that
have a body for it. `contacts` is sixteen columns and none of them is
`organization`, `company` or `firm`; the only three `ALTER TABLE contacts` in
the repo add `promoted_ref_id`, `utm_json` and `referrer`. The investor path
ends at `metadata.organization_name`, a free-text JSON column that would accept
one — and the only writer in the product sends `partner_id`,
`relationship_type` and `strength_score`, so no row has ever carried it. Four
chips sat over a collection that is empty by construction, and `Funds` rendered
"No funds organizations are recorded": a per-filter claim about this founder's
data, from a page that had never had any to look at.

**A source guard cannot see any of this**, which is the decision. The ops half
has been guarded per zone since #465 and none of these three is an action. A
body's predicate is ordinary code over ordinary state; nothing in the suite
knows that `row.direction` is not a field or that `groups` can never fill.
Writing the filter half forces the four-step check onto every canvas label, and
a label that survives it becomes a `key` the guard then holds — so the row is
both the audit and the record of what the audit found. Two of these three had
been on screen since their pages shipped.

**A dead label's verdict belongs to the row, not to the word.**
`Co-investors` is a live chip on `/network/relationships` for an investor —
`relationship_type = 'co_investor'` over people — and prose on
`/network/organizations`, where the same word would have to select firms and the
store holds none. Same label, same table, two zones apart. This is why the
tables are keyed by zone and why a shared note is named once per zone rather
than hoisted to a file-level constant.

**When a filter half and an ops half disagree, the stronger finding wins and
both are rewritten.** The Organizations ops row said merging was merely unbuilt
— "duplicates stay as separate rows", "organizations are derived from the
relationship book, so there is nothing to merge". Both were true and both were
too weak: with no key there are no rows to be duplicates of, and the derivation
produces nothing. The two halves of a row are one sentence about one store and
must not be allowed to describe it at two different strengths.

## D55 — The Research stores are the reader's own record, which is why D9's licence is not their condition

**2026-09-07.** `/research/{funds,benchmarking,diligence}` shipped in #456 with
migrations 216 `research_funds` and 217 `research_benchmarks` — and no decision
entry, which is the gap this closes. D49 recorded the bucket boards and D50 the
advisor grant; the stores they were built alongside got nothing.

**Why the omission mattered more than a missing paragraph.** D9 withdrew the
Funds research tab and closed *"It returns when a source is licensed."* No
source has been licensed, and `/research/funds` is back. Read on its own that
looks like a decision quietly reversed. It is not: **the object changed.** D9's
tab wanted a directory of external funds, managers, fundraises, unicorns and
comparables — third-party market data nobody here can produce without buying
it. `research_funds` holds the funds a founder is *themselves* talking to,
with the stage fit they judged, the path they have in, and the reason they
were passed on. Every row is the founder's own record of their own raise.
Nothing in it is bought, so nothing in it needs a licence. That is the same
line D37 drew for Library and Ask — answer from what the caller uploaded, refuse
to answer from general knowledge — applied to a different bucket.

**Diligence has no migration and that is the design.** It is an assembly over
`data_room_grants`, `data_room_files.visibility` and `data_room_access_log`:
three tables that already exist, read together to answer one question an
investor cannot otherwise ask — which founders opened a room to me, and how
much of what they hold did they stage. A fourth table would have been a copy
of the first three going stale.

**Three absences these routes state in the response body rather than fill.**
Each is the same rule the filter halves later formalised as D51 — an absent fact
is said, never modelled:

- `cheque_overlap_note` (`research.ts:436`) — with no `raise_target_usd` on the
  active company's project there is no ask to compare a cheque range against,
  so the count is *absent rather than zero*.
- `sample_note` (`research.ts:560`) — the smallest peer set behind any
  comparison on the page is named up front, because "a median over a set that
  size moves with one member and should not be presented as a market rate".
  The write path refuses a peer figure without its source and sample size
  (`:567`), duplicating the schema CHECK so the writer gets a sentence instead
  of a constraint violation.
- `deal_stage_note` (`research.ts:668`) — the canvas puts a deal stage on a
  data room; a grant and a deal are separate records with no key between them,
  and joining them on a company name would attach a stage to the wrong room.
  `deal_stage` is `null` and says why.

**What this decision does not do.** It does not reopen D9's tab. A directory of
external funds still needs a licensed source and still is not being built; D9's
table row `| funds | none | no data source → D9 |` remains true of the thing it
describes. The two objects share a path and nothing else.


---

## D56 — Ask draws the canvas strip on two licences and refuses it on two, because the licences do not share a first tile

**Date:** 2026-09-07 · **Reverses in part:** the judgement recorded in
`77f53bf28` · **Follows:** D37, D51

`77f53bf28` gave `/research/library` its canvas structure — the four-tile stat
strip and the instrument card — and argued in the same commit that
`/research/ask` should **not** get the same treatment:

> Four empty tiles and an empty table would restate one absence five more times.

That is right, and it is right about only half the product. It was written
looking at the founder and investor artboards, where it still holds exactly.
The advisor and partner artboards specify a different Ask zone, and the
difference is the first tile.

**Where the original judgement stands, unchanged.** Founder's and investor's
four tiles — `Questions asked`, `Answers kept`, a first-pass cost and a
follow-up cost — and their whole `Session history` table are downstream of one
missing thing: a stored session. `research.post('/ask')` searches, answers and
returns; the only per-question row anywhere in the product is `ai_usage_logs`,
which holds token counts and no question text. Four tiles reading "Not
recorded" would state one absence four times, and a table whose every row is
"Not recorded" is what D51 and the Library rule already forbid. So those two
licences get **one sentence naming all four tiles**, and neither strip nor
table. `groupFilterNotes` does the same thing in the header row directly above,
for the same reason.

**Where it does not stand.** Advisor's and partner's strip opens with `Indexed
documents`, and their instrument card is `What Ask can reach` —
`Document / Kind / Added / Index state / In Ask`. Every one of those is a field
`api.research.documents()` already returns, and `AskZone` has already fetched
that payload for its own empty state. Nothing new is called to draw either. So
the strip is real in its first tile with three stated gaps below it, which is
the Library treatment exactly, and the card answers the question the zone
exists to answer: *which of my documents can Ask actually see.*

Refusing to draw them on the strength of an argument about tiles that are not
on this artboard would hide a sourced table behind a judgement made elsewhere.

**The rule this leaves behind, which is not about licences.** A zone draws its
canvas strip when **at least one tile in it has a store**; the rest then say
"Not recorded" in words. A strip with no real tile is a sentence instead. That
is why `ASK_STRIP_LICENCES` is one named constant gating both the strip and the
card rather than two role tests — the two surfaces answer the same question and
must not be able to drift apart. `research_zones.test.mjs` pins the constant,
its two uses, the absence of any bare role comparison, each tile at its own
`/>`, and the card's five columns.

**`In Ask` reads `index_state`, never `chunk_count`.** A document that indexed
once and later failed a re-index keeps its old passage count — the failure path
writes the state and leaves the number alone — so the count would call a
document answerable that Ask cannot see. The guard bans `d.chunk_count` in that
card.

**Still out of scope, and named so it is not mistaken for an oversight.** The AI
proposal card (`aiLabel` / `aiCost` / `aiBody` / `aiAccept` / `aiFoot`) appears
in ten artboard specs and is rendered nowhere under `pages/research/`; wiring it
means binding each zone to an aiRouter task class, which is a registration
decision rather than a layout one. Same for Ask's advisor/partner `.meter`, the
`.askbar` cost line, `.thread`, and the `scope` chip — `ZoneHeading` has no prop
for it. A session store for Ask is a migration, and a migration is a decision:
it is raised here, not built around.

## D57 — An account reaches a firm through `users.partner_id` and through nothing else

`requirePartnerProfile` (`cloudflare-worker/src/routes/_t13t14t15_helpers.ts`)
had two ways to resolve the caller's firm. It now has one, and the second is
recorded here rather than deleted quietly, because a removed authorization path
is exactly the kind of change a later reader will want the reasoning for.

**What it was.** When `users.partner_id` did not resolve, the helper ran
`SELECT * FROM partners WHERE email = ?` against the caller's own address and
returned whatever came back.

**Why it was useless, measured rather than argued.** Against production D1 on
2026-09-07: of 26 `role='partner'` accounts, **8** resolve by `partner_id`,
**18** resolve to nothing, and **0** resolved only by email. That is not a
coincidence of the current data — it is structural. `ensureRoleProfile`
(`services/ensureRoleProfile.ts`) runs the SAME email lookup on every
`/auth/me`, and writes `partner_id` from it. Any row the fallback could have
matched had already been linked before the fallback was reached. It was
unreachable by construction.

**Why it was dangerous.** `partners.email` is a person's address and `users`
holds another copy of one. Joining two tables on a mutable string is a link
nobody records making: change an account's email to one a firm happens to carry
and the account acquires that firm's quotes, engagements and clients, with a
200 and no audit row. `partner_user_firm_link.test.mjs` was written to stop
migration 210 doing precisely this from the write side — *"a row matched too
broadly does not fail closed"* — and the read side had the same hole open the
whole time.

**What the unmatched get instead.** The gap card, in both directions. An
account with no `partner_id`, and an account whose `partner_id` points at a
firm that no longer exists (the column carries no foreign key, so a deleted
firm leaves a dangling pointer, and that case used to fall through to the email
match — the worse of the two, since the account had once been attached to
something else). The card states that the account is not linked to a firm and
that an admin can attach it, which is a better answer than a guess.

**What this does NOT require.** A backfill for the 18. `ensureRoleProfile`
already creates a `partners` row and sets `users.partner_id` on every
`/auth/me`, which the SPA calls on session boot — so those accounts link
themselves at next sign-in, and the 18 are dormant rather than broken. What is
still missing is the admin surface the gap card promises, which is its own
piece of work.

**Where it is checked.** `cloudflare-worker/test/partner_user_firm_link.test.mjs`
exercises the resolver against real SQLite: a linked account gets its firm; an
account whose email IS a firm's does not; an admin previewing the role does not;
a dangling `partner_id` does not; a founder is refused before any lookup. A
source assertion sits beside them so an edit reintroducing the fallback has to
delete a line that says why it went.

## D58 — Three of the five Research tables describe objects this product does not store

`Pages · Founder Research` draws a `head`/`rows` table per zone with status
pills. Task #109 was to make the subpages match it. Four of the five zones
needed no code at all, and the reason is worth recording once here rather than
being rediscovered per zone.

**Funds was a re-layout and is done.** Every column and every pill the artboard
asks for was already rendered by `FundsZone.jsx`, and rendered correctly —
`stage_fit` NULL as `Stage not assessed`, a missing cheque end as unrecorded,
the thesis quoted in the fund's own words. Only the shape was a card list rather
than the canvas's four columns. `research_zones.test.mjs` now pins the columns
and both honesty rules, because a re-layout is exactly where a three-way pill
quietly becomes two-way.

**Library was already right, and is righter than the canvas.** The artboard
draws `Document · Kind · Year · Questions · State`; the zone draws
`Document · Kind · Added · Passages · State`. Two headings are deliberate
relabels and must stay that way:

- `Year` would be read off `created_at`, which is when the document was
  UPLOADED. The canvas's own sample row is a 2023 report indexed today, so the
  two are visibly different things and the column would state a publication
  year nobody recorded.
- `Questions` would be read off `chunk_count`, which counts passages. Nothing
  counts questions asked against a document — Ask keeps no session record at
  all (below) — so there is no number anywhere that means what the heading says.

This is the same rule the filter tables use when a canvas word would mislead: a
`label:` that says what the store holds, over a `canvas:` that says what the
artboard drew.

**Markets, Ask and Companies are blocked on stores, not on layout.** Each was
already recorded from the filter side; this is the same fact from the table
side, and it is why no table was drawn:

| Zone | The table the canvas draws | What it needs |
| --- | --- | --- |
| markets | Analysis · Method · Run · State · Note | a saved market deep-dive: an analysis with a method, a run date, a lifecycle and its sources. `founderZoneFilters.js` states it — *"nothing saves a market deep-dive… this page is the signals feed, gathered on a schedule"*. The signals feed is a real and different object; drawing it under these headings would relabel one thing as another. |
| ask | Question · Drew on · Cost · What you did with it | a session record. Nothing saves a question, an answer, its cost or what was done with it. |
| companies | Company · Relation · State · What changed | a competitor lifecycle (`Tracking`/`Archived` — `origin` is provenance, not state) and a change log (`summary` describes a competitor; nothing records change over time, and every canvas sample row is a change narrative). There is also a level mismatch: the table is per-COMPANY while the zone lists saved ANALYSES, and the list endpoint deliberately omits candidates. |

Each of those is a migration and a product decision about what the object is —
raised here, not built around, and not approximated from the nearest table.

**`SignalsPage.jsx` and `CompetitorAnalysisPage.jsx` were deliberately not
touched.** Both are mounted from routes outside Research, so a row-shape change
there reaches surfaces this task never looked at — and neither has the store its
table needs anyway.

## D59 — An IC decision belongs to a firm, and a NULL firm is not a public firm

Task #106 was titled "scope `/api/ic` to the caller's own firm" and `ic_decisions`
had no firm column. Recording what it turned out to be, because the shape is not
obvious and the wrong version of it is a leak rather than a bug.

**What was open.** Every read on `/api/ic` ran with no caller predicate at all.
`GET /api/ic` was literally `SELECT * FROM ic_decisions WHERE 1=1`; `GET
/api/ic/:uid` matched on the uid alone and returns the memo, the proposed terms
and every member's vote WITH its written rationale; `POST /api/ic/:uid/vote`
looked the decision up the same way before writing into its tally. Only `PUT
/:uid` was scoped, by `created_by`-or-admin. So any account holding the IC
licence — admin, partner, or a professional-tier investor — could read any other
firm's investment committee and vote in it.

**Nothing leaked.** `ic_decisions` and `ic_votes` are both empty on production
(checked 2026-09-08, before the fix was written). The surface shipped ahead of
its first user. That is why this is migration 219 and not an incident, and why
the backfill has nothing to do.

**Why the column was missing.** `ic_decisions` is migration 123. The company
rollout that put `company_id` on every table holding a firm's private data is
189–198. The Commit stage was built between the schema that had no tenancy
dimension and the one that did, and nothing swept back over it.

**What a decision belongs to — the three ways, and why not fewer.**
`icDecisionScope` in `services/tenancyScope.ts` admits a row three ways:
`created_by`, an existing `ic_votes` row for the caller, or a `company_id` the
caller is linked to. Scoping to `created_by` alone is the plausible wrong fix:
it passes every cross-tenant test and silently breaks the feature, because an
investment committee whose members cannot read the memo is not a committee. The
votes branch cannot bootstrap access — a vote row only exists because the vote
endpoint ran, and that endpoint is behind this same scope — so it grants nothing
new and keeps a member's own participation readable afterwards.

**`company_id IS NULL` DENIES here, and admits everywhere else.** This is the
one place in `tenancyScope.ts` where a NULL company narrows rather than widens,
and the inversion is deliberate. In `companyScope` and `projectInActiveCompany`,
company is laid over an ownership predicate that has already decided, so an
unassigned row stays visible under every company and hides nobody's data. Here
the firm IS what makes a colleague a colleague — there is no outer predicate —
so the familiar `IS NULL OR = ?` would hand every unassigned decision to every
licence holder, which is the leak being closed. A decision whose author has no
company is readable by its author and by whoever has voted on it, and by nobody
else.

**Membership is read from `user_company_links`, not from the switcher header.**
The `X-Company-Id` header answers "which of my firms am I looking at" — a filter
the reader controls. Authorisation may not depend on it, or a caller who has
never touched the switcher would lose their own firm's docket. The header is
used for one thing only: stamping `company_id` on a NEW decision, and there it
goes through `activeCompanyFor`, which verifies the claim against
`user_company_links` and returns null for a firm the caller does not belong to.
A forged header therefore files a row under nobody, never under the firm named.

**404, not 403, for a row outside the scope.** The predicate lives in the WHERE
clause, so "no such decision" and "not yours" are the same code path and there
is nothing to forget. `requireOwnEngagement` and `requireOwnQuote` answer the
same way for the same reason: a 403 confirms to a non-owner that the row exists.
The 403 on `PUT /:uid` stays, because by then the caller has been established as
entitled to READ the row, and "somebody else's to edit" is an authorship rule
inside a firm rather than a tenancy boundary.

**`deal_id` was the one foreign key nothing checked**, and the vote handler
copies it into `decision_journal_entries.deal_id`. It is now existence-checked
exactly as `project_id` already was. It is deliberately not narrowed further:
`deals` carries no company column on purpose (migration 194 — browsing deals is
a marketplace), so which deals a caller may see is a different surface's
question.

## D60 — Migration 039 never ran, and `schema.sql` was edited as though it had

Task #112 was "rewrite migration 039 so a fresh D1 build can apply it", and it
was written believing 039 had been applied. It had not, and what turned up while
checking is bigger than the file.

**Section 1 landed by hand; sections 2–6 have never run anywhere.** Read off
live D1 on 2026-09-08 with `SELECT sql FROM sqlite_master` — not off
`schema.sql`, which is the whole point of this entry:

| Table | Live `project_id` |
| --- | --- |
| `deals` | `REFERENCES projects(id)` — no CASCADE |
| `score_snapshots` | `REFERENCES projects(id)` — no CASCADE |
| `documents` | `REFERENCES projects(id)` — no CASCADE |
| `discovery_interviews` | `INTEGER NOT NULL` — no REFERENCES at all |
| `roadmap_okrs` | `INTEGER NOT NULL` — no REFERENCES at all |

`projects.deleted_at` and `idx_projects_deleted_at` are present. The file's own
marker row records exactly this, deliberately renamed on 2026-05-11 to
`_migrations_applied.name = '039_project_cascade_partial_deleted_at_only'` — it
is still the only row in that table. `CHANGELOG.md` has carried the same note
since. `schema_migrations` has the file marked applied (baselined, so recorded
without executing), which is why production is settled and only a fresh build
was ever affected.

Measured on the local workerd D1 that GOTCHAS names as the reproduction, the
old file fails with *"To execute a transaction, please use the
state.storage.transaction() … APIs instead of the SQL BEGIN TRANSACTION or
SAVEPOINT statements"* — the same rejection it hit in May. The rewritten file
applies both statements and produces `projects.deleted_at TIMESTAMP` plus the
index, which is what production has.

**The file now says what it did, not what it intended.** Sections 2–6 are
deleted rather than repaired, for three reasons in order of weight:

1. A fresh database must land where production is. Keeping the rebuild would
   give every new build a cascade production does not have, and every later
   migration would be written against a schema only one of the two carries.
2. Nothing depends on the cascade. `services/projectTrash.ts::hardDeleteProject`
   deletes from twenty-four child tables by hand and then detaches
   `activity_logs` by nulling `project_id`, because that history is deliberately
   KEPT — which a cascade would have dropped. That loop is the only cascade
   production has ever had and it works. Its header claimed the opposite ("on a
   migrated DB the manual deletes are redundant"), which is how a working
   safeguard gets deleted as vestigial; corrected in the same commit.
3. The rebuild had gone stale where it would have hurt most. Three of its five
   sections copied rows with `INSERT INTO <t>_new SELECT * FROM <t>`, which maps
   by POSITION, and the live column order no longer matches the declarations —
   `score_snapshots` has since gained `official_week`, `deals` sixteen columns
   including the whole pass taxonomy. Empty database: copies nothing. Populated
   one: writes values into the wrong columns.

**THE PART THAT MATTERS MORE THAN 039.** `schema.sql` — the snapshot every new
environment is provisioned from — had been edited to carry the cascade, with
five `-- Task #7 (AM) — ON DELETE CASCADE so admin hard-delete drops X too.`
comments marking the exact sites. So the intent was written into the snapshot
while the migration that would have realised it never ran, and for four months
a new database and production disagreed about five foreign keys with nothing
checking. All five now match production, including the two that carry no
reference at all: matching exactly beats adding a constraint only new databases
would have, because an insert that succeeds on production and fails in dev is
the divergence in its most confusing form. If the key is wanted it is a
migration applied to both.

`cloudflare-worker/test/migrations_fresh_build.test.ts` pins that agreement, and
is the assertion that would have caught this in May.

**A related finding, recorded and NOT fixed here: this repo cannot build a
database from its migrations alone.** Replaying every numbered migration on top
of `schema.sql` fails 55 times out of 221 — `schema.sql` is a current-state
snapshot, not the base the deltas were written against, so it is already past
what most of them add (11 `duplicate column name`, 41 `no such table`, 3 other).
That is what `migrate-d1.mjs --baseline` exists to paper over. Closing it means
reconstructing the original base schema, which is separate work; the test above
records the current failure classes so a migration that fails for a NEW reason —
referencing something nothing creates — fails the build.

**Both exemption lists are gone.** `scripts/check-sql-migrations.mjs` named 039
and 200; `frontend/test/migration_column_shapes.test.mjs` named 039 again, in a
second list nobody had connected to the first. 039 needed no exemption once
trimmed. 200 needed none once the blanket `^PRAGMA` ban carved out
`defer_foreign_keys` — the one pragma D1 honours and a table rebuild requires,
evidenced by 200 having applied to production carrying it. That carve-out is
itself tested: with no migration carrying any other pragma, widening it to
"any pragma" passed the whole suite until an assertion called the predicate
directly.

## D61 — The admin docs were orphaned by a fix for a problem already fixed

Task #113 was "decide the orphaned admin docs: restore or retire", with the
instruction not to simply re-add the import — that would reverse someone's
decision — and to prefer retiring if the reason for the removal could not be
recovered from git history. **The reason is recoverable, and it argues for
restoring.** Nine days separate two commits:

- **2026-05-13, `88e6d1f97`** — *"Task #2 (DD) — Hide Admin docs from
  non-admins"*. It built the whole apparatus the docs surface still carries:
  `roles: ['admin']` on `sections/admin.js`, `filterSectionsForRole` and
  `adminOnlyAnchors()` in the manifest, a role-scoped fuse index in
  `lib/docs/search.js`, and `AdminDocsPathGuard` in `App.jsx` mounted on both
  `/docs/admin/*` and `/help/admin/*`.
- **2026-05-22, `2c38e60b3`** — *"Remove administrative sections from user
  documentation"*, whose body says it removes the Admin section "from the
  StudioOS documentation navigation and search index". That is exactly what the
  previous week's work already did, per viewer. It deleted the import and the
  `SECTIONS` entry.

So the second commit was a blunter second fix for a problem that was already
solved, and it left the first one guarding nothing: `adminOnlyAnchors()`
returned no admin anchor, `AdminDocsPathGuard` redirected admins to
`/help#admin/<sub>` where no such anchor existed, and 179 lines of written
admin documentation were unreachable by anyone including an admin.

**Restoring honours that decision rather than reversing it.** The decision was
"admin content must not appear in user documentation". `admin.js` is still
tagged `roles: ['admin']`, and the filter is live in both places that matter —
`DocsLayout` (rail, body, "on this page") and `lib/docs/search.js`. Every
non-admin viewer sees precisely what they saw yesterday. What changes is that an
admin can read the docs the path guard has been pointing at for four months.

**Re-registering it made a latent hole live, which is why "don't simply re-add
the import" was the right instruction.** `buildDocsRecords(role)` excluded
admin-tagged sections "when a role is provided" and returned the FULL corpus when
`role` was `undefined` — stated as back-compat for callers passing nothing.
`DocsLayout` passes `role` straight from `useAuth()`, which is `undefined` for an
anonymous visitor. With the section unregistered that leaked nothing; with it
registered, the Help Center search box would have served the admin corpus to
anyone while the rail beside it correctly showed nothing (the rail's filter
compares against `''` and drops the section). The filter is now unconditional:
an unknown role is a non-admin, which is the only safe reading of "unknown", and
it makes the two surfaces agree. No caller loses anything — nothing in the repo
calls it with no argument.

**Two branches had never been exercised by any data.** `filterSectionsForRole`
and `adminOnlyAnchors` each handle a tagged SUBSECTION inside a public section —
the shape `88e6d1f97` created in `portals.js` ("Admin Console (overview)") and
`2cf22e3ea` deleted nine days later. Mutations that removed those branches
entirely passed the whole suite. They are not deleted as dead code: an
admin-only subsection is a shape this manifest is designed to carry and the next
one would leak in silence. They are now tested against a fixture built in the
test, so the contract holds regardless of what the corpus happens to contain.
`adminOnlyAnchors` gained an optional sections argument to make that possible —
its sibling already had that shape.

**The persona line stays refused, for a reason that survived the change.**
`help_center_contract.test.mjs` asserted that NO section carried a `roles` array,
explicitly so that "if a section ever grows one, this fails and the refusal gets
revisited rather than quietly outliving its reason". It fired, and the refusal
was revisited: the only `roles` array in the corpus is `['admin']`, and admin
content is already invisible to every viewer it would exclude, so "Applies to
<persona>" would read "Everyone" on all 98 articles a non-admin can see. A label
that is a constant everywhere it is read labels nothing. The guard now watches
for a roles array that would actually discriminate between viewers who share the
corpus — `['founder']`, `['investor', 'partner']` — which is the day the line
starts carrying information.

## D62 — The production baseline closes the fresh-build gap D60 recorded

D60 correctly recorded that replaying every numbered migration on top of the old
current-state snapshot was not a valid from-scratch build. That finding is now
superseded: `cloudflare-worker/sql/schema_baseline.sql` is derived from production,
and a new database starts there rather than from the retired loose schema files.

The fresh-build contract is now strict. The test builds the baseline and applies
every migration newer than cutoff 219; it tolerates no failure and carries no
known-failure or "other reason" lists. It still checks the five `project_id`
clauses that caught migration 039's cascade drift: `deals`, `score_snapshots`,
`documents`, `discovery_interviews`, and `roadmap_okrs` must match production,
with none carrying `ON DELETE CASCADE`.

The one-time `--bootstrap` runner mode uses the same boundary: only an empty local
or preview database may be bootstrapped, the baseline is applied once, and every
migration through 219 is recorded without being replayed. Later migrations remain
pending for the normal forward-only runner. Remote bootstrap is refused because
production adoption is a different operation with different safety guarantees.

## D63 — The baseline is the same kind of artifact `schema.sql` was, so it gets the guard `schema.sql` never had

`schema_baseline.sql` replaced `schema.sql` as the file every new database is
built from (see the D60 work and the Replit pass that landed it). It is a
production snapshot committed to the repo — which is **exactly what `schema.sql`
was**, and exactly the artifact that drifted from production for four months
while five `project_id` clauses promised an `ON DELETE CASCADE` migration 039
never applied. Being freshly dumped makes a snapshot true on the day it is
taken and says nothing about any day after.

So the fix reproduced the original bug class with a fresher file, and nothing in
the repo asserted otherwise. `scripts/check-baseline-drift.mjs` is that
assertion.

**The invariant is not `baseline == production`.** It is

    baseline + every migration above the cutoff  ==  production

and the difference is the whole design. A check demanding equality with the
baseline alone would go red the first time anyone shipped a migration, and stay
red until someone re-dumped the file by hand — a chore nobody does twice. It
would be switched off within a month and the drift would come back. What is
checked instead is the repo's whole schema story reproducing production, which
is the property that was actually false, and which stays checkable as
migrations land.

**By name, in both directions, never by count.** The first gate written for the
baseline was "the built database has 399 tables". `_cf_KV` (Cloudflare's own,
which local workerd creates itself and refuses to let a file create) and
`sqlite_sequence` are auto-created, so a dump missing two real tables while
regaining those two still reports 399. The guard builds the story in the same
SQLite engine D1 is and takes the set difference of object names — and the
object's TYPE is part of its identity, so a missing table cannot be cancelled
out by an index that happens to share its name.

**It runs after the deploy, and it is not `continue-on-error`.** A disagreement
does not make the worker that just shipped unsafe, so it must not stand between
a good build and production; but it does mean a fresh environment would come up
wrong, which is worth a red workflow. `GOTCHAS.md` already records what
`continue-on-error` did to the Semgrep job — a green check that means only that
the scan ran — and that is not a pattern to copy.

**Two things found reviewing the pass that landed the baseline**, both fixed
here rather than left:

- `migrations_fresh_build.test.ts` replaced a test recording 55 real failures
  with one that filters migrations to `> BASELINE_CUTOFF` — a set that is
  **empty today** (221 files, highest prefix 219, three prefixes repeating:
  011, 068, 118). It asserted `[] === []`. It is a forward guard that starts
  working at migration 220, which is fine, but nothing said so and it read as
  strong. `the cutoff explains the empty set` now makes the emptiness a checked
  consequence of where the cutoff sits, and refuses a cutoff past the highest
  migration — the dangerous direction, because every file at or below it is
  recorded as applied without being run.
- The guard's own `compareObjects` filtered nothing; both of its callers did.
  Correct on the real path and wrong as an exported function, which is the shape
  that breaks when a third caller arrives. It filters for itself now. That was
  caught by its own test on the first run, which is the argument for writing the
  test.

## D64 — Task #104 named the grant table; the gap was the two beside it

Task #104 read "give migration 218's grant table a writer". `advisor_client_grants`
has had a complete writer since task #82 — an `INSERT … ON CONFLICT (project_id,
advisor_user_id) DO UPDATE` at `routes/advisor_grants.ts:142`, a revoke beside it,
both reachable through `POST`/`DELETE /api/advisor-grants/:projectUid` and driven by
`AdvisorGrantSection`. Migration 218 ships **three** tables, and both of the others
were half-wired in opposite directions:

- **`advisor_client_document_shares` — a reader and no writer.** The client brief
  resolves a shared document through it; nothing in the repo could create a row.
  Three places said so in prose (`routes/research.ts`, D50, and `LibraryZone`,
  which rendered the consequence to the user) and none fixed it.
- **`advisor_client_access_log` — a writer and no reader.** The brief has been
  inserting `open_brief` rows since #82 and nothing ever read them, so the
  founder-facing record the migration describes did not exist: you could grant
  access and had no way to see whether it was used.

**The share's conditions come from the reader, not from taste.** The brief joins
`s.advisor_user_id = ? AND s.status = 'active' AND d.owner_user_id IN (SELECT id
FROM users WHERE founder_id = ?)`. A row missing any part of that can never be
read, and writing one would show the founder a document as shared that the advisor
cannot see. So a share requires the caller to own the project, the document to
belong to the founder RECORD (through `users.founder_id`, the way the brief
resolves it — not `owner_user_id = user.id`, which would disagree with the brief
for a co-founder), and the advisor to be an advisor now.

**One condition the reader cannot enforce, and the writer must: a live grant.** The
brief is reached through the grant, so a share to an ungranted advisor is written
and then invisible to everyone. The picker offers only granted advisors for the
same reason — a control that offers what the API refuses teaches the wrong model.

**Two scoping bugs found by mutation rather than by reading**, both of which passed
the whole suite first:

- Scoping the revoke to `shared_by_user_id = user.id` was untested AND wrong. Every
  case that could reach the clause was already refused by `ownedProject`, and a
  founder record can be held by more than one account — so a co-founder could see a
  share in the list and be unable to revoke it, while the grant revoke beside it is
  project-scoped. Both the list and the revoke are now scoped to the founder record.
- Dropping the share's ownership clause entirely also passed, and that one is a
  cross-tenant write: `advisor_client_document_shares` has no `project_id`, so an
  attacker naming **their own** projectUid clears `ownedProject` and only the
  share's own clause stands between them and another tenant's row. There is now a
  test that does exactly that.

**D37 is untouched.** The writer resolves a document by id and widens no namespace;
adding `research_doc` to `ALL_ENTITY_TYPES` would still publish every user's private
documents to every other user's search box, and the test asserts `routes/search.ts`
never mentions the share table.

Production is unaffected either way: `advisor_client_grants`,
`advisor_client_document_shares`, `advisor_client_access_log` and
`research_documents` are all empty, and there are zero advisor accounts. This was
built for correctness, not to unblock a live user.

## D65 — A company's KYB sits beside the account's, and `companies` does not exist

Task #108 asked whether KYB should be per-company rather than per-user. The
answer is **beside**, and D40 and D42 had already argued it twice before the
question was put: *"The account's entity is who signs your contracts; the
company's is who the workspace belongs to. They must not drift into each other."*

**What was per-user, and stays.** `corporate_profiles.user_id` is not a column,
it is the PRIMARY KEY — one row per account, structurally — and `trust.ts`
upserts it `ON CONFLICT(user_id)`. That record is the account holder's own legal
entity and it is correct as it stands. Migration 220 does not touch it, move a
row out of it, or deprecate it, and a test asserts the company write never
writes a `corporate_profiles` row: the moment it does, the two objects have
started to drift.

**What was missing.** `TrustCenterPage`'s Entity tab carried a comment saying
Trust Center v2 draws a "Your companies" card, one row per company with its own
KYB pill, and that the page states the model instead of drawing a selector that
"would have changed nothing when clicked". `ROUTE_MAP` said the same and named
#108 as carrying it. `company_kyb_records` is what makes that card honest, and it
is drawn now.

**`companies` DOES NOT EXIST ON PRODUCTION, AND THIS IS THE FINDING WORTH
KEEPING.** Migration 034 creates it. `schema_migrations` records 034 as applied
(2026-06-30 14:15:40). Measured 2026-09-08:

```
SELECT COUNT(*) FROM companies;   ->  no such table: companies
```

It is also absent from `schema_baseline.sql`, and there are **zero** references
to it in `cloudflare-worker/src/` — no FROM, no JOIN, no REFERENCES. Company
identity in this product is `company_profiles` joined through
`user_company_links`, which is what `resolveActiveCompany` verifies. So
`REFERENCES companies(id)` would have shipped a foreign key pointing at nothing,
and neither SQLite nor D1 would have said so — a REFERENCES target is not
verified until the constraint is enforced, and D1 does not enforce them by
default. It would have looked correct for as long as nobody looked. Migration
220 references `company_profiles(id)`, and a test fails the day `companies`
appears in the baseline so the choice gets reconsidered rather than inherited.

**`company_id` is NOT NULL, unlike migration 219's.** In 189/193/194 `company_id`
narrows an ownership predicate that already holds, so NULL widens harmlessly.
Here the company IS the ownership key, with no second owner to fall back on, so
a row with no company would be a KYB record belonging to nobody and readable by
whoever asked. The column refuses it at the schema, which is why
`companyKybScope` is the simplest scope in the module: membership, and nothing
else. There is deliberately **no `started_by_user_id` branch** — `esignEnvelopeScope`
and `icDecisionScope` both admit their creator because those records are about a
person's act; a KYB record is about the company, and someone who has left should
not keep reading its registration number because they filled the form in once.

**The company comes from the verified header, never from the body.** Mutation
testing found that reading `company_id` from the request body passed every test,
because no test sent one — a body field is an ownership claim the caller makes
about itself, while `X-Company-Id` goes through `resolveActiveCompany`, which
refuses anything that is not 1-15 digits and then checks `user_company_links`.
There is now a test that sends another member's company id in the body and
requires it to be ignored.

**Zero rows migrate.** Production on 2026-09-08: `corporate_profiles` 0,
`sanctions_screenings` 0, `kyc_partner_imports` 0, `company_profiles` 3,
`user_company_links` 3 (all three belonging to one account). There is no
per-user KYB row to reshape, and inventing a company KYB from an account's would
assert something nobody entered. The cost of this change only goes up from here,
which is the argument for making it while the tables are empty.

**D42's guard is untouched and still valid.** It fails the day `company_profiles`
gains `entity_id`, `jurisdiction` or `registered_address` — and this change adds
none of them, because the company's entity lives in its own table rather than
being bolted onto the profile. The guard was placed to force a reconsideration;
the reconsideration happened and reached the same answer it encodes.

## D66 — U11's guard already existed, pointed at the one directory that was clean

Task #107 asked to close U11, "390 undeclared axal-* Tailwind classes". Two
things were true that the item did not know.

**The guard it asked for did not need writing.** U11's closing line names what
would make the sweep safe to start: *"a guard that fails a NEW undeclared
`axal-*` class, so the number can only go down."*
`frontend/test/ui_design_tokens.test.mjs` had asserted exactly that invariant
since the `ui/` primitives were built — and walked only `frontend/src/ui/`,
which was the one directory with zero violations. The rule was right and the
reach was wrong, which is the same shape `chunk_reload_loop.test.mjs` records
about itself. It now walks `pages/` and `workspaces/` with a shrink-only
allowlist, and it already runs under `test:drift`: no new `scripts/check-*.mjs`,
no `package.json` change.

**The number was wrong, and so was the table.** The census counted **397
occurrences across 8 tokens in 50 files**, comments excluded. U11 lists six
tokens and misses `axal-line` (8 uses, the whole HQ shell from PRs #417/#418)
and `axal-blue` (2, `AdminPage.jsx:845`). Its `border-axal-border: 16`
double-counts: a `\b`-terminated grep for `axal-border` also matches
`axal-border-soft`, listed separately on the next row as 11. The bare count is
5, so the honest 2026-09-07 total was ~379. Three sibling docblocks disagreed
with it and with each other (~410, ~400, ~400) — what a number nobody can
re-derive looks like.

**The sweep stays open, and is bigger than U11 estimated.** Not one of the 397
call sites has a `dark:` counterpart, so declaring eight light values would flip
the entire workspace surface to light-only in dark mode. Either eight colours
get chosen in BOTH themes under D2's palette rule, or 397 call sites move to
Tailwind's own greys — a restyle across four licences needing its own render
pass. `workspaces/bucketOverview.css:45,51,57` holds the only concrete values
anyone has assigned to three of them (#4b5563 / #6b7280 / #e5e7eb).

**The allowlist may only shrink, and the test enforces that too.** A token fixed
everywhere would otherwise sit in the list forever, and the next one could be
waved through by adding a line — which is how an allowlist becomes permission.

### The same batch: Markets, Ask and Companies are live, and empty is not unbuilt

Asked to record those three Research zones as "blocked on a store", the check
found the opposite. All three sit in `ResearchWorkspace`'s `LIVE_ZONES` and each
reads a real worker route over a real D1 table. Production, 2026-09-08:

| Zone | Store | Rows |
| --- | --- | --- |
| Markets | `signals.ts` → `signals`, `market_intel_rows` | 10 and **196,956** |
| Companies | `competitors.ts` → `competitor_analyses` | **0** |
| Ask | `research.ts` → `research_documents` | **0** |

Companies and Ask are **empty, not unbuilt**; Markets is genuinely populated.
`NoStoreYet` renders "No store behind this yet", so recording the three would
have put a false sentence on the page rather than merely a stale note in a doc —
and `ROUTE_MAP.md:133` already records a version of that document calling Ask
and Library unbuilt AFTER they shipped, which read as written would have sent
someone to rebuild a shipped feature in the wrong place.

**What was actually wrong sat one layer up.** `FounderResearchDesk` printed
"Source unavailable" whenever a key was absent from `records` — and a key is
absent both while the request is in flight and after it fails. So a healthy page
said it on every card until the fetch resolved, and a store holding 196,956 rows
said it too. The `failed` list existed and only ever set one page-wide banner,
so no card could tell whether its own source had broken. It is three states now,
with three sentences, and a later success clears the failure it recovered from.

## D67 — The action builder gets a fourth kind, because one zone set could only be built outside it

`zoneActionBuilder.js` could say three things about a zone header op: `kind:
'export'` runs `exportView` over rows the page has loaded, `to:` links to a
route the licence may open, and `unbuilt:` renders nothing and records why.
Across all four profiles' 218 entries there was not one op performed by the page
that drew it.

`/validate/*` is the zone set that could not be expressed. Three of its ops open
a dialog the workspace owns (`setLogOpen`, `setHypOpen`, `setLinkOpen`) and its
three exports are **server-side** CSV downloads with a busy spinner and a shared
error line — not `exportView` over loaded rows. So `FounderValidateWorkspace`
built its own local `ACTIONS` map: the only zone header in the product outside
`founderZoneActions.js`, and therefore the only one no canvas guard could check.

**The cost was not cosmetic.** `profile_zone_filters.test.mjs` requires every
zone with a filter table to have an ACTION table for the same zone, so the four
Validate zones sat in its `excluded` list — which is why the founder profile
covered 26 of its 30 zone pages and the registry's docblock claimed that was
"ALL OF THEM". A missing word in a builder's vocabulary kept sixteen canvas
chips off the screen and made a count read as complete.

`kind: 'handler'` is that word. The table declares the op and names the handler;
the page supplies either the click or `{ onClick, disabled, busy, title }` when
it has more to say — a server-side export knows when it is in flight, a control
needing a venture knows when there is none, and neither fact can live in a
table. A handler the page does not supply **renders nothing**, exactly as
`unbuilt` does, because the alternative is a button that does nothing.

**Two guards, because the static one cannot see a browser and the runtime one
cannot fail CI.** `zone_actions.test.mjs` checks that every declared handler is
supplied and every supplied handler is reachable — a rename would otherwise drop
an op from the row and stay green — and it calls the builder directly to prove
the drop actually happens. `profile_zone_actions.test.mjs` pins the count per
profile at 6 for founder and **0** for the other three, so a second use shows up
as a change rather than as a silent spread.

### What the fourth kind is not

It is not a render prop. The page passes handlers *in* and gets a bound row
back, which is the same split D53 records for filters: the table owns which ops
the canvas promised, the page owns the state only it can hold.


## D68 — "Not recorded" belongs to the reader's data, never to the product's gaps

**2026-09-09.** Task #122, `/research/ask` — but the rule settles a tension that
runs through all seven Partner Research and Network artboards, so it is recorded
once rather than argued seven times.

### The two decisions that appeared to disagree

**D56** says a stat tile with no store behind it is **not drawn**. That rule was
itself a reversal: the tiles used to render `Not recorded` with a sentence
beneath each, and `research_canvas_strips.test.mjs` REQUIRED it. The reversal's
argument was exact — "printing the refusal INSIDE the control's own label turned
every unbuilt op into a paragraph of design-review commentary on the customer
surface" — and it has not been weakened.

**The artboards draw `Not recorded` tiles anyway.** `Pages · Partner
Research`'s Market zone opens with `Retainer rate · Not recorded · never run`;
Client prep with `Their Q4 budget · Not recorded · not in anything Verwood has
shared`. Both are the design's deliberate choice and both are on the composition
the product was asked to match.

### The distinction that resolves it: whose absence is it?

- A tile absent because **the product never built the store** is design
  commentary on a customer's screen. `Sectors covered` and `Net revenue
  retention` were that case; they are still not drawn, and their reasons live in
  `SignalsPage`'s own docblock where whoever can build the store reads them.
- A cell absent because **the reader's own record has no such fact** is a
  finding. "Verwood has never shared a Q4 budget" and "the firm has never run a
  retainer reading" are the two most actionable lines on their pages, and
  hiding either would leave a blank where a decision belongs.

So `NotRecorded` in `frontend/src/workspaces/canvasKit.jsx` is for the second
kind, and its docblock says so. The test for whether a tile may draw it is not
"is there a number" but "would the sentence be about the product or about the
reader".

### What followed from applying it to Ask

Every one of Ask's tiles turned out to be the FIRST kind — the product had no
session store — which is why the strip had been cut to a single tile on two
licences and dropped entirely on the other two. Migration 221 built the store,
and seven of the eight tiles across the four artboards became real in one
change, along with four filter chips and two ops in four tables. One tile is
still not drawn: `Follow-up cost` prices DeepSeek's cached input, and
`research_ask` routes to Workers AI Llama 3.3 70B with the task marked uncached,
so no answer this product writes is ever billed as a follow-up. It will start
drawing itself the day a cached answer is written — the tile's `value` returns
null over no rows rather than zero, because **zero reads as free**.

### Three consequences worth stating

1. **A gap card is deleted in the commit that closes its gap.**
   `RESEARCH_STORE_GAPS.ask` said "Answers are produced. Nothing keeps them."
   It went with migration 221. A gap card outliving its gap is worse than never
   writing one: it is a confident, specific, prominent claim that the product
   cannot do something it now does. The same applies to an `unbuilt:` reason —
   `ONE_ANSWER_ONLY`, `NO_ANSWER_RECORD` and `NO_SESSION_RECORD` were deleted,
   and removing `NO_SESSION_RECORD` revealed it had been covering two different
   absences under one sentence.
2. **The per-licence strip table is the shape, not a special case.**
   `SignalsPage`'s `MARKETS_STRIP` reached it first; `AskZone`'s `ASK_STRIP` is
   the second. Four artboards ask for two different sets of four tiles, and
   drawing one set on all four is matching one artboard and overwriting three.
3. **A rate is a fact and comes from the router.** The artboards quote
   `$0.440 / M in · $0.014 cached` — DeepSeek's price list, for a model this
   product does not run. `railModels.js` and D13/D16 already said a model's
   name, id and rate come from `GET /api/ai/pricing`; the metered banner reads
   it there. Matching an artboard means matching its composition, not
   transcribing a competitor's prices under our own model's work.

### The kit

`canvasKit.jsx` holds the anatomy the seven artboards share — the stat strip's
`NotRecorded`, the metered banner, the source legend, the instrument card with
its `instNote`, the pair note — because they render seven pages from one
template and only the data differs. This repo already carries three copies of
one CSV escaper that disagree with each other; seven copies of a table would be
the same mistake at seven times the size. Copy stays on the page that draws it,
where a reader comparing artboard to screen can see both.

## D69 — An invitation is a row and a hashed token; the direct link stays, on the one surface that means it

Task #121 said Company Settings should "actually invite a member instead of
linking one". The control was labelled **Invite by email** and posted to
`POST /company/:uid/members`, which resolves the address to an **existing**
account, writes `user_company_links`, and 404s otherwise. Two failures in one
button: somebody without an account could not be reached at all, and somebody
with one was joined to a company **without being asked**. The page's own
docblock said so — which was the right thing to write down and the wrong thing
to leave true.

**The store is a new table, not a status column on the link.** A pending
invitation is not a member in a lesser state: it has no `user_id` (that is the
point — the invitee may not exist yet), it has a hashed token and an expiry,
and it survives being revoked. Migration 236 gives it
`company_invitations`, FK'd to **`company_profiles(id)`** — `companies` is the
unused table from migration 034 and D65 already established which one is real.

**One pending invitation per address, enforced by the index, not by a read.**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_invitations_one_pending
  ON company_invitations(company_id, email) WHERE status = 'pending';
```

A partial unique index rather than a check-then-insert, because two clicks half
a second apart on a form with a spinner is not a hypothetical race — it is the
ordinary way people use a button that appears not to have worked. Revoked and
accepted rows fall out of the index, which is exactly what lets an address be
invited again after either one.

**The token is returned once and stored as a hash**, matching
`project_member_invitations` (`hashInviteToken`, SHA-256 hex). Consequences the
UI has to carry rather than hide:

- **Resend issues a NEW token** and restarts the 14-day clock. It cannot
  re-send the old link, because nothing stored can reproduce it. A "resend"
  that quietly did nothing would be a button that lies, so the previous link
  stops working and the control says so.
- **`email_sent: false` is a normal 200.** Every sender in `services/email.ts`
  returns `false` with no Gmail credentials, which is the state of most
  environments. The page hands the link over once, in an amber card that says
  it cannot be recovered afterwards, instead of flashing a green tick over a
  message nobody received. The row records the same fact, so the pending list
  can distinguish *sent and unanswered* from *never sent* — only one of those
  is the invitee's move.
- **Revoke keeps the row.** Deleting it would lose who invited whom and when,
  and the partial index already frees the address.

**Accept is bound to the address, not to the account.** `POST
/company/invitations/accept` compares the caller's email to `invitations.email`
and refuses a mismatch with `wrong_account` **plus the address it was for** —
without that last field the reader cannot tell which of their accounts to use,
which is the only thing they need to know. A forwarded invitation is an
ordinary thing to receive; joining the forwarder is not an acceptable outcome.
`already_member` is a **success**: somebody added directly while their
invitation was in flight has the outcome the invitation asked for, and calling
that a failure would be false.

**`api.addCompanyMember` stays.** The obvious tidy-up — delete the endpoint
that caused the problem — would break the surface where it is honest:
`CompanyProfilePanel`'s **"Add team member"** modal, which is titled *Add*, not
*Invite*, and states *"User must already have a StudioOS account."* The defect
was never the endpoint; it was one page calling it under a label describing
something else. Company Settings no longer reaches for it, and a guard asserts
that page-by-page rather than repo-wide.

**Two guards were rewritten, not deleted, and this is the interesting part.**
`frontend/test/company_settings_members.test.mjs` asserted the OPPOSITE copy:

> The add-member copy must not promise an invitation. […] A UI that says
> "invite" would be describing a feature the backend does not have.

That was correct when it was written and is the reason the honest caveat had
been there for two weeks. The rule did not change — *say what the backend
does* — the backend did. Both assertions were rewritten to hold the new truth
with the docblock explaining the flip, because a guard silently deleted the
week its premise changes is how a codebase loses the reason it was ever
careful.

## D70 — The support ledger is the one gap this series built rather than reworded, and its write is not admin-only

Six investor zones were audited the same way in September 2026: read the schema
before trusting the sentence on the disabled control. Five of the six
`unbuilt` reasons turned out to be false — a scoring run that *was* stored
(ID2), a vote that *could* be closed two lines from the button that said
otherwise (ID3), closing templates that *did* include the SAFE (ID4), a mark
history *already being served* to the same reader (IP1), a KPI rule set
arriving on every page load and never rendered (IP2).

**IP3's three reasons were true, and that is why this one is a migration.**
`/portfolio/value-add` said no support ledger existed. Every table joining an
investor to a company records the investor **gaining access** to one:

| Table | What it actually records |
| --- | --- |
| `investor_introductions` | an investor **requesting** an intro to a founder, against a paid quarterly quota. `status` is written `'pending'` by the one INSERT and updated by **nothing** in the worker; `_investorProjectScope` unions it with dealroom membership to decide which projects an investor may *see*. |
| `intro_propositions`, `intro_credit_ledger` | the Network peer-matching engine and the credits spent accepting a match. |
| `investor_dealroom_members`, `deal_invitations`, `data_room_grants` | three more ways in. |
| `engagements`, `engagement_hours` | a **partner's** paid delivery — born of a need and a quote, carrying a price. |

Reading any of them as value-add would relabel access, matching, or billed
consulting as support given. The licence axiom is invest in **and support**
companies; the artboard's own words are that this desk is *"where the second
half becomes auditable"*, and it could not be without somewhere to write.
Migration 237 adds `portfolio_support_entries`.

**`state` defaults to `'promised'`, and delivering is a write.** The artboard is
explicit that *"an intro offered in June and never made is worse than one never
offered, and only a record shows the difference"*. A ledger of completed work
would lose exactly the fact worth keeping. `PATCH /portfolio-support/:uid` is
therefore not a convenience: without a transition the column would freeze at
`promised` precisely as `investor_introductions`'s does, and this table would
reproduce the defect that disqualified it. `'withdrawn'` is a real terminal
state so a promise can be retired honestly rather than left pending forever or
quietly re-labelled delivered; both destinations are terminal, and re-opening
one is a 409.

**`hours` is nullable and NULL is never 0.** Most support is not timed. The read
returns the recorded sum **and** `entries_without_hours` beside it, the tile
reads "Not recorded" rather than "0 h" when nothing was timed, and the AI
instruction refuses to fold the untimed entries into a total (D56/D68).

**The write is open to an investor, unlike every other write in the Portfolio
bucket.** `routes/positions.ts` gates all four of its writes on `requireAdmin`,
correctly: a mark changes what an LP is told a position is worth, which is a
governed assertion. A support entry is not a valuation — it is a record of what
a person did. An admin-only ledger stays empty, because the people doing the
work cannot write to it, which is the state IP3 was already in. So an investor
may log against a project **already in their own accessible book**, checked
against the same `investorProjectIds` scope as the read, and nobody gains a
project they could not already see. `cloudflare-worker/test/portfolio_support_scope.test.ts`
drives that gate against real SQLite rather than asserting it from source text.

**A company counts as supported only from a recorded entry.** The third of the
three original reasons stayed true after the store landed, so it became a rule
instead: "no support at all" is an anti-join between the ledger and
`portfolio_positions` — two stored sets compared — never the ledger's silence
read as an answer, and never inferred from an update, an introduction row, or
book membership.

## D71 — The renewal rate decides the engagement store's shape: two verbs own the three columns it reads

Migration 238 adds `advisor_engagements` for Practice · Engagements. Unlike the
five-of-six false `unbuilt` reasons the investor series turned up (D70), **all
four claims on this zone were true**, and the schema check is why:

| Table read | Why it cannot answer |
| --- | --- |
| `engagements` | the **partner** licence, and unusable rather than merely wrong: `need_id` and `quote_id` are NOT NULL and `quote_id` is **UNIQUE**, so an advisory relationship needs a fabricated need *and* a fabricated quote that cannot even be reused twice; `price REAL NOT NULL` contradicts the artboard's own equity client; `partner_id`/`founder_id`/`project_id` are all NOT NULL and there is no advisor column. It is also defined twice, which drags in `check-migration-column-shapes.mjs`. |
| `partner_retainers` (208) | the right **shape**, the wrong owner — keyed `engagement_id REFERENCES engagements(id)`, unreachable from an advisor. Its `shape`/`renews_at`/`ended_at` are copied rather than reinvented. |
| `partner_engagement_health` (232) | `scope_state`/`scope_note`, also keyed on `engagements(id)`, and carrying no renewal decision or cycle count even for partners. |
| `advisor_client_grants` (218) | has `status` and `expires_at` and looks reusable. It is **data-room access**. Reading `expires_at` as a contract term is exactly the mislabel D70's table warns about. |
| `advisor_state` (048) | the name is a trap: `(user_id, question_id, last_asked_at, answer_count)`, the AI advisor's question cadence. |

**A renewal decision and a cycle count exist nowhere in the product** — not even
on the partner side. Those two are genuinely new rather than ported, and
everything the artboard calls "Only here · the number that judges a practice"
is computed from them.

**That is why the write surface is four verbs and not one PATCH.** `lane`,
`cycles` and `outcome` are the rate's whole input. A merge-PATCH over all three
would let a caller assert `outcome = 'renewed'` with no cycle behind it, or
clear a cycle with no decision, and the instrument would report whatever the
last writer typed. So the descriptive columns merge freely through
`PATCH /me/engagements/:id`, and those three move only through
`POST …/advance` (a lane) and `POST …/renewal` (a decision).

**Signed → ended is refused on `/advance`, with a 409 naming `/renewal`.**
Ending a signed contract *is* the renewal decision that did not go the advisor's
way; routing it through the lane verb would drop it out of the denominator —
the failure the canvas names outright: *"a rate that excludes its failures is
not a rate."* Ending an **unsigned** row is allowed there and records no
outcome at all, because an abandoned draft never had a renewal to lose. That
asymmetry is the store's central rule, and
`cloudflare-worker/test/advisor_engagements_scope.test.ts` drives both halves
against real SQLite.

**Three consequences of reading the canvas fixture rather than the artboard
markup**, each of which changed the schema after the first draft:

- **`cycles` counts terms RUN, including the one in progress.** The fixture is
  explicit — "Fifth cycle" at `cycles:5`, "First cycle ending" at `cycles:1` —
  so signing sets 1 and each renewal adds one. The renewal history lists every
  row with `cycles > 0`, which is every engagement ever signed; an unsent draft
  is the only thing 0 leaves out. An earlier draft of the migration had this
  backwards, counting renewals *behind* a row.
- **`proposed_at` exists because a proposal card reads "Sent Aug 21".** Folding
  that into `started_at` would file the day terms went out as the day the work
  began. Three stamps, one per transition, plus `term_ends_at` — which serves
  both "Renews" and "Ends", because which one it means is `lane`'s job.
- **There is no `end_reason`.** The first draft had one, reasoning that "they
  hired in-house" and "wrong fit" are different kinds of ending. The fixture
  settles it the other way: both arrive as one sentence, the artboard draws
  exactly one Note column, and a second field would have had no reader.

**`outcome` is NULL until a row is signed, which diverges from the fixture on
purpose.** That fixture stamps `outcome:'Active'` on an unsent draft and its own
comment calls the field "the placeholder outcome field", routing the Active tile
around it. A stored value the artboard has to work around is the wrong default;
here an unsent draft cannot reach the rate's denominator at all. The Active
tile therefore counts **lanes**, not outcomes — a renewed contract is the most
active thing on the board and its outcome is `'renewed'`, so an outcome filter
would report 2 of the canvas's 5.

**`amount_cents` is nullable and has its reader on another artboard.** PR5 ·
Earnings carries a per-client `retainer` figure beside a session count
(Meridian: 13500 over 6 sessions), and that cannot come from
`advisor_bookings.amount_cents`, which is the per-session column already
occupying the other half of the same row. `shape` is load-bearing across the
same seam: Earnings excludes the equity client **by design**, because a cash
gross cannot span a client who bills no cash, and without a stored shape it
would have to guess which to leave out. NULL means nobody recorded an amount,
never zero (D56/D68) — and `renewal_rate` is NULL before the first decision,
because a practice that has not reached a renewal has not failed to renew.

**No lazy bootstrap, and that is the rule rather than an omission.**
`GOTCHAS.md` ties `services/advisorStoresSchema.ts` to **ALTER** migrations:
they are flagged non-idempotent and *recorded-without-running* by a `--baseline`
adoption. 238 is pure `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
EXISTS`, so the runner applies it for real; mirroring it into the bootstrap
would also break `advisor_stores_bootstrap.test.ts`, which holds the healed
schema equal to migrations 201–206 exactly. Migration 237 is the precedent —
same series, same shape, no bootstrap.

**The board advances by control, not by drag.** The canvas labels it "By
contract state · drag to advance". A per-card control is keyboard-reachable
without a drag-and-drop implementation to make accessible, and the state change
it writes is identical. Recorded here rather than passing silently.

## D72 — A receipt the sender can set is not a receipt: the deliverables store is split across two licences on purpose

Migration 239 adds `advisor_deliverables` and `advisor_deliverable_versions` for
Practice · Delivery, whose blurb is the whole requirement — *"Every work
product, every version, and whether anyone opened it."* Three of its four tiles
are open receipts (Unopened, Median to open, Never opened), and that is what
makes this store unusual: **the thing it most needs to record is not the
advisor's to say.**

**All four "no store exists" claims held**, unlike the six-zone investor audit
where five were false (D70). Every candidate was read:

| Table | Why it cannot answer |
| --- | --- |
| `advisor_client_document_shares` (218) | the right two nouns, the wrong direction. `shared_by_user_id` is the FOUNDER, and the row's document must satisfy `owner_user_id IN (…founder…)` — it can only record a founder offering their own file to a named advisor. |
| `advisor_client_access_log` (218) | not merely pointed the wrong way — structurally incapable. `advisor_user_id` is its **only** actor column, and its own header calls it "the founder's own record of an advisor's reading". There is no slot in which a client open could be written. |
| `research_documents` (213) | fourteen columns, never once ALTERed. Its `kind` labels subject matter rather than naming a client, and `indexed_at` is the Vectorize stamp. 213's header pre-declares the boundary. |
| `engagement_deliverables` (208) | **exactly** the right columns and the wrong licence — single FK to `engagements(id)`, which D71 already documents as unreachable from an advisor. Its column design is copied; its ownership is not. |
| `deliverable_snapshots` / `company_week_status` | the name is the trap. Keyed `(user_id, cohort_cycle_id, week_number, deliverable_key)` — the founder's cohort week homework, no advisor column. |

All twenty `advisor_*` tables were then swept three ways — a column grep, an
ALTER grep, and a whole-tree column inventory. **Not one** carries a version, a
sent stamp, an opened stamp, or a work product the advisor owns.

**THE SPLIT. Migration 208's header states the rule this store inherits:**
*"`opened_at` and `signed_off_at` are the CLIENT's to set. Only the founder side
can truthfully say a thing was read, so a partner-side write to either would be
the firm reporting a metric about itself."* So no ADVISOR route writes either
column; the founder side does. **This paragraph named the wrong file for it —
`routes/advisor_grants.ts` — and D73 corrects that**: no grant is involved, the
relationship carrying a deliverable is the engagement, so the client's two routes
live beside the founder-facing half of `routes/advisors.ts`. The test asserts this
**against the SQL** — every
`UPDATE advisor_deliverable_versions SET …` clause and every `INSERT INTO
advisor_deliverable_versions (…)` column list — rather than against behaviour,
because the failure mode is someone adding a convenient `SET opened_at = ?`
years from now, and because the module's own comments and DTO name the column
constantly, so a blanket ban on the string would fail against correct code.

**SENDING REQUIRES A CLIENT WITH AN ACCOUNT, and this is the rule that makes the
receipts trustworthy rather than merely sincere.** It falls straight out of D71
keeping `advisor_engagements.founder_user_id` nullable so a contract can name a
company that has not joined. A version sent to a client who cannot sign in can
never be opened by anyone, so it would sit in `unopened` forever, inflate
`never_opened`, and quietly bias `median_to_open_hours` toward whichever clients
happen to be linked. Creating and versioning stay open to any client — a draft
needs no counterparty — and only the send demands one, with a 409 that names the
consequence and not just the rule. `addressable` is reported beside `unopened`
for the one case the send rule cannot prevent: an engagement unlinked *after* a
send, which leaves a row that went out and can never be nudged.

**Two tables, because a work product has many versions**, which the artboard
proves twice: each list row carries a latest version *and* a count ("v4", "4
versions"), and the trail card lists four versions of one deliverable with a
different note against each. One table grouped by title would break on a rename.

**`version` is an INTEGER here and `TEXT` in 208** — the one place this
deliberately diverges from the shape it copies. A trail has to be ordered and
`'v10'` sorts before `'v2'` as text. The artboard's own "v2 draft" is a label
rather than an ordinal, so it gets its own column and the number keeps the order.
`UNIQUE (deliverable_id, version)` turns a lost race into an error instead of two
rows both calling themselves v3; the route reads `MAX(version) + 1`, so that
constraint is the only place the protection actually lives, and the test asserts
it directly against the migration-built schema rather than trying to stage a race.

**Every stamp lives on the version, not the work product.** The artboard's trail
marks only v4 "Aug 19 · sent", and its Verwood row reports "Not opened in 4 days"
against one version. Sending and reading happen to a version; a work product is
the thing they happen to.

**There is no `state` column, and that absence is load-bearing.** Not started /
Sent / Opened is entirely determined by which stamps exist, so storing it would
be a second source of truth that drifts the first time a write half-fails —
precisely the defect that disqualified `investor_introductions` from being read
as a ledger (D70): a status column written once by its only INSERT and updated
by nothing.

**`Median to open` is a real measurement here**, unlike Opportunities' median
(D68's case), where no `decided_at` existed and the tile correctly reported
nothing. Both stamps are real, so the figure is computed — **on the FIRST open of
each work product**, because a second version read a month later says nothing
about how fast the work reached its reader and would drift the tile upward every
time a client revisits something old. A reversed pair (`opened_at < sent_at`,
which clock skew and a bad backfill both produce) contributes no duration at all:
a tile reading "−3 h to open" is worse than one reading nothing. And null before
the first open is never 0 — nothing opened yet is not "opened instantly".

**`Never opened` takes no arbitrary threshold.** It counts sent versions whose
work product has never been opened at all, and the note names the oldest — which
is what the canvas's own note does ("Verwood board brief, Aug 22"). A day count
would have been a rule nobody agreed to.

**The AI band is not built, and its premise is false at the first clause.** The
artboard draws a consent-gated batch summariser whose foot note says the gate
working *is* the feature. Nothing in this product records that an advisory
session was recorded, captures consent to record one, or holds a transcript of
one: `advisor_bookings` has thirteen columns and one ALTER ever (205, money).
The two stores with the full recording→transcript shape belong to other people —
`reference_checks` is investor deal-diligence and has been hardcoded 501 since
T13, and `discovery_interviews` is the founder's own customer-discovery work,
walled off by `canWrite` (owner-or-admin), by the absence of any booking→project
join, and by an R2 prefix check. `advisor_proof_consents` is attestation consent
over a claim about past work, with no audio, no transcript and no booking link;
reading it as recording consent would be inventing the recording. Building the
band needs five pieces — columns, consent capture, an audio MIME allowlist and
R2 prefix, a transcribe route, a summarise route — and the schema supplies zero.
The zone says that rather than drawing a dead control.

## D73 — The receipt is the client's to give, and the link that makes one possible is chosen rather than typed

D72 built the deliverables store and refused every advisor-side write to
`opened_at`. This is the other half: the two routes that let the founder record
having read something, and the one finding that had to be fixed first.

**THE CHAIN WAS DEAD, AND ONE GREP PROVED IT.** D72's send rule refuses a version
whose engagement has no linked client account. Nothing in the product set that
link:

| Link in the chain | State before this decision |
| --- | --- |
| `POST /me/deliverables/:id/versions/:v/send` | 409 unless `advisor_engagements.founder_user_id` joins to a real account |
| writers of `founder_user_id` | `POST /me/engagements` and `PATCH /me/engagements/:id`, both through `engagementClientUser` |
| UI that sets it | **none** — one mention in the whole SPA, `DeliveryZone.jsx` rendering the read-only label "(no account — cannot be sent)" |

So every engagement in production carried NULL, every send 409'd, nothing could
ever be opened, and a founder surface shipped on its own would have been
structurally empty for ever. **A rule with no way to satisfy it is not a rule, it
is a wall** — and PR3a built one without noticing, which is why this series keeps
re-checking its own claims and not only the schema's.

**THE RELATIONSHIP IS THE PERMISSION.** `engagementClientUser` used to accept any
existing `users.id`, which was wrong in both directions at once: an advisor has no
way to learn another account's numeric id, so the column was unusable by a human;
and an advisor who guessed one could attach a stranger to their own contract and
then open a message thread with them through Delivery's nudge. It now requires one
of two facts the product already records — the account has **booked** this advisor
(`advisor_bookings`), or it holds an **active grant** to them (`advisor_client_grants`,
migration 218). Neither can be manufactured by the advisor alone. An unrelated
account resolves to `null`, exactly as a dangling id always did, so the engagement
keeps its client NAME and simply stays unsendable: one rule, one outcome, and no
new error path. The control on Engagements offers precisely that set, following
`DocumentShares`' own reasoning — *"offering an address the API would refuse is
how a control teaches the wrong model."*

**THE TWO ROUTES ARE IN `routes/advisors.ts`, NOT `routes/advisor_grants.ts`, and
D72's forward-looking sentence saying otherwise was wrong.** It read "the founder
side does, through `routes/advisor_grants.ts`", written before the founder side
existed. The schema settles it: **no grant is involved.** The relationship that
carries a deliverable is the ENGAGEMENT, so a grant-scoped route would hide every
work product from a founder who never opened a record — which is most of them.
`advisors.ts` already holds the founder-facing half of this router (`/`, `/match`,
`/:uid`, `/:uid/slots`, `/slots/:id/book`, `/bookings/:id/*`), so
`GET /received/deliverables` and `POST /received/deliverables/:uid/open` join it
there.

**SENT VERSIONS ONLY, and that is a privacy rule rather than a filter.** A version
with no `sent_at` is the advisor's work in progress; a client who could see it
would be reading a draft that was never handed over, and a client who could *stamp*
it would make `median_to_open_hours` measure an interval that never happened. A
work product whose every version is unsent does not appear at all.

**FIRST OPEN WINS, ENFORCED IN SQL.** The UPDATE carries `WHERE … AND opened_at IS
NULL`, so the guarantee is a property of the statement rather than of the
handler's control flow: a founder reloading cannot move the stamp and two
concurrent opens cannot race. The second call is **not** a 409 — reading something
twice is not an error — it returns the row with the original stamp. The receipt is
therefore a first-read time, and the advisor's median measures the wait that
actually happened.

**404, NEVER 403**, for a version under someone else's engagement: the scope is a
join, and comparing after the load is what makes another client's row
indistinguishable from one that does not exist. The same join refuses the ADVISOR
on this route, so the store has exactly one writer of `opened_at` and it is the
person who read the thing.

**The invariant test got stronger rather than looser.** It asserted "no route in
`advisors.ts` writes `opened_at`"; it now splits the file at the client's handler
and asserts that the advisor's half writes neither stamp, that the client's half
has exactly one write, and that the write carries the `opened_at IS NULL` guard.

**`signed_off_at` still has no writer, deliberately.** 208 names it alongside
`opened_at` as the client's and 239 carries the column, but no artboard draws a
sign-off and no page renders one — so a control would save a fact nothing reads.
The founder's card says so rather than leaving the gap silent, and the test holds
the column unwritten on both sides.

## D74 — A remote call has three outcomes, not two: nothing in the auth path may await one without a deadline

**2026-09-12. Sign-in stopped working, and the reason was that nothing had
failed.** Two reports minutes apart: *"The server did not respond within 30s.
Nothing was changed"* — the SPA's own message, from
`frontend/src/lib/api.js::timeoutError`, because the worker never answered at all
— and, separately, that **Continue with Google had disappeared from `/login`**
while the card still read "Google, passkey, and authenticator codes are also
available."

Two reads of the production D1 bounded the problem before any code was touched:
`magic_link_tokens` held four rows, newest **2026-08-03**, and the attempt wrote
none — so the request never reached the INSERT that is the *first* thing
`/magic/start` does after its gates. `users` was current to 2026-09-09, so D1 was
reachable and writable. Every `cloudflare-worker-deploy` run was green. And
`checkRateLimit` fails **closed**, which returns a 429 in milliseconds, not a
thirty-second silence. What remained was the shape of the gates themselves.

**A REMOTE CALL CAN SUCCEED, FAIL, OR NEVER ANSWER, and this codebase had
carefully handled the first two everywhere.** `rateLimitMiddleware` catches a KV
error and takes the bucket's declared policy — fail-open by default, 503 for the
abuse-prone buckets. `checkRateLimit` catches and denies. `turnstile` returns
`false`. `auth_google` falls back to the binding cookie. Every one of those
branches was already written, already reviewed, already right — **and unreachable
the entire time the call was pending**, because a stall throws nothing. The bug
was not a missing error path. It was an unreachable one, and that is a category
that no amount of care inside the `catch` can fix.

**So every await on that path is now bounded**, and the bound is expressed in
whichever way the call admits. `fetch` takes an `AbortSignal`, so it gets
`AbortSignal.timeout(ms)` directly: fifteen of them, across `services/email.ts`
(12), `services/email/gmail.ts` (2), `services/turnstile.ts`,
`routes/auth_google.ts`'s token exchange and `middleware/cfAccess.ts`'s JWKS
read. KV and D1 cannot be cancelled at all, so they get `util/deadline.ts` —
`withDeadline(work, ms, label)`, a race that stops *waiting* without pretending
to stop the work, swallowing the straggler's later rejection so it cannot surface
as an unhandled rejection after the response has gone. It **throws**
`DeadlineExceeded` rather than returning a sentinel, precisely so the `catch` that
already implements the policy covers the stall too and there is no second branch
to keep in step with the first.

**A stall condemns the namespace for the whole request, not just one bucket.**
Several buckets match a typical path — a specific one plus the global 1000/min
burst — and a per-call deadline would otherwise be paid again for each, turning a
2s stall into 6s on the one route where the budget is 30s and already shared with
two more limiters and a schema bootstrap. So the matching buckets are resolved up
front; on a `DeadlineExceeded` the request is decided from what the **remaining**
matching buckets declare. Reading them all is what keeps the posture exact: a
fail-open bucket early in the list cannot smuggle a request past a fail-closed one
later in it.

**`/magic/start` no longer makes sign-in wait on Gmail.** The token row is
committed before the mail goes out, so the link is valid whether or not Google's
API answers — and the 202 says only "a link is on its way", which is true the
moment the row exists. Awaiting the send made *the availability of sign-in equal
to the availability of Gmail*: two bounded fetches at ten seconds each, on top of
the limiters and the bootstrap, is already past the thirty seconds the browser
waits. The send moves to `c.executionCtx.waitUntil`, keeping its `catch`, because
a failed send must still be logged.

**`ensureAuthBlockersSchema` was a cheap bootstrap and an expensive stall.**
Eleven sequential D1 statements sit in front of `/magic/start`; on a migrated
database every one is a no-op that still costs a round trip, and the memo landed
only on success — so a slow D1 made *every* request re-run all eleven and wait
again. The failure compounded instead of degrading. It now shares one deadline and
sets a 60s cooldown when it blows it. It is explicitly best-effort: a route that
needs one of those tables still has its own `try`/`catch` around the statement
that touches it, and that is what reports a genuinely missing table.

**A KV OUTAGE IS NOT THE USER'S FAULT, AND MUST NOT BE REPORTED AS THOUGH IT
WERE.** `checkRateLimit` returned a boolean, so a KV failure and a real limit hit
were the same answer, and both reached the browser as *"Too many requests. Please
wait a minute and try again."* — advice that would never come true, sending
someone away to wait on a queue that was not the problem. It now returns
`'allow' | 'deny' | 'unavailable'`; all nine call sites render the third as a
**503** with `code: 'rate_limiter_unavailable'` saying the limiter is what failed,
and `/magic/verify`, which answers with a redirect rather than JSON, bounces
`?magic_error=limiter` with its own copy. The fail-closed posture from audit M1 is
unchanged — the request is still refused — only the reason is now true.

**The same rule holds on the client, and this is why the outage looked cosmetic.**
`LoginPage` probes `/api/auth/google/start` on mount and rendered the button only
if the probe resolved. The probe was hanging, so the button vanished — under a
sentence that still promised Google. That is **D56/D68 in its user-facing form: a
promise with no control under it**, and it is worse than a blank space, because a
blank space makes someone look for another way in while a promise makes them look
for a button that is not there. The same sentence also promised a passkey on every
browser without WebAuthn, and the collapsed toggle named one too. Three changes:
the probe is a **tri-state** (`'probing' | 'yes' | 'no'`), because a boolean
initialised `false` cannot tell "not asked yet" from "the server said no" and both
rendered as silence; the sentence is **derived** from the same conditions that
render the controls, so anything named is offered and anything offered is named;
and a refused probe leaves a **stated absence** where the button was, saying that
the server did not confirm it, that it may be either unconfigured or unanswering,
and which ways in still work.

**The probe gets its own six-second deadline, and rendering is what found that.**
Source assertions all passed while the browser showed, for the hanging case, a
silently shorter list of options and no note at all — for the full thirty seconds
of the module default. A probe whose only job is to decide what the page may
*claim* must not be allowed to leave that claim pending, so `api.googleStartUrl`
now forwards a `timeoutMs` and the probe passes a short one. The real click keeps
the default: a person who chose Google should not inherit a probe's budget.

**What this decision does NOT claim.** Converting a silence into a named error is
not the same as proving the outage is gone. The stall was never reproduced against
production — this sandbox has no egress — and the middleware remains the leading
explanation rather than a confirmed one, on the strength of a falsifiable
prediction: **`/api/auth/me` is exempt and kept answering; `/api/auth/magic/start`
and `/api/auth/google/start` are not exempt and both failed.** Two curls and one
`wrangler tail` settle it. Exempting those two paths would also have hidden the
symptom, and that is the wrong fix — `/magic/start` carries its own stricter
per-IP and per-email limiters and must keep them — so
`cloudflare-worker/test/auth_path_bounded.test.mjs` pins them as **not** exempt,
alongside its scan for a bare `fetch` or an unbounded KV await anywhere on the
path, and live tests that run the middleware against a namespace whose promises
never settle and require an answer inside the deadline, with the bucket's declared
policy.

## D75 — Money already moves through Axal; the advisory practice gets the model the wellbeing directory has had all along, recorded before it is charged

**2026-09-12.** Practice PR5 asks for a page (D4, Earnings) that draws a
platform cut, three payout-account states that gate charging, a payout history
and a 1099 summary. The codebase appeared to forbid all four. Migration 205's
header reads, in capitals, **"RECORD ONLY. NO MONEY MOVES THROUGH AXAL"**;
`EarningsZone.jsx` shipped the sentence *"Axal … does not take a cut, and holds
no money on your behalf"*; and `templates/legal/advisor_program_terms_v1.md` is
marked **DORMANT** — *"the take-rate and payout sections below describe
functionality the platform does not yet execute. Do not publish or send while
payments remain off-platform."*

**Reading the code rather than the comments changed the decision.** Money has
moved through Axal since task #4. `services/wellbeing/bookings.ts` creates a
Stripe **destination charge** with `application_fee_amount` and
`transfer_data[destination]`, settling to an expert's connected account;
`routes/wellbeing.ts` runs the full Connect **Express onboarding**
(`/accounts`, `/account_links`) and an account-status refresh that writes
`charges_enabled` / `payouts_enabled` back to `experts`; `expert_bookings`
already stores `application_fee_cents` per line; and the platform's shipped
default application fee is **15%** (`DEFAULT_APPLICATION_FEE_PCT`), overridable
per expert and by `EXPERT_APPLICATION_FEE_PCT`.

So 205's sentence was **true about its own column and false as a statement
about the platform**, and it had been read as the latter. It stays true of
`advisor_bookings.billing_state`, which nothing here turns into a transaction.

### The decision

1. **Build the money model as drawn**, over the advisory practice's own tables.
   Migration 241 adds `platform_settings` (one typed platform number, seeded
   `advisor_take_rate_bps = 1500`), `advisor_payout_accounts` (D4's three
   states with the gate each implies), `advisor_payouts` (the audit trail), and
   two columns on `advisor_bookings`: `platform_cut_cents` and `take_rate_bps`.
2. **Beside `experts`, never inside it.** `experts` (052) is the WELLBEING
   directory, matched by `services/wellbeing/match.ts`; writing an advisor
   there would put an advisory practice in the wellbeing match pool. 240 built
   beside it for the same reason. The *column design* is copied deliberately —
   `provider_account_id`, `charges_enabled`, `payouts_enabled` do the same job
   under near-identical names — because a second vocabulary for the same three
   facts is how two halves of a product come to disagree.
3. **15% is the platform's existing default, not a canvas fixture.** D4's
   `CUT = 0.15` is a mock; that it matches `DEFAULT_APPLICATION_FEE_PCT` is
   what makes it the right seed. It is **admin-configurable** —
   `PUT /api/admin/platform/take-rate`, super-admin only, audited with the
   previous value in the row, clamped to 0–50% for the same reason the
   wellbeing fee is.
4. **Basis points, integer cents, floor.** `cut = floor(gross × bps / 10000)`,
   so `gross − cut = net` closes exactly per line and in every total. Floor
   rather than round because a rounded cut can exceed the stated percentage by
   a cent, and a fee the terms do not describe is a fee somebody can dispute;
   rounding down can only favour the advisor.
5. **The rate is stamped on the line, not only in the setting.** This is what
   makes the setting safe to change: an operator moving 15% to 12% must not
   restate a quarter an advisor has already reconciled. `totalLines` prefers
   the line's own rate and falls back to the current one only for rows recorded
   before 241.
6. **The total is the sum of the line cuts**, never the rate applied to the
   gross total — D4 says so itself (*"The cut is charged per line, not netted
   at the bottom"*), and the two differ by up to a cent per line. A table whose
   rows do not add to its total is the most corrosive thing a ledger can do.

### What is recorded and what is charged are different, and the difference is rendered

**Advisory charging is off.** `services/advisorMoney.ts::settlementMode()`
answers `'none'` unless `ADVISOR_CHARGING_ENABLED` is set *and* a Stripe key is
present, and it reads production through `util/paymentMode.ts` rather than a
second, looser test. Every money response carries `settlement`, and no surface
may render a cut as a charge while it says `'none'`. PR5b wires the advisory
service leg to **test keys** with production charging behind that flag;
`advisor_program_terms_v1.md` stays **DORMANT** until counsel clears it, and
its `{{advisor_program.take_rate}}` placeholder now has exactly one source —
the setting the ledger charges from — so the document and the ledger cannot
disagree about the number.

**The two contradictions are retired here rather than left standing.** 241's
header supersedes the platform-wide reading of 205's (205's own text cannot be
edited by a later migration, and rewriting history in place would hide that the
position changed). `EarningsZone.jsx` no longer denies a cut it now records:
it states the rate, states that nothing has been charged under it, and derives
both from `settlement` so that flipping the flag changes the sentence rather
than leaving a stale one behind.

### What this does not decide

Whether advisory charging *should* go live. That waits on counsel clearing the
dormant terms, and the flag ships off. Nor does it reopen migration 175's
payout ledger: 175's table paid platform credit under a rewards scheme, and
`advisor_payouts` records money settling from a client's card to an advisor's
connected account — same noun, different transaction, which is why every row
here carries a `provider_payout_id` that can be reconciled against the
processor.

## D76 — Trust Center v2's month-over-month delta gets a real history, and its "needs action" split cannot be copied from the canvas

**2026-09-12.** Task #148 asks for `/trust` to match
`design/canvases/integrated/Trust Center v2.dc.html` (T2: v2 supersedes v1).
Two of its score-panel elements cannot be built as drawn, for opposite
reasons — one has no data behind it, the other has data that means something
different here.

### The delta had nothing behind it

The canvas prints a month-over-month move under the ring, backed by
`PREV_SCORE = { founder: 47, investor: 58, … }` — a literal keyed by role —
and, when a role is missing from it, falls back to `prevScore = score` and
renders **"Unchanged from last month."** No score history existed anywhere in
the repo, so shipping that fallback would tell a brand-new account its score
held steady across a month it did not exist for. D56/D68: an absence is
stated, never rendered as a plausible zero.

**Decision: migration 243 adds `trust_score_snapshots`, written by the worker
on read.** `GET /trust/me` calls `recordAndCompareScore`, which does an
`INSERT OR IGNORE` keyed on `(user_id, captured_month)` and then reads the
most recent **earlier** month. No cron: the row is stamped by the first visit
in a calendar month, which is also what makes the comparison meaningful — the
snapshot is what the score WAS when the month was first observed, and a later
visit that month must not move it.

Three consequences worth stating:

- **The worker computes the score, not the client.** A history a caller can
  set is not a history. The rule therefore exists twice — `trustScoreOf` in
  `services/trust.ts` and `computeTrustScore` in `lib/trustCenter.js` — because
  production code never imports across the `frontend/src` ↔
  `cloudflare-worker/src` line in this repo. `test/trust_score_parity.test.ts`
  imports and RUNS both over shared fixtures; asserting the two files merely
  look alike would pass the day someone edited one into agreement with itself.
- **No history returns `null`, and the page says so** rather than drawing a
  zero delta (`NO_HISTORY_NOTE`).
- **The month is named** ("since May 2026"), because "last month" is false for
  a reader who last opened the page five months ago. `captured_month` is a
  calendar LABEL and is formatted by splitting on the hyphen — `new Date('2026-09')`
  is midnight UTC and renders as August for every reader west of Greenwich.

### "Needs action" is a different question from the pill's colour

The canvas splits its obligation counts with its own `toneOf`: neutral + bad
is "needs action", `prog` is "in progress". That works **in its vocabulary**,
where the fixtures carry `'Pending'` and `'Not started'` as separate statuses.

`legal_obligations` has no `not_started`. Its untouched state **is** `pending`,
and `POST /obligation/:key/start` transitions `pending → in_review`. Copying
the canvas's split — `STATUS_TONE.pending` is the amber `prog` tone, correctly,
because amber means "wants attention" — made the page tell a reader with three
untouched obligations *"3 in progress — nothing needs action from you."*

**Decision: `waitingOn(status)` in `lib/trustCenter.js` answers the separate
question** — `'you'`, `'us'` or `'settled'` — and `outstandingCounts` is the
single derivation both Overview sentences are built from. An unrecognised
status answers `'you'`: telling someone nothing is required of them when
something is, is the harmful direction.

The two sentences stay distinct (`scoreLine` totals the open work,
`obligationSummary` splits it) because they sit inches apart in the v2
two-column Overview, and the column previously repeated the panel's verdict
verbatim.

### The envelope timeline is real — and it ships less than it reads

The canvas's third score-panel-adjacent element is a per-agreement accordion
drawing `Sent → Viewed → Signed` with a dot per step. Unlike the delta, this
one needed no new store: `routes/esign.ts` has appended `envelope_created`,
`envelope_viewed` and `envelope_signed` to `esign_audit_events` since the
append-only trail replaced the `audit_log` JSON blob. All three steps the
canvas draws are events the signing flow really writes.

`GET /trust/agreements/:envelope_uuid/history` serves it, fetched on expand
rather than folded into `/agreements` — that endpoint already returns up to
200 pairwise rows, 100 pending envelopes and 100 documents, and almost none
of them are ever opened.

Four decisions inside it:

- **`ip`, `ua`, `signer_email` and `meta` never leave the worker.** They are
  on every audit row. A counterparty's IP address is not part of what the
  canvas draws and not something a status page has any reason to disclose;
  the full trail stays with admins at `GET /api/legal/esign/:id`. The SELECT
  asks for `action, ts` and nothing else, and the test reads the SQL rather
  than the intent.
- **404, not 403, for a non-recipient** — `/my_signing_url` already refuses
  to confirm an envelope exists and this must not become the oracle that one
  does. The service returns `null` (not a recipient) distinctly from `[]`
  (yours, nothing recorded), and the route maps them to different answers.
- **Consecutive repeats collapse with a count.** A three-party envelope logs
  `envelope_viewed` once per party, and since `signer_email` is withheld the
  rows cannot be told apart on the page. `Viewed ×3` hides nothing and reads;
  three identical rows read as a rendering bug. Only CONSECUTIVE repeats
  collapse — a view after a signature is its own event.
- **Legacy envelopes fall back to the `audit_log` column.** It was the source
  of truth before `esign_audit_events` and `routes/esign.ts` describes it as
  "kept for backward compatibility but no longer written to". Without the
  fallback every older envelope would expand to an empty timeline and look as
  though nothing had ever happened to it.

And the one thing the panel must never do: **a failed read is stated as a
failed read.** "Nothing recorded for this envelope" and "we could not find
out" are different claims about an audit trail, and collapsing the second
into the first is the same defect as the canvas's "Unchanged from last
month".

## D77 — A renewal warning needs a memory of its own, and the inbox cannot be it

**2026-09-12.** Task #163. `/trust` reports a lapsed obligation accurately —
Trust Center v2 draws `Expired 74 days ago` — and **the first time anybody
finds out is when they open the page.** `expireDueArtifacts` flips a past-due
row at 04:35 UTC without telling anyone. The fix is a nightly sweep that
warns beforehand, and the interesting part is not finding the rows.

### The inbox is not a memory

`notify()` (`services/notify.ts`) is the platform's one notification writer
and it already does the hard parts: per-user channel preferences, quiet
hours, and a digest buffer flushed on its own schedule. This task feeds it
rather than building anything beside it.

But **`notify()` has no idempotency of any kind.** A nightly caller that
simply asked "what expires soon?" would write the same warning into the same
inbox every night for thirty nights. So something has to remember what has
already been said, and `notifications_inbox` cannot be that thing: a reader
can mark rows read, the UI can clear them, and `payload` is opaque JSON with
no index to match on. Memory that a reader can delete is not memory.

**Migration 244 adds `renewal_notices`**, and the `INSERT OR IGNORE` *is* the
decision to send — a row is claimed exactly once, so a second run the same
night claims nothing and therefore sends nothing, and two overlapping runs
cannot double-send. Same pattern as migration 243's score snapshot.

Two columns in the unique key are easy to leave out and both were nearly
missed:

- **`user_id`**, because a pairwise NDA has TWO parties and both lose cover
  when it lapses. Keyed on the subject alone, party A's claim silently
  swallows party B's warning. Found by reading `expireDueArtifacts` rather
  than by testing — one row, two people.
- **`expires_at`**, because a renewed obligation has a new deadline and the
  three warnings must arm again for the new term. Without it an item warned
  once could never be warned again for the rest of its life, which is the
  opposite of what a renewal notice is for.

### The predicate is copied, not reinvented

The sweep selects exactly the rows `expireDueArtifacts` flips — obligations
that are `satisfied` with a deadline, NDAs that are `active` with one. If the
warning and the expiry disagreed about what expires, somebody would be warned
about an item that never lapses, or lapse with no warning. It also gives the
"never warn about a settled row" rule for free: `waived`, `revoked` and
already-`expired` rows are not `satisfied`/`active` and never match.

### Three warnings, and the smallest crossed threshold

30 / 14 / 7 days, each sent once, then silence — chosen with the user over a
single 30-day notice (one miss and you hear nothing again) and over a weekly
drumbeat (four or five per item is how a compliance notice teaches people to
ignore compliance notices).

The threshold for a given deadline is the **smallest one it has crossed**,
not the nearest. A sweep that misses a night — a failed cron, a deploy, a D1
blip — would otherwise skip that threshold forever, because the next run
finds the item already past it. Taking the smallest crossed threshold means
a missed 14-day run still warns at 13, once, under the 14-day claim.

### One notice per person, and it must not be critical

The digest is per recipient: someone with four lapsing agreements gets one
message listing all four. Four separate messages is what makes people turn
compliance mail off.

The notice passes `category: 'compliance'`, and that category is deliberately
**not** in `CRITICAL_CATEGORIES`. An omitted or critical category bypasses
quiet hours *and* the digest buffer (`notify.ts`: `const isCritical =
!args.category || CRITICAL_CATEGORIES.has(args.category)`) — so getting this
wrong would wake someone at 3am about a deadline thirty days out, which is
the exact opposite of what a batched renewal notice is for.

### When a send fails, the claim stands

The claim is written before the notice goes out, so a failed send costs that
person that one warning rather than repeating it nightly. The next threshold
still fires. Rolling the claim back on failure is the tempting alternative
and it is worse: it turns a flaky notifier into a nightly spammer.

---

## D78 — The magic-link fix is verified by a round trip or it is not verified; and a probe that never ran is red, not green

**2026-09-12. D74 shipped a fix for a sign-in outage and nothing had confirmed
it against production.** That is not a gap in the fix; it is a gap in what this
repo can observe. `/login`'s magic link timed out at 30s, D74 moved the email
send off the response path with `waitUntil`, and for the whole time the task sat
open the only live evidence anyone had was `post-deploy-smoke.yml` — which
probes `/api/health` and **stayed green straight through the original outage**,
because `/api/health` is `RATE_LIMIT_EXEMPT` and touches none of the auth path.
A green board is not evidence. It was not evidence then and it would not have
become evidence by waiting.

### Why timing alone was rejected

The obvious probe is the cheap one: POST `/api/auth/magic/start`, assert it
answers in under a second, done — it measures the reported symptom directly.
It was rejected because **the fix changed what a fast answer means.**

```ts
const deliver = sendEmail(c.env, 'auth_magic_link', email, { name, magic_url: magicUrl })
  .catch((e) => { console.error('[AUTH:magic-start] email send failed', e); });
const ctx = (() => { try { return c.executionCtx; } catch { return null; } })();
if (ctx?.waitUntil) ctx.waitUntil(deliver);
else await deliver;
```

The token row is committed first and the mail becomes a separate errand with a
`.catch` that logs and swallows. That removes the latency — and it creates a
failure mode the *old* code could not have: **the endpoint can answer `202` in
200ms while the mail silently never arrives.** Gmail credentials expire, the
OAuth refresh token gets revoked, `waitUntil` gets dropped on an eviction, and
`/magic/start` keeps answering in 200ms through all of it. A latency probe would
go green on every one of those. It would not merely miss the regression; it
would actively certify it.

So the probe reads a real inbox, follows the real link, and asserts a real
sign-in. `/magic/start` answering `202` is **necessary and nowhere near
sufficient**, and the three findings are reported separately — `start_latency`,
`mail_delivered`, `sign_in_completed` — because they fail for different reasons
and a single pass/fail hides which. A fast endpoint must not be allowed to cover
for mail that never came; that is the specific lie this design refuses to tell.

A mailbox is unavoidable, not a convenience: `magic_link_tokens` stores
`token_hash`, so the raw token exists **only in the email**. There is no back
door for a probe to take.

### Only exit 0 is green — "we never ran" is red too

The probe exits **0** verified, **1** ran and failed, **2** not configured. The
workflow distinguishes 1 from 2 in its annotation and its step summary, and
**fails the job on both**.

That last part is the decision, and the tempting alternative is to let exit 2
pass with a warning: the four secrets do not exist yet, so a scheduled job goes
red every four hours until somebody acts, and a permanently-red check is how
people learn to ignore red. It is still wrong. A green tick for *"we did not
run"* is the same lie as `/api/health` in a different costume — and this
workflow exists for exactly one reason, so a green tick on it reads, to anyone
glancing at the Actions tab, as "the magic link works". Crying wolf is a check
going red for reasons unrelated to the thing it guards. This goes red for
precisely the thing it guards: the login flow is unverified. The red is
actionable, its summary names the four secrets, and it clears the moment they
land.

### The cadence is set by a rate limiter, not by taste

`magic-start-email` allows **3 per 900s per address** (`routes/auth.ts`). A
probe that trips its own limiter reports a broken sign-in when sign-in is fine
— a false alarm on the one check whose whole value is being believed. The cron
is `30 */4 * * *`: four-hourly, and on the half hour so it does not collide with
the 6-hourly SPA smoke at `:00`.

`frontend/test/magic_link_probe.test.mjs` does not take that on trust. It reads
the limit off `auth.ts`, expands the cron itself, and asserts that
`floor(window / gap) + 1 <= limit` — so changing either the schedule or the
limiter fails the build rather than the probe. The same test reads
`MAGIC_LINK_TTL_MIN` off `auth.ts` and the default mail budget off the probe,
and asserts the budget sits inside the token's lifetime; comparing two literals
there (`120_000 < 15 * 60_000`) would have been an assertion that can never
fail, which is a thing this repo has now written twice and caught twice.

### Why not in `post-deploy-smoke.yml`, and why not in `test:drift`

Not the smoke: that job's own header says *"No secrets required"*, and folding
this in hands every scheduled SPA check a mailbox credential it has no use for.
Its cadence is deploy-shaped; this one's is limiter-shaped.

Not `test:drift`: it reaches production and signs in. A check that cannot run
inside the suite must never sit in the suite reporting success. Its pure helpers
— token extraction, Gmail part flattening, staleness, the three verdicts, the
redirect reading — are unit-tested and those tests *are* in the suite.

### The stale-message trap

A matching email from a previous run satisfies a naive inbox search forever, so
the probe would keep passing for months after delivery broke — the same shape of
failure as the `/api/health` smoke, arrived at by a different route. Every
candidate message must carry an `internalDate` strictly **after** the instant
this run called `/magic/start`. A message at the exact request instant predates
the send and does not count.

### What this decision does NOT claim

**Task #168 is not closed by this commit.** The probe is not the deliverable; a
green run of it is. Until `MAGIC_PROBE_EMAIL`, `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` exist as repository secrets, the
job fails with NOT CONFIGURED and **the `/login` magic link remains unverified
against production.** Those secrets require a dedicated test account on
production — never a real person's address, because the probe signs in as it —
and read access to its mailbox; a `+alias` of the sending Gmail account delivers
to that same inbox, which is the cheapest way to satisfy it. Neither can be
created from inside this repo.

---

## D79 — A second probe rather than a subset of the first, because a green tick must keep meaning one thing

**2026-09-12, hours after D78.** That decision built a magic-link probe that reads a
mailbox, follows the link and asserts a sign-in — and established the rule that **only exit 0
is green**, with "we never ran" failing the job precisely because a green tick for an unrun
check is how `/api/health` stayed green through the original outage.

The probe cannot run. It needs a Gmail OAuth app to read an inbox, and none exists. So #168
sat unverified while a cheaper question went unasked: **did the request reach its INSERT?**

That question needs no mailbox. `/magic/start` commits a `magic_link_tokens` row before it
does anything else, and D74's diagnosis turned on exactly that — four rows, newest
2026-08-03, and the failing attempt wrote none. A row appearing is direct evidence the
thirty-second hang is gone.

**And the cost had been overestimated.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
are already repository secrets with D1 scope, and `scripts/migrate-d1.mjs --remote` is the
standing precedent for CI reading production D1. So the check needs **one** new secret rather
than four, and no OAuth app at all.

### Why not a flag on the existing probe

The obvious shape is `--no-mailbox` on `check-magic-link-live.mjs`: one script, shared
helpers, less code. It is the wrong shape, and D78 is the reason.

A single script with two modes has to **go green on a subset**. Its green then means
"everything I was configured to check passed", which is not a fact about the system — it is a
fact about the configuration, and the reader cannot tell which from the tick. That is the
"partially verified green" D78 exists to forbid, reintroduced through the back door. Two
probes, each green only when everything it names passed, keep the tick meaning one thing.

So `check-magic-link-insert.mjs` reports `start_latency` and `token_row_written`, and
`magic-link-probe.yml` stays the only thing that can close #168.

> **Amended the same day by D80.** The two paragraphs above originally went further and said
> this probe "disclaims delivery in the script, in the annotation and in the step summary —
> because the `waitUntil` failure mode leaves the row committed and the mail unsent, and this
> probe is blind to precisely that." **That was wrong on the last point.** The `waitUntil` send
> writes an `email_send_log` row, so the failure is legible in D1 and the probe now carries a
> third verdict, `mail_send_recorded`. What stays true is the shape of the argument below — two
> probes rather than two modes — and that only the mailbox probe can prove the mail *arrived*.
> Read D80 before relying on any sentence here about what this probe cannot see.

### The schedule offset is a correctness requirement

Both probes request a link for the **same address**. The mailbox probe accepts any message
whose `internalDate` post-dates its own request — so if the insert probe fires inside that
polling window, the mailbox probe picks up the **insert probe's** email, follows a perfectly
valid link, and passes **without ever proving its own mail arrived.** A false pass on the one
check whose entire value is being believed, and nothing in either script would notice.

Hence `0 */4 * * *` against the mailbox probe's `30 */4 * * *`: thirty minutes against a 120s
mail budget. `frontend/test/magic_link_insert_probe.test.mjs` parses both crons and that
budget out of source and asserts the gap exceeds it, so neither can drift alone. The same test
checks the union of both schedules against `magic-start-email`'s 3-per-900s limit, because the
limiter is per address and two workflows now share one.

### A third exit code with a second meaning

Exit 2 already meant "could not run". Here it also covers **the API token lacking D1 read** —
which must never surface as `token_row_written: false`, because that reads as a broken sign-in
when the truth is a missing permission, and sends someone hunting a production auth bug. The
verdict rests on `MAX(id)` for the probe address before and after, never on a parsed
`created_at`: that column is a SQLite `CURRENT_TIMESTAMP` in UTC, and
`new Date('2026-08-03 12:20:43')` parses as local time in Node, so comparing it to a runner
clock is a timezone bug and a skew bug at once. `AUTOINCREMENT` ids are monotonic and carry no
clock. Scoping to the address also means a real person signing in mid-run cannot be mistaken
for the probe's own row. No token material is read; the row id is all it needs.

### What this does not claim

Each run writes one row to production `magic_link_tokens` (15-minute expiry, never used) and
sends one real email, so it was put to the user before being built. **It does not close #168.**
Until a run passes, nothing is verified; once one does, #168 reads *original 30s symptom
verified, delivery still unverified* — and only the mailbox probe can change the second half.

## D80 — The `waitUntil` send does leave a trace, so the probe asserts the Gmail handoff

**2026-09-12, hours after D79.** That decision shipped `check-magic-link-insert.mjs` with two
verdicts and a disclaimer: *"NOT CHECKED HERE: delivery. Only check-magic-link-live.mjs can see
that."* The disclaimer rested on an assumption nobody had checked — that D74's `waitUntil` send
leaves nothing in D1. **It leaves a full record.**

`routes/auth.ts:8` imports `send as sendEmail` from `services/email/send.ts`. That function
inserts an `email_send_log` row (`status='queued'`, `to_addr`, `template_key='auth_magic_link'`)
**before** it enqueues onto `JOB_QUEUE`; the queue consumer (`services/queueWorker.ts`, case
`email_send`) calls `deliverNow`, which marks the row `sent` **only when the Gmail API accepted
the message** and `failed` with a `last_error` otherwise.

So the precise failure D74 introduced — token row committed, `/magic/start` answering 202 in
200ms, mail never sent — is visible as a row stuck at `queued`, or a `failed`/`dlq` row naming
its cause. **The probe as merged would have passed on exactly that**, reporting a healthy login
that delivers nothing. That is the defect this decision closes, and it needed no new secret:
`email_send_log` sits in the same D1 the probe already reads.

### Why this is a verdict and not the mode D79 rejected

It looks like the thing D79 forbade, and it is the opposite. D79's objection to `--no-mailbox`
was that a script with modes **goes green on a subset**, so its tick reports the configuration
rather than the system. `mail_send_recorded` adds no mode and no subset: it runs on every run,
on the same single secret, and there is no configuration under which the probe passes without
it. The tick still means one thing — it just means more of the right thing.

### What is proved, and what is still not

**Proved: acceptance.** Gmail took the message. **Not proved: arrival.** A bounce, a spam file
or a wrong address all come after acceptance, and nothing here follows the link or asserts a
session. So the mailbox probe keeps exclusive territory — inbox arrival plus a completed
sign-in — and remains the check that closes #168. With this verdict, #168 reads *original 30s
symptom verified, send handoff verified, arrival and sign-in still unverified.*

### The budget is measured, not guessed

Production `email_send_log` holds four real `auth_magic_link` rows. Their `enqueued_at` →
`sent_at` gaps are **10s, 29s, 82s and 26s**, every one on the first attempt. `MAGIC_SEND_BUDGET_MS`
therefore defaults to **180000** — the 60s first written here would have failed the 82s send,
which succeeded. `frontend/test/magic_link_insert_probe.test.mjs` parses the budget out of
source and asserts it clears 82s, asserts the schedule gap clears the sum of this probe's
budgets, and asserts the budgets fit inside the job's `timeout-minutes` so raising one cannot
silently trade a report for a killed job.

Two further traps the tests pin. The poll is scoped `AND id > ?` against a baseline taken
**before** the request: every existing row is `sent`, so without that scope the August rows
would satisfy the verdict forever — the same trap the token baseline exists to avoid, one table
over. And `last_error` is **redacted before printing**: `deliverNow` stores the thrown message,
the payload it was thrown from carries the rendered `magic_url`, and a CI log is readable by
anyone who can read the repo, so a URL or any 24-character token-shaped run is stripped while
`gmail_creds_missing`, `gmail_send_failed` and `deliver_now_threw` survive intact.

### One narrow correction to D74's rationale

Reading the same table settled something else. `[[env.production.queues.producers]]` landed in
`92bef59e4` (2026-05-05), before all four sends, so `JOB_QUEUE` was bound throughout: pre-D74,
`await sendEmail(…)` awaited `ensureSendLog`, the log INSERT and `Jobs.enqueue`'s `queue_jobs`
INSERT — **three D1 round trips, never the Gmail call**, which ran in the consumer. So the
`waitUntil` move did not remove "two bounded fetches (token + send) that can legitimately take
10s each", as its own comment in `auth.ts` claims. **#535 is not misdiagnosed** — its
load-bearing half is the other one, `util/deadline.ts`'s `withDeadline` wrapped around every
await on the auth path, which bounds a stall wherever it sits. Only that one sentence of the
comment is wrong. Whether the hang is gone still needs a live measurement, which is
`start_latency`, which needs a run.

---

## D81 — `chargeSession` gets its caller; the flag becomes a switch rather than a claim

**2026-09-13.** PR5b (D75) shipped `services/advisorConnect.ts` with onboarding at one end and
fulfilment at the other. Reviewing that leg turned up that **the middle had no writer**:
`chargeSession` was an exported function referenced by nothing but its own test file — no route,
no webhook, no dynamic import. `POST /api/advisors/bookings/:id/pay` is that caller.

The state machine was already built from both ends. `PATCH /me/bookings/:id/billing` stamps
`amount_cents`, `platform_cut_cents` and `take_rate_bps` server-side and moves the row to
`billing_state = 'billed'`; `markSessionCharged` moves it to `'collected'` when Stripe's webhook
says the money arrived. Only the transition between them — the client actually paying — had
nothing that could perform it.

### Why this is worth a decision rather than just a route

`settlementMode()` answers `'none'` **only** because `ADVISOR_CHARGING_ENABLED` is unset, and
that value is reported as `settlement:` by seven handlers in `routes/advisors.ts` and two in
`admin_platform.ts`. So before this route existed, flipping the flag would have **told advisors
settlement was live while no path could take a payment** — a surface asserting a capability that
does not exist, which is the D56/D68 failure. This change does not turn charging on. It makes the
flag *sufficient*, so that flipping it is a switch and not a claim.

### The dead code this uncovered, which was worse than recorded

Migration 240 created `advisor_office_hour_slots.payment_state` with `'held_unpaid'` meaning "a
slot taken by a booking that could not be charged", and the working note for this task said that
column simply had no writer. It was worse than that. `markSessionCharged` clears the hold with
`SET payment_state = 'charged' WHERE ... AND payment_state IN ('held_unpaid', 'authorized')`, and
**neither of those two states had a writer anywhere in the worker** — so that `UPDATE` could never
match a row. The fulfilment leg's slot bookkeeping was unreachable in both directions, not merely
unexercised. Step 4 of this route is `held_unpaid`'s first writer, which is also what makes that
`UPDATE` reachable for the first time. (`'authorized'` still has none; it is for a manual-capture
flow nobody has built, and it stays honestly empty rather than being written by this route to make
a `CHECK` constraint look used.)

The write is scoped `AND payment_state = 'not_applicable'` so a slot already `charged` or
`refunded` by another booking on the same capacity is never walked backwards, and it is
best-effort: the founder's answer does not depend on the bookkeeping succeeding.

### Charging an already-priced booking, rather than a path that prices itself

The obvious alternative was a route that resolves a price itself — `advisor_booking_links.
session_type_id` → `advisor_session_types.price_cents`, a chain migration 240 created and no
route reads. That was rejected for this change: it needs a booking path that does not exist (the
`/b/<slug>` link flow is unbuilt) and it makes a pricing decision nobody has asked for. Charging
a booking the advisor has already priced needs **no migration and no new booking path**, and it
closes the actual gap. The price chain remains unresolved and unasked.

### The guard ordering is load-bearing, and the tests treat it as behaviour

`chargeSession` throws `SettlementDisabled` on its own, so the route refuses either way — but it
throws *after* the handler would have called `ensurePaymentsCustomer`, which creates a Stripe
customer and writes `users.stripe_customer_id`. Checking settlement first means a charge that
cannot succeed leaves **no customer, no `held_unpaid`, and no D1 write of any kind**. The `catch`
still maps `SettlementDisabled` anyway, because a guard that depends on the caller checking first
is not a guard.

### A rate-limit bucket, because the PR template's checklist was a real question

*"Rate-limit bucket assigned for any new public endpoint"* turned out not to be a tick-box here.
The route fell through to the generic `user` bucket: **60 PaymentIntent creations per minute per
user, fail-OPEN**, so knocking out KV removed even that. `promo_validate` (20/min, failClosed) and
`admin_catalog_writes` (20/min, failClosed) are both tighter for strictly less exposure, and the
`Bucket` type's own comment reserves `failClosed` for *"abuse-prone / money-adjacent buckets so the
limiter can't be bypassed by knocking out KV"*. `advisor_session_charge` is 10/min per user,
failClosed. Ten is far above any real workflow — paying is one call, a declined card is a handful
of retries — and `chargeSession`'s idempotency key means repeat calls for the same booking return
the same intent, so what this caps is a script walking many bookings.

**The pattern names both mounts, and that is load-bearing.** `index.ts` routes the advisors router
at `/api/advisors` **and** `/api/mentors`. A bucket naming only the first would leave
`/api/mentors/bookings/1/pay` on the generic fail-open bucket — a limiter that is present, green,
and bypassable by spelling the prefix the other way. That is the `ai` bucket's recorded bug
verbatim (`/api/advisor` vs `/api/advisory`, where the one route that spends Workers AI per request
matched no AI bucket at all), except both prefixes here are live today rather than hypothetical.

`rateLimit_advisor_charge.test.ts` executes the pattern rather than substring-matching it, for the
reason its sibling gives: a regex reads correct and matches the wrong set. 13 mutations, 0 escapes
— including dropping `mentors`, widening the id to `.+`, losing either anchor, adding a `/g` flag,
and moving the bucket below the catch-all.

**One of those mutations escaped first, and the cause is worth recording**: the sibling guards
locate a bucket with `src.slice(at, at + 400)`, and this bucket sits immediately above the generic
`user` one, so 400 characters run past its closing brace into a neighbour that also carries
`scope: 'user'`. Flipping *this* bucket to `scope: 'ip'` left the assertion satisfied by the next
bucket's line. The fix slices to the literal's own `},`. The existing guards are not wrong today,
but only because their windows happen to land in comment prose — reordering the list would give
them the same hole.

### No frontend, and therefore no `docs/` rebuild

The route returns 503 in every environment today. A payment UI that can only 503 would be exactly
the surface-implying-a-capability failure above, so there is none — and no `api.js` method either,
since nothing calls it (`check-api-drift` has nothing to reconcile). The route is written, tested
and unreachable, which is the posture `advisorConnect.ts` already takes for the same reason.

### One deliberate omission, stated rather than skipped

Wellbeing persists `stripe_payment_intent_id` on its booking row; `advisor_bookings` has no such
column and adding one is a migration this change was scoped to avoid. It is not needed:
`markSessionCharged` finds the booking by `metadata.booking_uid`, and `chargeSession`'s idempotency
key `pi:advisory:${bookingUid}` is deterministic from that same uid, so the intent is recoverable
from Stripe without a second copy. A follow-up if a reconciliation report ever wants it locally.

### What the green here means

`cloudflare-worker/test/advisor_charge_route.test.ts` is 20 tests, every assertion
mutation-checked in both directions (24 mutations, 0 escapes). **It is unit-test green, not a live
charge** — `settlementMode()` is `'none'` in every environment, including the test harness unless
a test forces it on, so no money has moved and none can until the flag flips. Three findings from
that pass are recorded next to the code they apply to, because they generalise:

- An assertion is worthless if its fixture makes the bug invisible. `amountCents: gross` mutated
  to `amountCents: 30000` **passed**, because the fixture price was `30_000`. Fixed with an odd
  price (`41_737`) and by asserting against the stored row rather than a constant.
- A source-text assertion cannot see dead code. `if (false && e instanceof SettlementDisabled)`
  still contains the text the assertion reads, so it escaped; the honest mutation for a source
  assertion is deletion, and the residual gap is written down in the test rather than patched with
  a rule that only fits the mutation that found it.
- **A guard that scans a file as text reads its comments too.** PR5a's existing guard — *"no
  advisory surface renders a charge as accomplished fact"* — forbids hard-coding the settlement
  mode anywhere in `routes/advisors.ts`, and it failed this branch **twice**: first on a real
  literal in the `SettlementDisabled` catch, then on the comment written to explain why that
  literal had been removed. Both were the guard working. The first fix was the interesting one:
  the right value was neither a constant nor a second `settlementMode()` read but `e.mode` off the
  thrown error, symmetrical with the `e.state` the 409 below it already used — so a refusal now
  reports what the service decided rather than what the environment says a moment later. The
  second was a reminder that prose inside a scanned file is part of what gets scanned.

---

## D82 — A fill that is not a restatement needs a different promise, and TAM needs a table before it needs a model

D46 settled how "AI fills the blanks" works on one surface and made two rules that
this change alters. Both were right for what existed then, and neither generalises.

### The rule that had to change: match-back is not the only honesty mechanism

D46's mechanism is MATCH-BACK — *"every item is matched back against something
that exists in the project before it can become a row"*. `parseTagProposals`
refuses a phrase not in this project's own ungrouped set; `parseDraftProposals`
refuses a claim that restates one on file. Both of Validate's fills are
RESTATEMENTS of evidence the founder logged, so the rule fits them exactly.

It cannot fit a market size. The whole point of asking Eadwyn for TAM is that the
project does not contain it, so there is nothing to match back against — and with
no replacement guarantee, filling it means writing an unsourced number into a
column a founder-derived figure occupies. So each kind now declares which promise
it keeps, and `services/fills/types.ts` holds the three:

| Class | The promise | What happens when it cannot be kept |
| --- | --- | --- |
| `restatement` | it restates a row already in the project | the proposal is dropped — D46's rule, unchanged |
| `sourced` | it carries a citation naming where it came from, with the quote | **the proposal is dropped**, never written with a hedge |
| `composition` | it makes no factual claim (a tagline, positioning copy) | it may never target a column holding a MEASURED value |

`refuseReason` enforces this on the WRITE path rather than in review, because a
`sourced` value with no citation is not a lower-quality fill — it is an assertion
with nothing behind it, and the store must not be able to hold one.

### The other rule that changed: "two capabilities, not three" is now three surfaces

D46 counted capabilities on one surface. The dispatch was `if (row.kind ===
'pain_tag')` in a file about Validate — fine for two kinds, the wrong place for a
third. `services/fills/registry.ts` holds one entry per kind now, and its own
header states the invariant the move had to preserve: **`apply` must be the
function the manual form already calls.** That is D46's "accepting and typing
produce the same row", generalised, and the reason is concrete rather than tidy —
`insertHypothesis` allocates `H1, H2 …` from the highest code EVER used so a
retired `H2` is never reissued, and a second writer with its own idea of that rule
is how duplicate codes start being handed out to a founder who finds out when two
claims share a name in a board pack.

**The test for that invariant first passed with the rule reimplemented.** An empty
`hypotheses` table cannot tell `MAX(CAST(substr(code,2)))` from `COUNT(*) + 1`,
because with no history both say 1. The fixture now seeds a project whose codes
are not a dense sequence — H1 live, H6 retired, H2 live, X9 hand-edited — where
the next code is H7 and each of the four plausible wrong rules gives a different
answer. It is the clearest example this repo has of a test that was green and
worthless, and the lesson is the fixture, not the assertion.

### Provenance is a side table, because a column cannot hold two facts

`projects.tam` is one bare `REAL`. `SpinoutLabMarketPage` derives TAM from an
addressable population × an ACV with the founder's own assumptions, and says so
three times: a code comment recording that the design's "AI-assisted estimates"
was dropped *"rather than lie about provenance"*, on-screen copy reading *"nothing
on this page is auto-invented — empty means not researched yet"*, and a per-card
"Founder research" / "Founder model" stamp. The moment a model can write to that
column all three become false, because nothing beside the number says who produced
it.

So `fill_provenance` (migration 246) records one row per accepted fill: the
address as a `(table, row, column)` triple, the class, **both values** — what was
proposed and what was written — `edited` derived from comparing them, the citation,
and the model that ran. `filledColumns` compares a provenance row against what the
row holds NOW, so a founder who typed over a filled figure by hand owns it and the
card stops claiming otherwise: the same lie pointed the other way is still a lie.

`edited` is derived and never passed in, because a caller that has to remember to
set it will eventually forget, and the one thing that row must never do is claim a
value is untouched when it is not.

### The market surface needed a table before it needed a model

The honest fill for market sizing proposes the INPUTS, not the size — a TAM
proposal would write over the founder's arithmetic. But until migration 247 there
was nowhere to put an addressable population: the drawer's twelve fields were
`useState` and went when the tab closed, and the page's own comment had been asking
for `project_market_assumptions` since it was written. **What it kept was the
conclusion with none of the reasoning**, which is a stranger thing for a page about
derived figures to do than anything its copy warns about. 247 is that table; the
store patches rather than replaces, which is what lets one cited figure land
without blanking the eleven the founder typed.

The drawer's note — *"only TAM/SAM/SOM are saved to your startup record yet"* —
was true and is now false, and it was corrected in the same change. A stale honest
note is worse than none: it teaches a founder to expect their work to be dropped,
so they stop typing it.

### Brand already worked; its provenance was the only thing missing

`POST /brand/landing/autofill` has returned `ai_generated: true` since it shipped
and its mechanism is correct — it drafts into local state, the founder edits
freely, Save is the commit. **Nothing about it was rebuilt.** The flag was read at
the point of use and discarded, so a published headline Eadwyn wrote was
indistinguishable from one the founder typed, on the same page whose rail names the
model. The editor keeps the proposal through the draft as a MAP and not a set,
which is the whole design: a keystroke does not clear it, because a drafted line
half-rewritten is exactly the case `edited` exists to describe.

Its save-time write is deliberately NOT the accept path's. Validate reverts when
provenance cannot be written, because there a value with no provenance is the state
the table exists to prevent. Brand copy is the founder's own words on their own
page, saved by an explicit click, so a failed audit row is logged and the save
stands — refusing it would be the worse outcome.

### Two smaller findings, recorded where they generalise

**A citation that names a document and not the passage is a label.** `SearchHit.chunk`
has been declared "for a citation" since the research library shipped and
`upsertEntity` has always written `metadata.chunk` — and `searchSemantic`'s mapping
dropped it, so `routes/research.ts` recorded `chunk: null` on every Ask citation it
ever wrote. Found while building the citation path, fixed there, and the band shows
the quote for the same reason: the only check a reader has is reading the sentence.

**A dead guard that reads as a safeguard is worse than none.** The brand recorder
tested `hasOwnProperty(written, column)` before its emptiness check, and the
mutation run showed deleting it changed nothing any test could see. It cannot: a
column absent from `written` reads as `undefined` and then as the empty string, so
no input distinguishes the two. It was removed rather than kept, because the next
reader would have trusted it.

### Also: the second surface to declare a `mode`, and the first outside Validate

D17 named a brand page as the plausible second one. It is the market page, because
that is where a branch became true — off, no figure is proposed and nothing is
spent; on, Eadwyn looks for the inputs the page multiplies. `FillKind.assistSurface`
names the rail whose `mode` gates a kind, so D17's rule is now checked
mechanically: a fill whose rail declares no mode is a capability with no switch,
which is the mirror image of the dead config `ui_assist_rail_and_sidebar` already
refuses.

**And "Edit the claim" was built.** The canvas has drawn accept / edit / discard
since this band was designed; the middle control lived only in a comment
describing the artboard. Accepting a value a founder would have corrected teaches
them to discard and retype — the same work with the proposal's provenance thrown
away. An unchanged edit is sent as a plain accept, because a table where every row
is marked corrected says nothing about any of them.

### The fourth surface is a refusal, and the plan's premise for it was wrong

The plan named four surfaces. Three are live — Validate's two restatements, market
sizing and competitors as `sourced`, brand copy's provenance as `composition`. The
fourth, company and account settings, gets **no fill**, and the reasoning is worth
more than the feature would have been.

The plan's guardrail was right: *"Never fill an identity field the platform cannot
verify — it is the one place a wrong fill carries legal weight."* Its premise was
not. It listed *"Legal name, jurisdiction, sector, description, links"*, and
`company_profiles` **has no legal name, no jurisdiction and no incorporation date**.
Those live on `entities` and `compliance_events` — a legal-filing surface, and a
different piece of work. So the guardrail had nothing to guard on this page.

What Company Settings actually edits is eleven columns, and applying the same
tests every other kind passes refuses all eleven:

| Fields | Why no class can keep its promise |
| --- | --- |
| `company_name` | Identity. The legal-weight case, and the only one the plan anticipated correctly. |
| `website`, `linkedin_url`, `logo_url` | **A URL is a model's likeliest fabrication.** The competitor fill's own prompt forbids inventing one; a fill whose entire output *is* a URL cannot make that promise. |
| `stage`, `revenue_range`, `employee_count`, `international_presence` | Facts only the company holds. Nothing in the project to match back against and nothing outside it to cite, so neither `restatement` nor `sourced` applies — and `composition` may not occupy a column holding a measured value. |
| `expansion_goals` | Intent, which only the founder has. |
| `description`, `current_products` | Prose, and **already served**. The brand builder's autofill drafts exactly this from `project.description` and `.problem_statement`, and that path now keeps its provenance. A second mechanism drafting the same sentences from the same source into a different column is a second answer to one question. |

And the page has no AI rail. Adding one to reach a single field would put a spend
meter and a model card on an administrative form — `eadwynConfig`'s rule is that
config follows a mount, and the mount would exist only to justify the config.

**The refusal is written as a test, not just as prose.** Deciding not to build
something leaves no code behind, which means it leaves nothing to disagree with
later: the next person reads the plan, finds a surface listed as planned, and finds
no trace of why it is absent. `settings_no_fill.test.ts` fails when a fill starts
targeting `company_profiles`, when the page mounts a rail, when `eadwynConfig`
declares a settings surface, and — the assertion that matters most — when Company
Settings grows a twelfth editable column, because a new field is a new question
that this reasoning has not answered.

## D83 — A capital call becomes a receivable, and "deployed" goes back to meaning deployed

**Task #197.** `POST /api/funds/:id/capital-call` enqueued a
`capital_call_notice` job that did two things: wrote one `activity_logs` line per
LP, and added the call amount to `vc_funds.deployed_capital`. It wrote **no
`capital_calls` row**, which is the table the LP's own portal reads
(`routes/funds.ts` `GET /lp-portal`, and the per-LP statement at
`GET /:id/lp-report/:lpId`), the table `PartnerPortal.jsx` and `CapitalPage.jsx`
render through `api.listCapitalCalls()`, and the table
`quarterlyReportViewModel.js` folds into an LP's quarterly report.

**The sharpest statement of the bug is that both of those pages carry a working
Pay button.** `api.payCapitalCall()` is wired on both, and
`POST /capital/calls/:id/pay` really does set `status = 'paid'` and stamp
`paid_date`. It had nothing to act on. A GP issued a call, an LP saw a log line
and a moved dashboard number, and the question "who owes what, by when" had no
answer anywhere in the database.

### The key is the call, not the job — and the job id would have been worse

The handler is **re-run**. On the D1 path `Jobs.markFailed` puts the same
`queue_jobs` row back to `pending`; on the CF Queue path the consumer deletes its
own idempotency claim in the failure branch on purpose, so that "a CF retry
actually re-runs the handler". `claimDelivery` dedupes concurrent redeliveries of
one message and nothing else — its comment names the race it closed as the one
where "both run the job and we double-charge LPs". A ledger row added naively here
turns a missing receivable into a doubled one.

So each row carries an explicit `uid` and the insert is `INSERT OR IGNORE`, which
is the mechanism `GOTCHAS.md` already describes as this repo's answer to
re-delivery: "the per-effect UNIQUE constraints are the dedup… there is no
separate event-dedup table by design". No migration was needed —
`capital_calls.uid` has been `TEXT UNIQUE NOT NULL` since the baseline.

The uid is `cc:<call_uid>:<lp_id>`, where `call_uid` is minted **by the enqueueing
route** and travels in the payload. It deliberately does not come from `job.id`:
the CF Queue consumer calls `handleJob` with a hardcoded `id: 0`, so a job-keyed
uid would be identical for every call ever issued and the *second* fund's real
call would be silently swallowed — a worse bug than the one being fixed. The DLQ
retry path mints a *fresh* delivery key on purpose, so that is no good either. A
payload with no `call_uid` (in flight across the deploy, or hand-enqueued through
`/api/infra/enqueue`) falls back to fund + amount, which dedupes per amount rather
than per press: a lost duplicate rather than a doubled receivable.

Notices are then sent only for rows that were actually new, so a retry that fills
in what it missed does not tell everyone twice. The "was it new" flag reads
`meta.changes` and never the `RETURNING` row, because the repo's own D1 test
adapter models `batch` as a sequence of `run()` calls with no `results` — code
keyed on the returned row reports "nothing inserted" under test while inserting
fine in production, which is the worst direction for a money path to be wrong in.

### And the issuance bump had to go, because writing the row is what made it wrong

`POST /capital/calls/:id/pay` already adds a paid call's amount to
`deployed_capital`, and `test/capital.test.ts` pins it: a 500 call marked paid
leaves the figure at 500. Before this change the job could bump the same figure at
issuance harmlessly, because it wrote no row and so nothing could ever be paid.
**Writing the row makes issuing-then-paying count the same money twice on an
investor's dashboard.**

Of the three ways out, one is sound. Suppressing the pay-path bump per row needs a
marker and leaves the figure meaning neither called nor deployed; dropping the
*pay* bump instead would contradict an existing money invariant to fit a new
feature. So the issuance bump goes — which is also the only option the readers
agree with. `FundPerformancePage.jsx` labels this figure **"Invested into
portfolio"**; `InvestorFundLanding.jsx` shows **Deployed** beside **Called**,
expecting `called ≥ deployed`; and `services/fundRollup.ts` records that a capital
call is not a dated cash receipt at all, which is why it refuses to compute IRR.

**This is a visible behaviour change.** A fund dashboard no longer advances the
moment a call is issued, only when an LP pays. The figure becomes true rather than
becoming different, but somebody watching the number will notice, so it is stated
here and in the PR rather than buried in a diff.

### One writer, and what the extraction is NOT justified by

`routes/capital.ts` had two inline inserts that already disagreed — one bound
`due_date`, the other did not — so the job would have been a third set of
defaults. They now share `routes/_capital_call_writes.ts`.

The usual argument for this shape is D46's: *an automated path must call the
function the manual form already calls.* **It does not apply here, and pretending
it did would be the more comfortable lie.** `api.createCapitalCallV2()` has no
caller anywhere in the SPA; there is no reachable manual form to match. The weaker
reason is sufficient — one writer cannot drift from itself — and the unreachable
create route is recorded as its own finding rather than dressed up as a
justification.

`due_date` is accepted and never invented. `legalcap.ts` defaults its
auto-generated call to `+30 days`; that is its choice and is not copied, because a
capital call's due date is a deadline an LP acts on. A row without one reads as
"no due date recorded", which is true, and every reader already tolerates NULL.

### What this does not touch

`capital_calls` is **two different tables under one name**, the same failure as
#183's `metrics_snapshots`. `routes/legalcap.ts` writes `(deal_id, syndicate_id,
amount_cents, …)` against its own `ensureSchema`; no migration ever added those
columns, so the baseline's LP shape is what production has and legalcap's path is
the dead one — already on record in `scripts/sqlite-table-collisions-baseline.json`.
It is worse than a dead write: `api.capitalCalls()` selects `cc.syndicate_id`, the
client method swallows its own failure into `[]`, and three investor screens render
a permanently empty capital-call list with no error shown. Deciding which shape
wins is a product question about whether syndicate capital calls are a real
feature, so it is its own task rather than folded in here.

## D84 — A linter enters the repo, for exactly one rule

**Task #200.** `FounderGrowFocus.jsx` declared `metCount`, `measured` and
`readTargets` in the host component and read all three inside `FocusContent`, a
sibling defined in the same file. `/grow/focus` rendered a blank body with
`ReferenceError: metCount is not defined`. Vite bundled it without a word,
because an undefined identifier is a **runtime** error and not a build one. Two
of the three were caught by CodeQL after the fact and the third by a browser.

The repo already carried two bespoke guards aimed at this neighbourhood, and one
of them states in its own header why they are not enough:
`scripts/check-react-hook-imports.mjs` says *"A general undefined-identifier
check is a linter's job and would need real scope analysis to avoid false
positives; hooks are worth special-casing because they are the names most often
added to a component body long after the import line."* That is exactly right,
and it is why the hook check could not have found these three: they are not
hooks, and telling "declared in a sibling scope" apart from "declared here"
requires resolving scopes rather than matching text.

### The decision: ESLint, with everything off except `no-undef`

Writing scope analysis by hand is writing a linter, so the alternative was never
"linter or script" — it was "a linter, or a third script that reimplements the
part of a linter that is hard". `eslint.config.mjs` at the repo root configures
`frontend/src/**/*.{js,jsx}` with `no-undef: 'error'` and **no other rule**;
`npm run lint:undef` runs it and `test:drift` calls it.

**No style rules, no `react-hooks`, no `import/*`, no formatting.** Each of those
is a judgement about house style that nobody in this repo has made, and turning
any of them on here would put hundreds of findings between this rule and the next
person who runs it. That restraint is the decision, not an omission: the rule
earns its place by being the one the codebase has already been bitten by twice.

The worker is deliberately out of scope, and for a good reason: `tsc --noEmit`
over `cloudflare-worker/src` already refuses an undefined name — the same
guarantee by a better route — and it is already in `test:drift` as `test:types`.

### The gap this leaves open, measured rather than waved at

`frontend/src` holds **27 `.ts`/`.tsx` files** (the deck templates, `DeckBase`,
`brand/gvpn.ts`), and the glob above is `{js,jsx}` because espree cannot parse
TypeScript. The worker's justification does not transfer to them: `test:types`
compiles `cloudflare-worker` **only**, the SPA has no tsconfig at all, and Vite
strips those types without checking them. So against this bug class those 27
files are covered by nothing but the 14 hook names in
`check-react-hook-imports.mjs`.

The gap is real and currently **empty**. A probe tsconfig over exactly those
files reports 15 errors and **zero TS2304** ("cannot find name"), so nothing in
them is undefined today. Closing it properly means a frontend `tsc --noEmit`,
which means first resolving those 15 — and they are not lint noise. Two look
like live wrong output: `templates/index.ts` gives two templates the category
`"event"`, which `TemplateCategory` does not admit, and
`minimal_seed_app.tsx:1160` hands a timeline `{year, event}` objects where it
expects `{date, label}`. A third reads `.initials` off an object typed `{name}`.
Each is a judgement about what a deck should render, so they are their own task
rather than bolted onto this one — recorded here so the next person does not
read `lint:undef` as covering the whole SPA.

### The two bugs the first run found

Both were live, both were in the class the rule was added for, and neither was
reachable by any existing check:

- **`components/StartupList.jsx`** — the empty state's "New startup" button fell
  back to `setShowForm(true)`, a setter that left with the create form when the
  page became a component. `onNewStartup` defaults to `null` and the sole caller
  (`ExecutionPage`) passes nothing, so the throwing branch was the **only** branch
  that ever ran: every new account with no startups clicked that button and got a
  `ReferenceError`. Fixed by rendering no button when there is no handler — an
  absent control is honest, a control that throws is not.
- **`pages/SpinoutLabPage.jsx`** — read `LAB_APPLY_HREF` without importing it
  from `../lib/spinoutLab`. Fixed by adding it to the existing import.

### The 119 findings that were not findings

The first run reported 122 errors, of which 119 were `eslint-disable` comments
**already in the source** naming rules from plugins this config does not install:
`react-hooks/exhaustive-deps` (77), `jsx-a11y/*` (2), and 40 "unused disable
directive". ESLint errors on a disable comment for a rule it cannot resolve, so
those directives turned a three-finding run into a wall.

Installing both plugins to make the names resolve would pull in two dependencies
for spelling alone, and deleting 119 comments from files this task is not about
would bury two real bugs in an unreviewable diff — those comments are notes from
whoever wrote the code, and they still say something about a deps array even with
no linter to enforce them. So the names resolve to **no-op rules** and
`reportUnusedDisableDirectives` is off, because against a no-op every one of them
is trivially unused. If a later pass turns these plugins on for real, that block
in `eslint.config.mjs` is what it deletes.

### The one declared blind spot

`frontend/src/decks/buildDeck.js` ends `abToBase64` with `(typeof btoa ===
'function') ? btoa(bin) : Buffer.from(bin, 'binary')…` — correct in the browser
and under `node --test`, and `no-undef` cannot see that the `Buffer` branch is
unreachable in a bundle. Node globals are therefore declared for
`frontend/src/decks/**` alone, and **not** repo-wide: a blanket declaration would
hide a real `process.env` or `require` reaching a browser bundle. Rewriting
working code to satisfy a linter that cannot read a `typeof` guard would be the
wrong way round.

### What this does not replace

`check-unused-imports.mjs` guards the opposite direction — a name imported and
never used — which `no-undef` cannot see at all, and it reaches five trees this
config does not (`cloudflare-worker/src`, `scripts/`, and both test trees).

`check-react-hook-imports.mjs` is the interesting one, and the honest statement
is narrower than "it still has its own territory": it is scoped to `frontend/src`
exactly like this config, so across `.js`/`.jsx` it is now **coverage-redundant**.
That was verified rather than assumed — deleting `useState` from
`StartupList.jsx`'s import line makes `lint:undef` exit 1 naming `useState` at all
four call sites, which is precisely the `PublicNav.jsx` failure the script was
written for. It is kept for two reasons that are worth stating plainly because
someone will reasonably want to delete it: it is the only cover for the
`.ts`/`.tsx` gap above, and its message names the specific failure where ESLint
says only `'useState' is not defined`. If the frontend `tsc --noEmit` above ever
lands, the first reason disappears and only the second remains.

## D85 — Three chips were a column list away, and the frequency beside them was wrong

**Task #175.** `/validate/pain-map` drew V2's chip row — `ICP only · All
interviews · Need-to-have · By recency` — with three of the four as prose. All
three carried one reason, and it was a good reason when it was written:

> *"a theme carries its phrases and not the interviews they came from, so no
> mention can be traced to a conversation whose ICP fit is recorded"*

That was true of the **payload** and never true of the database.
`discovery_interviews` has carried `icp_fit` since migration 161 and
`interview_date` since the baseline; `getPainGroupsView` selected neither. The
whole of the missing link was two names in one column list. **No migration.**

### The fold, and where the attribution had to happen

`analyzePains` already kept per-theme sets of interview ids for `need_count` and
`nice_count`, so the shape existed. The new counts ride the **same first-sight
branch** that increments `count` — the one guarded by `seenKeys` — so one
interviewee naming a theme three ways is one interview in every number on the
row. A fold that attributed per phrase instead would report more customers than
were spoken to, the asymmetry `evidenceFor` exists to hold.

`isIcp` is **imported** from `routes/_founder_validate_helpers`, not restated.
The rule is `strong || partial`, with NULL a fourth state and an explicit `none`
a recorded non-customer, and the whole value of one definition is that the pain
map and the hypothesis verdict cannot drift about who counts as a customer. A
service importing a `routes/_*.ts` shared module follows `_competitor_writes.ts`
and `_capital_call_writes.ts`; that file imports only `types` and `auth`, so
there is no cycle.

### `fit_unrecorded_count` is not a footnote

Three buckets, not two: ICP, recorded non-ICP, and **never recorded**. Folding
NULL into "not ICP" makes `icp_count` read 0 for every project logged before
migration 161, and an `ICP only` chip then states *"none of your pains come from
your customers"* with total confidence on no evidence. `verdictFor`'s header
names this as the failure the absent-is-not-empty rule exists to prevent; it is
the same rule, one screen over. So the row shows `2 icp · 4 fit ?` and the map
carries `icp_recorded` — read **from the interview rows, not from the theme
counts**, because a project whose only ICP interviewee named no pain leaves every
theme at zero while the field is plainly in use.

### `By recency` is a sort, and the date is the interview's

The date is the latest `interview_date` among the interviews mentioning a theme —
"somebody said this to us recently". Never a date of the theme's own: a founder
renaming a group months later would move it without anyone saying anything new.
`created_at` is deliberately not the fallback, because a batch of old interviews
typed up this morning would all read as this morning. Themes with no date sort
**last** rather than being dropped — a pain people named is not hidden because
nobody recorded when they said it. The comparison is a **string** compare on
`YYYY-MM-DD`, which sorts in date order; `Date.parse` on a bare date string is
the local-versus-UTC trap this repo has already been bitten by.

### The chip row needed three kinds, and the guard had to learn them

This zone's three siblings only ever narrow, so one predicate map said everything
about them. This row does not: `All interviews` is the **cleared state** and `By
recency` **reorders**. `zone_actions.test.mjs` required every live chip to appear
in the predicate map — a rule written after a real escape, where a missing
predicate made "Retired" show the live claims — and satisfying it would have
meant two `() => true` entries that pass the guard while lying about what the
chip does.

So the page declares `PAIN_VIEWS`, `PAIN_SORTS` and `PAIN_CLEARED`, and the guard
now asserts the invariant rather than the shape: **every live chip is claimed by
exactly one declared role, and every declared role belongs to a live chip** —
with a second assertion that no chip is claimed twice, since a chip that both
narrows and reorders has no defined behaviour. That is stricter than what it
replaced, not looser: the sorts and the cleared state are now checked too.

### THE BUG FOUND ON THE WAY, and it was the worse one

The pain map's frequency was **wordings over interviews**. The page computed
`g.phrases.length / view.interview_total`, ranked by the same, and quoted it in
its own footnote — while `g.count`, the distinct-interview count the server
computes, went unread.

`analyzePains` seeds every curated alias as a phrase **whether or not any
interview logged it**. So a founder who grouped three wordings under one theme
saw that theme at *"3 phrases · 150%"*, bar pinned at 100%, on a two-interview
project **where nobody had mentioned it at all**. Measured against the real
service, not reasoned about: `count: 0`, `phrases.length: 3`, `interview_total:
2`.

It was not a disagreement nobody had noticed — it was one a comment had
*vouched for*. `serializePainMapCsv`'s docblock said `count` is "the same number
the pain map page shows", and went on to describe computing frequency from
`phrases.length` as an "earlier reading of that page". That earlier reading was
the live one. The export wrote `0` and `0%` for the theme the page drew at 150%:
one record, two answers, one screen apart, with the prose asserting they agreed.

The page reads `count` now and ranks by `count` desc then title — the order
`analyzePains` gives `themes`, which is what the deck's Problem slide renders.
That matters beyond tidiness: this zone's own `Send to Problem slide` op is a
**link** to that slide, so ranking by wording variety let the page and the slide
it points at name different leading pains. The wording count is still shown, as
a separate label, because it is what a founder curating the map needs to see.

### The silent-blank-page regression this nearly shipped

Naming `icp_fit` in the SELECT unconditionally is **not safe**. Migration 161
ALTERs it in, `ensureDiscoveryIcpFitColumn` exists because it may be absent, and
its header says a caller should "degrade to 'ICP fit unavailable' instead of
emitting SQL that would fail with `no such column`". The interview read is
wrapped in `.catch(() => [])` — so on an environment where the column cannot be
read, the result is not a missing chip. It is **no interviews**, and the entire
pain map renders empty with no error shown. A feature that only adds a chip would
have blanked the page it sits on.

The column list follows the bootstrap's answer, and the degraded path is pinned
by a test that makes the ALTER fail. Getting that test right took two attempts,
and the first attempt is the lesson: it built the table without the column and let
the bootstrap add it, so an unconditional SELECT passed just as well and the
mutation walked straight through. A degradation test that lets the system heal
itself first is testing the healthy path.

### Still refused, and now for one honest reason

`/validate/verdict`'s `As of last week` and `Changed this month`, and
`/validate/hypotheses`' `Recently moved`, all want the same thing: a record of a
claim **changing**. `hypotheses` carries no `updated_at` that reaches the board
and nothing writes a lane transition, so there is no history to read. That is a
store this product does not have, not a query it forgot to write — the opposite
of the three above — and a product question (what is a verdict snapshot *of*?)
rather than an engineering one.

## D86 — Two shapes under one name, and both already had homes

**Task #183.** `metrics_snapshots` was two different tables. Production's is a
DEAL metrics table — `deal_id, snapshot_date, key_metrics, traction_score,
ai_review, created_by` plus ten named metric columns — and `routes/pipeline.ts`
creates exactly that at runtime, so it is the one that exists.
`services/queueWorker.ts` read and wrote a GENERIC METRIC SERIES (`scope,
scope_id, metric_name, value, captured_at, extra`), which only
`sql/historical/infrastructure.sql` ever declared, and nothing has built from
`historical/` since the migration ledger became the build path.

The collision was invisible until `check-sqlite-columns.mjs` stopped unioning
`historical/` into its harvest. Before that, the two shapes merged into one
17-column set that satisfied both queries.

### What it cost, and the worst of it was not in the task title

Three queue jobs threw `no such column`:

- **`traction_review`** died on its first SELECT, so the AI never ran and no
  review was ever written. This is the one the task was filed about.
- **`metrics_aggregation`** died on its INSERT, so a counter that has existed for
  as long as the job has was never recorded once.
- **`liquidity_valuation`** died reading a momentum nothing had written — and it
  dies **before** `Listings.updateValuation`, with no catch between. So a founder
  lists a subsidiary for sale, `secondary_listings.ai_valuation_cents` stays NULL,
  and `LiquidityPage.jsx:562` renders **"— pending" for that listing forever**.
  A broken metric series turned into a marketplace that never prices anything.

### The decision: no new table, because both shapes already had homes

The task suggested a `metric_series` table or dropping the job. Neither was
needed once the question was asked per-use rather than per-name:

- **The per-deal AI review goes in `metrics_snapshots.ai_review`** — a TEXT
  column that has existed since the baseline with **no writer and no reader
  anywhere**. It is named for exactly this, and the momentum rides inside its
  JSON.
- **The global counter goes in `system_metrics`** (`metric_name, value, labels`),
  which IS the generic named series this repo already has: `meter()` in
  `queueWorker.ts` writes to it on every job and `analyticsReports.ts` reads it in
  five places. Safe to add a name there because every existing read filters
  `metric_name = 'request'`.

`services/tractionSnapshots.ts` is the one place that knows this, so the three
jobs cannot drift about where a traction review lives.

### `traction_score` is deliberately not touched, and this is the load-bearing part

That column is a **0-100 rule-based** score computed by `pipeline.ts` from
users/revenue/engagement/growth, and `POST /pipeline/decision-gate/review`
branches on it at **70** and **40**. `aiTractionReview` returns momentum on
**0-10**.

Writing one into the other is the exact trap the `ai_scoring` job's own comment
already refuses — *"correcting the names would have started mixing the two
instruments instead"* — and the consequence here is worse than a wrong number on a
dashboard: every AI-reviewed venture would read as "iterate" at the gate that
decides whether it spins out. A mutation that makes `recordReview` also write
`traction_score` fails the suite.

### A review annotates a measurement, so it is an UPDATE

A new row per review would be a snapshot with all ten metrics NULL. That pollutes
the series the next review reads and drags `pipeline.ts`'s "latest snapshot" reads
onto a row carrying no metrics. So the review UPDATEs the snapshot it reviewed,
which also makes it **idempotent by construction** — and it needs to be, because
`Jobs.markFailed` puts the same row back to `pending` and the CF Queue consumer
deletes its idempotency claim in the failure branch on purpose. A retry overwrites
one column on one row. There is nothing to double.

Two guards fall out of that, both asserted: a `traction_review` for a project with
no snapshot returns instead of throwing (throwing would retry forever on a venture
nobody has measured), and a missing `project_id` throws instead of returning
(reviewing nothing quietly is how the original bug stayed silent).

### Absent is not empty, where it reaches a model

`metricPointsFrom` skips NULL metrics rather than sending zero. `net_burn=0` in a
prompt is a statement about the venture that nobody made, and a model cannot tell
it from a real zero burn. The first draft got the `key_metrics` branch wrong —
`Number(null)` is `0` and `Number('')` is `0`, both `Number.isFinite` — so a field
the founder left blank reached the prompt as `growth=0`, in the same function whose
docblock forbids exactly that. Its own test caught it. The same rule reaches a
price: `aiValueAsset` renders an absent momentum as `n/a`, and an asserted test
keeps it from becoming `0`.

### What is still on record, and why

`scripts/sqlite-columns-baseline.json`'s six `metrics_snapshots.*` lines are
**deleted** — the guard fails on an entry that has since been created, so the
ledger cannot go stale, and the matching assertion in `schema_guards.test.mjs`
shrank with it.

`sqlite-table-collisions-baseline.json`'s entry **stays**, with its text
corrected. The DDL files still disagree: `sql/infrastructure.sql` declares a shape
nothing builds from and now nothing writes. That is a documentation collision
rather than a live one, and retiring the file is its own small task.

## D87 — The per-project metric series gets its own table, and two live writers start working

**Task #203**, found by closing #202. Excluding `sql/historical/` from
`check-sqlite-table-collisions.mjs` left `metrics_snapshots` with five LIVE
definitions, and two of them were writers nobody had counted.

### The break, measured

Production's `metrics_snapshots` is the DEAL shape `routes/pipeline.ts` creates at
runtime — `deal_id NOT NULL, snapshot_date, key_metrics, traction_score,
ai_review, created_by` — plus ten metric columns that `progress.ts`'s own
`ensureMetricsSnapshotsSchema` ALTERed in. That ALTER trail is visible in the
baseline as the comma after `created_by`, which is how we know the helper has run.

Its `required` list never included `project_id`, `mrr`, `active_users`, `notes`
or `source`. And:

- **`routes/progress.ts:1784`** — the founder metrics-snapshot POST — INSERTs all
  five.
- **`integrations/providers/stripe.ts:337`** — the Stripe MRR sync — INSERTs four.

So both threw `no such column: project_id`. A founder entering KPIs got a failure;
a Stripe sync wrote nothing. `computeLifecycleSignals` wraps its read defensively,
so `latest_mrr`, `active_users`, `monthly_churn_pct` and `new_users` returned NULL
on every call — a founder's lifecycle signals were permanently blank and nothing
said why.

### Three things kept it invisible, and each is now asserted against

1. **A helper believed to do what it could not.** The comment above
   `computeLifecycleSignals` said *"pipeline.ts also writes a deal-keyed
   metrics_snapshots, so we ensure the founder-metrics shape first."* An ALTER
   cannot turn a `deal_id` table into a `project_id` one. A test now creates a
   deal-shaped table, runs the bootstrap, and asserts `project_id` is still absent
   — so nobody restores the belief.
2. **A guard that cannot see it, by design.** `check-sqlite-columns` unions every
   CREATE TABLE, so each writer's own `CREATE TABLE IF NOT EXISTS` contributed
   `project_id` and `mrr` to the known set and its INSERT validated against them.
   That guard's docblock states the limitation and names
   `check-sqlite-table-collisions.mjs` as the complement — which is exactly how
   this surfaced.
3. **A docblock asserting the opposite of the truth.** `services/saasMetrics.ts`
   said the `project_id` shape was *"the LIVE one … what every metrics handler
   reads."* Every clause was false about production. It is corrected, and the
   correction says what it used to say, because a doc that confidently states the
   wrong schema is load-bearing in the wrong direction.

A fourth kept it invisible in CI: **three test fixtures hand-wrote
`metrics_snapshots` with `project_id`**, and one apologised for it in advance —
*"in the shape `ensureMetricsSnapshotsSchema` creates (project_id, not the
baseline dump's historical deal_id)."* Calling production's shape "historical" is
how a fixture comes to certify a broken feature. All three are repointed.

### The decision: a new table, not four more ALTERs

Migration 249 creates `project_metrics`. The alternative — adding the five columns
to `metrics_snapshots` — was rejected on two grounds:

- **The reader families are disjoint.** `deal_id`: `pipeline.ts` (three reads) and
  `services/tractionSnapshots.ts`. `project_id`: `progress.ts`'s whole CRUD
  surface plus three rollups, `research.ts`, and `stripe.ts`. Merging them would
  make the deal side's `SELECT *` reads return project rows with every traction
  field NULL — the pollution D86 refused for the review annotation.
- **`deal_id` is `NOT NULL`.** A project row would have to put something there.
  `deal_id` IS a `projects.id` (D86), so it would be the same number in two
  columns: a thing that works by coincidence and breaks the first time someone
  changes what `deal_id` means.

**No backfill, and that is provable rather than hopeful.** The old writes named a
column that does not exist, so they always threw. There has never been a
project-keyed row to move.

### The uniqueness that replaces a read-modify-write

`UNIQUE(project_id, snapshot_date, source)`, so `stripe.ts` upserts instead of
`DELETE`-then-`INSERT`. The old pair had a window where the day carried no figure
at all, and — worse — the DELETE was inside a `try/catch` while the INSERT was
not: a failed delete left a duplicate, a failed insert took the whole sync down.

`excluded.*` names only the four figures Stripe knows. A blanket replace would
wipe a founder's headcount for the same day, because Stripe has no opinion about
their headcount.

**A NULL `source` does not collide** — SQLite treats NULLs as distinct in a UNIQUE
index — and that is deliberate. A hand-entered figure is a statement someone made,
not a projection to be silently replaced, so the route decides whether a second
entry updates or adds. A founder's figure and Stripe's figure for the same day are
two claims and are two rows.

### Dollars, carried over rather than re-decided

`check-money-cents` correctly flagged four new REAL money columns. They are
recorded in the baseline with the reason rather than converted: `saasMetrics.ts`
computes LTV:CAC, CAC payback, burn multiple, CMGR and runway over these as
dollars, `financial_models.assumptions_json` carries `mrr` and `arr` as dollars
beside them, and the SPA renders both. Converting the column without converting
that chain would put two denominations one join apart, which is worse than either.
Re-denominating the metric series is its own task.

### One latent bug fixed on the way, found by a test

`ensureProjectMetricsSchema`'s readiness flag was a module-level `let … = false`,
so the first `env.DB` to bootstrap marked the helper done for **every** database in
the isolate. In production there is one D1 and it never showed. It is a `WeakMap`
keyed on `env.DB` now, matching `services/painGroups.ts` and
`services/discoveryInterviewSchema.ts`, which key readiness that way for exactly
this reason.

---

## D88 — `/build/cadence` gets a store: rituals, runs, templates — and the archive is what somebody wrote down

**Date:** 2026-09-13 · **Task:** #176 (FB4) · **Migration:** 250

`/build/cadence` was the emptiest zone in the product and the most talkative about
it. The page loaded the project list and no second source, printed "Cadence store
unavailable" in four places, showed four `Unavailable` stat cards and a
three-row "Capability coverage" list — and its four filter chips and three ops
were all registered `unbuilt`, which renders **nothing**. So the artboard's
toolbar shipped empty while the body explained at length that it could not work.
Reported three times; the user's words were "doesn't look at all like the one from
the artifact".

Migration 250 gives it three tables and `routes/founder_cadence.ts` reads them.

### Three tables, because three different things are being stated

A **ritual** is a standing intention ("we retro on Fridays"). A **run** is what
happened on one date, including not happening. A **template** is the prompt a
ritual is conducted from.

Folding runs into rituals would make the archive a property of the schedule, so
editing the schedule would rewrite history. Folding templates in would stop two
rituals sharing one prompt, which is the first thing a founder with a Monday plan
and a Friday retro wants.

### Every figure above the archive is computed, and none is stored

Reviews archived, adherence, the template count and the average retro length are
counts over `ritual_runs` and `ritual_templates`. `founder_validate.ts` states the
rule this follows: a stored count is a second answer to a question the rows
already answer, and the two disagree the first time a row is edited.

Three of the four had a wrong-but-plausible implementation waiting, and each is
pinned by a test:

- **Adherence over an empty archive is NULL**, not 0% (which says the founder
  adheres to nothing) and not 100% (which congratulates them for it). The
  denominator is returned beside the percentage, because adherence over three runs
  and over three hundred are different claims.
- **An untimed retro is excluded from the average, not counted as zero minutes.**
  What protects this is `intOrNull` checking emptiness **before** `Number()` —
  `Number(null)` and `Number('')` are both 0 and both finite, the trap #203
  shipped once in the function whose docblock forbade it. Verified against
  `node:sqlite` that SQL's own `AVG` also skips NULLs.
- **`reviews archived` is its own aggregate, not `runs.length`.** The archive is
  capped at 500 rows so a Worker's memory envelope stays predictable; a count
  taken from the returned page would be right for every account under 500 reviews
  and silently stuck at 500 for the ones that have most.

### Adherence cannot see a skip nobody recorded, and that is not patched over

`done / (done + missed)` needs the missed rows to exist, so a project that logs
only its successes reads 100%. Inferring a miss from a scheduled date with no row
would mean deciding a founder on holiday broke their cadence. The figure reports
its denominator instead.

### One run per ritual per date, which replaces nothing and prevents a lot

`UNIQUE(ritual_id, run_date)`, and the writer upserts. Friday's retro happened
once; without the index a double-submit files it twice and **every** count above
the archive is then wrong in the direction that flatters. Keyed on `(ritual_id,
run_date)` rather than `(project_id, run_date)` — the latter would make a Monday
plan and a Monday standup mutually exclusive, which is most founders' Monday.
Both columns are NOT NULL, so unlike migration 249's `source` there is no
NULL-distinctness hole.

### Retiring keeps the archive; deleting does not

`active = 0` retires a ritual and its runs stay, because the archive is the zone's
reason to exist. Deleting takes the runs with it: a run with no ritual has no name
and no kind, so it would draw as a blank row and match no filter. The page offers
retire first.

### The filter row mixes two axes, and that is the canvas's choice

`All rituals · Plans · Retros · Skipped` — the first three select the ritual's
KIND, the fourth the run's STATE. A missed retro is under both, so the counts do
not sum to the total. Asserted rather than tolerated, in
`frontend/test/cadence_vocabulary.test.mjs`, because a reader who expects them to
sum will conclude the numbers are broken.

### `other` is a kind, and it is load-bearing

Without it a founder's weekly investor sync has to claim to be a retro to be
stored at all — and then it lands in the `Retros` filter and in the average retro
length. A store that forces a wrong answer gets wrong answers. The worker coerces
an unrecognised kind to `other`, which is why the form has to offer it: otherwise
the coercion is invisible to the person filling it in.

### "1 customised" is a timestamp, not a boolean

`ritual_templates.edited_at` records that someone saved a change. A `customised`
flag would be a stored derivation; a timestamp is a fact, and it answers the next
question a reader has. The three built-in starting points are **not** seeded rows:
a GET that writes cannot be retried safely, and a seeded row is indistinguishable
from one the founder wrote, which would make the count a statement about the
platform rather than the venture.

### What the page stopped saying, and the one sentence that survives

Every "unavailable" claim is deleted rather than softened — a refusal kept beside
a working feature is the failure #193 was filed for, and `NO_CADENCE_STORE` is
gone from `founderZoneFilters.js` for the same reason `NO_SESSION_RECORD` went
when migration 221 landed. A stat card with nothing in it now reads **"Not yet"**
rather than "Unavailable": the platform can answer, the account has not got there,
and #180 is about exactly that distinction.

What survives, because it is still true: **a calendar event is not an operating
ritual and a roadmap change is not a review outcome.** Nothing here reads
`calendar_events`. An archive assembled from side effects would report a cadence
nobody ran.

### Three things a mutation sweep changed, not just confirmed

24 mutations applied, 24 caught, and two more proved **equivalent** rather than
escaped — worth recording so nobody tries to close them:

- Removing `decided > 0` computes `Math.round((0 / 0) * 100)` = NaN, and
  `JSON.stringify({ a: NaN })` is `{"a":null}`. The response is byte-identical, so
  no assertion at the HTTP boundary can distinguish it. The guard stays.
- `AND r.duration_minutes IS NOT NULL` is redundant with SQL's `AVG`, verified
  against `node:sqlite`. It stays as a statement of intent; `intOrNull` is what
  actually protects the figure.

And one real bug the sweep found rather than confirmed: the retro **target** was
read from the average's row set, so a retro ritual whose runs were all untimed
contributed no target either — a founder who had set "target 30" and never timed a
retro read "No target set". It is its own query now. The target is a property of
the ritual; the average is a property of its timed runs.

### `/starters` had to be registered above `/:projectId`

Hono matches in registration order, so the literal path resolved as
`projectId = 'starters'`, `Number('starters')` was NaN, and the route answered 400
"Invalid project id". A test found it. A static segment goes above the parameter
that would otherwise eat it.

### Three guards were corrected, not loosened

- `profile_zone_actions.test.mjs`'s identifier scan read **comment words** as
  variable names (`// Both ops need a venture.` → an undeclared global `Both`).
  `codeOnly()` now runs on the call text — the same helper two tests above already
  uses on the whole file. Narrowing a scan to code can only remove false alarms,
  and the guard's own note says a false alarm is what gets a guard weakened.
- `profile_zone_filters.test.mjs` asserted all four cadence chips were disabled
  and unselectable. That fact changed, so the assertion is **inverted**, not
  relaxed: four live chips, no hover text, exactly one active, and the shared
  reason gone from the module.
- `_deck-loader-hook.mjs` could not import any page that imports its stylesheet —
  `ERR_UNKNOWN_FILE_EXTENSION` before the first assertion. A `.css` import is now
  an empty module, which is what Vite does for the real build. Until this existed,
  testing a page's exported predicates meant regexing its source, which proves the
  file contains a string rather than that the module exports a working value.

### `CADENCE_VIEWS` lives in the page, and a guard is why

`zoneFilterBuilder`'s contract is that the table owns the labels and the **page**
owns the predicate (`FounderValidateWorkspace`'s `PAIN_VIEWS` is the same shape),
and `profile_zone_filters.test.mjs` proves a live filter key appears in the page
that would have to serve it. With the four predicates in `lib/cadence.js` the keys
were nowhere in the page and that guard failed — correctly. The worker exports its
own `CADENCE_VIEWS` with the same four keys and
`frontend/test/cadence_vocabulary.test.mjs` compares the two, values and meanings
both, because `frontend/` and `cloudflare-worker/` cannot import each other.

---

## D89 — `/build/kpi` gets definitions and an importer, and stops denying the targets it already had

**Date:** 2026-09-13 · **Task:** #176 (FB5) · **Migration:** 251

Two of `/build/kpi`'s four ops were `unbuilt`, which renders nothing — so the
artboard's row shipped with half its controls invisible. And the page carried
**three claims that were already false**, which is the more interesting half.

### What the page was denying

- `Against target · Unavailable`, noted "Targets are not stored in this source."
  `metric_targets` has been stored since migration 173 and given a reader and a
  writer by #194. This page simply never read it.
- `Definitions unavailable`, drawn as a disabled chip.
- A closing note: "Targets, target variance, cash/burn fields, and metric
  definitions are not returned by the current source." Wrong on all four —
  variance is computed from the first two, and `net_burn` / `cash_balance` are
  columns `project_metrics` has and `progress.ts`'s POST has always accepted.
- The rail's `['Target comparison', 'No target source is connected.']`.

Every one is deleted rather than softened. A refusal kept beside a working store
is the failure #193 was filed for, and this is the second zone in one pass where
the refusal outlived its fix.

### The ledger was showing seven of twelve metrics

`net_burn`, `cash_balance`, `headcount`, `nrr_pct` and `paying_accounts` were
absent from the page's `FIELDS` — three of them rows the canvas's own table draws.
A founder who had entered a burn figure could not see it, and "Missing cells"
counted out of seven. All twelve are listed now, and their LABELS come from
`lib/metricTargets`'s `METRIC_LABELS` rather than a second copy of the same twelve
strings: two label tables that agree today is exactly when to merge them.

### A definition is not a target, and `metric_targets` proves it

`metric_targets.target_value` is `NOT NULL`. Hanging a `definition` column there
would mean defining "net burn" required inventing a plan number for it — and then
"4 of 6 against target" would count a metric nobody set a target for. So migration
251 is its own table, `UNIQUE (project_id, metric_key)` on the same key shape so
the two are joinable per metric. Same call as 249 and 250: ask what the row is
FOR, not what it is near.

`source_kind` there is **not** `project_metrics.source`. One records where the
founder intends a metric to come from; the other where one row actually came from.
The two disagreeing is a finding — a metric declared Stripe-synced whose rows all
say `manual` means the integration is not running — so both are kept.

"1 customised" is `edited_at`, a timestamp: a fact, not a stored derivation. And
the three built-in starting points are **not** seeded rows — a GET that writes
cannot be retried safely, and a seeded definition is indistinguishable from the
founder's own, which would make the count a statement about the platform.

### The importer's real feature is the rejection list

`services/metricsCsv.ts` parses; the route writes. An importer that reports "OK"
while eleven of fourteen months went missing is worse than one that fails, because
the founder finds out six weeks later when a board pack is short. So:

- a verdict **per line**, with the line number in the FILE (header included) so it
  matches what their editor shows;
- `dry_run: true` runs the same parse and writes nothing, so the committing press
  is never the first thing that reads the file — one endpoint, one parser;
- the row cap is reported line by line, never applied quietly;
- a duplicated month is **refused, not last-wins**: both lines look deliberate and
  a silent pick drops a figure the founder can see in their own file;
- a row whose every metric is blank is refused rather than written as a month of
  nulls, or "months on record" counts rows the import invented.

It reads what a spreadsheet actually holds — `$104,800`, `1.2%`, `(61,200)` for
negative, `—` and `n/a` for absent, `2026-08` / `08/2026` / `Aug 2026` for the
month — and refuses `08/02/2026`, which is February in one country and August in
another. A date the platform picked is a row filed against a month that may not
have happened.

**`source = 'csv'`, and that is load-bearing.** `project_metrics` is unique on
`(project_id, snapshot_date, source)`, so an import can never overwrite a figure
entered by hand, and re-importing a corrected file updates the import's own rows.
`DO UPDATE` uses `COALESCE`, so a second file covering only MRR does not blank the
burn the first one carried — the difference between a correction and a truncation.

### Two more equivalent mutants, and one real find

22 mutations applied, 22 caught. One proved equivalent: removing
`month < 1 || month > 12` from the date validator changes nothing, because
`lengths[12]` and `lengths[-1]` are both `undefined` and `1 <= undefined` is false.
The check stays — a date validator should state its rule rather than rely on an
out-of-bounds comparison happening to be falsy.

The real find: the parser held a **literal, invisible U+FEFF** in a regex to strip
Excel's byte-order mark — and `trim()` already strips it, since U+FEFF is
`<ZWNBSP>` in the spec's WhiteSpace production (verified against node). So the
replace was redundant AND was the kind of byte an editor or a reformat eats,
leaving a regex that matches everything. It is gone; every BOM in the tests is now
written as an escape. And the trim turns out to be load-bearing for exactly one
header — `notes`, matched by an exact comparison with no alias entry — which is
now the assertion that holds it.

### The test had to mount the router the way production does

`progress.ts` refuses by `throw new Error('Forbidden')` and nothing in that file
maps it; `index.ts`'s app-level `onError` does, via a table whose own comment says
"Without this, RBAC failures surface as 500s and the frontend can't distinguish
'log in again' from 'the server crashed'." Driving the sub-router alone returns
500 for what is a 403 in production. Rather than accept `403 || 500` — which would
make a genuine crash read as a refusal — the test attaches the same three-line
mapping and asserts 403 exactly.

### One latent bug fixed on the way

`ensureMetricTargetsSchema`'s readiness flag was a module-level `let`, the same bug
#203 found in `ensureProjectMetricsSchema` twenty lines above it: the first
`env.DB` to bootstrap marks the helper done for every database in the isolate.
Production has one D1 and it never showed. Fixed to a `WeakMap` keyed on the
binding rather than left sitting beside its own fix.

---

## D90 — `/build/this-week` gets a week history, and it is the transitions that are stored

**Date:** 2026-09-13 · **Task:** #176 (FB1) · **Migration:** 252

Three of `/build/this-week`'s four chips were `unbuilt` — `Last 4`, `All 14`,
`Carried only` — under one reason that was true: "a key result carries no week, so
there is no earlier week to open", and "nothing records a commitment moving from one
week to the next". `roadmap_okrs` has a `kanban_status` and an `updated_at`, and
`updated_at` moves when the **title** is edited, so it cannot say when an objective
was committed. `unbuilt` renders nothing, so three quarters of the artboard's filter
row was invisible.

### The transition is the fact; the week is derived

A `week_start` column on `roadmap_okrs` would hold one week — the current one — and
answer none of the three questions. "Was it in Now four weeks ago" needs history,
and history on a single column is a column that gets overwritten. So migration 252
is an append-only log of column changes, `okr_column_moves`, and every window is
derived:

- **This week** — the OKR's current `kanban_status`, which needs no history and is
  why that one chip alone kept working.
- **Last 4** — has a move *to* `now` whose week is one of the last four.
- **All weeks** — has ever had a move to `now`. The chip's count is WEEKS, not
  objectives: the canvas says "All 14", meaning fourteen weeks.
- **Carried only** — is in Now *now*, and its **earliest** move to Now was in an
  earlier week. Reading the latest instead would make anything touched this week
  look new, which is exactly how a three-week-old commitment escapes the chip that
  exists to surface it.

### A reorder is not a commitment, and that is the load-bearing condition

A drag within one column arrives at the same endpoint with the same
`kanban_status`. Logging it would put a "committed to Now" row in every week a
founder tidied their board — so `Carried only` would find nothing carried, because
every card would have a commitment in the current week. Live, selectable, always
empty: the failure `zoneFilterBuilder.js` opens its docblock with. The log is
written only when the column actually changed.

### The log never fails the move

A card that moved on the board and then reported an error is a card the founder
will drag again. The write is wrapped, the failure is logged server-side, and the
move returns 200.

### No backfill, and the page says so instead

An OKR already sitting in Now has no move row, so it appears under `This week` and
not under `Last 4`. The only timestamp available to invent one from is `updated_at`,
which may be when someone fixed a typo — a week derived from that would be a
specific, confident, wrong answer. The route returns `history_since`, the earliest
week on record, and the zone prints it: the empty state under a narrow chip says
"the column history starts in the week of X" rather than repeating the
nothing-in-Now sentence. The seam heals in four weeks of use and never lies.

### `(day + 6) % 7`, and why that line has four tests

`getUTCDay()` is 0 on **Sunday**. The offset back to Monday is therefore
`(day + 6) % 7` — 0 on Monday, 6 on Sunday. `day - 1` is correct on six days in
seven and sends every Sunday *forward* a day, which puts a Sunday commitment in
next week, makes `Carried only` show this week's new work as carried, and raises no
error anywhere. The arithmetic lives in `services/okrWeeks.ts` so it can be
exercised by calling it; 15 mutations were applied to it and 15 caught.

`Date.UTC(y, m - 1, d)` from the integers, never `Date.parse(iso)` — the trap
`interview_date` and `lib/cadence.js` both already carry notes about. A malformed
date returns null rather than falling back to the current week, and an unparseable
"today" makes the carried set **empty** rather than everything: the chip's job is to
single out a few rows, so failing open would make it useless and look like an
answer.

### Three refusals that outlived their fix, all in one pass

`NO_WEEK_STAMP` joins `NO_CADENCE_STORE` (D88) and `NO_SESSION_RECORD` (migration
221) as a shared `unbuilt` reason **deleted** rather than reworded once its store
landed. Three in one file now. A reason that survives its own fix gets cited again,
and the pattern of removing the constant — not just the entry — is what stops that.

The page's stale claims go with them: a "Weekly history · Unavailable" stat card is
now weeks on record; a card headed "Weekly history is unavailable" whose body said
carry-overs "require a cadence history source that is not connected to this desk" is
now the list of weeks; and the rail's `['Weekly history', 'No cadence archive is
returned by the available founder read API.']` is replaced by what is genuinely
absent — a plan the platform wrote.

### A hand-written fixture was wrong on the first try, which is the argument

`okr_move_log.test.ts` first spelled the column `key_results`; it is
`key_results_json`, and every route call died on `no such column`. The fixture now
takes `roadmap_okrs` from `schema_baseline.sql`. A hand-copied DDL that drifts makes
every assertion above it true of a schema production does not have — the whole of
#203 — and it happened here within minutes of the rule being restated.

---

## D91 — `/build/board` gets swimlanes, and the WIP limit refuses the move

**Date:** 2026-09-14 · **Task:** #176 (FB2) · **Migration:** 253

Two of this zone's five chips were not in the registry **at all**. `Engineering` and
`GTM` were one entry reading "a card carries a stage, not a lane, and no lane is
stored", and `unbuilt` renders nothing — so the artboard's five-chip row drew three.
`Configure lanes` and `Bulk move` were `unbuilt` too, and the first of the two named
its own fix: "the six lanes are written into the code twice and no per-project stage
list is stored, so there is nothing for an editor to change."

### A lane is not a status, and that is the whole reason this was buildable

The status is **where** a card has got to in its life (todo → doing → done); the lane
is **whose** work it is (Engineering, GTM, Ops). The canvas's own instrument carries
both on every row — `Card | Lane | Age | Owner` — and its note depends on the
difference: "Engineering is one card over its WIP limit of four, which is why the
permissions card sits in backlog rather than starting." A WIP limit counts cards in
flight *within* a lane, which cannot be expressed at all if the lane **is** the
status.

Read as a stage list this looked impossible, because the six pipeline stages are a
literal written twice (`FounderBuildBoard.jsx` and `pages/PipelinePage.jsx`) and are
genuinely not a founder's to change. Read as a lane it was a table and a nullable
column: `project_lanes` per project, `mvp_tasks.lane` per card. The stages are still
a literal, still written twice, and this change does not touch them.

### The lane is stored as a name, not a `project_lanes.id`

The alternative makes a rename either break every card in the lane or need a cascade.
The name is what the founder typed and what the board draws, so a rename is one
`UPDATE` on the cards and one on the lane — and `PUT /:projectId/lanes` with an `id`
does exactly that pair, which is why renaming carries the cards rather than orphaning
them.

The cost is real and is paid in the open: a card can name a lane that no longer
exists. `DELETE /lanes/:id` **unassigns** its cards rather than deleting them, the
read returns those names as `orphan_lanes`, and the board draws them as their own
group. A card nobody can see is worse than a lane nobody configured.

### Nothing is seeded, and unassigned is a group rather than an absence

A project that has never configured lanes has none, and all its cards are
`lane IS NULL`. The board draws them as one "Unassigned" group; it does not invent
Engineering, GTM and Ops on the board of a solo founder building a design tool. The
dynamic chip group therefore keeps a reason — `zoneFilterBuilder` draws nothing for a
group with no names, and "the page forgot to pass them" and "this venture has none"
are different problems with the same appearance.

### `wip_limit` NULL is not `wip_limit` 0

Zero is a **real** limit: a lane closed to new work, which is how a founder pauses a
workstream without deleting its cards. `Number('')` is 0 and finite, so a blank
coerced before being tested would close a lane the founder meant to leave unlimited —
the `Number(null) === 0` trap #203 was built out of, hit again three files later.
Emptiness is checked before `Number()` in `intOrNull`, and the dialog sends `null`
for a blank rather than `0`.

### The limit refuses, all-or-nothing, and the refusal is rendered

`POST /:projectId/cards/bulk` counts what the destination lane would hold and answers
**409** with `{ lane, wip_limit, would_be, moved: 0 }` — nothing moves. A partial move
that reported an error would leave the founder to work out which cards landed, which
is worse than a refusal.

`BulkMoveDialog` reads those **fields**, not the message: "Engineering would hold 6 in
flight, over its limit of 4. Nothing was moved." A generic "something went wrong"
there would hide the one number the founder needs to decide between raising the limit
and moving fewer cards.

### What counts as in flight, and why an unknown status counts

`NOT_IN_FLIGHT` is `todo`, `backlog`, `done`, `cancelled`, `archived`. Backlog is
excluded because the canvas's own note has a card sitting there *because* the lane is
full — counting it would make the limit self-fulfilling.

`mvp_tasks.status` is free text from the client, so the list cannot be exhaustive, and
the conservative reading of a status nobody recognises is "somebody is doing this".
An unknown status therefore **counts**: the limit holds a little too tightly rather
than not at all. A WIP limit that can be walked past by inventing a status is not a
limit.

### `Mine` was a false refusal, not a gap — and the Owner cell was worse

This is a #193-class finding rather than anything migration 253 built.
`mvp_tasks.assigned_to` is an **INTEGER user id**, so "Mine" was always answerable
from data the board already had; the chip was refused on a belief about the column.
The page now filters on the reader's own id from `useAuth()`.

The related defect was upstream of the chip: the table's Owner cell was printing the
raw integer. A founder read "Owner: 41" on their own board. It now names the reader
where the id is theirs and says "assigned" or "unassigned" otherwise, which is all
this route can honestly say — `mvp_tasks` has no join to a user's name, and inventing
one here would be a second table's work.

### `Automations` stays a stated gap, deliberately

The artboard reports "Automations · 3 · 1 paused" and gives nothing else: no trigger
vocabulary, no action vocabulary, no example rule. A rules engine built from a count
would be inventing the feature rather than integrating it — the one thing #176 asks
not to do. The entry keeps its engineering reason and gains a founder-facing `hover:`
under the tooltip cap, so the disabled control explains itself on the board instead of
only in the source.

### The one interpolated SQL statement in this route, and why it is safe

A bulk update over N selected cards needs N placeholders:
`const placeholders = ids.map(() => '?').join(',')`. The interpolated text is derived
from the *length* of an array of numbers that have each been through `Number.isFinite`
— no caller-supplied character reaches it — and every value is still bound. It is
recorded in `scripts/sql-prepare-baseline.json`, the argument is in the docblock beside
it, and a test asserts the statement's shape so a future edit that interpolated a
value instead would fail rather than pass quietly.

### Two things the tests found that review had not

A typo'd bulk status fell through to "Nothing to change": an unrecognised status
resolves to null, the body then looked empty, and the route answered 200 having done
nothing. The unknown-status 400 now comes first, so a client sending `in-progress` for
`in_progress` is told.

And a lane with no limit was accepted as a destination without counting anything,
which is correct — but nothing asserted it, so a mutation that made an unlimited lane
*refuse* survived. The gap is closed with an assertion rather than left as a passing
sweep: 22 mutations applied, 22 caught.

### The guard that a reformat silently shrank

Worth recording because it is general, and because it nearly hid this work's own
regression. Five assertions in `frontend/test/profile_zone_actions.test.mjs` each
extracted the zone-action table with their own line-anchored
`/^ {4}\{ …label: '…'/gm`, which is correct only while every entry fits on one line.
`Automations` gained its `hover:` string, went multi-line in the house style every
other list in this repo uses, and vanished from all five at once: the canvas-order
comparison saw a zone one op short, and the links + exports + handlers + gaps sum
stayed balanced *because the entry had left both sides of it*. One test failed, and it
failed pointing at the canvas.

The fix is not a formatting convention. The reader now closes an entry at its own `}`,
and it counts the table's `label:` keys by a separate route so it can be compared
against the entries it actually parsed — read fewer than the table has and the file
says so instead of quietly asserting less. Reformatting the entry back onto one line
would have made the suite green and left the next multi-line entry invisible.

---

## D92 — `/build/roadmap` gets a dependency graph, and a chip that was live over nothing

**Date:** 2026-09-14 · **Task:** #176 (FB3) · **Migration:** 254

Two of this zone's four chips were wrong in opposite directions, and the second is
the one worth recording.

`Scenarios` was honestly refused — "no roadmap scenario is stored", which was true.

**`Dependencies` was LIVE and could never show a row.** `FounderBuildRoadmap.jsx`
filtered on `item.dependency || item.dependencies || item.blocks`; `roadmap_okrs`
has none of those columns and `progress.ts`'s `OKR_SELECT` returns none of them.
Selecting the chip emptied the table under the caption "items naming a
dependency", which a founder reads as *this venture has none* rather than
*nothing here can have one*. The `Blocks` column said "Not recorded" on every row
and the `At risk` stat said "Unavailable" — the same emptiness in three different
words.

### Why no guard caught it, and what now does

The zone suites count **refusals**: an `unbuilt` entry has to justify itself, the
links/exports/handlers/gaps sum has to balance, a reason may not name a path. This
was not a refusal. It was a working control over a store that did not exist, which
is the failure `zoneFilterBuilder.js` opens its own docblock with and the one thing
those counts are structurally unable to see. Same class as #93.

`frontend/test/roadmap_zone_contract.test.mjs` ties the page to the route by name:
every `item.<field>` the page reads must be a key the handler writes, and every
live `key` in the filter registry must be a branch the page implements. It is
narrow — one zone, one shape — and narrow is what makes it checkable.

### A dependency is an edge, not a column

`depends_on TEXT` on `roadmap_okrs` would hold one unvalidated name and could not
answer "what does this block", which is the column the artboard draws. So
`okr_dependencies` is its own table, indexed both ways, and the edge points from
the **blocker** to the **blocked** — the direction the cell reads.

Four refusals on the write, each a state the graph cannot hold rather than a
policy: no self-link; both ends on the same roadmap (without which naming another
venture's objective id would confirm it exists); no duplicate edge; and **no
cycle**, because two objectives blocking each other can never be cleared by
anybody and would make the state walk meaningless. The unique index is on the
*ordered* pair, so the table itself will happily store `A→B` and `B→A` — the route
is the only thing standing between the founder and that trap, which is why the
cycle check has its own tests at one, three and four hops.

### `At risk` is not derivable, and a provably-empty state nearly shipped

The artboard's `State` column draws Blocked, In flight, At risk and Provisional.
The first draft of `services/okrGraph.ts` derived **At risk** as "downstream of
something blocked, but not itself blocked" — and that set is **always empty**. If
`B` is blocked then `B` is not done, so any `X` that `B` blocks has an unresolved
direct upstream and is blocked by the direct rule. There is nothing the transitive
rule can reach that the direct rule has not already claimed.

Shipping it would have re-introduced the exact live-but-empty bug this change
exists to fix, one file from its own fix. It was caught by reasoning the rule
through before building on it, and `okr_graph.test.ts` now asserts that **every
state in `STATE_LABELS` is reachable** — a state no input can produce is a chip
that draws and never fills.

Nor can the artboard's rows be reverse-engineered into a rule: `Handoff schema` is
Blocked and blocks two items, one drawn **In flight** and the other **At risk**.
Two items with the identical relationship to the identical blocker carry different
states, so the copy is illustrative and there is no rule in it to recover.

**So risk stays unanswered and the page says why.** `Blocked` is the honest version
of that number, and a card beside it explains what would have to be stored for risk
to mean anything — when an objective became stuck, which nothing records.

### A scenario is saved and compared, never applied

`Saved scenarios · 2 · "raise slips 6wk"` is the artboard's stat, so a scenario is
a named what-if somebody wrote down. It stores **an alternative quarter per item**
and nothing else: the quarter is the only field a what-if plausibly moves, and
copying whole OKRs would make a scenario go stale the moment somebody fixed a typo
on the live one.

It does not write back, and the dialog says so. The artboard offers `New scenario`,
`Export` and `Configure` and no "apply" anywhere; a bulk edit of every quarter on
the board from a control nobody drew is inventing the feature. Saving replaces the
item list rather than merging it, because a scenario is one coherent story — merging
would leave an objective the founder removed still in it.

`New scenario` stops being a link to `/execution/roadmap`. That note said
"objectives and key results are edited in Execution", which was true of objectives
and beside the point here: that editor writes the **live** quarter, which is the one
thing a what-if must not do.

### `Configure` stays a stated gap

The same argument as `/build/board`'s `Automations` (D91): the artboard names the
control and specifies no setting for it to change — no default quarter, no horizon,
no ordering rule, no example. A settings screen invented from a button label is
worse than a disabled control that says why.

### Two test-harness traps this change walked into, both now shared

`splitStatements` in `cloudflare-worker/test/_baseline.mjs` exists because the
fixtures' `sql.split(';')` cut migration 254's own prose in half — "…`item.blocks`;
`roadmap_okrs` has none of those columns" — and handed the second half to SQLite,
which failed quoting the migration's comment. **51 migrations have a semicolon
inside a `--` comment**, and at least five put one in a *trailing* comment after
real SQL, which stripping whole-line comments does not fix. The shared splitter
tracks string literals instead: `--` opens a comment and `;` ends a statement only
outside a quoted string, with `''` as the escape.

And the route test answered 500 where production answers 401, because `requireAuth`
refuses by `throw` and only `index.ts`'s app-level `onError` maps it — the third
time that has bitten in this pass (D89's `progress.ts` tests, and again here). The
mapping is composed into the test app, and the refusal is asserted as 401 exactly.

---

## D93 — four of Raise's seven refusals were false, and one constant was hiding three of them

**Date:** 2026-09-14 · **Task:** #177 · **Migration:** none

`/raise/*` carried seven `unbuilt` entries. **Four were not true.** No migration,
no route and no table was needed to close them: every one was already served by an
endpoint the founder could already call.

| Refusal | Verdict |
| --- | --- |
| `raise/status` → `Timeline` | **false** — both sources carry dates |
| `raise/pitch` → `Shares` | **false** — the page was already holding the array |
| `raise/liquidity` → `Restrictions` | **false** — the ledger is mounted and founder-reachable |
| `raise/liquidity` → `History` | **false** — same endpoint, same array |
| `raise/liquidity` → `Tender` | true, and it needed its own sentence |
| `raise/pitch` → `Variants` | true — `pitch_decks` has no variant column |
| `raise/status` → `Share war-room` | true — no share mechanism exists for this view |

### The refusal that described its own mapper

`Timeline` said "the assembled rows carry a state but no date, so they cannot be
put in order". That is a true statement about the twenty lines above it and a
false one about the data: `raise_prospects` and `legal_documents` both carry
`created_at` and `updated_at`, and **both routes `SELECT *`**, so every date was
already on the page. The mapper simply did not copy it into the row.

This is the sharpest version of the pattern D91 recorded for `/build/board`'s
`Mine` and D92 for `/build/roadmap`'s `Dependencies`: a refusal written from a
belief about the source rather than from the source. The fix is two lines —
`at: x.updated_at || x.created_at || null` on each — plus a sort.

`updated_at` leads because the question is "what moved last", not "what was filed
first". A row with neither is kept and sorts last, and an unparseable stamp sorts
last rather than as epoch zero — which would put it **first** under a heading that
says most recent.

### The refusal to data that was already on screen

`Shares` said "share links are held by the deck builder and are not returned to
this page". `GET /decks/:id/engagement` returns a `shares` array — id, created,
expires, view_limit, view_count, exhausted and, since #196, `revoked_at` — and
`FounderRaisePitch.jsx` was **already calling that endpoint and already reading
that array** to build the Analytics table. The links were never absent; they were
on screen in the shape of their *readers*. `Shares` asks the other question: which
links exist and which still open.

### One constant covering three absences, two of which were not absences

`NO_LIQUIDITY_LEDGER` — "no restriction, tender or liquidity-event ledger is
connected" — sat on `Restrictions`, `Tender` and `History`. But
`liquidity_events`, `secondary_listings` and `secondary_rofr_notices` all exist,
`routes/liquidity.ts` is mounted at `/api/liquidity`, and nine `api.liquidity*`
methods reach it.

**The gate is the fact that mattered.** `GET /liquidity/events` is restricted to
admin, partner and investor — a founder is refused there, which is probably how
the belief formed. `GET /liquidity/my-portfolio` is `requireAuth` **only**, and it
returns `my_listings` and `exit_history`: exactly the two arrays those two chips
needed. The ledger was connected the whole time, through a different door.

The constant is **deleted**, not reworded — the D88/D90 pattern, and this file's
own note about `NO_SESSION_RECORD` had already recorded why: one sentence covering
several absences stops being true one absence at a time and nothing notices. Three
in one file now, and this is the first where the shared reason was false when
written rather than falsified later.

`Tender` keeps a refusal and gains its own words. A tender is the **company**
offering to buy shares back; `secondary_listings` is one holder offering to sell.
Nothing records the first, and calling a seller's listing a tender would misname
the party doing the buying.

### Two live controls that did nothing, found on the way

- **`/raise/liquidity` drew its filter row twice** — the zone header's chips and an
  in-body copy with four hardcoded labels. The copy rendered `Tender` as
  selectable while the registry refused it, and would have kept drawing the old
  four after this change. Removed; one filter row, owned by the registry. Same
  doubled chrome #37 and #40 removed elsewhere.
- **The `Restriction coverage` card had four hardcoded "Not recorded" rows** under
  one sentence saying no source was connected. Two of the four are answerable from
  the ROFR notice (`company_elected`, `investors_elected`); the other two — board
  approval, lockup — are clauses in the Bylaws or the SAFE that nothing parses.
  They are now marked **"No source"** rather than "Not recorded", because those
  are different claims: one says nobody filled it in, the other says nobody could.

### What the page refuses to round

The ROFR window is a **contract term stored per notice** — `secondary_rofr_notices`
says in its own comment that 30 days is common but "a term of the specific
agreement". So the stat reports a single window only when every notice agrees, a
range when they do not, and never an average, which would be a number nobody
signed. And a listing with **no notice served is not clear to transfer** — the
table's comment says a NULL `notice_date` "reads as 'not_started' and therefore
NOT clear" — so the absence is shown as an unanswered question, not a green light.

### Raised, not fixed here

**80 schema bootstraps cache readiness in a module-level boolean** (task #204),
including `rofrSchemaReady` in this same liquidity route. 13 files use the
`WeakMap` keyed on `env.DB` that #203 settled on; there is no guard, and
`GOTCHAS.md` does not record the rule, which is why the pattern kept spreading
after the decision. Stated at its real severity: a module flag is only wrong when
one isolate serves two different bindings, so this is a latent hazard that
reliably breaks tests — not a production outage.

---

## D94 — four more false refusals in Grow, and the two that were right for the same reason

**Date:** 2026-09-14 · **Task:** #179 · **Migration:** none

Grow carried **fourteen** `unbuilt` entries across seven subpages — the largest set
of the three founder buckets. **Four were false.** As with #177, closing them needed
no migration, no route and no table.

| Refusal | Verdict |
| --- | --- |
| `talent` → `Post a role` | **false** — `job_postings` is the store; `/jobs/new` is mounted |
| `talent` → `Bulk reject` | **false as written** — the records exist; the gap is the writer |
| `customers` → `Stalled` | **false** — four activity stamps, all returned |
| `capital-match` → `Warm path only` | **false** — the join has its own migration |
| the other ten | true, and left alone |

### The refusal that denied a whole feature somebody else had built

`Post a role` said "no role posting is stored". **Task #68 built the job board.**
`job_postings` exists and carries a `project_id` — the very column this desk's own
role chips filter on — `jobs.create()` writes one, `routes/jobs.ts` serves it, and
`/jobs/new` is a route `App.jsx` mounts for a founder. The posting surface existed
the whole time; this desk had simply never pointed at it. It is a `to:` link now,
the same correction #193 made four times over.

### The refusal that was right about the gap and wrong about where it was

`Bulk reject` said "no candidate records exist to act on". `job_applications`
exists, `jobs.applications(id)` reads it — its own comment calls it "the sole PII
surface" — and **this page already puts those candidates in a table**. What is
genuinely missing is a **writer**: `routes/jobs.ts` has no endpoint that sets an
application's status, so a reject has nothing to call.

The distinction matters because of who reads the reason. "No records exist" sends
the next engineer to build a store that is already there; "no endpoint sets a
status" sends them to add eleven lines to a route. The refusal stays — correctly —
and now says which.

### A timeline that was there all along

`Stalled` said "no activity timeline is stored, so no account can be called
stalled". `waitlist_signups` carries `created_at`, `invited_at`, `followed_up_at`
and `promoted_at`; `WAITLIST_SELECT` returns every one, and that route's own comment
calls them "independent activity marks".

**The newest stamp is the last touch**, not `created_at` — an account invited
yesterday is not stalled because it signed up in March. And a row whose stamps are
all unparseable is **not** called stalled: silence about a date is not evidence of
neglect, and the false accusation sends a founder chasing a live account.

### A join with its own migration

`Warm path only` said "nothing joins a prospect to a relationship in the network
book". **Migration 128 is named `contact_promotion.sql`**, it adds
`raise_prospects.contact_id`, and it indexes it as `idx_raise_prospects_contact`.
`contacts` is the network book. A prospect carrying a contact id was reached through
somebody the founder already knows — which is the chip, exactly. Nothing is inferred
from a shared domain or a similar firm name.

### A stale guard inverted, not deleted — and its second half was never true

`profile_zone_filters.test.mjs` **pinned `Stalled` as drawn-dead**, and its comment
gave the reason: the chip had once shipped live with a predicate of `return []`, so
clicking it answered "you have no stalled accounts" over a store that — the note
said — "records no stalling at all".

The first half was a real bug, rightly caught. **The second half was never true.**
The guard now holds the opposite state and a stronger claim: the chip must be
selectable *and* the page must compute the predicate from those four stamps. This is
the third stale guard inverted rather than dropped (D88, D90); what is new is that
this one encoded a *false belief* rather than a fact that later changed.

### Getting it wrong in the other direction is also possible

Two of the ten survivors are **dynamic-group** reasons — `talent`'s role chips and
`capital-match`'s stage chips — and both were tempting to call false, because
`job_postings.project_id` and `raise_prospects.stage` both exist. They are correct
as they stand: each page **does** supply names from rows it has loaded
(`dynamic: { roles: jobs… }`, `dynamic: { stages: stages… }`), and the reason covers
only the empty case, which is what a dynamic group's reason is for.

An earlier draft of this work recorded the Talent zone as fetching nothing at all.
That was wrong — the page imports `jobs as jobsApi` and a grep for `api.` missed it.
Deleting those two reasons as false would have been the same error as the four above,
pointing the other way, so the guard now asserts the supply as well as the reason.

### Where the four buckets stand

Across #176, #177 and #179, **ten refusals turned out to be false** and every one
was a belief about the source rather than a reading of it. None needed a new store.
The guards that count refusals cannot see this class, which is why each bucket now
has a contract test tying its claims to the thing that makes them true or false.

---

## D95 — schema readiness is a property of the database, not of the module

**Date:** 2026-09-14 · **Task:** #204 · **Migration:** none

### The bug, stated precisely

115 lazy schema bootstraps remembered "already done" in a module-level
`let _ready = false`. A module is instantiated **once per isolate**; the flag
therefore means *some database this isolate has served is bootstrapped*, while
every `if (_ready) return` reads it as *this database is bootstrapped*. When one
isolate serves two bindings, the second is told the work is done and its DDL never
runs — and what follows is not an exception. It is a `SELECT` against a table that
does not exist, or a read that succeeds against an older shape.

This is #203 with the scope widened: that task found the bug once, in a live
break, and settled on a `WeakMap` keyed on `env.DB`. 16 files adopted it. The
other 115 were never swept, and nothing stopped a new one being written.

### Severity, stated honestly

**This reliably breaks tests and does not reliably break production.** One
production isolate serves one binding, so the flag is usually right by accident.
The realistic failure paths are a test running two fixtures through one module
instance, a preview Worker beside production, and a scheduled handler against a
second database. Filing it at that severity is the point: a latent hazard is
worth a guard, not an incident report, and overstating it would have bought a
rushed fix instead of a swept one.

### The conversion

Every flag becomes `const READY = new WeakMap<object, boolean>()`, read and
written through `bindingKey(env)` — a new one-line export in
`util/schemaBootstrap.ts`, which already owned per-binding schema state. The cast
`env.DB as unknown as object` now exists in exactly **one** place, because a cache
keyed on the wrong thing does not throw; it simply never hits, or hits for a
stranger.

**The identifier was renamed on purpose.** `_ready` → `READY` means a half-converted
file fails to compile, so `tsc --noEmit` — not a reviewer's eye — is what proves
every read and write moved. A same-name conversion would have left
`if (READY)` reading a WeakMap as always-truthy: green build, dead cache.

**Three in-flight promise latches moved with the booleans** and are the more
dangerous half. `ensureInvestorSchema`, `ensureAdvisorSchema` and
`ensureExploringSchema` each coalesced concurrent callers on a module-level
`Promise<void> | null`. Shared across bindings that hands database B the promise
of a users-table CHECK rebuild that ran against database A — B is told the rebuild
happened when nothing touched it. They are `WeakMap<object, Promise<void>>` now,
so two bindings get one rebuild **each** rather than one between them.

### One file is exempt, and says so

`services/aiRouter.ts` keeps its own inline cast and imports nothing. Its test
loads the file by reading the bytes, stripping the single `import type` line and
evaluating the rest inside `new Function`; a value import would survive that strip
and throw `Cannot use import statement outside a module`. Having no value import
is a property that test depends on, so the file carries the cast and a comment
saying why. A documented exception beats a helper nobody may use.

### The guard found a real bug on its first run

`scripts/check-schema-readiness.mjs` bans the boolean and the promise latch, and
additionally fails any `WeakMap<object, …>` in a file that never names the binding.
That third rule caught `services/projectAccess.ts`, whose comment said "keyed
per-DB … mirrors the ensureProject*Columns pattern in routes/projects.ts" — and
which keyed on `env`, the whole environment object, while `projects.ts` keys on
`env.DB` seven times over. Wrong in both directions: two bindings arriving with one
`env` share an entry describing only the first, and a fresh `env` per request never
hits, so a ten-statement bootstrap re-ran every time. The false comment is what
made it invisible to reading.

### What the guard does not check, and why

Whether the latch is set before or after the work, and whether a failure latches.
Those differ legitimately — `ensureExploringSchema` latches only if the role-CHECK
rebuild succeeded, `ensureXSchema` latches inside its `try` — and a check that
forced one shape would push the next author into the wrong one. Source shape is all
`check-schema-readiness` can see, so behaviour is pinned separately by
`cloudflare-worker/test/schema_readiness.test.ts`: two bindings each get their DDL,
one binding gets it once, a failed bootstrap does not latch, and `projectAccess`
keys on the binding. Reverting `xSchema` to a boolean fails three of those five;
reverting `projectAccess` to `env` fails exactly the one written for it.

### A dead test seam is deleted rather than kept

`__resetWorkflowSchemaCache()` existed for one stated reason — "the module-level
cache would otherwise leak across cases" — which is no longer true, and it had no
caller anywhere. `aiRouter`'s `__resetForTest()` has twenty, so it stays, now
reassigning the map and with a docblock saying it is belt-and-braces rather than
load-bearing. A seam whose reason has evaporated is a false claim the next reader
will trust.

### Two existing guard tests were updated, not loosened

`apex_cutover_bootstrap.test.mjs` pinned the single-flight property by the old
identifier names. It now pins the same property on the new latches **and** asserts
each is a `WeakMap` — an assertion that would have failed before this change. Its
production-short-circuit test likewise requires the `.set(bindingKey(env), true)`
form, so a file that drops back to a boolean fails there as well as in the guard.

---

## D96 — the SPA gets a type-check, and strict turned out to be the cheap option

**Date:** 2026-09-14 · **Task:** #201 · **Migration:** none

### What was unchecked

`frontend/src` holds 27 `.ts`/`.tsx` files — the deck templates, `DeckBase`,
`Thumbnail`, `brand/gvpn` — and **nothing looked at their types**. `test:types`
compiles the worker; the SPA had no `tsconfig.json` and no `typescript`
dependency at all; Vite 8 hands TypeScript to oxc, which strips types and never
checks them. `lint:undef` is globbed `{js,jsx}` because espree cannot parse
TypeScript, so against a missing import — a runtime `ReferenceError` the bundler
emits without complaint, which is the entire reason `lint:undef` exists — those
27 files were covered by fourteen hard-coded hook names and nothing else.

D84 recorded this gap and left it open on purpose: closing it meant landing a
`tsc --noEmit` behind pre-existing errors, and several of those were judgements
about what a deck should render rather than type pedantry.

### Strict is the SMALLER error set, which is not the obvious way round

#201's own guidance was *"keep `strict` off at first if that is what it takes to
land the gate"*. Measured with the repo's pinned compiler (TypeScript 7.0.2) over
exactly those files:

| config | errors |
| --- | --- |
| fully loose (`strict:false, noImplicitAny:false, strictNullChecks:false`) | **15** |
| `noImplicitAny` only | **18** |
| `noImplicitAny` + `strictNullChecks` | **10** |
| `strict: true` (TS 7's default) | **10** — identical to the row above |
| **`strict: true` + `allowJs: true`** | **9** |

The mechanism is worth keeping because it decides the fix and not just the flag.
`demo_day_app.tsx` reads `const raw = data.features[idx] ?? {}` and then six
`raw.x ?? <default>` lines, under a comment saying autofill may write `{name}`
only. Loose mode cannot narrow through `??`, reduces the union to `{}`, and files
**seven** complaints against a defensive fallback that is already correct;
`strictNullChecks` knows the left side is non-nullish, drops the `{}`, and all
seven vanish. Following #201's item 4 — *"needs the real slot type, not a cast"* —
would have meant tightening a guard that exists precisely to tolerate a partial
payload. `allowJs` takes the last one: `decks/spinout/deckData.js` is the only
`.js` any of these files import, and admitting it (one extra file, `checkJs` off)
lets TS infer instead of refusing. The whole check runs in about 1.4 s.

### The nine, and what each turned out to be

| site | verdict |
| --- | --- |
| `templates/index.ts:57,58` — `category: 'event'` | **the type was wrong, not the data.** `PitchDeckPage.jsx` hard-codes an `'event'` filter tab, so both decks were always visible; the worker's own union is `fundraising \| commercial \| event \| narrative`. Widened to match, `'narrative'` included. Not widened to `string` — `ShareDeckCTA` branches on it. |
| `minimal_seed_app.tsx:1160` — timeline shape | **a real rendering bug.** `TimelineDots` reads `date`/`label`; `achievements` carries `year`/`event`, so the JOURNEY strip drew its dots over three empty columns. Fixed the way `minimal_seed.tsx` and `kawasaki_10_20_30.tsx` already had — widen the component and normalise — rather than renaming the data the autofill produces. |
| `series_a_growth_app.tsx:1164` — `.initials` | **type-only, and #201 was wrong about it.** The task predicted it "renders `undefined`"; the line is `l.initials \|\| safeUpper(l.name).slice(0, 6)`, so it never did. The union simply lost the declared `initials?` because the fallback is `Array.from` (whose callback is inferred alone) rather than an array literal (which the conditional widens) — which is why `minimal_seed_app`'s identical pattern does not error. |
| `yc_seed.tsx:381` | type-only: the one `Editable` in the file reading a raw optional instead of going through `v(data, …)`. The component already rendered `{value \|\| placeholder \|\| ''}`. |
| four × `keyof JSX.IntrinsicElements` | **not the "probe-config artifact" #201 guessed.** React 19's `@types/react` removed the global `JSX` namespace; the spelling is `React.JSX`. Those four template-local `Editable`s diverged from `DeckBase`, which sidesteps it with a literal union. |

### Scope the timeline bug honestly

`minimal_seed_app.tsx` is the one `_app` variant **no wrapper re-exports** — the
other seven reach the registry through one-line re-export files (`demo_day.tsx`,
`series_a_growth.tsx`, …), while `minimal_seed.tsx` is its own full
implementation. So nothing imported the file and no user saw those empty columns.
It is real code with a real bug that was not shipping, and saying otherwise would
be the same overstatement this decision exists to correct. Whether that variant
should be adopted or deleted is a separate question and is not answered here.

### The gate, and the two dependency facts under it

`frontend/tsconfig.json` (strict, `allowJs`, `checkJs: false`, `noEmit`) plus
`npm run test:types:frontend`, chained into `test:drift` beside `test:types`.
Two things had to become explicit first:

- **No TypeScript was reachable.** `npx tsc` from `frontend/` resolved a *global*
  6.0.2 that CI does not have. The root now pins `typescript` at the worker's
  `^7.0.2`, and `repo_layout.test.mjs` fails if the two pins drift — the same
  answer the repo already gave the duplicated `image-size` override.
- **`@types/react` was transitive.** A gate reading JSX through a type package no
  one declared is a gate an unrelated dependency bump can silently change.
  `@types/react` and `@types/react-dom` are `frontend` devDependencies now.

### `docs/` digests cannot test a build change

Adding a project-root `tsconfig.json` is build-affecting in principle — Vite reads
one for `jsx`/`target` — so it had to be checked. Hashing all of `docs/` before
and after said the build moved; **the instrument was wrong**. `build-frontend.mjs`
keeps a rolling asset-retention window, so a third build with no input change
moved the digest again. Two `vite build --outDir <tmp>` runs, with and without the
file, came out **byte-identical**. Compare bundler output, never `docs/`.

### `check-react-hook-imports.mjs` keeps its place, on a narrower claim

D84 kept it for two reasons: the TS/TSX the linter cannot parse, and a message
that names the failure. This removes the first — a deleted `useState` import in
`demo_day_app.tsx` is caught by both, established by mutation rather than
assumed. It stays for the second alone: one line naming the hook and the file,
where `tsc` gives a TS2304 per call site. That is a real difference and a small
one, and the record now says so instead of claiming coverage it no longer has.

**6 mutations applied, 6 caught**: a deleted named import and a deleted hook
import each fail the gate by file and line; reverting the timeline normalisation
and breaking the initials fallback each fail a render assertion, not just the
compiler; drifting and deleting the root TypeScript pin each fail
`repo_layout.test.mjs`.

---

## D97 — a share link may not promise what its own next step cannot deliver

**Date:** 2026-09-14 · **Task:** #205 · **Migration:** none

### The bug, and why neither file could see it

`ShareDeckCTA` decided its copy with `category === 'commercial'` and let
everything else inherit the fundraising card: *"the SAFE, term sheet, and side
letters are ready for your review."* `ShareViewerSignupModal` gated both the
deal-pack fetch and the post-NDA branch on `category === 'fundraising'`.

For `'event'` — the category `demo_day` and `axal_spinout_demoday` both carry —
those two disagreed. A Demo Day viewer read the promise, **signed the NDA on the
strength of it**, and arrived at a post-NDA step with no branch at all. Not an
error, not an empty state: nothing rendered. The signature was already recorded.

The reason it survived is the shape, not the oversight: **two files each held
their own idea of what a category meant, and neither could see the other's.**
Every individual line was defensible on its own.

### The rule now lives in one place

`frontend/src/lib/shareDeckAudience.js` maps a category to one of `FEEDBACK`,
`DEAL_PACK`, or `null`, and both files ask it. `'event'` is `DEAL_PACK` **by
decision** rather than by fall-through: a Demo Day viewer is there to evaluate
the company, which is what the deal pack is for.

### `'narrative'` renders nothing, and the reason is a finding

The repo does not agree with itself about what a narrative deck is. The worker
files two methods under `'narrative'` (`services/decks/methods.ts`:
`sequoia_classic` and `narrative_brand`) while the frontend registry calls the
first **`fundraising`** and the second **`commercial`** — and the two sources
reach different screens: `PitchDeckPage.jsx:1570` prefers the methods value
(`m.category || tpl.category`), `PitchDeckPrintPage.jsx:714`, which renders this
CTA, reads the registry's.

So a CTA that mapped `'narrative'` would be guessing which half of that
disagreement is right, and guessing wrong is exactly the bug above. It renders
nothing until the repo settles it. Raised separately; not decided here.

An unrecognised value renders nothing for the same reason. **Defaulting to the
deal pack is how a Demo Day deck came to offer documents in the first place.**

### The assertion that outlives the others

`share_deck_cta_audience.test.mjs` pins the rendered copy per category — but the
durable one is the last test: **neither file may compare `category` to a literal
again.** The render tests pin what the code does today; that one pins the thing
that let it be wrong. Its value showed in the mutation sweep: restoring the bare
`category === 'fundraising'` in the modal's prefetch — the precise line that left
the panel blank — was caught by **that test alone**, because every rendered
output still looked right.

**3 mutations applied, 3 caught**, each by a different assertion class: dropping
`'event'` from the map fails the unit test, the cross-file invariant and the
render test; the bare literal in the modal fails only the coupling guard; letting
the CTA default an unknown category to the deal pack fails the render tests.

## D98 — one company, one startup: the 25 in-body pickers go, and the ledger that counted them was four short

**Date:** 2026-09-14 · **Task:** #181 (with #177, #179) · **Migration:** none

### The question that blocked this for two rounds

A startup is not a company. The sidebar's `CompanySwitcher` selects a **company**
— sent as `X-Company-Id`, verified against `user_company_links`, and the worker
narrows a founder's projects by `company_id` (migrations 189, 193-198). Each
in-body picker selected a **project**, and every one sat behind
`projects.length > 1`: *more than one startup inside the already-selected
company.* That made it a second axis rather than a duplicate, and deleting it
looked like removing the only way such a founder could move between startups.

So the question was never "is this chrome redundant" but "can a company hold two
startups". It is answered, and it was **measured, not assumed**: production D1
holds **5 projects across 5 founders, one project each**, `company_id` NULL on
all five (legacy rows predating migration 189). `projects.length > 1` was false
for every live account, so **not one of these pickers rendered for anybody**.
The deletion removes no capability any account was using.

`projects.company_id` handling is untouched. It is written on creation
(`routes/projects.ts:437,515`, `imports.ts:117`) and read with a deliberate
`OR p.company_id IS NULL` for those five legacy rows. The schema still permits
more than one project per company; the UI simply no longer offers to switch.

### The ledger was counting the wrong thing

Task #84 removed these once, per route, and they came back, because nothing
counted them. #181 then added `scripts/check-inline-project-pickers.mjs`, which
swept for `data-testid="select-<something>-project"`. That sweep found **21** and
corrected the task, which had named eleven by hand.

It was still wrong. **Four more pickers carried no test attribute at all** —
`FounderRaiseLiquidity`, `MarketIntelPage`, `RaisePipelinePage`,
`raise/DataRoomPage` — so a ledger reporting "21 in-body startup pickers, all on
record" was reporting a number it had no way to complete. The real count was
**25**. A guard keyed on a *test attribute* can be defeated by leaving the
attribute off, which is not a hypothetical: four authors already had.

The sweep now also keys on `projects.length > 1` used as a render guard, which is
the property that *defines* the control — a scope switcher that appears only when
a second startup exists. The mutation sweep pins the difference: a picker written
without a testid fails the new gate and **passes the old one**.

A `<select>` over projects that is *not* behind that guard is deliberately out of
scope. On `/cap-table`, `/discovery`, `/build/brand` and twenty other legacy tool
pages the picker is the tool's own input, shown whether you have one startup or
ten. Those ask "which startup is this tool about"; these asked "which startup is
this page about", on a page the sidebar had already scoped.

### Deleting a control means checking what reached through it

Twenty-two of the 25 pages read `?project_id=` and still do.
`MarketIntelPage` and `RaisePipelinePage` never did — they resolve the first
project their own fetch returns, which is exactly what they did on every account
where the picker was hidden. `inline_project_pickers_retired.test.mjs` holds that
as a per-file table, so a page that later loses its URL read fails there instead
of quietly showing project #1 forever.

Nine pages were left holding a `projects` array that nothing read once the picker
was gone, and one (`DataRoomPage`) a `projectUid` with no setter. Both are
deleted rather than left as a fetch feeding nothing — `check-unused-imports` sees
neither shape, so this was a manual sweep.

### The "New Startup" button, and the thing it was hiding

`CreateStartupForm` rendered its own button to toggle its own form, in the Build
desk's header. That is the same class of control: a body-level handle on
something the URL already addresses — thirteen places across the SPA link to
`/build?new=1` (the Command Palette's "Create startup", ten empty states, two Lab
pages). The button is gone; a closed `CreateStartupForm` now renders **nothing**.

Removing it exposed a bug the button had been covering. `creating` was seeded by
a `useState` **initializer** reading `?new=1`, which runs once. Twelve of the
thirteen links arrive from another route and remount the desk, so they worked.
The Command Palette is the thirteenth and can be opened **from /build itself**,
where `nav('/build?new=1')` changes the search string without remounting: the
initializer never re-ran and the entry did nothing at all. The desk now follows
the param when it changes. Had the button simply been deleted, the palette entry
would have gone from silently-broken to visibly-broken.

### Two "Open workspace" links went with them

#179 recorded the user's words about Grow · Brand — *"Open workspace has nothing
to do there"* — and #177 flagged the identical link on Raise · Liquidity. Both
are body-level controls whose whole function is to send the reader somewhere
else, and both destinations remain reachable: Brand's from the zone header's own
`New page` action (same URL), Liquidity's from the sidebar ("Liquidity & Exits")
and the Raise workspace tab row.

Liquidity's copy had to move with its link. The page said *"Use the workspace for
supported actions"* — a sentence pointing at a control the page no longer has. It
now names where modelling an exit actually is, the zone header's `Model an exit`.
**A dangling instruction is worse than the duplicate link was**, and it is the
failure mode a deletion-only change would have shipped.

### What the tests pin that the count cannot

`check-inline-project-pickers.mjs` counts; that is the right tool for counting,
and the ledger stays at zero so a twenty-sixth has to argue for itself in a diff.
`inline_project_pickers_retired.test.mjs` asserts the three things a text sweep
cannot see: that every page can still be aimed at a startup, that a closed
`CreateStartupForm` renders the empty string while an open one still renders the
form, and that `?new=1` is followed on change rather than only at mount.

`frontend/test/_codeOnly.mjs` gained `codeOnlyJsx`, because three of those
assertions failed against correct code: each deletion left a `{/* … */}` in the
markup naming what went, and those comments contain the exact strings the
assertions ban. Same lesson as `codeOnly`'s own docblock, one layer in — **the
comment you want to keep is the one that names the thing.**

**7 mutations applied, 7 caught.** Re-adding a picker with a testid, re-adding
one without (the new capability — the old gate passed it), restoring a baseline
entry with no picker behind it, dropping a page's `?project_id=` read, restoring
the "New Startup" button, deleting the `?new=1` effect, and restoring Liquidity's
dangling sentence.

## D99 — the terms nobody ever accepted, asked for once, and the provenance line that would have lied about it

**Date:** 2026-09-14 · **Task:** #178 · **Migration:** none

### What #549 left behind

PR #549 made the terms consent real: an explicit, unticked checkbox on the
onboarding licence gate, and `recordTermsAcceptance` to make the act permanent.
But that gate is passed only by fresh Auth-v2 signups. Admins, impersonated
sessions, `access_level = 'limited'` accounts, the legacy `flow='chat'` rows and
**every account older than #549** still had `tos_v1` and `privacy_v1` sitting
`pending` — satisfiable since #549, satisfied by nothing. What those people had
been shown was "By continuing you agree" in 10px under a submit button, which is
a notice and not an act.

Marking the obligations satisfied would have been a one-line change and a false
record. So they get asked, once, and the answer is theirs to give.

### The signal rides `GET /auth/me`, and every other candidate writes

`recovery_pending` in the same response literal is the shape: an inline IIFE
doing its own `SELECT`, swallowing errors to a safe default. The new
`terms_acceptance_pending` sits beside it.

The alternative was an obligation endpoint, and it is disqualified on mechanics
rather than taste. Every read-shaped `/trust/*` GET calls `seedObligations`,
which is one unconditional `UPDATE` plus **one `INSERT … ON CONFLICT DO UPDATE`
per obligation def, in a loop** — and `GET /trust/score/:userId` does that to
*another user's* rows. Gating page load on one would put those writes on every
navigation.

**The flag is a fact, not a policy.** An admin really does have these rows
pending and `/me` says so; whether a session is interrupted over it is decided in
one place, `App.jsx`, beside the licence and KYC gates whose exclusions it
copies. Two places deciding is how they come to disagree.

**Absent reads as "do not gate", in all four of its forms**: a DB error, a
missing table, an account with no obligation rows, and the dev FastAPI, whose
`/me` has no such key. The SPA therefore tests `=== true` and initialises to
`false`. The inverse of any one of those would put an unskippable consent screen
in front of every session — including one whose own accept call is failing.

### The gate renders in place rather than navigating

This is the one structural difference from the two gates above it, and it buys
two things. It blocks every path including `/onboarding/*`, so there is no
exemption list to keep in step with the KYC gate's; and `onLogout` is already in
scope in `RequireAuth`, so **Decline runs the app's own session teardown** rather
than a second copy that drifts from it. The reader keeps their URL, so accepting
drops them exactly where they were going.

`licenceGateOwnsConsent` is what stops anyone being asked twice: a fresh signup
mid licence flow will accept at the licence screen, so the interstitial stands
down for them. Stated as a fact about the account rather than a path test,
because a path test would have to name every screen that flow can be on.

**A consent screen with no exit is not consent.** Clickwrap was chosen over
implied acceptance because it is the stronger record, and a record collected from
someone with nowhere else to go is weaker than the notice it replaces. Decline
signs out, changes nothing, and the question is asked again next time.

**No version is claimed.** Migration 245 deliberately stores no document hash —
`/terms` and `/privacy` are JSX while the `tos_v1`/`privacy_v1` templates are
different documents, so nothing knows which bytes a reader saw. Saying "version
3" would invent the one fact the schema refused to guess.

### The defect this would otherwise have shipped

The task's own research said to "add a matching `obligationSource` label or
provenance falls through to the verbatim branch". **Neither would have
happened.** `obligationSource` keys off `evidence_meta.source`, not `surface` —
and `recordTermsAcceptance` **hardcoded** `'source','signup_clickwrap'` for every
surface, because there had only ever been one caller. So the Trust Center would
have told an account that predates the signup checkbox entirely that it had
**"Accepted at signup"**. The label lookup would never have seen the new surface
at all.

`source` is now a parameter defaulting to `'signup_clickwrap'` — additive, the
existing caller unchanged — and `reacceptance_interstitial` has its own entry:
*"Re-accepted in the app."* The durable assertion is neither of those: it is that
the SQL may not contain a source literal again, so a third caller that forgets
its own gets the honest default rather than a borrowed sentence.

`evidence_meta` stays under `COALESCE`, which keeps the *first* acceptance's
provenance. That is right for a field that says where an obligation came to be
satisfied; a second act belongs in `legal_acceptances`, which is append-only and
is where it goes.

### No new `status='satisfied'` write site, and no backfill

The accept route calls the existing `recordTermsAcceptance`, so
`obligation_satisfiable.test.ts`'s `sites === 5` pin is untouched — if it ever
moves, a new satisfier was added and that is a different change.

Migration 245 **does not** reserve an `'admin backfill'` surface, contrary to what
the task recorded: `surface` is plain `TEXT NOT NULL` with no CHECK and no enum,
and the phrase appears once, in the migration's prose. The rule needs no schema
to enforce it — **an acceptance recorded on somebody's behalf forges the record
this change exists to make honest** — so the refusal lives where it could
otherwise happen: the route takes no user id, the client sends no body, and a
test asserts both.

### The score jump, decided rather than left open

Satisfying two required rows moves partner/admin 0→100, founder 0→67, advisor
0→50, crossing the band threshold at 60. Two facts bound it: `trust_score_snapshots`
is pull-based (`INSERT OR IGNORE` per user-month, written only by `GET /trust/me`),
so there is no mass write; and the 60/90 thresholds are frontend-only.

**Decision: no bespoke score-delta annotation.** The provenance fix is what makes
the jump explainable — the obligation's own line now says it was re-accepted in
the app rather than at signup — and a second, parallel explanation of the same
event is how two surfaces start disagreeing. Recorded here so the choice is
visible rather than silent.

**15 mutations applied, 15 caught.** Seven on the worker: dropping `required = 1`,
dropping the obligation-key filter, counting `satisfied` as owing, failing closed
on a DB error, taking a user id from the request, re-hardcoding the source, and
deleting the new label. Eight on the SPA: pre-ticking the checkbox, removing the
decline control, removing the announcement, claiming a document version, dropping
`!isImpersonating` from the gate, reading the flag loosely, initialising it to
`true`, and unsubscribing the shell from the accepted event.

## D100 — a verdict that was only ever derived gets a history, and it is written on the read

**Date:** 2026-09-14 · **Task:** #175 · **Migration:** 255

### Three chips that could not answer their own question

`/validate/verdict`'s `As of last week` and `Changed this month`, and
`/validate/hypotheses`' `Recently moved`, were registered `unbuilt` under a
reason that was exactly right and said so in the file:

> a claim's verdict is recomputed from its evidence on every request and never
> stored, so no earlier state of the board exists to compare against …
> snapshotting it is a change to the model, not a predicate this row can carry.

Migration 255 is that model change. The derived values stay derived — storing
the CURRENT verdict would be a second answer to a question the interviews
already answer — and what is stored is the other thing entirely: an append-only
record of what the derived pair HAS BEEN.

**The lane is recorded beside the verdict, and that is what makes the third chip
work.** `laneFor(verdict, evidence)` is derived too, and a claim moves from
`none` to `testing` the moment its first supporting interview lands with no
verdict change at all. A chip about the board's columns has to ask about
columns.

### CORRECTION TO THE PLAN: there were three chips, not six

The approved plan named six, three of them on `/build/this-week`. **Those were
already done.** `NO_WEEK_STAMP` is gone, migration 252's `okr_column_moves` logs
every roadmap column change, and all four of that zone's chips are live. The
plan was written off an audit finding rather than off the code.

### CORRECTION TO THE PLAN: written on the read, not on the write path

The plan said to instrument "the evidence-write path". **There is no such path,
singular.** `verdictFor(evidenceFor(links, interviews))` depends on
`hypothesis_pain_links`, on every interview's `icp_fit`, and on which pain
groups each interview's `pains_json` resolves to through `pain_group_aliases` —
so a verdict moves on a link insert, a link delete, an ICP-fit patch, a newly
logged interview, an edited pains blob and a pain-tag re-grouping. Six writers
across three route files today, and **the failure mode of missing one is
silent**: that path produces no history, and a history with a hole in it looks
exactly like one without.

So it follows `trust_score_snapshots` instead, which solved the same problem the
same way: pull-based, idempotent, written only by the read that needs it. The
cost is stated rather than hidden — a board nobody opens records nothing, so the
board returns `verdict_history_since` and both zones print it.

**It is not `seedObligations`, and the difference is the whole reason this is
acceptable on a read.** That one performs an unconditional UPDATE plus one upsert
per obligation definition on every call. This performs ONE SELECT and writes only
when a recomputed pair differs from the last row — **zero statements in the
steady state**, which is almost every request. A test asserts exactly that: five
consecutive reads of an unchanged board write nothing.

### Nothing is backfilled, and the refusal is per claim

The only timestamp a past verdict could be invented from is
`hypotheses.updated_at`, which moves when the CLAIM TEXT is edited. A verdict
dated from that would be a specific, confident, wrong answer.

So `As of last week` **excludes** a claim with no observation that old rather
than showing today's verdict under an earlier heading, and the zone says when the
record starts. Same seam as `/build/this-week`'s un-backfilled log, handled the
same way.

`Recently moved` and `Changed this month` ask a different question and needed a
different shape. "Differs from what it was at `since`" quietly refuses the most
interesting case — a claim first observed three days ago that moved yesterday HAS
moved this week. A change is an adjacent pair of observations that disagree, and
the window is about **when** the change happened, not how far back the record
reaches. A first observation is never a change: counting it would report every
claim as recently moved for as long as the record is younger than the window.

### The bug that would have made two chips answer everything

SQLite's `datetime('now')` writes `2026-09-14 11:20:00` — a space, no zone. `'T'`
sorts **after** `' '`, so `'2026-09-07 12:00:01' < '2026-09-07T12:00:00.000Z'` is
TRUE: a stamp one second inside a window compares as outside it, and other pairs
compare the other way. Every comparison goes through `parseObserved`, and the
test carries the boundary fixture where the two answers differ — without it the
string-comparison mutation escaped.

### A claim I had to correct mid-build

I wrote, four times, that an `unbuilt` entry "renders NOTHING". **That has not
been true since #180**, which changed the builder to draw a `disabled` chip
carrying its reason as a hover title — inert rather than invisible, which is
better and is still not an answer. The mutation that put a chip back to `unbuilt`
ESCAPED the first version of this test, because the test counted chips and a
refusing chip is still in the array. What separates live from refusing is
`disabled` and `onSelect`, and that is what it asserts now.

`founderZoneFilters.js`'s own docblock still described the old rule, two hundred
lines above the new entries. Corrected in place rather than left to disagree with
itself.

`NO_VERDICT_SNAPSHOT` is **deleted, not reworded** — the fourth constant in that
file to go when its store arrived, after `NO_WEEK_STAMP`, `NO_CADENCE_STORE` and
`NO_SESSION_RECORD`. A shared reason that survives its own fix does not sit
harmlessly; it gets cited by the next chip.

**11 mutations applied, 11 caught — two only after being closed.** Writing
unconditionally, ignoring the lane in the comparison, caching readiness per
isolate instead of per binding (the #204 shape), returning the history
newest-first, dropping the project scope, comparing the stamp as a string,
falling back to today's verdict when nothing is old enough, counting a first
observation as a move, putting either chip back to `unbuilt`, and dropping
`verdict_history_since` from the board.

---

## D101 — a fork the picker never reached, and the test that was guarding the copy nobody could see

**Date:** 2026-09-14 · **Task:** #206 · **Migration:** none

`frontend/src/decks/templates/minimal_seed_app.tsx` is **deleted**. It was 1,643
lines and 60 KB, and `templates/index.ts` has never been able to reach it.

### The premise on the task had expired, and the expiry is the interesting part

The task read "a deck variant nothing imports — adopt it or delete it", and D97's
sibling note at `DECISIONS.md:6655` says the same. That was true when #201 was
written and **stopped being true the same day**: `c9a134dc1` (#570) added
`frontend/test/deck_templates_missing_data.test.mjs`, which imports the file at
module scope. Deleting it without touching that import takes all 26 tests in the
suite down before the first one runs, and with them `test:frontend`,
`test:decks`, `test:drift` and CI.

So the file was not unreferenced. It was referenced by **exactly one thing, and
that thing existed only because nothing else referenced it** — the suite's own
comment said so: *"the one `_app` variant no wrapper re-exports, so this suite is
the only thing that looks at it."*

### The test was pinning a real behaviour on the wrong file

`minimal_seed_app.tsx`'s `TimelineDots` took two shapes from two callers —
`milestones` is `{date,label}`, `achievements` is `{year,event}` — and admitted
only the first, so the JOURNEY strip drew its dots over three empty columns.
#201 found it with the compiler and pinned the fix with a render assertion.

But `minimal_seed.tsx` — the template `templates/index.ts:75` actually ships —
**already had that fix**, and the deleted file's own docblock said so: *"The fix
is the one `minimal_seed.tsx` and `kawasaki_10_20_30.tsx` already made."* The
live file widens the prop at `:523` and normalises `m.date || m.year` at `:534`.

So the assertion was guarding the copy nobody could open, while the deck a
founder actually opens carried the same behaviour with nothing watching it. The
test is **moved, not deleted** — it now renders `Deck_minimal_seed` against
`minimal_seed.tsx`'s own `SAMPLE_DATA`, and both mutations (dropping `|| m.year`,
dropping `|| m.event`) fail it. The suite stays at 26 tests and covers more than
it did.

### Two arguments for adopting it instead, and why neither survived contact

**"It is the only Minimal Seed with a live single-screen presenter."** It is not.
`minimal_seed.tsx:1454` exports the same `MinimalSeedDeckApp` — Framer Motion
shell, prev/next, `AnimatePresence`, `useReducedMotion`, keyboard nav — and says
so in its own header at `:11-13`. This claim was in the plan for this task and
was simply wrong; the file was read before the delete, not after.

**"Someone shipped it on purpose."** They did, and then un-shipped it on purpose.
`ab9e3b81c` (2026-05-23) removed it from the registry hours after `6898a2449`
added it, on explicit user feedback — *"Minimal Seed must stay at slot 4 … not
appear as separate `_app` entries"* — and in that same commit the sibling
`series_a_growth_app.tsx` was rescued by rewriting `series_a_growth.tsx` into a
one-line re-export. `minimal_seed_app.tsx` got no such rescue because
`minimal_seed.tsx` was already a complete implementation. Every touch since is a
sweep: a rebrand, a scanner pass, a security pass, a delivery audit, and #201.

### What it would have cost to keep

The two files are **83% byte-identical**, and the live one is a commit ahead:
`d56f61491` gave every template brand-kit theming, so `minimal_seed.tsx:17`
imports `BrandProvider` and `:1620-1626` wraps the deck in it, while the fork
still hardcoded `const ACCENT = '#5E6AD2'` at `:70`. Adopting meant shipping a
brand-theming regression or hand-merging 277 lines into a duplicate that should
not exist. A stale fork is not free storage — it is a second place for the next
fix to be applied to, and #201 applied one there.

### Left in place deliberately

The three `attached_assets/Pasted-Here-s-the-complete-Minimal-Seed-deck-…txt`
transcripts this file was pasted from are **kept**. They are an archive of where
the code came from, which is what that folder is for, and deleting the source
makes that provenance the only remaining trace rather than a redundant one.

One citation was re-pointed rather than left to rot: `series_a_growth_app.tsx`
explained a TypeScript inference asymmetry by contrast with this file's
array-literal fallback. `minimal_seed.tsx:992` has the identical pattern
(`partner_logos`, same optional `initials`), so the comment now cites that.

**2 mutations applied, 2 caught.** Dropping `|| m.year` and dropping `|| m.event`
from the live `TimelineDots` each fail the moved test — which is the whole point
of moving it, since neither would have failed anything before.

---

## D102 — a deck's category says who it is for, so `narrative` was never one

**Date:** 2026-09-14 · **Task:** #207 · **Migration:** none

D97 found that the repo did not agree with itself about what a narrative deck
is, declined to guess, and said so: *"Raised separately; not decided here."*
This is that decision.

### What the disagreement actually was

The same thirteen decks are described in three places, each with its own
`id → category` table: the worker's `services/decks/methods.ts` (production,
served by `GET /api/decks/methods`), the SPA's `decks/templates/index.ts`, and
the FastAPI dev mirror `_DECK_METHODS_DEV` in `backend/app/api/routes/decks.py`.
Eleven decks agreed. Two did not:

| deck | worker | registry |
| --- | --- | --- |
| `sequoia_classic` | `narrative` | `fundraising` |
| `narrative_brand` | `narrative` | `commercial` |

### `narrative` is a STYLE in a vocabulary of AUDIENCES

That is the whole finding, and `lib/shareDeckAudience.js` is the proof: every
entry in it answers *who is looking and what do they want next* — `commercial`
asks for feedback, `fundraising` and `event` open the deal pack. A writing style
has no answer to that question, which is exactly why the value could not be
mapped and why D97 was right to refuse. The field's own declaration said
"Suggested category badge in the picker", but the picker was never its only
reader.

So `narrative` is retired at its source rather than taught to more code. The
registry's values were correct all along: Sequoia Classic is the template
founders raise money with, and a brand deck goes to customers and partners.

### It was a live defect, not a tidiness problem

`PitchDeckPage.jsx:1570` merges the two sources as
`m.category || tpl.category || 'general'` — **the worker wins** — and the filter
row at `:1604` is the hard-coded list `all | fundraising | commercial | event`.
So both decks displayed "NARRATIVE" on their picker cards and fell out of every
chip but "All". A founder filtering by Fundraising could not find the Sequoia
template. It read as two missing templates rather than as a filter row one entry
short.

### Deciding it upstream is what left the NDA path untouched

The share CTA reads the registry (`PitchDeckPrintPage.jsx:714`) and the share
endpoint (`routes/decks.ts:893-900`) ships `method_id` and deliberately no
category, so **no share link's promise changes**. The alternatives — the
registry adopting `narrative`, or collapsing to one table and piping the
worker's value into the share payload — would both have forced
`shareDeckAudience.js` to answer D97's question on the path where answering it
wrong *was* #205. That asymmetry, not a preference between two spellings, is
what picked this direction.

`ShareDeckCTA`'s `return null` for an unrecognised category **stays**. It is not
vestigial now that the undecided case is gone: it is what stops the next new
category from silently inheriting the deal pack, which is how a Demo Day deck
came to offer documents in the first place.

### The deliverable is the guard, not the two values

`frontend/test/deck_category_sources_agree.test.mjs` parses all three tables out
of source — TypeScript, TSX and Python — and holds them to one answer. It exists
because **nothing was watching**: `scripts/check-deck-templates.mjs` guards the
registry but its `REQUIRED_FIELDS` deliberately omits `category`,
`decks.autofill.test.ts` reads `methods.ts` for slide counts only, and
`_DECK_METHODS_DEV` was covered by nothing at all. Three tables were free to
drift independently and two of them did, visibly, for months, without failing
anything. Fixing the two values would have left that freedom in place.

Four things it asserts, and each caught its own mutation:

- every source parses to **thirteen** decks — a regex that matches nothing
  agrees with everything, so the evidence is checked before the verdict;
- all three tables give every deck the same category;
- every category any of them emits is one `shareDeckFlow` can route — **three
  tables agreeing on an unroutable value still fails**, because agreement is not
  correctness;
- `narrative` may not come back, in any table or in the worker's union type.

A fifth assertion guards the same defect from the other side: the picker must
offer a chip for every category a deck can hold. Agreeing tables would not have
saved a new category from being reachable only under "All".

`share_deck_cta_audience.test.mjs`'s `WORKER_UNION` was a hand-written list and
is now **parsed from `methods.ts`** — it named `narrative` for exactly as long as
the worker did, so the loop over it could only ever check what someone had
remembered to type. A fifth category added to the worker without a flow now
fails on the spot.

**7 mutations applied, 7 caught.** Flipping `sequoia_classic` in each of the
three tables in turn; flipping all three to `narrative` together (agreement
holds, routability and retirement both fail); removing a deck from the dev
mirror only; re-admitting `narrative` to the worker's union; and dropping the
`event` chip from the picker row.

---

## D103 — `docs/` records the source it was built from, because "which commit is newer" was never the question

**Date:** 2026-09-14 · **Task:** #207 · **Migration:** none

`scripts/build-frontend.mjs` now writes `docs/.build-source`: a SHA-256 over the
sorted (path, content) pairs of `frontend/src`, stamped last so it only ever
describes a build that finished. `scripts/check-docs-fresh.mjs` reads it and
asks the real question — *is the committed `docs/` the build of this source?* —
falling back to the old commit-timestamp comparison only when the stamp is
absent.

### The gate had a state it could not leave

`check-docs-fresh --strict` compared the newest commit touching `frontend/src`
against the newest touching `docs/`. #207's own PR broke that, and the way it
broke is the interesting part: every source change in it was a **comment or a
type**. The minifier strips comments and `tsc` erases types, so a full rebuild
emitted a **byte-identical** bundle — verified, not assumed: `npm run build` at
that head left `git status -- docs` completely empty.

So there was nothing to `git add`, and the gate's own printed fix —
`npm run build && git add docs && git commit` — **cannot be carried out**, because
`git commit` on an empty change refuses. The PR was red with no way to go green
that did not involve either fabricating output churn or weakening the check.

### The proxy was wrong in the other direction too

A timestamp says *someone committed `docs/` after `frontend/src`*, which is
evidence that they probably rebuilt, not that they did. Commit `docs/` without
rebuilding and the gate reads fresh **forever** — a stale-bytes failure it was
written to catch and structurally could not see. The stamp catches it, so this
is a strengthening, not a workaround for one PR.

It also answers in a tarball, where the proxy could only `skip()` — and under
`--strict` a skip is a failure.

### Not a key in the retention ledger, which is the obvious wrong home

`docs/.asset-retention.json` is already rewritten by every build, so it looks
like the place for this. It is **gitignored on purpose** (45 KB that churns
wholesale — `.gitignore` says so and explains the trade), so CI never sees it
and a stamp inside it would answer nobody. Caught by checking `git check-ignore`
before pushing, not after. `.build-source` is one line and moves only when the
source does.

### Two tests that could not fail, and why that is the lesson

`sourceTreeHash`'s guarantees were mutation-checked, and **two mutations
escaped** — both because the test was wrong, not the code.

- **Dropping the path from the digest survived a rename test.** Renaming `a.js`
  to `renamed.js` in a tree containing `b.js` moves the file past `b.js` in sort
  order, so the CONTENT sequence changes from `[1,2]` to `[2,1]` and the hash
  differs whether or not the path is hashed. It was testing ordering while
  claiming to test paths. The fixture is now `a.js` → `b.js` beside `z.js`,
  which holds the sorted content sequence fixed, plus a sibling test that moves
  a file between directories.
- **Deleting `.sort()` survived an order test, and a second one written to
  replace it.** ext4 enumerates a directory by filename hash rather than
  creation order, so building the same tree twice in different orders returns
  the same sequence either way — and asserting `sourceFiles(dir)` comes back
  sorted fails for the same reason, since the raw walk is already sorted here.
  The sort is real defence on filesystems that return creation order, and on
  this one it is unobservable. `sourceFiles` and `sourceTreeHash` now take an
  injectable `readdir`; the test hands them one that reverses, which is the only
  way the assertion can fail.

The second is the durable lesson: **an assertion that cannot fail on the
machines that run it is not a guard**, however reasonable it reads. Two
successive attempts at it looked correct and proved nothing.

**9 mutations applied, 9 caught** — two only after the test was rewritten.
On the helper: drop the path, drop the sort, skip empty files, swallow a missing
directory. On the gate: edit `frontend/src` without rebuilding (strict fails,
local still warns), and remove the stamp (falls back to timestamps as designed).
`npm run test:retention` now globs `scripts/lib/*.test.mjs` rather than naming
one file, so the suite went 7 → 15 tests and a future helper's tests run without
a package.json edit.

## D104 — a branch session never leaves its host: host-only, branch-named cookies on a branch Worker, and why HQ keeps `.axal.vc` for now

**Date:** 2026-09-14 · **Task:** #211 (HQ and branches plan, PR 1) · **Migration:** none

A Worker deployed for a branch — `studioos-<code>` at `<code>.axal.vc`, with
`BRANCH_CODE=<code>` in its generated config — now sets **host-only** cookies
whose **names carry the code**: `studioos_auth_<code>` and
`studioos_csrf_<code>`. It reads only those names, and its passkey ceremonies
accept only its own origin. HQ (`BRANCH_CODE` unset) is unchanged: it still
sets `studioos_auth` and `studioos_csrf` for `.axal.vc`. `util/branch.ts` is
the one place the Worker decides which it is; `frontend/src/lib/branchHost.js`
makes the same decision from the page's hostname, so the SPA mirrors the
right CSRF cookie without asking.

### The plan said host-only everywhere, and the code said no

The build plan (D.4) called for dropping the `Domain=.axal.vc` attribute on
every host. Reading the sign-in path before doing it found the reason it
exists: the Google callback still lands on `app.axal.vc`
(`OAUTH_CALLBACK_BASE_URL`, `routes/auth_google.ts:119`), sets the session
there (`:687`), and then redirects to the apex (`:701`), where the SPA reads
it. That handoff works **only because** the cookie is scoped to the
registrable domain — `wrangler.toml:145-151` records exactly this, and names
the step that would end it: register the redirect URI on `axal.vc` at the
provider and drop the override. That step is a person's, at Google's console,
not a code change; until it is taken, host-only cookies on HQ would break
Google sign-in on the first attempt. So HQ keeps the domain cookie, and
`authCookieDomainAttr` says so at the line that decides it.

### Why a different name, not just a different scope

Host-only on the branch is necessary and not sufficient. HQ's `.axal.vc`
cookies are sent by the browser to every subdomain regardless, so a branch
host carries HQ's `studioos_auth` beside the branch's own. Two cookies with
one name on one host are delivered in an order the user agent chooses — RFC
6265 §5.4 sorts by path length, then creation time — and the Worker's cookie
parser takes the first match. A branch reading the plain name would therefore
accept its own user only when HQ's cookie happened to come second: a login
that works in one browser and not another, with nothing in the logs but 401s.
Naming the cookie after the branch removes the race instead of arguing about
its odds, and `branch_cookies.test.ts` pins it by presenting both cookies in
both orders.

### What changes when the redirect URI moves

One line: `authCookieDomainAttr` returns `''` unconditionally, and the dual
form in `clearAuthCookies` — which already exists from the last cookie-domain
migration — purges the legacy `.axal.vc` cookie on logout for one release.
Nothing else in this decision depends on that day.

### What is guarded

`cloudflare-worker/test/branch_cookies.test.ts`: a branch never emits a
`Domain` attribute and never clears HQ's cookie names; `extractJwtCandidates`
and the CSRF middleware read the branch's cookie in either order beside HQ's
and treat HQ's pair as no session at all; `expectedOrigins` on a branch is
exactly its own origin; a malformed `BRANCH_CODE` throws rather than reading
as HQ. `frontend/test/branch_host.test.mjs`: the hostname rule, and that
`api.js` mirrors the derived name rather than the literal.

## D105 — a branch's Worker config is derived from HQ's, and the registry file is the only place a deployment is declared

**Date:** 2026-09-15 · **Task:** #212 (HQ and branches plan, PR 2) · **Migration:** none

Two files per branch, and only one of them is written by a person.
`infra/branches/<code>.json` records what Cloudflare assigned — the D1 and KV
ids, the residency actually granted — and nothing else.
`wrangler.branch.<code>.toml` is **generated** from it and from
`wrangler.toml`'s `[env.production]` table by
`scripts/gen-branch-wrangler.mjs`, is gitignored, and is regenerated on every
deploy. `scripts/check-branch-config.mjs` runs in `npm run test:guards` and
renders every registry entry on every build.

### Why derived rather than templated

The binding tables already drift between the two that exist: `wrangler.toml`
carries a comment naming the 2026-05-05 login outage that came of a binding
declared at the top level and not under `[env.production]`, and a guard now
exists solely to compare those two. A hand-maintained branch template would be
the third, fourth and fifth copy of that table, and would break the first time
someone added a binding to HQ without knowing branches existed.

So the renderer copies every `[env.production]` table it does not recognise
verbatim, and transforms only what must change. A binding added to HQ reaches
every branch with no edit here — and the test that pins this appends a table
to a *copy* of `wrangler.toml` and asserts it appears in the output, so an
allowlist-shaped rewrite fails even though it would pass every other test.
Where a new table's identity key is unknown, the guard fails the build asking
for the rename rule, rather than shipping a config whose id still points at
HQ's resource.

### The four things that are not copied, each for its own reason

**The route table is replaced, never transformed.** A Workers custom domain
belongs to exactly one Worker, so a branch config carrying `axal.vc` would
move the apex off HQ on deploy — the most destructive thing a generator here
could do, and not recoverable mid-deploy. The renderer emits one route; the
guard refuses HQ's hosts by name; a test asserts neither string appears
anywhere in the output, `OAUTH_CALLBACK_BASE_URL` included.

**The Analytics Engine dataset is shared.** Every other resource is per
branch, which is the isolation the whole design rests on, but the HQ
statements and the anonymised median in the subsidiary Insights screen are
computed *across* branches. One dataset indexed by `BRANCH_CODE` is what makes
those two numbers possible without a cross-branch read; renaming it per branch
would have quietly removed them.

**Crons are trimmed to two.** HQ declares six cadences, four of which pull
external market-intelligence sources and send platform digests. Copied
verbatim, N branches would hit those sources N times for the same rows.

**The output is flat.** No `[env.*]` table, so `--env` is never combined with
`--name` and the non-inheritance trap cannot recur inside a branch config.

### Why the registry is a file and not a table in D1

A deployment must be readable before the database it describes exists — the
provisioning workflow writes the entry while creating the resources, and the
generator reads it to produce the config that binds them. It also has to be
reviewable in a pull request: a branch is a new production host, and the diff
that adds one should say so. `_example.json` ships with fake ids so the guard
renders a real config on every build, including today, when no branch has been
provisioned. A guard whose first execution is the day it matters is not a
guard.

### What is guarded

`scripts/lib/branchConfig.test.mjs` (9 tests, in `npm run test:retention`):
the derived names; the shared dataset; the absent apex; the flat output and
the inherited tables a flat config must re-declare; the trimmed crons; the
new-binding case above; every `validateBranch` refusal, including an entry
that kept HQ's database id; and every `checkRendered` refusal, each against
its own mutation of a rendered config. `scripts/check-branch-config.mjs` also
fails if a generated `wrangler.branch.*.toml` is ever committed.

## D106 — on a branch the elevation does not exist, the platform content is not gathered, and the licence is a dated copy

**Date:** 2026-09-15 · **Task:** #214 (HQ and branches plan, PR 4) · **Migration:** 256

`BRANCH_CODE` now changes what the Worker will do, not only which cookie it
reads. HQ is unchanged in every respect — the var is unset there and every
gate below is a no-op.

### The elevation is a property of the deployment, not a row

`hydrateSuperAdmin` answers `0` whenever `branchOf(env)`, and does not query
`super_admins` at all. That one line closes all 24 super-admin routes and the
`/me` echo together, because every one of them reaches the flag through
`requireSuperAdmin` → `isSuperAdmin`.

**What was already true, and why it was not a gate.** A branch database is
bootstrapped from the baseline with `BASELINE_CUTOFF = 219`, so migration 207
— the single super-admin holder — is marked and never executed, and
`super_admins` starts empty. The routes therefore already answered 403. But
an empty table is a *data state*: one `INSERT INTO super_admins` on a branch
database, by anyone who could reach it, would have reopened HQ's entire
console over branch data with every route still behaving normally. So
`cloudflare-worker/test/branch_mode_gates.test.ts` seeds that row before every
deny assertion. A test that only ever asked an empty table would pass against
the old code and prove nothing about the new one.

`requireSuperAdmin` refuses on a branch with **"HQ only"** rather than
falling through to "Super admin required". The second sentence reads as "ask
HQ to elevate you", which is untrue: there is no elevation to grant on that
deployment, and the ledger it guards is in another database. Both new
sentences are exported constants (`util/branch.ts`) and `AUTH_ERROR_STATUSES`
keys off the constants, because the failure that entry's own comment records
is a message and a map key drifting apart — which turns a working refusal
into a 500.

### HQ authors, a branch reads (D.9)

`requireHqAuthoring` is `requireAdmin` plus that refusal, applied to the three
template-store writes in `admin_contracts.ts` and the seventeen authoring
writes in `admin_assessment.ts`. It is **not** an elevation check: an
unelevated HQ admin authors exactly as before. Reads are untouched — a branch
must list, fetch, version and preview templates, because that is the S5
picker — and assessment `preview` and `sessions/:id/rescore` keep the plain
admin guard, because the results are the branch's (S4).

### The cron trim did not do what it looked like it did

`wrangler.branch.<code>.toml` ships two cron expressions instead of HQ's six
(D105), and it would be easy to read that as the fix for "N branches each
hitting the same external APIs". It is not. A branch keeps `* * * * *`, and
every block in the scheduled handler gates on the **wall clock** rather than
on which expression fired — so dropping the other four removes some duplicate
invocations within a minute and stops not one cadence. The gate had to be in
`index.ts`, and it is: `hqCadences` guards the Founder Signals refresh, the
whole market-intel connector block, the Platform Personas digest and the
market-intel watchlist digest. Everything else — the queue drain, job
cleanup, trust and partner-deal expiry, the trash sweep, TOTP remediation,
notification flushes, the score audits — stays per branch, and the test
asserts that too: a gate that swallowed a branch's own housekeeping would be
as wrong as no gate.

### Three more leaks closed, one of which writes

- `cloudflareSecrets.ts` loses its `|| 'studioos'` fallback **on a branch**.
  This is the only one on the list whose consequence is a write: a branch
  admin saving an integration key with `CF_WORKER_SCRIPT_NAME` unset would
  have PUT that secret onto HQ's script, overwriting production's credential
  from a screen that reported success. HQ keeps the fallback, because HQ is
  the script it names.
- A branch answers `X-Robots-Tag: noindex, nofollow`. Every branch serves
  HQ's `docs/` bundle, whose canonical links, sitemap and OG URLs name
  `axal.vc`; indexed, a branch host would be a full duplicate of the
  marketing site with canonicals pointing away from itself.
- Seven SPA links built from the literal `https://axal.vc` now come from
  `appOrigin()`. The referral link is the sharp case: a branch member sharing
  `https://axal.vc/register?ref=…` sends the referee to **HQ's database**,
  where the reward is attributed against a member who is not there.
  `ogRegistry.js`'s `SITE_URL` deliberately stays the apex — canonical tags
  are statements about where the canonical document lives — and a test
  asserts that too, so a later sweep cannot "fix" it and recreate the
  duplicate `noindex` exists to avoid.

### A boot assertion for the URL vars

On a branch, `assertBranchAppUrl` refuses to serve `/api/*` unless `APP_URL`,
`PUBLIC_BASE_URL`, `OAUTH_CALLBACK_BASE_URL` and `PUBLIC_MARKETING_URL` all
name `<code>.axal.vc`. A branch deployed with HQ's values does not fail — it
succeeds, and sends its users to HQ's host, where their branch-named cookie
does not exist and their account is not in the database. The comparison is
against `BRANCH_CODE`, not against one var trusting another.

### Migration 256 — the licence is a copy, and it says how old it is

`branch_licence`, `branch_promo_ceiling` and `branch_benchmarks` are
singletons (the first two) and a small keyed table, each carrying `pushed_at`
— HQ's assertion time, carried across in the push, not this database's write
time. They are empty on HQ by construction; nothing writes them there, and
reading a copy of your own ledger is a way to disagree with yourself.

`GET /api/licence/mine` reads the copy on a branch and stamps the response
`source: 'hq_copy'` with `as_of`. Without the branch path it would answer its
existing 404 — "You do not administer a territory licence" — to the one
person on the deployment who does, because `licence_admins` and
`territory_licences` exist there and are empty. A row in another database and
a row that does not exist must not read alike, so the two carry different
codes (`licence_not_pushed` vs `no_licence`). `events` is `[]` with
`events_available: false` and a reason: the trail is HQ's, and an empty array
alone would claim nothing has happened to the licence.

### What is guarded

`branch_mode_gates.test.ts` (9) and `branch_licence_copy.test.ts` (5) in the
worker suite; `frontend/test/branch_host.test.mjs` grows two (5 total).
23 mutations applied, 23 caught — one only after the `appOrigin` fixture
gained `{ location: {} }`, the single shape where dropping the optional chain
changes the answer. An assertion that cannot fail on the machines that run it
is not a guard.

---

## D107 — A branch gets the canvas's eight rows, notices and all; and suspension finally does something (2026-09-15, #215)

**The decision that needed recording, because it reads as a reversal of a rule
this repo states and is not one.** `sidebarConfig.js` says plainly that rows
are added as their pages land, because "a row pointing at a route that does not
exist is worse than a missing row: it looks shipped and 404s". Applied
literally to the subsidiary tier that would have shipped a **one-row** sidebar:
of the Admin · Subsidiary canvas's eight rows, only Settings has a page today,
Contracts now answers "HQ only" on a branch (D106), and S1–S6 do not exist.

A one-row sidebar is not that canvas, and it does not answer the question the
frame exists to answer — *whose data am I looking at*. So all eight rows ship,
**every one with a registered route**, and the rows whose artboards are unbuilt
render `BranchZonePending`: a card naming the artboard, what will be on it, and
**which numbered PR builds it**. The rule's actual property — no row 404s — is
untouched and is what `subsidiary_shell_s0.test.mjs` asserts. The notice names
a PR rather than saying "coming soon" on purpose: "soon" is unfalsifiable and
survives forever, whereas a named build makes the notice wrong the day it lands,
which is what gets it deleted.

**The shell is chosen on the deployment, not the account.** `shellRoleFor`
returns `branch_admin` when `/me.branch` carries a code — a fact about which
Worker served the page, which no browser can be wrong about. The file's own
rule is unchanged and restated for the new arm: **it names a sidebar, never a
permission.** Nothing that decides access reads it; the gates are D106's, in
the Worker, keyed off `BRANCH_CODE`. The branch arm is checked before the HQ
arm, which is not a precedence call between two live claims — D106 makes
`is_super_admin` 0 on every branch — but this file declining to depend on that
invariant holding somewhere else.

**Suspension is now a behaviour, not a column.** `requireBranchNotSuspended`
reads `branch_licence.status` and throws on the decision write in each of
`admin_lp_applications.ts`, `refer_earn.ts`, `admin_cohort.ts` and
`spinout_moderation.ts` — four files, four routers, no shared write helper,
which is why it is four call sites and not one. Three properties are load-bearing
and each is pinned in both directions:

- **423 Locked, not 403.** They are different claims. 403 is "this is not
  yours"; 423 is "this is yours, and HQ has frozen it" — a state with a date, a
  reason and an appeal path, which the shell renders differently. This is the
  only entry in `AUTH_ERROR_STATUSES` that is not 401/403, and it widened the
  map's type to admit one.
- **After the admin gate, always.** A freeze check that ran first would answer
  423 to an anonymous caller and leak the branch's licence state to anyone who
  could reach the URL. The guard slices the *handler* out to assert the order,
  because these files register several routes and a whole-file offset
  comparison passes even when the pair is reversed — found by mutation, not by
  reading.
- **Reads never freeze, and an unreadable copy never freezes.** A frozen branch
  can still see its queue; that is what the banner is about. And a branch whose
  licence HQ has not pushed yet reads as NOT suspended — inferring suspension
  from a missing row would freeze every branch in the window between bootstrap
  and the first push, which is exactly when its principal is trying to work.

**Two defects in PR 4's licence copy, found by wiring a page to it rather than
by reading it.** D106 shipped `branch_licence` and the payload that reads it,
and nothing rendered either until now. The copy emitted its own column name
`legal_entity` where `MyLicencePage` reads HQ's `legal_entity_name`, and carried
no `licence_ref` at all — so the single screen the copy exists for would have
shown a blank entity and a licence with no reference on it, on the one tier
nobody had run. **Migration 257** adds the column (additive, never an edit to
applied 256), and the payload now speaks HQ's field names, asserted against the
keys the page actually reads rather than a list retyped in the test.

The same wiring surfaced a third: the History panel rendered the branch's
empty `events` array as "Nothing recorded yet", which is a claim about HQ's
append-only trail that this deployment cannot make. The server was already
sending `events_available: false` with a reason; the page now renders it. An
empty array and an unavailable trail are different facts and must not share a
sentence — the same rule `licence_not_pushed` follows against "you administer
no licence".

**What this does not do.** S1–S6 have no bodies; PRs 12–14 build them. There is
no shell-level frozen banner yet — the 423 is server-side and the branch Home
that would carry the banner does not exist. The canvas moves `backlog/` →
`integrated/`, 61 → 62 and 26 → 25, because it now has routes.

**Verification.** `npm run test:drift` exit 0. `subsidiary_shell_s0.test.mjs`
(7) and `branch_suspended_freeze.test.ts` (7) are new; `branch_licence_copy`
grows one. **14 mutations applied, 14 caught** — one only after the handler
ordering assertion stopped comparing whole-file offsets, which is the same
lesson again: an assertion that cannot fail on the code it guards is not a
guard.
