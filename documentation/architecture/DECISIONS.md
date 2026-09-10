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
