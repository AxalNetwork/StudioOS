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
computed *across* branches. One dataset carrying the branch on every row is
what makes those two numbers possible without a cross-branch read; renaming it
per branch would have quietly removed them.

> **CORRECTED BY D161.** This paragraph said "one dataset **indexed by**
> `BRANCH_CODE`", and that was never built — the sole index was the route
> (`middleware/observability.ts`), and the reader had no branch predicate, so
> every per-branch AE query returned nothing for as long as the sentence
> stood. D161 builds the dimension, and deliberately as a **blob** rather than
> an index: the first index is the sampling key and the sampling key is the
> route, so moving it would make samples either side of the change
> incomparable and lose the route-level sampling fairness it exists for. The
> dataset is therefore shared and **filterable** by branch, not indexed by it —
> which is what the two numbers above actually need.

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
`super_admins` at all. That one line closes every super-admin route and the
`/me` echo together, because every one of them reaches the flag through
`requireSuperAdmin` → `isSuperAdmin`. *(This sentence said "all 24" until D132;
by then the figure was 40 across eleven route files. The count is gone rather
than corrected — nothing guarded it, and the claim is about the funnel, not the
tally.)*

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

---

## D108 — HQ reads every branch at once, one failure stays local, and a branch can finally push something up (2026-09-15, #216)

**The rule the whole PR is shaped around.** Under D.2 each branch is its own
Worker over its own database, so every cross-branch figure on an HQ screen is N
remote calls and any of them can fail — or, worse, never answer. Two obvious
implementations are both wrong: awaiting them together makes HQ's Home as
available as its least available branch, and summing whatever came back prints
a total that is quietly missing a territory. The second is the dangerous one,
because it looks like an answer.

So `services/branches.ts` is `Promise.allSettled` under a deadline, with a
**per-branch state** and a denominator on every aggregate. "Of N branches, M
answered" is a sentence H1 must be able to say. Three states, not two, and the
third is the one that gets forgotten:

- **`ok`** — it answered, with its own `as_of`.
- **`unreadable`** — it did not. This is explicitly **not** a claim the branch
  is down: a binding can be misconfigured, a deploy can be mid-flight, the
  deadline can be tight. The copy says "could not be read" and offers a retry.
- **`not_deployed`** — HQ holds a licence and a registry row but has no binding
  yet, because a new branch's `[[services]]` entry reaches HQ on its next
  deploy (D.7, and the accepted cost in F.11). Structurally different from a
  failure and must not share its colour.

**The entrypoint classes contain no logic, and that is a testability decision
rather than a style one.** `WorkerEntrypoint` comes from `cloudflare:workers`,
which does not exist under `node --test`, so anything written inside those
classes could be verified only by deploying — for calls that cross the tier
boundary, the worst possible place to learn something is wrong. The behaviour
lives in `rpc/branchOps.ts` and `rpc/hqOps.ts`, plain modules tested against a
real SQLite; `rpc/index.ts` is delegation, and a guard asserts it stays that
way (no SQL, no control flow).

**What a binding does not give you, stated once.** A callee cannot see which
binding called it. So every branch→HQ call passes its own `BRANCH_CODE`, HQ
validates it against the same regex `branchOf` uses, **and checks it against
`licence_deployments`** — which is why migration 258 ships in this PR rather
than with provisioning. A code HQ has never provisioned cannot file an
escalation. That is attribution, not authentication, and the difference is
worth naming: an entrypoint is callable by any Worker in the account, the
account is ours, and treating the transport as an identity is how a binding
ends up trusted for something it cannot establish. The money-adjacent calls
need the per-deployment secret (`rpc_secret_hash`, migration 258); `reportUsage`
is the first and PR 9 builds it.

**Escalations exist now, so two false statements were deleted rather than
reworded.** `admin_hq.ts` shipped the sentence "No escalation exists on the
platform: a subsidiary cannot push a ticket up to HQ, so there is nothing to
list", and HQ Home's rail said the same. Both were true and are now false.
Migration 259 gives the concept a store — kind, subject, the branch that raised
it, and a **due date rather than an SLA band**, because a band stored at write
time is wrong an hour later. The band is derived on read, the way
`okr_column_moves` stores the Monday and derives the window.

**Four things the code corrected, each recorded rather than quietly fixed:**

1. **Two of the four backlog table names were wrong in the first draft**
   (`cohort_applications`, `spinout_moderation_queue`; the real ones are
   `cohort_applicants` and `spinout_moderation_cases`), and so were two status
   vocabularies. This would not have failed loudly — it would have reported the
   backlog as permanently *unreadable*, a plausible-looking answer that is
   never right. The names and statuses are now read off each store, and
   referrals reuse the exported `PRE_VERDICT_STATUSES` minus `draft`: a draft
   belongs to the member still writing it, and counting it as reviewer backlog
   puts a branch admin under pressure for work nobody handed them.
2. **`territory_licences` does not have the columns the branch copy has.** The
   first `licence()` pull named `term_start`, `term_end`, `template_version`
   and `token_margin_split_bps`; only a renamed `token_split_bps` exists, and
   D1 would have thrown on every pull. `term_end` and `template_version` are
   now sent as **null with a comment saying why** — the ledger holds
   `term_years` beside `starts_on` and no end date, and deriving one here would
   invent a fact HQ never asserted.
3. **An unreadable queue voids the backlog rather than shrinking it.** If one
   of the four stores cannot be read the answer is `null` with a reason naming
   it, not the sum of the other three. A smaller number presented as the
   backlog is worse than no number.
4. **A test was at fault, not the code.** The LIKE-escaping assertion searched
   for `'%'` — one character, which the short-needle guard rejects before the
   query runs, so the test could not fail either way. It now searches `0%`
   against two rows built so that escaping *changes the answer*. Third time
   this lesson has been written down in this programme: an assertion that
   cannot fail on the code it guards is not a guard.

**What this does not do.** No branch is deployed, so `branches` is `[]` on
production and every assertion here is exercised against fixtures — the first
real fan-out is PR 7's throwaway branch. `revenueSummary`, `governanceFeed`,
`mintSupportSession` and the HQ→branch pushes beyond `applyLicence` are not
built; H4's grouped search has `searchAccounts` behind it but no page yet.
Seats used stays `null` with its reason on both tiers until `seat_assignments`
exists.

**Verification.** `npm run test:drift` exit 0 — frontend 2389, worker
3048 → 3069, retention 29. `branch_rpc_fanout.test.ts` is new (21);
`hq_home.test.mjs` had two pins re-pointed rather than relaxed, because the
property worth guarding was never "escalations are absent" but "the payload
says which of the two it is". **7 mutations applied, 7 caught**, including
`Promise.allSettled` → `Promise.all` and dropping the deadline, which hangs the
suite rather than failing an assertion — a distinction the test measures
elapsed time to catch.

---

## D109 — A branch can be made, by a workflow that has never run, and the PR says so (2026-09-15, #217)

**Every ingredient existed and nothing could assemble one.** PRs 1–6 shipped
the config generator, the migration runner, the branch-mode gates, the shell
and the RPC surface, and there was still no path from "HQ issued a licence" to
"`fr.axal.vc` answers". `branch-provision.yml` is that path.

**IT HAS NEVER RUN, AND THAT IS THE HONEST STATE RATHER THAN AN OMISSION.** It
cannot until the credentials D.11 lists exist: a Cloudflare token widened
beyond today's Workers Scripts + D1 to KV, R2, Queues, Vectorize and **Zone
DNS**, and — only for HQ's Deploy *button* — `GITHUB_ACCESS_TOKEN` with
`actions: write` (task #192). So this PR ships the workflow, its guard and its
runbook; it does not ship a green live run, and the PR body leads with that
rather than burying it. A workflow is code: it can be reviewed, linted and
tested as text, and the properties worth testing are not the ones a run would
show anyway.

**THE STEP ORDER IS A CORRECTNESS PROPERTY, NOT A STYLE ONE**, and the code
decided it rather than the plan. `gen-branch-wrangler.mjs` refuses unless
`infra/branches/<code>.json` exists; `migrate-d1.mjs --branch` refuses unless
the generated toml exists. So the sequence is forced: create the resources,
capture the ids, write the registry, generate the config, then migrate. Two
more orderings matter for reasons the refusals do not enforce — secrets before
deploy, because a Worker without `JWT_SECRET` answers **503 config_error** on
every request (up, and refusing everything, which is not "live"), and deploy
before smoke, because there is nothing to smoke otherwise. The guard asserts
all four.

**EVERY DISPATCHED VALUE IS DATA, NEVER SCRIPT TEXT.** `${{ }}` inside a
`run:` block is substituted before the shell parses the line, so a value
carrying `;` runs as a command on a runner holding `CLOUDFLARE_API_TOKEN`.
Semgrep caught exactly this on PR 3's one interpolated step; this workflow has
nine inputs and all nine arrive as job-level `env:` vars, charset-validated in
one step before anything is built from them. **The single most valuable line in
the guard** scans every `run:` block for `${{ inputs.` and asserts zero — it
guards the class, not the instance. The same reasoning is why three steps are
Node scripts rather than heredocs: a `run:` block building JSON or SQL from
dispatched values would have to interpolate them, and `process.env` does not.

**NO WRANGLER CALL MAY FALL THROUGH TO HQ'S CONFIG.** Every one names
`--config wrangler.branch.<code>.toml`. A bare call reads `wrangler.toml`,
whose `[[routes]]` are the apex custom domains — deploying a branch with it
would move `axal.vc` onto the branch Worker, which is leak L10 and the reason
the generated config exists at all. This also **designs out one of the three
unknowns** the plan left for the first run: whether `wrangler d1 execute` with
a name not in the config resolves through the account never arises, because the
name is always in the config. The other two stay, and each gets a step that
fails naming the exact right it is missing rather than a generic error.

**Three smaller calls, each stated because the opposite is defensible:**

- **The registry entry is written `provisioning`, never `live`.** The Worker is
  not deployed when that file is written, and a status running ahead of the
  deploy makes the registry a claim rather than a record.
- **The principal row carries no password.** It is seeded `role='admin'` and
  active with no credential; the principal signs in by magic link or Google
  like everyone else. Writing a password would make this workflow's log, or the
  secret that fed it, briefly the credential to a subsidiary's console.
- **HQ's binding goes through a PR, not a push.** The committed `wrangler.toml`
  is the deployed truth the apex guards and the parity guard read, and this
  change adds the one thing that lets HQ reach another database. HQ gains the
  binding on its **next deploy**, not on merge — which is why
  `services/branches.ts` has a `not_deployed` state (D108) rather than
  reporting the gap as an outage.

**Idempotent by step, not by run.** Every create tolerates "already exists" and
the principal seed is `INSERT OR IGNORE`, so a failure half way is re-runnable.
The one refusal is a code whose registry file is already committed: that is a
branch someone has already provisioned.

**Verification.** `npm run test:drift` exit 0.
`frontend/test/branch_provision_workflow.test.mjs` is new (9). **7 mutations
applied, 7 caught** — an input interpolated into a `run:`, a wrangler call
losing its `--config`, the deploy retry removed, the registry claiming `live`,
the SQL literal no longer escaping a quote, the service binding written to one
table instead of two, and the idempotence guard removed. One escaped on its
first attempt because the test's own extractor stopped at a line end and read a
call's `--config` on the next line as absent — the same shape of mistake as
measuring a guard by a whole-file offset (D107), fixed by joining backslash
continuations first. No `frontend/src` change, so `docs/` does not move.

---

## D110 — A licence gets a contract and a deployment, the grid shows what nobody holds, and a missing credential is a state (2026-09-15, #218)

H2 and H3 are the two HQ artboards that were built honest and incomplete. The
ledger drew who holds what; the coverage map was refused, the renewal pipeline
had no zone, the issue flow stopped at Activate, and there was nothing anywhere
that could ask for a branch to exist. This is those four, plus the Platform
console that watches the result.

**The coverage grid is built from the EU, not from the ledger — because the
white space is the point.** The refusal that stood in `AdminLicences.jsx` said a
map was "presentation of the same data the territory list already carries".
That was true of a map of what is *held* and missed what H2 exists to answer:
which countries are still available. A grid assembled from the licences that
exist can only ever show what is taken. So `lib/licenceCoverage.js` starts from
the 27 member states and joins the ledger onto them. It is a 27-cell grid and
not a choropleth because the shape of a country carries no information here and
a projection is a large dependency for none.

Three cell states, and **the middle one is the whole reason there are three**: a
**suspended licence still holds its territory**. Releasing a country is a
termination, not a lapse — `AdminLicences.jsx` already says the intuition runs
the other way — and a grid that painted a suspended holder's countries as free
would invite exactly the double-issue migration 187's UNIQUE index exists to
make unrepresentable. A terminated licence holds nothing, so it is excluded
rather than given a fourth colour. A country a licence holds that is **not** in
the EU is reported in `outside_eu` rather than dropped: a grid titled "EU
coverage" that silently swallowed a Swiss territory would make the ledger look
smaller than it is.

**`days` to renewal is derived on read, and an overdue row is kept.** The same
rule the escalation SLA band follows (D108): a number of days baked in at render
time is wrong tomorrow, so `renewalPipeline` takes the date to measure from.
Overdue renewals go negative and stay in the list, because an overdue renewal is
the single most important row on the zone and hiding it because it sorted below
zero is how a lapsed licence goes unnoticed.

**The issue flow is six steps now, and the record is not one of them.** It was
five, ending in "Activate" — but the Activate *button* has always sat above the
tabs rather than inside them, so the fifth tab was really the history. Steps 5
and 6 are the two the canvas draws, Contract and Deploy, and the history keeps
its own unnumbered tab: it is provenance, not a step anybody performs.

**Step 5 stores the rendered text, which is the whole reason migration 259
exists.** `legal_template_versions` keeps every prior version precisely because
an archived version *stays binding on the contracts that carry it*. A row that
held only a slug and a version number would still be re-rendered from today's
merge values, so a licence signed at a €90,000 fee would display tomorrow's
€95,000 — a contract that silently restates itself is not a record of anything.
The version is **read from the library, never passed by the caller**: an
archived version stays binding on a contract that already carries it, it is not
newly issuable. A re-issue **supersedes**, never overwrites, for the same reason
`licence_events` is append-only.

**A merge field the licence cannot fill keeps its placeholder and is named.**
Blanking it turns "we never agreed a governing law" into a contract that reads
as complete and says nothing — the most expensive silent failure available on
this screen. `unfilled_fields` is a column, not a computation, so the gap
travels with the instrument.

**Step 6 is the first thing in the programme that can ask for a branch**, and
two of its decisions are about honesty rather than mechanism:

- **The credential is a STATE, not an error.** `GITHUB_ACCESS_TOKEN` with the
  `actions: write` scope is task #192 and is not set in production, so the
  normal answer today is **409 `github_not_configured`** carrying the exact
  secrets to set and the note that the workflow still runs by hand from the
  Actions tab. A 500 would read as a broken button and send someone to the
  logs. `GET /api/admin/deployments` returns `dispatch_available` so the page
  disables the button with the server's own sentence rather than letting
  someone press it into a 409 — the SPA never carries a second copy of a secret
  name. And a **403 from GitHub is reported as the scope**, not as an unset
  secret: telling someone to set a secret that is already set sends them to fix
  the wrong thing.
- **The row is written before the dispatch.** A `workflow_dispatch` returns 204
  with no body whether the run then succeeds, fails, or is never scheduled, so
  the dispatch establishes only that GitHub accepted the request. Writing first
  means a failed attempt leaves a row saying `failed` with the reason instead of
  leaving no trace of something someone did.

**The provisioning status and the live read are separate fields, everywhere.** A
deployment that reached `worker_live` last week and is unreachable right now has
not regressed to `requested`; conflating them loses which of the two is wrong.
For the same reason the Deployments zone's coverage counts only the branches HQ
**asked** — a registry row HQ has no binding to yet was never asked, and folding
it into `unreadable` would report a deploy HQ owes itself as a branch that is
down.

**A branch code is refused, not corrected.** `FR` is rejected rather than
lower-cased, on both sides. It names the Worker, the database and the hostname,
and `write-branch-registry.mjs` and `check-branch-config.mjs` both refuse it
(D105): a code HQ silently rewrote would be accepted at one end and rejected by
the workflow it was dispatched to, which is two definitions of a valid branch
code. There is one.

**The defect this PR found on the way, and fixed rather than worked around.**
`AUTH_ERROR_STATUSES` lived in `index.ts` and said `'Super admin required':
403` — but `routes/_t13t14t15_helpers.ts`'s `mapError`, which **31 route files
call inside their own `try/catch` so `app.onError` never sees their throws**,
carried its own ternary listing four sentences and not that one. So the entire
HQ franchise console answered a permission refusal with **400 Bad Request**,
and the SPA cannot tell a refusal from a malformed request at 400. It is the
same failure the map's own comment records — a decision in two places — reached
from the other side. The table now lives in `util/authErrors.ts` and both
readers index it.

**Deliberately not here.** Sending a contract for signature (the row carries
`status` and `envelope_uid` and nothing writes them yet — the e-signature leg is
its own work), and the Deployments zone's rollout percentage and rollback, which
need the Cloudflare versions API rather than the registry.

**Verification.** `npm run test:drift` exit 0, read as the exit code.
`cloudflare-worker/test/admin_licences_deploy.test.ts` (16),
`cloudflare-worker/test/licence_contract_instantiate.test.ts` (14) and
`frontend/test/hq_licences_h2h3.test.mjs` (17) are new. **44 mutations applied,
44 caught** — one escaped first: nothing proved the template version came from
the library rather than from the request body, which is exactly the archived-
version hole the route's comment claims to close, so the assertion was added
rather than the comment softened.

---

## D111 — A statement is a claim somebody can be held to, and the honest half of it is what nobody could report (2026-09-15, #219)

H5 drew five zones over two stores. The two with nothing behind them were
**statements** — what each subsidiary owes HQ this quarter — and the **promo
budget**, which the product had never had. Both said so on screen in the
server's own words, which was the right answer while it was true. This is the
work that makes it untrue, and most of the decisions below are about the
figures that are *still* missing after it.

**A statement is HQ's claim, not a reconciliation.** `subsidiary_statements`
(**migration 260**) holds one row per licence per period: the gross a branch
reported, the revenue share the licence carried when the statement was drawn,
and the owed figure computed from the two. `paid_cents` and `disputed_cents` are
**entered by an HQ operator** with a note and a user id, and nothing here talks
to Stripe. Making *paid* automatic needs HQ to be a Stripe Connect platform with
each branch a connected account (D.8), which is real work and is not this.

**Owed is computed and stored, which is the opposite of the SLA band (D108) and
for the opposite reason.** A band is a view of a date and must stay current; an
owed figure is a **claim**, agreed against a share that can be re-termed next
quarter. Recomputing it later from today's terms would silently restate a
statement somebody has already paid against — the same failure D110's stored
contract body exists to prevent. Both the inputs and the answer are kept: a row
holding only the answer could not explain itself, and one holding only the
inputs would restate itself.

**Two tables, because they have different authors and different trust.**
`subsidiary_usage_reports` is what a **branch said about itself**, arriving over
the RPC surface with its own `reported_at`; `subsidiary_statements` is HQ's
ledger row. Folding them together would make "the branch says it billed
€40,000" and "HQ has decided it owes €14,000" the same fact with the same
authority, and the whole point of a statement is that the second is a decision
someone at HQ can be held to. A re-report **replaces** its (licence, period,
stream) row, because a branch correcting itself is a correction and not a second
quarter's trading.

### The finding: a branch cannot total its own revenue, and that had to be read rather than assumed

Before writing `revenueSummary` the branch-side stores were read. All three
answers were "cannot measure", and each for a different reason:

| stream | why |
| --- | --- |
| subscriptions | `account_subscriptions` carries a plan, a status, a period end and Stripe ids and **no amount**. The charges are in the Stripe API, read one customer at a time. There is no local charge ledger to total a quarter from — on a branch any more than at HQ, which is the same finding `admin_revenue.ts` already records for the platform. |
| licence fees | A subsidiary charges no onward licence fee in the product. The annual fee flows the other way. |
| token margin | `ai_usage_logs.est_cost_usd` is a **cost** and is real; what tokens were **billed** at is stored nowhere, so a margin cannot be derived. |

`engagement_invoices` carries a `total_cents` and is deliberately **not** read:
it is a partner billing a founder, not the branch billing anyone, and summing it
would report other people's trade as the subsidiary's.

So the shape of a statement follows from the data rather than from the canvas.
The cost is reported as `token_margin`'s **`estimate_basis`** and never as its
gross — that is the one shape that gives HQ the number it does have without
letting a statement add a cost up as revenue. **A stream nobody could report is
not zero**, it is counted: `unreported_streams` travels with the row, `complete`
is derived from it, and every surface showing the owed figure shows that it is a
**floor rather than a total**. A draw that treated those streams as 0 would not
produce a smaller truth, it would produce a false one.

**Money rules, held by the same guard the ledger uses.** Integer cents, integer
basis points, rounded **once** at the end — 3500 bps of 1,234,567 is 432,098.45
and a floor would under-bill every statement shaped like that, forever, in one
direction. Nothing is summed across currencies: a stream reported in a currency
the licence is not denominated in is **reported as unusable rather than
converted**, and the ledger's totals are keyed by currency so a page cannot
reduce them to one number without deleting the key.

**A re-draw refuses past `draft`.** A drawn statement nobody has sent is a
working figure; once `issued`, somebody has seen it, and re-running the draw
under re-termed terms would restate what a subsidiary was told it owed. Void it
and draw a new one. A licence with **no agreed share refuses outright** rather
than drawing at 0% — that would file a statement for nothing as settled.

### Money-adjacent RPC carries a secret, and a missing hash refuses

A service binding cannot identify its caller (D.7), so a branch code is
**attribution, not authentication**. For `escalate` (D108) the worst case is a
mislabelled queue item. For `reportUsage` it is the figure a statement is drawn
from, so the call carries a per-deployment secret verified against
`licence_deployments.rpc_secret_hash`; HQ stores the **SHA-256**, so reading the
table cannot impersonate a branch.

**A deployment with no hash on file refuses**, and this default is the point: a
NULL meaning "no check configured, allow" would remove the guard from exactly
the deployments nobody has audited. That was not hypothetical — **a real gap
this PR closed**: `branch-provision.yml` generated `RPC_SECRET_SHA256`, used it
once to set the Worker secret, and never wrote it to HQ, so every branch would
have had a NULL hash and every real `reportUsage` would have been refused. The
workflow now records it, charset-checking both the digest and the branch code
before either reaches a SQL string.

One deliberate asymmetry, because it reads like an inconsistency and is not:
`authenticateBranch` **lower-cases** the caller's code, while the D110 deploy
route **refuses** a code that is not already lower-case. There the string is a
name being chosen and accepting `FR` would create a branch whose code is not
what the operator typed; here it is an identifier being presented, and `FR`
resolves to `fr` and must still present `fr`'s own secret — so the normalisation
reaches no branch the caller could not already reach.

**A ceiling, not a budget.** `licence_promo_ceilings` is what HQ allocates per
licence per period and pushes to the branch; `issued_cents` is what the **branch
reports** having issued against it, and it is **nullable on purpose** — "the
branch has issued nothing" and "the branch has not told us" are different
statements, and a zero would report the whole ceiling as still available. HQ
never computes it and never echoes it back on the pull, because HQ's copy is
stale by construction. The push reports whether it **landed** as its own field
rather than as the success of the write: the ceiling is stored either way, and a
502 for an unreachable branch would make an operator re-enter a figure that is
already saved.

### Three defects the tests found in this PR's own code

1. **`subsidiary_usage_reports.gross_cents` was `NOT NULL DEFAULT 0`** in the
   first draft of migration 260 — in the same file whose header says an
   unmeasurable stream must be null. The first report threw, and the only way to
   make it succeed would have been to write the 0 the rest of the design exists
   to prevent. The column is nullable.
2. **`branchRevenueSummary` validated its period inside a `try`** whose `catch`
   turns any throw into "the AI usage log could not be read". A nonsense period
   therefore produced a plausible summary with a false reason attached, and HQ
   would have drawn a statement over a window nobody meant. The bounds are
   computed before the try.
3. **The `PATCH` handler built its `SET` clause by joining an array of column
   fragments**, and `check-sql-prepare` refused it. Every fragment was a literal
   written above it, but "provably safe by reading the function" stops being
   true the first time somebody pushes a request-derived field name in, and that
   is a change nobody would think to re-review. It is three literal statements
   now, fully bound, applied as one `batch` — and **nothing is prepared until
   every field validates**, because three statements are three chances to write
   half a change.

**What is still absent on H5, and says so:** the token margin and the
per-subsidiary token P&L (U1 — no account names its licence, and no price is
recorded to subtract a cost from), subscription revenue as a platform figure,
and a branch's issued promo spend until that branch reports it. The two zones
that used to carry a stated refusal for a store that did not exist now carry
figures; the rail's unavailable list lost both lines and gained the narrower one
that is still true — a promo code names no subsidiary, so what a branch issued
is a figure the branch reports.

**Verification.** `npm run test:drift` exit 0. New: `hq_statements.test.ts` (23),
`branch_usage_report.test.ts` (20); `hq_revenue_h5.test.mjs` re-pointed (11) and
`admin_revenue.test.ts` updated, its retired-refusal assertions replaced rather
than deleted. **34 mutations applied, 34 caught.** The first run of the new RPC
suite failed four ways and three of them were real code defects, listed above.

---

## D112 — A branch can ask, HQ can answer, and the answer arriving is a different fact from the answer existing (2026-09-15, #220)

D108 gave a branch a way to push an item up: `hq_escalations` (migration 259),
`recordEscalation`, and H1's list. What it did not give anybody was a way to
**answer** one. `answer`, `answered_by_user_id` and `answered_at` have been
columns nothing writes since the day they shipped, so H1 was a queue that could
only grow: a branch pushed an item up, HQ read it, and it stayed there forever.
This closes the loop, and the decisions below are mostly about the ways a loop
like this lies quietly.

**A decision is one answer with an author and a time — not a thread, and every
surface says so.** The canvas draws "the answer coming back as a thread with
HQ's decision and who made it". What the schema holds is the *decision* half.
So a second answer **replaces** the first rather than appending (two decisions
in one column is not a thread, it is a lost decision), and the branch's lane
renders the answer with **no reply box**. A textarea there would be the most
expensive thing on the screen: the person using it would believe they had
replied, and nobody would ever read it. The payload says `answer_shape:
'single_decision'` so no future surface has to rediscover this.

**An answer requires its reason, even when the decision is no.** A status change
with nothing written arrives at the branch as a refusal it cannot act on, on the
screen of the person least able to find out why.

### The delivery is its own fact, and that is the shape this whole tier keeps

`answerEscalation` records HQ's decision and **does not push**. The route pushes
and reports the result in its own `pushed` field — the D111 promo-ceiling
precedent, for the same reason: HQ deciding and the branch receiving are
different events, and a route that reported them as one would make an
unreachable branch look like a decision that never happened, so an operator
would enter it twice.

**The mirror of that, on the branch side: a raise that cannot reach HQ is kept,
not dropped.** The local row is written either way (**migration 261**,
`branch_escalations`), because a raise is still a thing a person did and losing
it because a binding was down would teach people to distrust the button. It is
stored `undelivered` with the reason and is retryable — and it is emphatically
**not counted as an escalation HQ has**: `hq_uid` is null, and every surface
keys off that rather than off the row existing.

**Why a second table at all.** `hq_escalations` lives at HQ deliberately: the
point is that HQ sees every branch's queue on one screen. But a branch cannot
read HQ's database (D.2), and S3's To-HQ lane is a list of the branch's own
escalations on the branch's own screen. `branch_escalations` is that list, keyed
on **HQ's uid** rather than a local id — a push matched on a local row number
would land on whatever escalation happens to hold that number, silently and on
the wrong one. A push for a uid this branch has no row for is **reported, never
inserted**: a branch inventing a row from a push would show an escalation nobody
there raised.

`answered_by_name` is a **name, not an id**, because HQ's user ids and a branch's
collide by construction (D104) and an HQ id stored locally could be joined to a
local `users` row and name the wrong person with complete confidence.

### The trap: the appeal path must not be the thing that freezes

D107 gates every branch write behind `requireBranchNotSuspended` → 423. PR 5
shipped the frozen-branch banner whose **stated appeal path is an escalation**.
Gating this route would have left the banner telling a branch admin to appeal
and the appeal button answering 423 — a locked door with a sign pointing at it,
and the kind of consistency a later refactor "tidies" into place without
noticing. **The escalation route is deliberately ungated**, the route records
why, the form says so on screen, and a test asserts it on `codeOnly` so the
explanation cannot satisfy the assertion.

### H6's localisation refusal is narrowed, not deleted

It had three parts: no localisation link, no brand-approval state, no
per-subsidiary attribution. This closes **two** — a content escalation carries
`branch_code` and now takes a decision. The third is untouched and is why the
artboard's "4 localised" still has no source: **nothing records that one piece
is a localisation of another**, so a count would be counting submissions and
calling them translations. The sentence survives in a smaller and still-true
form, the same way D111 kept `budget_reason`.

### The defect the tests found

`mapError` answered **400** for the branch-tier refusal, because the route threw
its own wording and `AUTH_ERROR_STATUSES` did not know it — the exact failure
D110 found across 31 route files, reappearing the first time somebody wrote a
new refusal. The sentence is a shared constant now (`BRANCH_ONLY` in
`util/branch.ts`, the mirror of `HQ_ONLY`), and the test asserts **both** the
route's status and the table entry, because a route throwing the right sentence
is only half of it: deleting the map entry would put it back at 400 with the
route unchanged.

**One deliberate collapse.** HQ's status vocabulary is wider than the branch's —
`declined` and `withdrawn` are both *decided* as far as a branch lane is
concerned — so the push maps them to `answered` rather than adding two more
CHECK values and a second vocabulary to keep in step.

**Verification.** `npm run test:drift` exit 0. New: `escalation_answer.test.ts`
(19) and `subsidiary_approvals_s3.test.mjs` (9). Every new assertion
mutation-checked both ways. **Two of the test's own assertions were wrong first
and were fixed rather than the code**: one scanned raw source and matched the
comment explaining the very thing it checked, the other grepped for the word
"reply" and matched the sentence telling the reader there is no reply box. An
assertion that fails on the correct implementation is worse than none.

## D113 — the build stamp stops being a merge conflict, and starts being answerable

**Date:** 2026-09-15 · **Task:** #224 · **Migration:** none

`.gitattributes` marks `docs/.build-source` `merge=union`, and
`scripts/check-docs-fresh.mjs` now refuses a stamp that is present but
unparseable instead of falling through to the commit-timestamp proxy.

### The problem, measured rather than estimated

D103 made `docs/.build-source` a tracked one-line SHA-256 of `frontend/src`.
That is the right design and it is not being reversed here. But because the line
changes whenever the source does, **any two branches that touch `frontend/src`
conflict on it — always, by construction.** On 2026-09-15 that cost five
separate mechanical resolutions across #516, #518, #520, #522 and #527, twice on
the same branch. The resolution is never a judgement call: reset `docs/` to
main's build, re-run the root `npm run build`, push.

### The fix that was rejected, and why it is written down

A custom merge driver (`merge=ours` and its relatives) is the obvious answer and
it cannot work here:

- A custom driver needs repo-**local** `git config merge.<name>.driver`, which
  cannot be committed. This repo has **no `postinstall`, no `prepare`, no
  `.githooks/` and no `core.hooksPath`** — nothing runs at clone or install
  time. The one precedent, `npm run lfs:install-hook`, is explicitly opt-in.
- Bot branches (Copilot autofix, the AI-findings autofixer, Dependabot, Cursor)
  never run a setup step at all.
- Decisively: the check that actually goes red is `og-tags`, which runs against
  **GitHub's own server-side merge**, where no local git config exists. A driver
  would not have prevented any of the five conflicts.

It is recorded here so the next person does not re-propose it and re-derive the
same three reasons.

### What a merge attribute does and does not buy

`union` is a **built-in** driver, so it needs no config and applies to bot
branches and to GitHub's merge alike. Two branches that both rebuilt now produce
a two-line file rather than a conflict — verified in a scratch repo, not
assumed.

**It does not remove the rebuild, and pretending otherwise would be the whole
mistake.** The correct value is a pure function of the merged source, so it can
only come from re-running the build. What changes is that a stale `docs/` is
reported by a CI message that prints the exact command, instead of by a conflict
marker in a file that looks binary.

### The hole that made the attribute unsafe on its own — and that was already open

`check-docs-fresh.mjs` read the stamp as
`/^[0-9a-f]{64}$/.test(v) ? v : null` and treated a corrupt file exactly like a
missing one. Missing falls through to the commit-timestamp proxy — **the proxy
D103 exists instead of**, which passes whenever `docs/` was committed after
`frontend/src`, as a merge commit always is. So an unparseable stamp silently
downgraded the gate to the thing it replaced, and printed a tick while doing it.

That was true before this change and independent of merges; the union attribute
would merely have made it reachable every day. `scripts/lib/buildStamp.mjs` now
classifies three states, not two:

| state | under `--strict` |
| --- | --- |
| absent | falls back to the proxy — a `docs/` built before D103 genuinely has no stamp |
| present and valid | the real comparison |
| **present and unparseable** | **refuses**, naming what is wrong (`2 lines`, `not 64 hex`) |

Extracted to `scripts/lib/` rather than left inline because `check-docs-fresh`
resolves its own root from `import.meta.url` and cannot be pointed at a fixture;
a pure classifier is testable, and `scripts/lib/*.test.mjs` is where
`sourceTreeHash`'s own test already lives.

### Also corrected here

`scripts/lib/sourceTreeHash.mjs`'s docblock still said the hash stamps
`docs/.asset-retention.json`. It stamps `docs/.build-source`; the retention
ledger is gitignored on purpose and a stamp inside it would answer nobody, which
is D103's own stated reason for not putting it there. The comment had never
caught up with the code.

### What to watch

That GitHub honours `merge=union` in its own mergeability computation is
**expected, not yet observed**. The next pair of `frontend/src` PRs is the test:
if `mergeable_state` still reports `dirty` on this path, the attribute bought
nothing and only the `--strict` hardening is worth keeping. Say so either way
rather than assuming it worked.

## D114 — The client error beacon reports the error, not the argument order, and `scope` stops being the unsanitised field

**2026-09-15.** `frontend/src/lib/log.js` has been the SPA's error reporter
since Task #10: it consoles, keeps a 50-entry `localStorage` ring
(`axal:client-errors`) support can read off an affected browser, and in
production beacons `POST /api/client-error` so the failure lands in the
Worker's deployment logs. 205 call sites used it correctly. Three ways of
calling it wrongly had also shipped, and every one of them is silent — the code
runs, nothing throws, and the report never arrives or arrives useless.

### 1. Reversed arguments, at 27 call sites, in 13 files

`reportError(err, { where })` instead of `reportError('Scope:op', err)`.
`toEntry`'s `isErrObj` test (`log.js:61`) is a bare `typeof err === 'object'`,
which the context object satisfies, so the entry is built by reading
`.name`/`.message`/`.stack` off `{ where }`. Traced:

| field | correct call | reversed call |
| --- | --- | --- |
| `scope` | `'ScoringPage:run'` | `"TypeError: Failed to fetch"` |
| `message` | the message, redacted | `"[object Object]"` |
| `stack` | the stack, redacted | `undefined` |
| `name` | `'TypeError'` | `undefined` |

Because `message` collapses to that constant for every such call, the beacon's
dedupe key (`scope|message`) degenerates to scope alone, so two unrelated errors
that stringify alike suppress each other inside the 5 s window.

**And it is a leak, not only a loss.** `toEntry` redacts `message`, `stack` and
`path`; it did not redact `scope`, correctly, because a scope is a
developer-authored literal. The Worker's sink depends on that:
`cloudflare-worker/src/index.ts:452-453` states the beacon carries "no token,
and no PII" and `:478-480` that "the client already redacts secrets/PII from the
free-form fields above" — then clips `scope` to 200 characters and writes it
verbatim into a `console.error('[client-error]', …)` line, deliberately
greppable in deployment logs. A reversed call therefore puts raw error text —
which can quote an email, a magic-link URL or a token — into the one field
nothing cleans, and from there into `wrangler tail`.

`toEntry` now redacts the scope too. That is defence in depth, not the fix; the
fix is the argument order and the guard below.

### 2. One call reached the *browser's* `reportError`, and nothing could have caught it

`SpinoutLabLpWorkspacePage.jsx:1075` called `reportError('…:apply', e)` without
importing it. That is not a `ReferenceError`: **`reportError` is a standard Web
API global** (`window.reportError`), present in `globals.browser`, which
`eslint.config.mjs:100` loads. So `no-undef` — this repo's only ESLint rule —
cannot ever flag it; `npx eslint` exits 0 on the file. At runtime the call
reached the browser's one-argument "report an exception" API, which reported the
**scope string** as an uncaught error and discarded the real one, so a failed LP
application reached neither the ring buffer nor the beacon.

This is why the guard has two assertions rather than one: **a check on argument
order passes this call**, because its first argument really is a string literal.

### 3. A scope `redact()` would eat

A consequence of the fix in 1, and guarded rather than hoped away. `redact`
rewrites `key:value` for a list of sensitive key names, so a future scope of
`auth:refresh` would be stored as `auth:[redacted]` and support would lose the
one string they search by. All 203 literal scopes in the tree pass through
unchanged — measured, not assumed — and the guard now asserts it for each new
one.

### The guard, and why not ESLint

`scripts/check-frontend-logging.mjs`, in `test:guards`. Not ESLint's
`no-console`/argument rules, for two measured reasons: the config is
deliberately one rule and its header refuses style rules outright; and its glob
is `frontend/src/**/*.{js,jsx}`, so the 26 `.ts`/`.tsx` files are never linted
at all. **The trap:** seven files already carry
`// eslint-disable-next-line no-console` for a rule that has never been enabled,
`App.jsx:2814` among them, and `reportUnusedDisableDirectives` is `'off'` so
ESLint will not even report them as unused. Turning the rule on would silently
bless the worst gap in the tree.

### Also fixed here

`App.jsx`'s `AppErrorBoundary` (`:2812`) and `decks/Thumbnail.tsx`'s
`ThumbnailBoundary` (`:41`) were the two boundaries whose `componentDidCatch`
never called `reportError` — `App.jsx` did not import `lib/log` at all — so a
top-level crash, the exact class `log.js`'s header says it was built for,
reached no beacon. Both now pair the two calls the way
`TopLevelErrorBoundary`, `RouteErrorBoundary` and `SafeMount` always have: the
beacon takes a redacted entry, and the console line adds `info.componentStack`,
which `toEntry` has no field for. `Thumbnail.tsx` is the first `.tsx` caller of
the JS logger, which `frontend/tsconfig.json`'s `allowJs: true` /
`checkJs: false` pair already admits.

`SpinoutLab83bPage`'s `act(fn, where)` helper passed an assembled scope in a
variable. That was correct at runtime and **unverifiable statically** — the
guard cannot tell a scope variable from an error variable, which is the bug it
exists to catch — so `act` now takes the operation alone and builds
`` `SpinoutLab83bPage:${op}` `` at the call. The guard found that site itself.

`redact` is exported so the guard and the test use the real function rather than
a second copy that drifts. `frontend/test/client_error_beacon.test.mjs` is the
first test `log.js` has ever had, and it is a unit test rather than this
suite's usual source scan for the reason `api_request_timeout.test.mjs` gives
about the request deadline: the bug compiles, lints and runs, so only calling
the function can see it.

### What is not here

The 36 catches whose only reporting is a `console.*` call — 33 of them in eight
Spin-Out Lab pages that never imported the helper — are coverage, not
correctness, and land separately with the no-console half of the guard. Three of
those catches set no UI state at all, so a failed delete, stage change or
clipboard write is invisible to the user; giving them error UI is a
user-visible change to shipped pages and is its own PR again.

## D115 — Every catch reports; `console.*` in `frontend/src` becomes a reasoned allowlist

**2026-09-15.** D114 fixed how the reporter was *called*. This is the other
half: 36 catches whose only reporting was a `console.*` call, and which
therefore reached neither the `localStorage` ring support reads off an affected
browser nor, for errors, the production beacon. A console line is visible only
to someone who already had that browser's devtools open at the moment it
happened, which is nobody.

**The split was clean and is worth recording, because it says what went wrong.**
33 of the 36 were in **eight** Spin-Out Lab pages, and it is exactly the set of
Spin-Out Lab pages that never imported `lib/log`. Twelve other Spin-Out Lab
pages do import it and contained zero console calls. No file was in both sets —
so this was never a judgement about which failures deserve reporting; it was
eight files that missed the convention and then grew. `ErrorState.jsx:6` already
named `console.error → generic toast` as an anti-pattern in its own docblock.

The existing console scopes were already this repo's `kebab:operation` form
inside brackets (`'[spinout-revenue:snapshots]'`), so they converted by dropping
the brackets. The eight bare page-level scopes gained the operation their catch
actually guards (`spinout-revenue` → `spinout-revenue:load`; all eight are the
load catch, each setting `setStatus('error')`).

### `reportWarn` gets its first callers

It shipped with **zero**, having been written alongside `reportError` and never
adopted. It is the right home for the genuinely warn-level sites — a
service-worker registration that failed (`pwa.js`), a settled-promise read the
page degrades past on purpose (`SpinoutLabCapitalPage`), a milestone write, an
empty template registry — because it reaches the ring buffer **without**
beaconing, which is the split `log.js` documents and the reason not to convert
these to `reportError` and triple the beacon volume.

### The allowlist checks itself twice

Ten console calls remain and each is allowlisted with its reason. Two fields
stop the allowlist from rotting into a blanket exemption, and **the second was
added because a mutation escaped**:

- **`methods`** — which console methods the stated reason covers. A
  `console.log` dropped into `log.js` passed a file-keyed allowlist, which made
  the guard's own docblock untrue. This is the split
  `cloudflare-worker/scripts/check-console.mjs` already enforces on the worker
  side: ban `.log`, keep `.warn`/`.error`.
- **`pairsWithReport`** — the five error boundaries keep their console line for
  exactly one reason, that it carries `info.componentStack`, which `toEntry` has
  no field for. That reason holds only while the boundary also reports, so those
  entries require a `reportError` call in the same file. A boundary that quietly
  loses its report now fails the guard instead of resting on an entry that
  stopped being true.

### The seven inert `eslint-disable-next-line no-console` directives are gone

They suppressed a rule that has never been enabled — `eslint.config.mjs`
declares only `no-undef` — and `reportUnusedDisableDirectives` is `'off'`, so
ESLint never reported them as unused either. With `check-frontend-logging.mjs`
owning this rule, a directive that cannot silence it is worse than none: it
reads as a sanctioned exception that does not exist.

### Still not here

Three of the converted catches set **no UI state at all**, so the failure is now
reported but remains invisible to the user: a failed snapshot delete
(`SpinoutLabRevenuePage`), a failed prospect stage change
(`SpinoutLabCapitalPage`), and a failed clipboard write that also skips the
`revenue_summary_generated` milestone. Giving them error UI is a user-visible
change to shipped pages, so it is its own change rather than a rider on a
mechanical one.

## D116 — Three Spin-Out Lab actions that failed without telling anyone

**2026-09-15.** D115 gave every catch in these pages a report. Three of them
still set **no UI state at all**, so the failure reached us and not the person
it happened to. All three were the same shape:

```
if (busy) return  →  setBusy(id)  →  try  →  catch reports  →  finally setBusy(null)
```

**`finally` clearing the busy flag is teardown, not an outcome**, and that is
what made a failure look exactly like a success — the spinner stopped either
way. It is also why these needed finding rather than noticing: a reader scanning
for a bug sees a catch with a `reportError` in it and moves on.

| where | what the user saw |
| --- | --- |
| `SpinoutLabRevenuePage` · delete snapshot | the spinner stopped, the row stayed, nothing said why |
| `SpinoutLabCapitalPage` · prospect stage | the select snapped back to the server's value, silently |
| `SpinoutLabRevenuePage` · copy investor summary | the button still read "Copy investor summary", so the click looked unregistered |

Each now has state of the shape its page already uses: `deleteError` renders
through the same rose line as `formError`; `stageError` is **keyed by prospect
id** the way `stageBusy` already is, so the message sits beside the row it
failed on rather than becoming a page-level banner; and `summaryCopied` widens
from a boolean to `'' | 'ok' | 'fail'`, which is the tri-state
`SpinoutLabScoringPage` already uses for its own copy button. Each message says
what did **not** happen — "still in your log", "still where it was" — because a
failure notice that leaves the outcome ambiguous is barely better than silence.

### The one judgement call, made explicit

`markMilestone(user, 'revenue_summary_generated')` **stays inside the `try`**.
The summary text is built before the clipboard call either way, so an argument
exists that generation succeeded and the milestone is owed. It is not: a founder
whose clipboard refused does not have the summary, and a deliverable nobody can
paste is not delivered. The test pins the call's position between `try {` and
`} catch` so this stays a decision rather than an accident of line order.

### What this does not change

Nothing about which failures are *reported* — that was D115, and all three were
already reporting before this. This is only what the screen says.

## D117 — One home for the string-level absence helpers, and the fallback stops being re-cased

`frontend/src/lib/README.md` has said since it was written: *"If a helper
appears in two places, put it here once rather than a third time."* Nothing
checked it. Measured against `main` at `597f0f68c`:

| duplicate | count |
| --- | --- |
| `const text = (value, fallback = 'Not recorded')` | **16**, in three spellings |
| the same function under the name `display` | **3** |
| a title-casing helper | **30**, under **14** names |
| `export const NOT_RECORDED = 'Not recorded'` | **2** (`lib/dealFlow.js`, `lib/fundAnalytics.js`) |

`ui/Honesty.jsx` made this argument one layer up — `Unrecorded` and
`Unreadable` were four components whose copy had already drifted apart. These
are the string-level half of the same rule, for the cases that need a string
rather than an element, and they had drifted the same way.

### The two divergences, both demonstrable

**1. `text` had two behaviours.** Twelve pages used
`String(value ?? '').trim() || fallback`. Four — `FounderBuildBoard`,
`FounderBuildRoadmap`, `FounderBuildThisWeek`, `FounderBuildCadence` — tested
trimmed-emptiness and then returned `String(value)` **un-trimmed**. So
`text('  x  ')` was `'x'` on twelve pages and `'  x  '` on four.

**2. Every founder title-caser re-cased its own fallback sentence.** This is the
finding recorded against #522 and left latent there; it is worse than that note
said. The helpers ran `text(value, fallback)` *first* and title-cased the
result, so a formatter that cannot tell a human-written sentence from data was
handed one. Verified by running the shipped expressions:

```
labelStage(null)  ->  "Stage Not Recorded"
statusLabel(null) ->  "State Not Recorded"
pretty(null)      ->  "Not Recorded"
```

Meanwhile `InvestorPortfolioPositions.jsx` cased *first* and fell back after, so
the same null there read `"Not recorded"`. The same absence, two strings, in one
product. Nobody wrote "Stage Not Recorded".

### The fix, and why `titleCase` takes no fallback

`frontend/src/lib/absence.js` holds `NOT_RECORDED`, `text(value, fallback)` and
`titleCase(value)`. `text` **trims**, which is what twelve of the sixteen did.
`titleCase` cases the value and returns `''` for an absent one, so the caller
writes its own fallback after it:

```js
titleCase(row.stage) || 'Stage not recorded'
```

**The fallback is deliberately not a parameter.** There are nine different ones
in the tree — "Stage not recorded", "State not recorded", "Event",
"relationship" — and they are not interchangeable, so folding them into the
helper would flatten copy somebody chose *and* put the sentence back inside the
caser, which is the bug. This is the shape `InvestorPortfolioPositions` already
had; it is now the only shape.

Nineteen founder pages convert. `lib/dealFlow.js` and `lib/fundAnalytics.js`
re-export `NOT_RECORDED` rather than declaring it, so no import site moved.
`ui/index.js` re-exports all three beside `Unrecorded`/`Unreadable`.

### What changes on screen

Two things, both moving a minority onto what the majority already did:

1. The four Build pages start trimming.
2. Twelve founder sites stop rendering a title-cased fallback — "Stage Not
   Recorded" becomes "Stage not recorded".

### The guard, and why it starts dirty

`frontend/test/absence_helpers_single_definition.test.mjs` asserts each helper
is **defined once**, not counted — a count passes as soon as somebody deletes
one copy and adds another. It refuses both `text` and its `display` alias,
because the alias is how three files hid from the first measurement.

The 18 title-casers outside the founder pages are on a **named deferred list**
with their reason, the shape `check-inline-project-pickers.mjs` uses for its own
baseline, and the guard refuses **stale** entries as well as new ones — a ledger
is only worth reading if every line still points at something. The list may only
shrink; the follow-up empties it. `InvestorPortfolioPositions` stays on it on
purpose: it is the reference for the correct ordering.

### Left alone deliberately

- **`dateLabel` / `date` / `formatDate`** — byte-identical in 7 files, with
  `'Date not recorded'` at 17 sites. An `Intl` formatter, not an absence helper.
- **`money` must not be merged.** `FounderRaiseCapital` formats whole dollars as
  currency; `FounderRaiseLiquidity` abbreviates to `$1.2M`. Two deliberate
  behaviours under one name — the exact trap this change exists to avoid.

### One assertion was wrong before it was right

The check that `titleCase` has no fallback was first written as
`titleCase.length === 1`. A **defaulted** parameter does not count toward
`Function.length`, so `(value, fallback = NOT_RECORDED)` still reports 1 and the
assertion walked straight through the mutation it existed to catch. It asserts
the behaviour now — a second argument must do nothing. Six mutations, six
caught; that one only after the assertion was fixed rather than the code.

### One existing guard was repointed, and it got stronger

`fund_surfaces_live.test.mjs` asserted `/Not recorded/` against the **source
text** of `fundAnalytics.js`. Moving the literal broke it — correctly: it was
watching a string, not a behaviour. It now follows the reference one hop (the
module must import the shared constant, and the shared module must define it as
that sentence) and adds the check the original could not make: that `fmtCents`
**answers** a null with it. Mutation-checked — making `fmtCents` return `'0'`
fails the new assertion and would have passed the old one.

## D118 — Investor deal-flow is one job on one URL family, and the port comes first

`/deals/*` and the legacy `/pipeline/*` trio were **two complete
implementations of investor deal-flow over two different backends**, with not
one shared source between them:

| family | pages | reads |
| --- | --- | --- |
| legacy | `/pipeline`, `/pipeline/screening`, `/pipeline/commit`, `/pipeline/transactions` | `api.pipelineActive` → `/pipeline/active` |
| canonical | `/deals/pipeline`, `/deals/screening`, `/deals/commit`, `/deals/closing` | `listDeals`, `dealScreening`, `icCommitRoom`, `esignList` |

**The product call: they are the same job, so `/deals/*` wins.** The legacy trio
was never a pre-canvas placeholder — it is a live view with working filters — so
redirecting it away is a real change, not a tidy-up, and the condition on the
decision is that **anything it does that the zones do not is ported first.**

### What the zones were actually missing, measured rather than assumed

Two things, and the second turned out not to be missing at all.

1. **Free-text search** was genuinely absent: `SearchInput` had zero importers
   under `pages/investor/deals/`. A real addition, and this decision's work.

2. **Counts on the chip row** were **already supported and simply unused.**
   `zoneFilterBuilder`'s `withCount` has always substituted `{n}` from a
   page-supplied `counts` map and has always **dropped** the clause rather than
   printing a figure it was not given. So this is a wiring change — `{n}` in
   `investorZoneFilters` labels, `counts` from the page — and it inherits the
   honesty rule already written there rather than restating it.

**The first pass of this change was going to add `FilterChips` beside the
existing `ZoneToolbar` row.** That would have put two chip rows with different
narrowings on one page, and duplicated a mechanism the repo already has. Reading
the builder before writing the component is what caught it.

### CommitZone is a room, not a list, and is left alone

`CommitZone` is one deal's vote plus a decisions history. The legacy
`PipelineCommitPage` was a filterable list of **commit-stage deals**, and its
replacement is **`PipelineZone`'s stage chips** — `DEAL_STAGES` already carries
`commit` and `dealStage()` already assigns it. Same for
`PipelineTransactionsPage` against `ClosingZone`. Forcing a room into a table to
make the port look symmetrical would have been the wrong shape, so the guard
asserts the two facts that make the substitution true instead of skipping the
zone silently.

Search is likewise offered on **two of Screening's four views**. `Scored` and
`Red flags` are per-deal lists; `Rubric` is six dimensions and `Pass reasons` is
a five-entry taxonomy. A search box over a vocabulary reads as a failed search
rather than a view without one.

### What does NOT land here

The redirects and the deletions. `/pipeline/screening`, `/pipeline/commit` and
`/pipeline/transactions` keep working until the port has shipped, because
retiring a working view before its replacement is complete is the failure this
decision's ordering exists to prevent. Two traps are recorded for that change:

- **`/pipeline` (the root) must not become an unconditional redirect.** It is
  role-forked — partner gets `PartnerBucketRoutes`, investor and founder keep
  `PipelineWorkspace` — and founder access there is deliberate.
- **`legacyRedirects()` must never be mounted wholesale.** It is exported from
  `shellConfig.js` and called by nothing, and **all 24 of its rows are live
  mounted routes**. Mounting it would replace every one of them.

### One existing guard was repointed, and it got stronger

`investor_deals_id2.test.mjs` asserted `rows={rows.map` — "the instrument draws
the narrowed set". There are now two narrowings, so it draws `visible`. Pinning
only that would have been **weaker** than what was there, because a `visible`
built from `scoredRows` satisfies it while silently ignoring the chip. It now
pins the composition: search narrows the chip's output, never a raw list.
Mutation-checked — that exact bypass fails it and would have passed the old one.

### Two assertions were wrong before they were right

A `data-testid` on the search **wrapper** meant deleting the control left an
empty div carrying it, and the mutation escaped. The assertion now pins the
element and its binding, which also catches a control rendered but not wired to
the page's state. And a concatenated template literal in ClosingZone's filter
bound `.toLowerCase().includes(q)` to the second literal only, so the expression
returned a string and every row passed — caught on review before it ran.

## D119 — The three legacy investor pipeline paths retire, and the two traps in retiring them

D118 called `/deals/*` and the legacy `/pipeline/*` trio the same job and ported
what the trio had that the zones did not. This is the other half:
`/pipeline/screening`, `/pipeline/commit` and `/pipeline/transactions` become
redirects to `/deals/screening`, `/deals/commit` and `/deals/closing`, and
`PipelineScreeningPage.jsx`, `PipelineCommitPage.jsx` and
`PipelineTransactionsPage.jsx` are deleted — each was imported by
`PipelineWorkspace` alone, so they became dead the moment the routes moved.

The redirects carry **no guard of their own**. The destination guards itself, so
an unentitled visitor is refused there rather than at a URL that no longer has a
page behind it.

### Trap 1 — `/pipeline`, the root, must not redirect

It is **role-forked** in `App.jsx`: partner gets `PartnerBucketRoutes`, investor
and founder keep `PipelineWorkspace`, and founder access there is deliberate per
the route's own comment. **Only the investor arm was superseded.** An
unconditional redirect would take the founder's board and the partner's bucket
root with it — a change to two licences nobody asked for, made while retiring a
third's pages.

### Trap 2 — `legacyRedirects()` must never be mounted wholesale

It is exported from `shellConfig.js` and **called by nothing**, and every one of
its rows named a path `App.jsx` still mounts as a live route. Mounting the set
would have replaced each of those pages with a redirect to its successor.

The dangerous row was `/pipeline`'s own. Deleting the marker would have disarmed
it and lost the provenance — this zone *did* supersede that board for investors
— so the row keeps its `legacy` and gains **`legacyForked: true`**, and the
function skips it. The flag names the condition rather than the exception: a
legacy path whose route forks on role and only one arm was superseded.

### The tab bar kept its doors

`PipelineWorkspace`'s own header already recorded the fact that decided this:
**its tab bar is the only inbound link an investor has** to those surfaces,
because the investor shell collapsed the former sidebar rows into one "Deals"
row landing on `/pipeline`. Deleting the three tabs alongside the three pages
would have removed the door with the room. They now point at `/deals/*` and join
the two rows that were already cross-route doors, so the distinction that file
drew between "tabs this workspace renders" and "doors" covers every row.

Founder still sees the Board tab only. `/deals/*` is admin + partner + investor,
and a tab a founder cannot follow would be a door into a refusal.

With the three sub-paths gone, `/pipeline` is the only route that renders the
workspace, so the pathname-derived `active` state was removed rather than left
as a branch nothing can reach.

### What is guarded

`frontend/test/investor_pipeline_retirement.test.mjs` pins both traps directly —
the root keeps its fork and never redirects, and `legacyRedirects()` never
offers `/pipeline` **for any role in `ROLES_WITH_SHELL`**. Trap 2 is asserted
*through the function* rather than by reading the config, because a
`legacyForked` row the filter stopped honouring would still look right in
`shellConfig` and would arm the trap again. Five mutations, five caught,
including both traps and the deletion of a door.

---

## D120 — HQ opens a support session on a branch, and the entrypoint that does it is the only authenticated one

Plan F.5 listed `mintSupportSession` on `HqEntrypoint` alongside `health`,
`overview` and the `apply*` pushes. Building it turned up why it cannot sit
there on the same terms, and `rpc/index.ts`'s own header states the reason:
**"An entrypoint is callable by any Worker in the account."**

That is tolerable for what `HqEntrypoint` did before. Reads leak branch data to
a Worker that already runs our code; `applyLicence` and `applyPromoCeiling`
overwrite a copy with a copy. Opening an authenticated session **as an arbitrary
user** is a different kind of thing, and putting it behind an entrypoint the
codebase documents as callable by anything in the account would have made it a
privilege-escalation primitive rather than a support tool.

### The authentication leg, mirrored from the one that already exists

The RPC surface was one-directional: a branch presents `RPC_SECRET` and HQ
verifies it against `licence_deployments.rpc_secret_hash` (`hqOps.ts`,
`authenticateBranch`); HQ presented nothing and the branch held no hash. So the
reverse leg is the same shape reversed — `HQ_RPC_SECRET`, plaintext on HQ, its
SHA-256 as `HQ_RPC_SECRET_HASH` on the branch, verified constant-time by
`authenticateHq` in `branchOps.ts`. **A branch with no hash refuses**, the same
default the other direction takes and for the same reason: a null means the leg
was never provisioned, which is exactly when a default-open turns the control
off on the deployments nobody has audited.

**Both comparisons are now one implementation** (`rpc/secret.ts`). The part that
must not drift between the directions is not the SHA-256, it is the
normalisation and the three named refusals — `no_hash`, `no_secret`, `mismatch`
— around it. `frontend/src/lib/README.md` states that rule in the SPA's voice
and D117 enforced it there; this is the same rule one tier down.

**HQ's secret is one value the operator sets once, not one generated per run.**
`RPC_SECRET` is per deployment because it identifies one branch. HQ is one
Worker with one identity, so every branch stores the hash of the same secret —
and generating it inside `branch-provision.yml` would have rotated it on every
provision, silently breaking the HQ→branch leg for every branch provisioned
earlier. It is a repository secret (D.11); the workflow puts only its hash on the
new branch.

**The workflow does not put the plaintext on HQ, and the guard is why.** The
first version did, and `branch_provision_workflow.test.mjs` refused it: no call
in that workflow may read HQ's config, whose `[[routes]]` are the apex custom
domains (L10). That rule has been narrowed exactly once, for
`d1 execute studioos-db`, on the stated principle that the call "can neither
create, deploy nor route" **and** that HQ's database row cannot be written any
other way. A Worker secret can — by the person already creating the value. So
the call was removed rather than the rule widened, and DEPLOY.md carries the one
command. Narrowing a guard to admit a convenience is how a guard stops meaning
what it says.

### The three checks the branch cannot make, and the one that does not transfer

`admin.ts`'s local support session requires `requireFactor(c,'totp')`,
`requireStepUp(c)` and an admin role. Those are facts about an HQ operator's
browser session; a branch cannot see a session on another host at all, because
HQ's JWT is signed with a different secret (D.4). They are enforced at HQ in
`admin_support_sessions.ts` **before** the binding is touched, and the branch's
trust in that is what `HQ_RPC_SECRET` buys and nothing more. The route says so,
because a reader who assumed the branch re-verified them would think those gates
were belt-and-braces and could be relaxed. They are the only copy. The gate is
`requireSuperAdmin` rather than `requireAdmin`: this reaches across a tenancy
boundary into someone else's database, which local impersonation does not.

The branch re-checks what it can — the reason at ten characters, the target
exists and is active — and one more: **the target is not carrying a
`super_admins` row.** That guard reads the table through `loadSuperAdminFlag`
rather than asking `isSuperAdmin`, because on a branch `hydrateSuperAdmin`
returns 0 unconditionally and never queries (D106). A holder-vs-holder check
written the way `admin.ts` writes it would have been a branch that can never
fire — 0 for every target, including the one case worth catching, which D106's
own header names as the escalation the deployment-level refusal exists to
survive.

**The other half of `admin.ts`'s holder rule does not transfer, and saying so
beats shipping a check that cannot fail.** "Only a Super Admin may impersonate a
Super Admin" exists because a plain admin borrowing the franchisor's account is
an escalation. Across this boundary there is nobody above HQ; supporting a
branch's own administrator is the ordinary case.

### Renamed, because it does not mint a session

F.5 called it `mintSupportSession`. It is `openSupportSession`: it records an
authorisation and returns a one-time code, and the JWT is created at **redeem**.
Two things follow, both improvements. No bearer credential is ever stored at
rest — `support_handoff_codes` (migration 262) holds a digest, a target, an
actor name and a reason, and nothing in it authenticates anybody. And the
30-minute clock starts when the operator actually begins rather than when HQ
pressed a button and walked away.

### The hand-off is a code, never a token

HQ opens `https://<code>.axal.vc/support/session?code=…`; the branch's
`POST /api/auth/support/redeem` swaps it for the session. A token in a URL sits
in history, in the next request's `Referer`, and in anything that reads the
address bar — and, unlike this code, would still work afterwards. The code is
192 bits from the CSPRNG, single-use via one atomic
`UPDATE … WHERE used_at IS NULL … RETURNING` (the `magic/verify` precedent), and
five minutes old at most. All three failure modes answer with one message:
telling "expired" from "never existed" tells an unauthenticated caller which
codes have been issued.

### `/support/session`, not `/support`, and the test is why

`/support` was already a route — `SupportRedirect` sends it to `/help`,
preserving `?topic=`. The first version registered a second `/support`, which
React Router never reaches because it takes the first match. The hand-off link
would have redirected to the help centre and dropped its code, **on every
branch, with CI green**, since nothing else tested that path. The guard now pins
both rows.

### Two things are named rather than joined, and one clock is used rather than two

**No `impersonated_by` claim, and no HQ id anywhere a JOIN could reach it.**
`admin_escalations.ts` already states the rule for the other direction: HQ's
user ids and a branch's are unrelated number spaces, so an id sent across names
whoever holds it locally. Every consumer of the claim was checked rather than
assumed — `pickAuthToken`, `selectJwt`'s audit blob, and `recoveryCoolOff`,
which keys off the impersonated user and never reads it. None needs a resolvable
id and none is improved by a wrong one. `impersonation_sessions.admin_user_id`
is written as **0**: the column is `NOT NULL` with no foreign key, nobody in
that database opened the session, and `AUTOINCREMENT` starts at 1 so 0 can never
collide. The actor travels as a name.

**The session is identified by `user_sessions.factor = 'hq_support'`, which is a
gate rather than a label.** `requireFactor` reads that column by jti and fails
closed, so a support session satisfies `requireFactor('totp')` nowhere — every
branch route behind TOTP or a step-up stays shut to HQ. That property costs one
column value because the mechanism already exists and is already read; a new JWT
claim would have been a flag with no reader, which is what `recovery_pending`
already is.

**The expiry compares one clock in one format, and this was a real defect caught
while the test was being written.** SQLite compares `TIMESTAMP` columns as TEXT.
`new Date().toISOString()` gives `2026-09-16T06:55:57.859Z` and
`CURRENT_TIMESTAMP` gives `2026-09-16 07:00:57`; the date halves match, so
position 10 decides it and `'T'` (0x54) beats `' '` (0x20). An ISO string is
therefore **always** greater, whatever time it carries — verified rather than
reasoned about, with a value five minutes past still answering 1. A five-minute
TTL written that way is a one-day TTL. Both sides now use `datetime()`.

**The same shape exists today in `magic_link_tokens`** (`auth.ts` writes
`expires_at` as ISO and `magic/verify` compares it against `CURRENT_TIMESTAMP`),
so a magic link's 15-minute window also lasts until the UTC date rolls over.
That is pre-existing and outside this change; it is recorded here so it is found
rather than rediscovered, and tracked as its own task.

### Precedence, which is why redeem behaves like a sign-in

`pickAuthToken` lets a Bearer beat a cookie when the Bearer's `impersonated_by`
equals the cookie's `user_id` — "a legitimate impersonation Bearer", true at HQ
where both ids name the same human. Across this boundary it is a coincidence
test. Had the ids differed, a branch user already signed in on that browser
would have had their own cookie beat the support session: the session would
silently not apply, and `selectJwt` would write a `cross_session_bearer_discarded`
row — an audit signal whose purpose is to flag a cross-account leak — for a
supported operation. Rather than special-case `pickAuthToken`, the redeem route
leaves it nothing to arbitrate: `revokeStaleCrossIdentitySession` then
`setAuthCookies`, exactly as every other sign-in path here does.

### What is not in this change

**D.6 move-by-re-invite is not here, and F.9 row 11 paired them.** It needs its
own store for the destination's invitation and its own answer to how the person
is notified, and putting an account-lifecycle feature behind the same review as
a 400-line authentication change is what the per-PR convention exists to avoid.
It is its own task and its own PR.

**Verification.** `test:drift` exit 0; worker `tsc` exit 0; 15 mutations applied
and 15 caught — one only after the ASSERTION was fixed rather than the code: the
expiry test overwrote `expires_at` with a `datetime()` value before checking it,
which forced the right format on to the row and made the test blind to the write
side, so the exact bug it exists for walked through it. It now ages the row in
whatever format the writer chose. The `/support` collision was caught by a guard
and not by a reviewer.

---

## D121 — Moving an account between branches is a re-invite, and both halves are reported separately

D.6's wording is exact and worth keeping in front of the reader, because the
temptation is to build something else:

> HQ deactivates the account where it lives with a reason and an audit row,
> invites the same email on the destination, and both tenants are notified.
> Projects, deals and documents **stay where they were**, readable by HQ.

This is F.9 row 11's second half. The first (D120, the cross-host support
session) shipped separately: an account-lifecycle feature behind the same review
as a 400-line authentication change is what the per-PR convention exists to
avoid, and the split is recorded here rather than left looking like a scope cut.

### Why it is not a record migration, said once so nobody rebuilds it as one

Two branches are two Workers over two databases that cannot see each other
(D.2). A true migration means copying rows across that boundary and rewriting
every reference on both sides, and a half-done one — some rows moved, some left,
foreign keys pointing into a database that is not bound — is worse than none.
So the account is closed where it lives and invited on the destination, and the
route says so **in its own response** (`records_note`), not only in this file:
an operator who assumed otherwise would tell the person something false about
where their work went. The person's own audit row says it too.

### The two halves cannot be one transaction, so they are two facts

There is no transaction across two Workers. The order is deliberate and the
other order is worse:

- **Close first.** Someone briefly with no home is a visible, recoverable,
  honest state: HQ sees `invited.ok = false` with the reason, and the retry is
  `inviteAccount` alone.
- **Invite first** would leave an invitation on the destination for an account
  still live on the source if the deactivation then failed — two active homes
  for one person, which the tenancy model has no way to represent.

And the response reports them separately, never folded into one success. This is
the third time the same shape has been correct — D111's promo ceiling, D112's
escalation answer, now this — and the reason is the same each time: collapsing
them makes an unreachable far side look like an action that never happened, so
an operator repeats it. Here repeating it is refused, correctly, by the
already-inactive guard, which would leave them with two refusals and no way to
finish. **Both bindings are resolved before either is called**, so a destination
that is not bound is a clean refusal rather than half a move.

### Both methods authenticate, because both are privileged

`moveAccountOut` closes an account and `inviteAccount` creates an invitation to
one. Each is at least as privileged as `openSupportSession`, so each takes
`HQ_RPC_SECRET` first and calls `authenticateHq` (D120). An unauthenticated
`HqEntrypoint` method that deactivates accounts would be exactly the hole D120
closed, reopened one PR later. HQ's route runs D120's full gate stack —
`requireFactor('totp')`, `requireStepUp`, `requireSuperAdmin` — for the same
reason it does there: those are facts about an operator's browser session that
no branch can check.

### It is not `toggle-active`, and the difference is the reason

`admin.ts`'s existing deactivation already writes the right **two** audit rows —
one for what the operator did, one addressed to the person it happened to — and
that shape is reused. But it carries no reason, and D.6 requires one: moving an
account moves which subsidiary earns revenue share on it, which is why the
canvas calls it "a money action wearing a directory action's clothes".

The person's row also **names the destination**. An account told only that it
was deactivated has been told something true and useless — worse, misleading,
because it reads as a suspension.

### `email_sent` is a fact, not an assumption

Every sender in `services/email.ts` returns `false` when the Gmail credentials
are unset rather than throwing, and a freshly provisioned branch has none. So
the invitation row records what the mailer actually did. `company_invitations`
(migration 236) had already written the rule this follows:

> *"an invitation nobody was told about is a different thing from one that is
> merely unanswered — the page says which."*

**And the link is handed back when the message did not leave.** The first
version told the operator to "pass the link on by hand" and never showed it to
them — guidance that cannot be followed. The link now travels on that path only:
to an authenticated super-admin, over the private binding, when the person
cannot otherwise be reached. On the happy path it is omitted, because then it is
already in the one place it belongs.

### Two things the mutation pass changed in the code, not the tests

1. **The raw token was the same shape as its own digest.** Two UUIDs with the
   dashes stripped are exactly 64 hex characters, so storing the credential
   instead of its hash looked perfectly correct in the table *and* passed an
   assertion checking the column's shape. The token is prefixed `invt_` now, so
   the two are distinguishable at a glance and in an assertion. The assertion
   additionally verifies the stored value **is** the digest of the token that
   was issued, which it can only do because the link comes back.
2. **A source scan could not see a `throw` placed above the text it matched.**
   The assertion that the invitation is reported rather than thrown matched the
   reporting literal, and a `throw e;` inserted before it left that literal in
   place. It reads the catch block as a whole now.

A third mutation appeared to escape and had not: a `perl` substitution whose
anchor was not unique replaced the same lines in `openSupportSession` instead of
`moveAccountOut`, so the pass proved nothing. **A mutation that lands somewhere
other than where it was aimed is not evidence**, and checking that it applied
where intended is part of applying it.

### What is deliberately not here

**The HQ screen.** H4 draws "Move to another branch" as a modal; this is the
worker half only, and the route has no SPA caller yet — the same state D120's
support-session route is in. Both are drawn in the canvas and neither is wired
to a button, which is worth saying because a route with no caller reads as
finished when it is half of a feature.

**Verification.** `test:drift` exit 0; worker `tsc` exit 0; 8 mutations applied,
8 caught — two only after the assertion was fixed, and one only after the
mutation was aimed correctly. Nothing here has run against a live branch, for the
same reason D120 could not: none has been provisioned.

## D122 — a cross-host support session's audit row could never close, and the sweep that closes it

**The defect, and it shipped in D120.** `redeemSupportCode` writes the branch's
`impersonation_sessions` row with `admin_user_id = 0`
(`rpc/branchOps.ts:855-865`). That is deliberate and D120 argued for it: the
column is NOT NULL with no foreign key, no user in *that* database opened the
session, and a real HQ id there would be joinable to a local `users` row and
would name the wrong person with complete confidence. The comment justifying it
reads *"0 matches nobody, because AUTOINCREMENT starts at 1."*

That sentence is also, word for word, why the row could never close. The repo's
only `SET ended_at` is `routes/admin.ts:1578-1580`,
`WHERE id = ? AND admin_user_id = ? AND ended_at IS NULL`, on
`POST /api/admin/impersonate-sessions/:id/end` behind `requireAdmin`. Three
conjuncts a branch row cannot satisfy: the route is mounted on HQ's router over
HQ's database, `adminUser.id` is a branch id on a branch, and the bound id can
never equal 0. There was no branch-side end route and no sweep;
`SupportRedeemPage.jsx` has no exit handler at all.

**What was actually wrong, stated precisely.** Access expired on time — the JWT
is minted for `SUPPORT_SESSION_MINUTES` and `user_sessions.factor = 'hq_support'`
is a gate `requireFactor` fails closed on. Nobody kept access they should not
have. The damage was to the record, and it was visible: `admin_security.ts`
renders a row past its limit as a red **`not closed`** card, and counts
`ended_at IS NULL` as the **`Impersonations live`** stat that `SecurityPage.jsx`
turns red when non-zero. So every branch support session ever opened incremented,
permanently, the number HQ reads as live impersonations — falsifying the claim
D120 exists to make, that a tenant need not ask HQ what was done to it.

**The fix is a sweep, not a route.** An end route would have to be called by a
browser the expiry has already signed out, which is the case that matters most.
`util/supportSessionSweep.ts` stamps the row from the scheduled handler every
five minutes.

**`ended_at` is the computed expiry, not the sweep's clock.** It is
`datetime(started_at, '+' || ? || ' minutes')` — the instant the token stopped
working. Writing `datetime('now')` would record when we noticed rather than when
it happened, and would make the cadence leak into the audit trail. Because
`started_at` is `TEXT NOT NULL DEFAULT (datetime('now'))`, both sides are SQLite
format and the ISO-vs-`CURRENT_TIMESTAMP` trap D120's own header documents has no
purchase — provided no JS timestamp is ever introduced here.

**It is NOT tier-gated, and that is the design.** The obvious shape was a
branch-only cron block, which would have been the first in the file and would
have forced a third category into the gating test. `admin_user_id = 0` is a value
HQ can never write, so the predicate *is* the tier discriminator and a better
one — it selects rows by what they are rather than by which deployment is
asking. On HQ it matches nothing and rides the `ix_imp_admin(admin_user_id,
started_at DESC)` prefix. A future HQ-side support-session writer is covered the
day it exists.

**Ordinary impersonations are excluded, and this is the reason the sweep is
narrow.** `POST /api/admin/impersonate-sessions/:id/extend` grants a fresh
30-minute window and writes only an `activity_logs` row — nothing about an
extension reaches this table. So on HQ `started_at + 30 minutes` is **not** the
expiry, and sweeping those rows would stamp a *false* end time where a null at
least claims nothing. A branch session has no extend path, which is exactly what
makes the arithmetic true there and only there.

**No migration, and not for convenience.** `impersonation_sessions` has six
columns and three identical definitions (migration 156, `schema_baseline.sql`,
the runtime bootstrap in `services/cohortTiming.ts`). An `ended_reason` column
would record whether the clock or a person ended it — and `SecurityPage.jsx`
already ships the opposite position: *"A session that ran to its limit is
recorded exactly like one ended early — the log does not distinguish diligence
from the clock running out, and it should not."* That copy stays true, and stays.

**What this does NOT fix, said plainly rather than left to be discovered.** HQ's
own rows still orphan. The close there is best-effort three times over — a
`.catch(() => {})` in `App.jsx`, a swallowing `try/catch` in `admin.ts`, and a
session id read from `localStorage` — so closing the tab leaves `ended_at` null.
Because of `/extend` that case is not computable from this table, and inventing
an end time for it would be the error this entry just argued against.

**Verification.** `test:drift` exit 0, read as the exit code; worker `tsc` exit
0; no `frontend/src` change, so `docs/` did not move. **9 mutations applied, 9
caught** — one only after the *assertion* was fixed: a scan anchored on the
function name walked straight through a mutation that replaced the import with a
local stub, the same shape as the #589 escape, and now anchors on the module
specifier instead. Three further tests were briefly passing for the wrong reason,
because the fixture passed the D1 shim as `env` rather than as `env.DB`, so the
call was throwing into the unreadable path; the failing tests are what exposed it.

## D123 — three new canvas exports land, and what two of them draw that the platform refuses

**What arrived.** Three Claude Design exports, all decoded with
`scripts/read-canvas.mjs` rather than described from a screenshot:

| canvas | id | verdict |
| --- | --- | --- |
| `Admin · Subsidiary` | `dc92a281` | same id as the committed copy — replaces in place, S0–S6 → **S0–S13** |
| `Admin · Super` | `c6bc9164` | same id as the committed copy — replaces in place, H1–H7 amended, **H8–H13** appended |
| `Spin-Out Lab · Programme Brief` | `b585b5fd` | **new**, no twin in the corpus |

`integrated/` 62 → 63; `backlog/` unchanged. The Programme Brief is the first
canvas to arrive graded `UPGRADE` without graduating from `backlog/`, because
its route (`/spinout-lab/brief`) was already live.

**THE S0–S6 DIFF IS ONE BYTE, AND IT WAS MEASURED.** The Subsidiary canvas's own
CHANGELOG claims "no other in-place change" across S1–S6. Rather than take that,
the committed copy was diffed against the export over the whole range: exactly
one difference, in S0, `SUBSIDIARY` → `BRANCH` on the territory badge. The claim
is now checked rather than asserted, and the rename is its own commit (task
#248) because every branch PR touches the shell and a one-word change buried in
a page PR collides with all of them.

**THE SUPER CANVAS MISCOUNTS ITSELF.** Its CHANGELOG says "H8–H14". The section
ids are `changelog, h1…h13` — six artboards were appended, not seven. Recorded
here rather than corrected in the canvas, because the canvas is the design
source and an edit would make the repo copy diverge from the artifact.

**TWO OF FIVE ASSETS PLACED; THREE BLOCKED ON A CREDENTIAL, AND NONE GUESSED.**
`read-canvas` reported five manifest entries it had not rewritten, and refuses
to substitute them on the stated principle that a canvas silently dropping an
asset is worse than one that says which. Two were resolved:

- `b7b8bd8c` is **byte-identical to `design/canvases/shared/doc-page.js`**
  (sha `371bab66f42db6ce`, 37,185 bytes), so it became `./doc-page.js`. This is a
  gap in the tool worth knowing: `read-canvas` rewrites the FIRST runtime script
  to `./support.js` and leaves a second one as a raw uuid. The Programme Brief is
  the first canvas in the corpus to load two.
- `ad2f96f2`, the Axal VC logo (200×191, 7.7 KB), became
  `./uploads/spinout-lab-brief-logo.png`.

**The three remaining assets are 1536×1024 backgrounds — 694 KB, 743 KB and
902 KB — and they cannot be committed from this environment.**
`scripts/lfs-size-gate.mjs` requires any NEW png over 500 KB to be LFS-tracked;
the repo's LFS is real and working (48 objects, the `attached_assets/*.docx`
set). But pushing a new LFS object from this session returns
`Post https://lfs.github.com/... /verify: Forbidden` — the credentials here can
read LFS and cannot write it. So the three stay as the unresolved uuids
`read-canvas` emitted, which is the tool's designed output and renders without
them, and they are named here so the next person places them deliberately rather
than rediscovering the gap:

| uuid | size | where it sits |
| --- | --- | --- |
| `735a9718` | 694 KB | PAGE 1 header background |
| `de4910a3` | 902 KB | PAGE 1 band background |
| `23586f65` | 743 KB | PAGE 4 full-bleed background |

**Three options when LFS write access exists**, in preference order: grant this
environment LFS write and commit them as pointers (the rule should name the three
paths individually, not `design/canvases/uploads/*.png` — that directory holds
about forty committed PNGs as plain blobs and a wildcard would convert the next
one anybody re-added); or recompress below 500 KB, which changes the bytes of a
design source and makes the file no longer a faithful decode; or leave them
unresolved, which is the current state and costs three decorative backgrounds.

**TWO THINGS THE NEW CANVASES DRAW THAT THE PLATFORM HAS ALREADY REFUSED.**
Neither is integrated here; both are recorded so neither is integrated by
accident. A canvas is a proposal, not a specification.

1. **The escalation answer as a thread.** S9 draws three turns and a
   *"Reply to HQ…"* box, and S7's appeal note repeats the promise. Migration
   261's header says the opposite in as many words: *ONE DECISION, NOT A
   THREAD — dressing one column as a thread would promise a reply box that
   writes nowhere.* The artboard also argues against itself: `s9Thread`'s middle
   turn is HQ's, and `s9Decision` renders that same turn again as a separate
   block. It draws the decision twice, which is the tell that what it holds is a
   raise and a decision, not a conversation.
2. **Per-track gates on the Programme Brief.** Page 2 gives each of three tracks
   its own four gates. `frontend/src/lib/spinoutLab.js` states in its own voice
   that `MILESTONES` is ONE list enforced identically for every founder, and
   that *"Drawing four track-specific gate sets would tell a founder that week 2
   asks something it does not ask."* Same design proposed twice, refused once.

**AND SIX TOKENS, NOT SIXTY.** The Programme Brief contains roughly seventy
`{ … }` occurrences. Six are backend values and the canvas says which by
spelling them without inner spaces — `{brief.generated_at}`, `{brief.year}`,
`{cohort.name}`, `{cohort.start_date}`, `{cohort.close_at}`, `{cohort.places}`
— beside the comment *"Live values stay as fields — a generated PDF fills them
from the platform, never from this file."* Everything spelled `{{ x.y }}` is a
DCLogic binding resolving from the canvas's own fixtures; wiring those to an API
would be building an endpoint for a rendering engine. Three of the six are
already derived client-side by `openCohortCopy()`, and `cohort.places` has no
store anywhere.

**Verification.** `test:drift` exit 0, read as the exit code;
`check-folder-docs`, `check-decision-ids` and `lfs-size-gate` exit 0; no
`frontend/src` change, so `docs/` did not move. Two frontend tests failed on the
first run and both were correct: adding a ROUTE_MAP row moves the corpus count
110 → 111 and makes the generated `PROFILE_ROUTING.md` stale. Regenerated, and
the pinned count moved with a note that it counts ROUTE_MAP **rows** — not the
folder totals in `design/canvases/README.md`, which are a different number and
always have been. Nothing here ships behaviour; it lands design sources and
their ledger rows.

## D124 — an expiry gate compares `datetime(column)`, because normalising the other side fixes nothing

**The defect.** SQLite has no date type. A timestamp is TEXT and a comparison is
a lexicographic string compare, so two formats that look alike do not compare
alike: `new Date(...).toISOString()` gives `2026-09-16T10:41:47.120Z` and
`CURRENT_TIMESTAMP` gives `2026-09-16 10:56:47`. Position 10 decides it — `'T'`
(0x54) beats `' '` (0x20) — so while the DATE halves match, an ISO string is
always the greater one. A TTL written that way does not expire until the UTC
date rolls over, up to ~24 hours late.

**The fix that looks right and is not.** Rewriting the comparison to
`expires_at > datetime('now')` is the obvious move, and it is what D120's own
comment prescribes. Measured with `node:sqlite` rather than reasoned about, for
a value that expired fifteen minutes ago:

| comparison | result |
| --- | --- |
| `expires_at > CURRENT_TIMESTAMP` | **1** — reads as live |
| `expires_at > datetime('now')` | **1** — the same bug |
| `datetime(expires_at) > datetime('now')` | 0 |

D120 is sound because it *also* changed the writer to `datetime('now', ?)`, so
both sides were already SQL-format. Applying half of that idiom to a column
whose writers were untouched leaves every row already in the database broken.
Only normalising the stored value fixes existing rows, and it keeps working for
any writer added later — which matters most where the writer is a passthrough of
the caller's JSON and cannot be relied on at all.

**Five idioms for one job.** The audit found the repo already carried three
correct forms and two broken ones. `services/partnerDeals.ts:570` had
`datetime(expires_at) <= datetime('now')` — the form adopted here — so this
decision picks an idiom the repo already had rather than inventing one.
`rpc/branchOps.ts:722-731` writes SQL-format and compares plainly (D120).
`routes/decks.ts:1184` normalises the ISO on write with
`.replace('T', ' ').slice(0, 19)`. The two broken forms are the bare column
against `CURRENT_TIMESTAMP` and against `datetime('now')`.

**What this PR changes: thirteen access-control comparisons.** Each decides
whether a door is open, so being wrong means a door that should be shut is not:

| gate | table | was |
| --- | --- | --- |
| `routes/auth.ts:1263` | `magic_link_tokens` | a 15-minute sign-in link kept redeeming |
| `routes/auth_passkey.ts:74` | `webauthn_challenges` | a 5-minute ceremony nonce stayed claimable |
| `routes/advisor_grants.ts:76,380`, `routes/advisors.ts:2973` | `advisor_client_grants` | an expired advisor grant still opened the founder's brief |
| `routes/data_room.ts:92,146`, `routes/research.ts:3550` | `data_room_grants` | an expired grant still listed and downloaded files |
| `routes/data_room.ts:109,256`, `routes/market_intel.ts:840` | `pairwise_ndas` | an ended NDA still gated the data room open and un-masked identities |
| `services/trust.ts:433,443` | `legal_obligations`, `pairwise_ndas` | the daily sweep never flipped them |

**Severity, stated so it is neither over- nor under-sold.** The two auth tokens
are single-use — the claim is an atomic `UPDATE … WHERE used_at IS NULL` — so
this is not a replay and not an auth bypass. It widens an exposure window that
already requires holding the token: an emailed link that leaks, sits in a
forwarded thread, or is read from a shared machine hours later still signs the
attacker in. The two grant columns are worse in a different way: their only
writer is an **unvalidated passthrough of the caller's JSON**
(`advisor_grants.ts:165`, `data_room.ts:492`), and the shipped SPA sends no
`expires_at` at all, so every row the product writes today is NULL and
short-circuits. They are therefore not live-broken — they are an API contract
that produces the defect the first time anyone sends the field. Normalising the
read is what makes the writer's format stop mattering.

**Writers are deliberately NOT changed.** It would make stored data tidier and
it would not make anything more correct, because the read now normalises
whatever it finds. Leaving the writers alone keeps a security-sensitive diff to
one mechanical shape, and it means a writer added later in any format is still
read correctly — the more robust property, and the one a passthrough column
needs.

**What this does not fix, named rather than left to be rediscovered.** The audit
covered 33 comparison sites: 17 broken, 6 uncertain, 10 already correct. This
records the thirteen that gate access. The rest are money and display figures
and follow separately, among them `services/referralAttribution.ts:85` and
`services/featureUnlocks.ts:98,113`; and one that runs the *other* direction —
`rpc/branchOps.ts:391-394` compares a SQL-format `ai_usage_logs.created_at`
against bounds `quarterBounds` builds with `.toISOString()`, so the branch's
quarterly AI cost silently drops every row dated on the quarter's first day
(measured: 3 rows in, 1 row out). That figure feeds HQ's statements under D.8,
and it is in the same file whose comment 300 lines later explains this exact
trap.

**The guard is owed and is not here.** This class has now recurred across five
idioms and D120 already wrote the explanation down, so a lexical check — a
timestamp column in a comparison is always wrapped — belongs in `test:guards`.
It ships with the remaining sites, because a guard that has to allowlist twenty
unfixed sites decays into a ledger nobody reads.

**Verification.** `test:drift` exit 0, read as the exit code. New
`cloudflare-worker/test/expiry_gate_datetime_d124.test.ts` runs the **real SQL
sliced out of each route file** against `node:sqlite` — a copy of a predicate in
a test only proves the copy is right — and the slicer refuses an anchor that
matches more than one place, which caught two anchors in the first draft that
were silently testing different statements. The expired fixture is pinned to
`date('now') || 'T00:00:00.000Z'` rather than "a minute ago", because a
relative fixture run near 00:00 UTC lands on yesterday's date, where the broken
predicate is accidentally right — the test would have passed against unfixed
code for one minute a day. **7 mutations, 7 caught**, four of them the
*plausible* half-fix rather than a full revert. No migration, no schema change,
no `frontend/src` change, so `docs/` did not move.

## D125 — the rest of the timestamp comparisons, and the guard that needed nothing left to allowlist

**What D124 left.** D124 fixed the thirteen comparisons that gate access and
named the rest rather than quietly dropping them. This is the rest: the sweep
found **75 comparison sites** in `cloudflare-worker/src`, carrying **five
idioms**, three of which were correct by different means —
`datetime(col) > datetime('now')` (`partnerDeals.ts:570`), a SQL-format writer
with a plain read (`branchOps.ts`, D120), and an ISO normalised on write
(`decks.ts:1184`). The two broken ones were the bare column against
`CURRENT_TIMESTAMP` and against `datetime('now')`.

**What this changes, and one of them is not a reporting figure.**

| site | column | what it did |
| --- | --- | --- |
| `services/featureUnlocks.ts:98,113` | `feature_unlocks.expires_at` | **an expired PAID feature kept being granted** — the row carries `source_payment_intent_id` |
| `services/referralAttribution.ts:85` | `referral_attributions.expires_at` | the attribution window outlived its term, so a referrer could be credited outside it |
| `services/shareLink.ts:145` | `captable_share_tokens.expires_at` | **the mixed-writer case**: revoking writes SQL format and killed a link, minting writes ISO and did not expire one |
| `routes/settings.ts:214` | `email_change_requests.confirm_expires_at` | display only — the accept path checks expiry in JavaScript at `:483`, so nothing was granted |
| `routes/assistant.ts:298` | `calendar_events.start_at` | listed every meeting **earlier the same day** as upcoming |
| `routes/events.ts:260`, `routes/events_public.ts:69,70,85` | `events.starts_at` | finished events in the upcoming feed, and today's missing from the archive |
| `rpc/branchOps.ts:391-394` | `ai_usage_logs.created_at` | **the reverse direction** — see below |

**Two of these run the OPPOSITE way from a TTL**, which is why the class is
worth stating rather than assuming understood. An ISO value sorts ABOVE
`datetime('now')`, so where a TTL under-expires, a start time **over**-selects:
`start_at >= datetime('now')` kept finished meetings in "upcoming". The comment
above that query says its `catch` exists so a failure does not turn "every
answer into 'no upcoming meetings'"; the real defect was the reverse.

And `branchOps.ts:391-394` is the mirror image again: a SQL-format column
(`DEFAULT datetime('now')`) compared against bounds `quarterBounds` builds with
`.toISOString()`, so **every row dated on the quarter's first day was dropped**
from the branch's reported AI cost — the figure HQ's statements read under D.8.
Measured: three rows in, one out. It sits in the same file whose comment 300
lines later explains this exact trap.

**FOUR ALREADY-CORRECT SITES WERE CONVERTED ANYWAY, and that is the point of the
guard.** `branchOps.ts:817`, `decks.ts:838`, `company.ts:766` and
`introductions.ts:254` were all FINE — their writers emit SQL format. Converting
them buys no correctness. It buys `scripts/check-timestamp-comparisons.mjs` with
**no baseline**: one rule, zero exceptions, and one idiom left in the codebase
instead of five. The alternative was a four-entry ledger, and
`check-inline-project-pickers.mjs` shows what that shape costs — a list somebody
has to curate, which goes stale.

**What the guard cannot see, said plainly so a green run is not over-read.** A
column compared against a **bound parameter** (`created_at >= ?`) is the same
defect with its format at the bind site, and is invisible to a lexical scan.
That is exactly how `branchOps` came to drop a day. `routes/market_intel.ts:1036,
:1047, :1109` are in that class and are **not** resolved here; they need the
bind traced, which is a different tool and a separate task.

**THE FIX WAITED FOR THE TESTS, and this is the part worth keeping.** The source
change was written first and mutation-checked before being committed: reverting
it on `featureUnlocks`, `referralAttribution`, `assistant` and `branchOps` each
left `npm run test:drift` at **exit 0 with zero failures**. Four correct fixes
that nothing could catch. An assertion that cannot fail is decoration, and a fix
nothing can catch is the same thing one layer down — so the commit that landed
them says so in its own message, and stayed on a local branch until
`expiry_window_datetime_d125.test.ts` existed. All six now fail on revert.

**One home for the fixtures.** `_baseline.mjs` already exported
`tableFromBaseline` and `stripForeignKeys`, and its own header records that it
exists because three files carried a byte-identical regex. D124's test file made
it a fourth by rolling its own slicer and standing up stub `users`/`projects`
rows. Both files now use the shared readers, and `_timeFixture.mjs` holds
`sqlAround` and the same-UTC-date fixture — `frontend/src/lib/README.md`'s rule
one layer along: "if a helper appears in two places, put it here once."

`sqlAround` got stricter twice while this was written, both times because it
**produced** something instead of refusing. It first assumed a template literal,
and `routes/assistant.ts` keeps its SQL in a double-quoted string, so it sliced
unrelated TypeScript. Taking the nearest quote of any kind then landed inside
`datetime('now')` when that preceded the anchor — and survived an "the slice
contains the anchor" check. The contract is now that an anchor names a
statement's **opening words**, so the quote before them is unambiguously the one
that opened it; ambiguous and non-opening anchors are both hard failures.

**Verification.** `npm run test:drift` exit 0, read as the exit code. Worker
`tsc --noEmit` exit 0. Six mutations on the source, six caught. Two on the guard
— a bare column and a `CURRENT_TIMESTAMP` comparison — both caught with the
offending file and line named. No migration (264 stays free), no schema change,
no `frontend/src` change, so `docs/` did not move.

## D126 — three HQ rails were mis-mounted in production, and the branch tier gets one mount rather than eight

**The defect, and it shipped.** `frontend/src/ui/WorkerRail.jsx:168-186`
destructures twelve props and declares neither `surface` nor `title`. Three HQ
pages — `pages/hq/ContentPage.jsx:94`, `PlatformPage.jsx:91` and
`RevenuePage.jsx:157` — passed exactly those two, where React discards them, and
omitted `workspace`, `role` and `coverage`. A parse of every `<WorkerRail>`
opening tag under `frontend/src` puts the scale precisely: **50 mounts, and
these three are the only ones missing `workspace`, and the only ones passing an
undeclared prop.**

Five consequences followed, each read off the line that causes it:

| # | line | effect |
| --- | --- | --- |
| 1 | `WorkerRail.jsx:307` `ACCENT[role] \|\| ACCENT.founder` | founder violet on the oxblood tier |
| 2 | `:312` `aria-label={\`Worker AI controls · ${workspace}\`}` | a screen reader announced **"undefined"**. The VISIBLE title at `:323` merely lost its name — JSX drops an undefined child — which is why nobody saw it |
| 3 | `:154-155` `modelKeyFor(workspace)` | collapsed to the bare prefix, so **one** `localStorage` model preference was shared across Content, Platform and Revenue |
| 4 | `:260` `canRun = coverage.length > 0` | the Coverage block printed "Not recorded" (`:390-392`) and the run button was permanently `disabled` (`:493`) under *"this page has not loaded a summary"* (`:499-503`) — **on three pages that each load live figures** (`api.hqContent`, `api.hqPlatform`, `api.hqRevenue` and four more). The sentence was false on all three and the rail's only action was dead |
| 5 | `eadwynConfig.js` | `surface="hq_content"` named nothing: `ASSIST_SURFACES` has five keys and none of the three is among them. `WorkerRail` never reads the prop, hardcoding `const WORKSPACE_SURFACE = 'workspace'` (`:166`) |

**Why CI never saw it, which is the part worth carrying.**
`frontend/test/ui_assist_rail_and_sidebar.test.mjs:470` walks `pages/` and
`workspaces/` for `<AssistLayout surface="…">` and validates each name against
`ASSIST_SURFACES`. It never scans `<WorkerRail`. Its own header records the same
miss one step earlier — it used to walk `pages/` only while every offender sat
in `workspaces/`, so *"every workspace subpage in the product rendered an empty
right column, in silence, for as long as the shell has existed"*. That widening
fixed the **directory** and not the **component**, and this is what the gap cost
the second time. The per-tier guards (`investor_shell.test.mjs:332-344`,
`founder_shell.test.mjs:403`, `investor_fund_i6`, `investor_portfolio_i4`,
`founder_validate_a2`) each pin their own pages, so a tier that never got one
simply drifts. The new guard is tier-independent.

**The guard is not the obvious rule, and the measurement is why.** *Every mount
passes `workspace` and `role`* is wrong: **31 of the 50 rely on
`role = 'founder'`**, and 28 of those are founder pages under `pages/founder/`
and `workspaces/founder/`, where the default is correct. That rule would have
demanded 28 edits to correct code to catch 3 defects.
`frontend/test/branch_rail_mount.test.mjs` asserts three narrower things
instead, and they touch nothing that was already right:

- **(a) every mount passes `workspace`** — 47 already did.
- **(b) no mount passes a prop `WorkerRail` does not declare**, with the allowed
  set **parsed from the component's own destructured parameter list** rather
  than typed into the guard. This is the root-cause rule: it catches `surface`
  and `title`, it catches the next `coverge=` typo, and it needs no ledger to
  curate — the lesson `check-timestamp-comparisons.mjs` (D125) was built on. It
  is also the rule that fires where (a) passes, which is why both exist: the
  mutation adding `titl="Content"` failed (b) alone.
- **(c) a mount outside the founder tree passes `role` explicitly, and any
  literal `role` is a key of `ACCENT`.** Nineteen mounts pass it today and all
  nineteen comply, so this is zero edits and pure future cover:
  `ACCENT[role] || ACCENT.founder` means a misspelt `branch-admin` fails exactly
  as silently as a missing one. A **path** rule rather than a file allowlist, so
  it cannot go stale.

**What the guard cannot see, stated rather than implied.** Two shared workspaces
pass `role={role}` because they serve several tiers, and a computed value is
beyond a lexical check. Banning it would break two correct mounts and naming
them would be an allowlist, so the guard's header says so and caps the count
instead.

**The branch tier mounts the rail exactly once.** `pages/branch/BranchZone.jsx`
owns the frame all eight `/branch/*` routes render in — the two-column layout,
the rail column, and the rail itself with `role="branch_admin"` (the steel
accent has existed since D107, `shellConfig.js:73`). No new `ASSIST_SURFACES`
entry: the workspace surface is the one every zone on every licence already
shares, and `eadwynConfig.js:62-64` states the rule in the repo's own voice —
*"config follows a mount, never the other way round."*

Two shapes inside that are deliberate:

- **The rail column reads `var(--fwr-track, 280px)`**, which is
  `WorkspaceShell.jsx:245` verbatim and is the collapse mechanism:
  `workerRail.css:298` sets `--fwr-track: 44px` on
  `:root[data-worker-rail="collapsed"]`. The five HQ pages hardcode `280px` in a
  Tailwind literal and therefore do **not** collapse. That is a real defect and
  it is **not fixed here**: it affects five pages, two of which this change has
  no other reason to touch, and fixing three of five would leave the tier
  inconsistent. Recorded so it is not rediscovered as a surprise.
- **A zone with data owns its frame; a zone without takes it from its route.**
  Coverage is what un-disables the rail's one button, and only the page that
  loaded something knows what it holds — so `BranchApprovals` wraps itself and
  reports its escalation counts, while the seven `BranchZonePending` routes are
  wrapped in `App.jsx`. Each of those seven wrappers goes away on the day PR 12
  or PR 14 gives its zone a page.

**`BranchZonePending` stays a card and must.** A draft made it own the frame,
which put a **second** rail on `/branch/approvals` — that page renders the
notice *inside itself* for the four local queues it has not built. That is the
doubled-chrome failure this repo has fixed on Network, on Partner and on the
Research zones, and it was caught while building rather than after.

**The empty rail is a lie in one place and the truth in another**, which is the
distinction this entry exists to fix rather than paper over. On the three HQ
pages "Not recorded" and a disabled button sat over four live reads. On an
unbuilt branch zone the identical default is exactly correct, because nothing
has loaded. Coverage is therefore assembled per source and filtered, so a source
that failed contributes no line and `coverageNote` says which — never a
fabricated zero, and never an empty rail readable as an empty pipeline.

**Refused, with the reason.** S12's cross-branch decline card cannot be honestly
built: the rail has no free-text input, `services/aiRouter.ts` carries no branch
awareness in 1223 lines, and a branch Worker has exactly one D1 binding — so a
cross-branch question cannot be *asked*, and a card refusing one would be
theatre about a wall that is already load-bearing. One always-visible sentence
in the rail says the true thing, and it lives in the frame so no zone can ship
without it. Also refused: the canvas's per-tier AI plan caps ($80 branch against
$400 HQ). No per-licence AI ceiling exists — there is one env default, per user,
identical everywhere — so a rail prop would be a number with nothing behind it.

**The scope chip is omitted**, on the product owner's call. The territory badge
already answers "whose data am I looking at" from the shell header (D107), and
two chips answering one question a few hundred pixels apart is the doubled
chrome above. Striking that answer adds a `{label, fixed}` prop and lands the
seam #244 needs early.

No migration (264 stays free), no worker change, no new `api.js` method.

## D127 — a seat is a consequence of `users.role`, and that is a definition rather than a measurement

**What the branch could not say.** `rpc/branchOps.ts` returned
`seats_used: null` with a reason that read *"Seats used needs
`seat_assignments`, which says who holds which seat id. No such store exists
yet on either tier"*. That sentence was a promise, and it had already expired:
`routes/licence.ts` carried a comment saying PR 5 would build the store, PR 5
shipped, and it built none. S2's seat tiles, S8's seat ledger, the amber
"request more seats" path and HQ's utilisation figure were all waiting on it.

**The answer was already in hand.** `branchOverview` runs
`SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role`
before it does anything else. `licence_seats.seat_type` (migration 187) admits
exactly `founder`, `investor`, `advisor`, `partner`; `users.role` admits those
four **plus `admin` and `exploring`** — the two that hold no seat, which is
precisely what S2's Exploring board describes. So seats used is the sum of four
numbers already fetched, and `WHERE is_active = 1` answers by construction the
question the research left open: a deactivated account does not hold a seat.

**No migration.** 264 stays free. The alternative was migration 264, a
`seat_assignments` table with a partial unique index on
`user_id WHERE state = 'held'`, and assign/release routes — a real PR rather
than a small one.

**THIS IS A DEFINITION, AND IT IS RECORDED AS ONE.** Role is not the same thing
as a licensed seat. Counting roles as seats is a choice about what the figure
means, not a measurement of a thing that exists, so the reason string says so on
the screen rather than presenting the number as more than it is. Two
consequences follow and belong in the same entry:

- **S8's seat ledger does not ship.** No seat has an id, nobody is assigned or
  released, and a vacant seat cannot be drawn.
- **S2's Members "Seat" column has no id to show.** If that column ships at all
  it is headed **Role**, and the page says that a role is not a licensed seat.

**The two tiers answer differently, and that is structural.** A branch can count
its own seats because every user in that D1 *is* the branch's. HQ cannot,
because no account names a licence (U1) — so `routes/admin_licences.ts`'s
`seatsUsed(): null` and `seats_used_available: false` are still correct, and its
docblock now says why the branch differs rather than leaving the asymmetry to
read as one tier being behind. `BranchOverview.seats_used` widens from the
literal `null` to `number | null`, which is what forces every consumer to handle
both.

**What keeps the definition honest** is `branch_seats_from_role.test.ts`, and
the drift it exists for is concrete. `licence_seats.seat_type` is the vocabulary
a licence is **sold** in. Add a fifth to the ledger — `service_partner`, which
the Super Admin canvas already names as a licence type — without extending
`SEAT_ROLES`, and every branch under-reports its seats against what HQ sold it.
Nothing would fail: the sum is still a sum and the page still renders. So the
test parses the CHECK constraint out of migration 187 and asserts it equals
`SEAT_ROLES`, parses `users.role`'s CHECK out of the baseline and asserts every
seat role is a value a user can actually hold, and pins the excluded set as
**exactly** `admin` and `exploring` — not merely "shorter", which passes however
the difference is made up. A new role fails that assertion and somebody decides
which side it is on, which is the point.

**The test that had to be re-pointed, not relaxed.**
`branch_rpc_fanout.test.ts` asserted `seats_used === null`,
`assert.notEqual(seats_used, 0)` and a reason matching `/seat_assignments/`, all
in one test shared with revenue. A correct **empty** branch now returns `0` —
exactly what the second assertion forbade — and zero there is a figure rather
than a fabrication, because the read succeeded. The test is split: revenue keeps
its own null-with-a-reason assertion, and seats get three of their own (an empty
branch is 0; six accounts across six roles with one deactivated is 4; and the
reason states that a role is not a licensed seat). The assertion this must never
become is `seats_used === null || typeof seats_used === 'number'`, which is the
assertion-that-cannot-fail this programme keeps catching.

**Two anchors in the new test were wrong before they were right**, and both are
the same class the previous commit fixed in `hq_revenue_h5.test.mjs`: it looked
for `CREATE TABLE IF NOT EXISTS users`, which the baseline does not contain, so
`indexOf` returned -1 and `slice(-1)` reported "the CHECK constraint moved"
instead of "this test cannot find the table"; and it read the first
`seats_used_reason:`, which is the **type** declaration and carries no sentence,
so it would have passed against a reason that still promised the store. A
missing anchor must fail as a missing anchor.

## D128 — nobody could search the account directory, and the tiles above it counted a page

**Two defects, and the second was live on a shipped HQ screen.** The task was
S0 wall rule 2 — a branch cannot search its own accounts. Read against the
code, the gap is wider and is HQ's: `AdminPage.jsx`'s Users panel filtered by
**role and nothing else**, so no one could look an account up by name or email
on either tier. A branch merely made the absence visible.

**And the tiles were lying.** `api.adminListUsers()` sent no `limit`, so
`admin.ts` applied `clampLimit(undefined, 100, 200)` → **100**, ordered
`created_at DESC`. The panel then computed
`counts = { all: users.length, admin: users.filter(...).length, … }` and
rendered each as a tile. Past a hundred accounts the **"All Users" tile read
100 as though it were the total**, every role tile counted only the newest
page, and there was no pagination control to reach the rest. A plausible number
standing in for an unmeasured one is precisely what `<Unrecorded/>` exists to
prevent.

**Both ship together, on the product owner's call.** They touch one route and
one panel, so one PR is one review of one component; splitting would have put
two passes over the same two files back to back, and the second would have
conflicted with the first on `docs/`. Recorded here so that an HQ correction
shipping inside a branch-titled task is visible rather than discovered later.

**What landed.**

- **`util/likeSearch.ts`** — one escaper, and the de-duplication is the
  justification rather than the new caller. The same four lines already existed
  **three times, byte for byte**: `rpc/branchOps.ts`, `routes/admin_partners.ts`
  and `routes/public.ts`. A fourth copy is what
  `frontend/src/lib/README.md`'s rule forbids and what D117 enforced on the
  other side of the tree — and D108's finding was that the escaping assertion
  *could not fail* because it was written against one of the copies. One
  implementation is what it owes a test.
  `likeNeedle` returns **`null`** for a needle under two characters rather than
  an empty pattern: `%%` matches every row, so a caller that fell through would
  hand back the whole directory dressed as a search result. The two directory
  searches keep their one-character minimum by passing it explicitly — this is
  a de-duplication, not a narrowing.
- **`GET /api/admin/users?q=`**, with the refusal server-side. A
  one-character query answers **400 `query_too_short`** whatever the browser
  does; the SPA gates at two characters so that 400 is not hit mid-typing. A
  UI-only rule would be a convention, not a control — `admin.ts:1440`'s own
  argument.
- **`?envelope=1`**, which the route's existing comment had already
  anticipated: *"a new `?envelope=1` mode can be added later without breaking
  the UI."* The flat array is still the default because
  `SuperAdminHolders.jsx` reads it, and a test pins that. The envelope carries
  `results`, `total`, `by_role`, `showing`, `limit` and `searched`.
- **The totals come from `SELECT role, COUNT(*) FROM users GROUP BY role`** —
  the same query `rpc/branchOps.ts` runs and, since D127, the same one
  `routes/licence.ts` runs. Three callers of one shape rather than a third
  shape. The tiles read the totals; the table still reads a page and the
  caption says so, which is what stops a tile of 341 sitting above a table of
  100 in silence.
- **The scope caption is branch-only.** `Searching {name} accounts` from
  `/me.branch`, through `branchOfUser` — the same reader the territory badge
  uses, so the two cannot disagree. On HQ it renders **nothing**: there is no
  territory to name, and an empty chip would be the doubled chrome this repo
  has deleted three times.

**Two things the build corrected, recorded rather than quietly done.**

1. **`ESCAPE '\'` inside a template literal cooks to `ESCAPE ''`.** The first
   draft wrote a single backslash in the TypeScript source; a template literal
   reads `\'` as an escaped quote, so the SQL reaching D1 declared an empty
   escape character and SQLite answered *"ESCAPE expression must be a single
   character"* — **every search would have 500'd in production**. The test
   caught it, not review, which is the argument for the fixture running real
   SQL rather than pinning query text.
2. **`check-sql-unsafe.mjs` scanned comments, so it accused documentation.**
   The route's new docblock explains why it does *not* use `sql.unsafe()`, and
   the guard matched that prose and reported a non-literal argument. It now
   skips comment lines — the two lines `check-timestamp-comparisons.mjs`
   already carries for the same reason (D125). Without the fix the workaround
   is to reword the comment, and a rule people route around stops being a rule.
   Mutation-checked: a real `sql.unsafe(\`SELECT ${x}\`)` still fails it.

**The mutation that matters, and why it is stated.** A fixture smaller than the
page size **cannot tell a total from a page count** — they are equal there — so
an assertion written against a handful of users passes against the broken code.
That is exactly how this shipped. `admin_user_search_d128.test.ts` seeds 141
accounts against a page of 100, and asserts `total !== results.length`.

**No migration** — 264 remains free. No new `/api/*` path, so the drift gate has
nothing to say; only the existing method's signature widened.

## D129 — the branch tier's first real page, and the notice that outlived its own fact

**S2 became buildable the moment D127 landed, and the screen standing in for it
became false in the same commit.** `/branch/accounts` rendered a stated notice
promising *"Seats USED needs the seat assignment store, which is why this is not
a number that can be shown today."* D127 decided a branch counts its own seats
from `users.role` and that no seat store ships, so that sentence was wrong by
the time it was read. It is the **third** expired promise in this programme —
`routes/licence.ts` and `rpc/branchOps.ts` each carried one saying PR 5 would
build the store, and PR 5 shipped without it — which is what makes it a class
rather than a slip.

**It was never a production defect, and the entry says so rather than
overselling it.** No branch has been provisioned (the first run is blocked on
#192's token), so `/branch/accounts` has rendered for nobody. What it was is a
promise sitting in the tree waiting for a reader, and the fix deletes the
promise along with the notice.

### What the page shows, and what it refuses to

| element | where the number comes from |
| --- | --- |
| Four seat tiles — used, licensed, **free** | `seats_used_by_type` (new, D129) against `branch_licence.seats_json`. `free = licensed − used`, which is S8's arithmetic |
| Members, searched | `GET /api/admin/users?q=&envelope=1` (D128). On a branch that route is territory-scoped **by construction** — this deployment's D1 holds this branch's accounts and no others — so the search adds no predicate. S0's first wall rule is literally true here, not enforced |
| Exploring | the same envelope's `by_role.exploring` |
| Request more seats | `branchEscalate({kind: 'seat_increase'})`, which D112's route already accepts |

**The Members column is headed Role, not Seat.** The canvas draws Seat; D127
recorded in advance that there is no seat id to put in it. A column headed Seat
with a role underneath would be the exact lie this page exists not to tell, and
the test asserts BOTH that the page says Role and that the artboard still says
Seat — so the divergence is deliberate and stays visible rather than quietly
becoming stale.

**S8's seat ledger does not ship**, and that is D127's decision carried forward
rather than a new one: no seat has an id, nobody is assigned or released, and a
vacant seat cannot be drawn. It sits in the rail's `unavailable` list, where a
reader meets it, instead of in a notice standing in for the whole screen.

### The one thing the worker gained, and why it is not a second query

`branchLicencePayload` already ran `SELECT role, COUNT(*) … GROUP BY role` and
summed four of its rows. `seats_used_by_type` is **those rows un-summed** — not
a second read. A second query could ask a subtly different question (a different
`is_active` predicate, say) and the tiles would then disagree with the total
beside them; the test asserts the parts sum to the whole precisely to pin that
they come from one read. Every seat role gets a key including the zeroes,
because SQLite returns no row for an empty group and a missing key would make
the page choose between rendering nothing and inventing a zero. `null` stays
reserved for the count having failed, which is a different claim and renders
differently.

### THE FINDING THAT CAME OUT OF WRITING THE PAGE, AND IT WIDENS D126'S GUARD

D126 found three shipped HQ pages passing `WorkerRail` props it does not
declare, and built a guard that parses the component's own destructure. **That
guard covers one component.** Writing this page reproduced the identical defect
on two others within an hour: four `<Unreadable>`/`<Unrecorded>` mounts passing
`reason` and `what` that neither declares. `Unreadable` takes `{what, claim,
onRetry}` and `Unrecorded` takes `{children, reason}`; React discarded the rest
silently, so the honest state would have rendered **without its reason** — on
the two components whose entire job is to be the honest state, which is the
worst possible place for this class to live.

Measured before fixing: **every one of the ~90 existing call sites in the tree
is correct.** The offenders were all in the new file. So the guard starts clean,
and what it buys is the next one — the same argument D126 made, one component
wider.

### Files

`routes/licence.ts` (one field) · `pages/branch/BranchAccounts.jsx` (new) ·
`App.jsx` · `pages/branch/README.md` · `frontend/test/branch_accounts_s2.test.mjs`
(new) · `cloudflare-worker/test/branch_licence_copy.test.ts`. **No migration —
264 remains free.** No new `/api/*` method, so the drift gate has nothing to say.

### What is still not built, counted rather than left looking overlooked

**S1 Home is NOT in this PR, and the reason is duplication rather than size.**
Three of its six blocks are somebody else's work: the AI digest needs a
`branch_briefs` store and a per-branch cost that AI Gateway metadata does not
yet produce (D.10); "flagged by the rail" needs an anomaly producer that does
not exist; and **queue pressure is #233's approvals read model wearing a
different layout** — the five sources S3's board unions are the five counts S1
orders by age. Building it here means writing that query twice and deleting one
copy a PR later, which is the duplication this repo has now consolidated four
times. S1 lands after #233.

## D130 — the four approval queues become one board, over one definition of "open"

**S3's own words are the specification.** *"Five queues that were five pages
become five lanes, because an admin's actual question is never 'what is in the
LP queue' — it is 'what is oldest and who is waiting.' Sorting by SLA age
across all of them is only possible once they share a surface."* The value is
the sort, and the sort is impossible until the four share a shape.

### The finding that decided the shape

`backlogOf` (`rpc/branchOps.ts`) **already declared all four sources**, with
their real tables and their real status vocabularies — and its own docblock had
already said what would come next: *"The per-queue split is S3's board, which
PR 13 builds over a read model; duplicating a partial version of it here would
be a second answer to the same question."*

So the list **moved** to `services/approvalSources.ts` rather than being
copied, and `backlogOf` now reads it. Two lists would have been two definitions
of "open", disagreeing exactly where nobody would look: the number above the
board would stop matching the rows in it, and each would look right on its own.
It is the third consolidation in four PRs — D127 gave two readers of seats-used
one `GROUP BY role`, D128 gave four callers one LIKE escaper, this gives two
readers one predicate — and the test asserts the **consequence** (the count
equals the rows, on a fixture spanning every status boundary) rather than the
refactor.

**What the shared list holds, and what it cost to learn.** `backlogOf`'s
comment: *"Two of the four table names in the first draft of this function were
wrong, which would not have failed — it would have reported the backlog as
permanently unreadable, a plausible-looking answer that is never right."* Two
traps in particular, both now pinned by name in the test:

- **Cohort applications live in `cohort_applicants`** (migration 157), the
  per-cycle decision row — **not** `spinout_applications` (155), which is the
  submission form's own store.
- **A moderation case awaiting a decision is `under_review`.** `'active'` is a
  RESOLVED case, so counting it would put closed work on the board.
- And `'draft'` is deliberately **not** reviewer backlog: a draft referral
  belongs to the member still writing it, and counting it would put the branch
  admin under pressure for work nobody has handed them.

### The honesty rule differs between the two readers, deliberately

A **count** missing a term is a smaller number presented as the total, so
`backlogOf` still returns `null` for the whole thing when one lane fails. A
**board** is different: the rows that could be read are real work somebody
should see. So a failed lane keeps a `null` count, the reason names it, and the
page says which lane it cannot vouch for. That is the `services/branches.ts`
fan-out rule applied one level down — per-source isolation with the gap stated
rather than averaged away.

### THE BOARD READS; IT DOES NOT DECIDE

Every decision still goes to that queue's own console, which owns the store's
status vocabulary, its side effects and its emails. A board that also decided
would be a fifth writer to four stores, each with rules it would have to
restate — and restating a rule is how the copies drift. The payload carries
`decides: false` and the test refuses a write verb on the route.

### THE FINDING THAT CAME OUT OF WIRING THE ROWS

**Spinout moderation has no console.** `/api/admin/spinout-moderation/:userId`
exists on the Worker, `api.adminSpinoutModeration` and
`adminSpinoutModerationDecide` exist in `lib/api.js`, and **nothing in
`frontend/src` calls either.** So a moderation case is real work that reaches
the backlog count, reaches this board, and has nowhere to be decided. The row
says that instead of linking to a route that would 404 — which `sidebarConfig.js`
names as worse than no link, because it looks shipped. The test measures the
caller count rather than trusting this paragraph, and **fails with instructions**
the day somebody builds the console.

A near miss in the same class: the cohort panel is *rendered inside*
`AdminSpinoutLab` rather than routed on its own, so a `/admin/cohort` link would
have 404'd. Every console link is now asserted against `App.jsx`'s route list.

### What does not ship, narrowed rather than deleted (the D111 pattern)

The notice this replaces promised *"the read model that makes them one board"*,
which PR 13 is — so that sentence had to go, and what replaced it in the rail's
`unavailable` list is the smaller true thing:

- **Assignment and history** need a store that does not exist. Migration 264 is
  still free and is what `approval_assignments` / `approval_events` would use.
- **An AI-drafted decision note with its cost.** The canvas draws the cost; no
  per-branch AI cost figure exists, because the gateway metadata that would
  produce one is not wired. Same refusal as S12's decline card and S1's digest
  cost — an invented cost is worse than an absent one.

### One timestamp trap, closed at the read model

`created_at` is `datetime('now')` on all four — `YYYY-MM-DD HH:MM:SS`, no zone —
and `Date.parse` reads that as **local**. On a Worker local is UTC so the bug
hides; on a developer's machine every row would be hours out, and a board
ordered by age cannot survive that. `ageHours` appends the `Z` rather than
assuming it, and the test asserts the SQL form directly. Same ISO-vs-SQL class
as D122 and D125.

### Files

`cloudflare-worker/src/services/approvalSources.ts` (new) ·
`routes/branch_approvals.ts` (new) · `rpc/branchOps.ts` (reads the shared list) ·
`util/branch.ts` (`requireBranchTier` lifted out of the escalations route, which
is the second branch-only surface) · `routes/branch_escalations.ts` ·
`index.ts` · `frontend/src/lib/api.js` · `pages/branch/BranchApprovals.jsx` ·
two new tests · **D130**. **No migration — 264 remains free.**

---

## D131 — S1 ships the three blocks that have a source, and names the three that do not

**Date:** 2026-09-16 · **Task:** #232 (the remainder) · **Status:** shipped

`/branch` rendered a stated notice promising all six of S1's blocks as PR 12's
work. Three of the six have no source, and one of those three cannot get one
without inventing data — so leaving the notice would have kept promising four
things for as long as the page existed. This ships the three that are real and
moves the rest into the rail's `unavailable` list, each with its own reason,
where a reader meets a fact rather than a schedule.

It is the **second** expired promise this programme has deleted in three PRs
(D129 was `/branch/accounts`), and the branch README now carries the rule:
when a `will=` promises a store, the PR that decides not to build it deletes
the promise too.

### What ships, and what each block reads

| block | source |
| --- | --- |
| **Queue pressure** | `laneCounts` — the same `countSql` reads `backlogOf` sums. Ordered by the **oldest item**, not by count. |
| **Programme clock** | `cycleWeekWindows` / `delawareYearMonth` for the open week, `company_week_status` for who is still pending. `runCohortTimingTick` is **not** gated on `hqCadences`, so a branch materialises its own cycles — checked in `index.ts`, not assumed. |
| **Revenue share** | The **rate** from `branch_licence`, dated. The **amount** is `null` with the reason, and there is no sparkline. |

### Ordering by the oldest item and ordering by count are different orders

The canvas asks for the first and a naive read gives the second. A lane holding
forty things opened this morning is not more urgent than one holding a single
thing nobody has touched in a week. The test's fixture is built so the two
orders **disagree** — four fresh referrals against one 200-hour moderation case
— because a fixture where the busiest lane is also the oldest cannot tell which
one shipped.

An **unreadable** lane sorts above every measured one: "I could not look" is the
thing an admin most needs to act on. It reports `null`, never `0`.

### The obvious wiring would have been wrong, and this is the finding

`approvalBoard` already returns a per-lane figure, so reading it would look
right. But that one counts the rows a lane **returned**, which is
`min(open, limit)` — a flooded lane would report exactly the cap, every time,
looking like a measurement. `laneCounts` runs the unbounded count instead, and
a test pins the difference by asking the board for a cap below the fixture.

`backlogOf` now **sums `laneCounts`** rather than running the queries itself, so
the total and the parts are one measurement rather than two that agree today —
D129's argument for `seats_used_by_type`, applied to the second figure both
tiers read. That is the fourth consolidation in five PRs: D127 one `GROUP BY
role`, D128 one LIKE escaper, D130 one definition of open, D131 one count.

### Every deadline carries the zone it is enforced in

The cohort programme runs on `COHORT_TZ` — **America/New_York** — for every
territory, and a branch admin reads the screen somewhere else. "Closes 23 Sep
00:00" with no zone is six hours wrong for a French admin deciding whether their
founders still have tonight. The server names the zone; the page prints it; and
`inZone` takes the zone as a **required** argument, because a formatter that
silently fell back to the reader's zone is the exact defect it exists to
prevent. The week interval is half-open (week N's deadline **is** week N+1's
unlock), so one instant a month does not report two weeks open.

### The territory's own clock is deliberately not drawn

S1 draws a local CET clock and this does not, and the reason is a measurement
rather than a preference: `branch_licence.territory` is comma-separated ISO
alpha-2 codes, and `frontend/src/lib/countries.js` — the platform's only country
list — says in its own header **"NOT ISO CODES: these are display names"**. So
nothing maps `FR` to a zone, and inventing a map would be a store built to
decorate a greeting. The clock that actually governs is shown instead, beside
the deadline it governs.

### The revenue block shows a rate and refuses an amount

The share is a licence term HQ pushed, so it is real and dated. The base it
applies to is not totalled anywhere on a branch, and `branchRevenueSummary`
already establishes that for all three streams: subscription charges live in
Stripe with no amount in this database, a subsidiary charges no onward licence
fee, and the AI figure is a **cost** rather than revenue. Multiplying a real
rate by a missing base is how a page invents a number that looks audited, so no
euro figure and no twelve-month sparkline are drawn.

### An assertion that pinned a name, not a property

`branch_approvals_board_d130.test.mjs` asserted `backlogOf` matched
`/APPROVAL_SOURCES/`. Moving it onto `laneCounts` — the same list, read one
level up — failed that guard, and the change was correct. The assertion now
matches the **import from the shared module**, whichever shape the consumer
takes from it, and was re-checked by removing the import entirely. Second time
in three PRs a guard has pinned a spelling instead of the thing it guards
(`branch_rail_mount.test.mjs` was the first).

### Files

`cloudflare-worker/src/services/branchHome.ts` (new) ·
`services/approvalSources.ts` (`laneCounts`) · `routes/branch_home.ts` (new) ·
`rpc/branchOps.ts` (`backlogOf` sums the lanes) · `index.ts` ·
`frontend/src/lib/api.js` · `pages/branch/BranchHome.jsx` (new) · `App.jsx` ·
`pages/branch/README.md` · two new tests, one re-pointed · **D131**.
**No migration — 264 remains free.**

---

## D132 — one super admin, many subsidiary admins, and four powers that were only three

**Date:** 2026-09-16 · **Task:** #232/#233 (the access-control half) · **Status:** shipped

The tier model was stated by the product owner in five sentences and this entry
records them verbatim, because everything below is a measurement against them
rather than a design of my own:

> *"HQ needs to be able to supervise all admins, but other admin profiles
> should not be able to see other admin's data."*
> *"HQ is basically the super admin profile."*
> *"Only one super admin profile exists, many admin profiles exist as
> subsidiaries."*
> *"The super admin has the capacity to open, ban, close and supervise admin
> accounts."*
> *"Super admin controls the entire platform."*
> *"Admins of subsidiaries should be able to manage their own accounts under
> the supervision of the super admin profile."*

| tier | who | count | reach |
| --- | --- | --- | --- |
| **Super admin = HQ** | Axal VC itself | **one** | everything, across every subsidiary — and supervising a subsidiary is a *supported operation*, not a leak |
| **Admin = a subsidiary** | one per territory licence | **many** | their own territory's members, and nothing of any other subsidiary's |

### Measured against the code, two of the four powers already held and two did not

The audit was the deliverable here; the diff is small because most of it was
already right, and saying which part was already right is what keeps the next
audit from re-deciding it.

| power | route | before |
| --- | --- | --- |
| **Open** | `PATCH /users/:userId/role` | ✅ already exclusive — the gate is `requireAdmin`, but the handler carries `isSuperAdmin` with its own reasoning: an admin *"cannot mint new admins to entrench access"*, and *"an existing admin cannot be demoted"* by a peer. Unchanged. |
| **Ban / close** | `PATCH /users/:userId/toggle-active` | ❌ the only guard was `rows[0].id === adminUser.id` → *"Cannot deactivate yourself"*. **No holder check and no admin-target check**, so any admin could deactivate any other admin, the super-admin holder included. |
| **Supervise** | `GET /monitoring/analytics/{audit, audit/export.csv, exports/recent}` | ❌ plain `requireAdmin` over `admin_audit_log a LEFT JOIN users u` |
| **Supervise (session)** | `openSupportSession` | ✅ already super admin + TOTP + step-up, and it already refuses a target holding a `super_admins` row. Unchanged. |

**I had assumed all four were unguarded and that was wrong**; verifying before
building is what caught it, and the plan was corrected rather than the code
being bent to match it. Deactivating an admin silences them exactly as
effectively as demoting one, so the policy held on one route and was reachable
on the next — that asymmetry, not a missing feature, is the defect D132 closes.

### The third door, which the plan for this entry did not know about

The plan named **two** monitoring routes. The file has **three**:
`/audit/export.csv` runs the identical `admin_audit_log a LEFT JOIN users u`
and returns up to **10,000 rows of it as a downloadable file**, names and
emails included. Gating two of three would have closed the front door of a room
with two, which is the exact shape of the thing being fixed. It turned up by
reading the route file rather than the plan's summary of it, and the guard
therefore asserts **the join** — a fourth route that reaches it fails the test
instead of slipping past a hard-coded list of three.

### A refusal is not a failure, and that needed a page change

Raising a gate on a live surface changes what a plain admin sees, so the PR
owns the second half of that. `AnalyticsTab`'s `RetryCard` would have rendered
the new 403 as *"Couldn't load recent exports (403)"* — red ground, alert
triangle, **Retry button** — saying three untrue things at once: that something
broke, that it might be transient, and that pressing a button could help. A 403
now renders through one `Refusal` component: neutral, the server's own
sentence, no retry. `PlanAuditHistory` renders its own inline errors rather
than `RetryCard`, so it learned the status too — otherwise the page would state
the refusal in one place and cry failure in two others about the same rule.

### The isolation half is physical, and it is not code that is missing

*"Other admin profiles should not be able to see other admin's data"* is
already the whole point of D.2: each subsidiary is its own Worker over its own
D1, so **there is no global view underneath to leak** is literally true rather
than enforced. What remains open is the *interim*: until a subsidiary is
provisioned every admin lives on HQ's one database, where
`tenancyScope.ts:64`'s `UNSCOPED_ROLES = new Set(['admin'])` gives each of them
every row. That closes when branches are **deployed**, which waits on three
repository secrets (`BRANCH_SECRET_BUNDLE`, `HQ_RPC_SECRET`, a widened
`CLOUDFLARE_API_TOKEN`) and not on more pages. `UNRESOLVED_ITEMS.md` U1 now
carries the measured counter-example beside the schema fact.

Note that the super-admin elevation adds **routes, not rows**:
`migrations/199_super_admin.sql` keeps `role='admin'` so all the existing role
checks still pass, which is why both tiers sit in `UNSCOPED_ROLES` and why the
fix here had to be a gate rather than a scope.

### HQ's supervision is narrowed exactly once, and that is now asked of the gate

D120 writes `user_sessions.factor = 'hq_support'` and its comment says the value
*"is a real gate, not a label"* because `requireFactor` reads the column and
fails closed. The test for it asserted the **string** was written — which would
pass unchanged if `requireFactor` stopped reading the column, if `selectJwt`
stopped resolving the jti, or if the session row stopped being found, every one
of which opens every TOTP-gated branch route to HQ while the column still reads
`hq_support`. `branch_isolation_invariants.test.ts` asks the gate instead, in
both directions: the support session is refused by `requireFactor` and by
`requireStepUp`, an ordinary TOTP session on the same branch is admitted, and
supervision reaches **exactly the target's own role** — a founder target fails
`requireAdmin`, the branch's own administrator passes it. **That second half is
not decoration**: a narrowing done too enthusiastically would take away the
supervision the owner's first sentence requires.

That file deliberately pins **only** what is not pinned elsewhere.
`branch_mode_gates.test.ts` already holds the `super_admins`-row deny, the
unread table on a branch, and `requireSuperAdmin`'s "HQ only";
`branch_cookies.test.ts` holds `branchOf`'s throw on a malformed code and the
per-branch cookie names. A second copy of an assertion is a second thing to
update, and the one that goes stale is whichever the next change misses.

### Two mutations escaped, and the escape was the useful part

Rewriting `createJWT(…, target.role, …)` to mint `'admin'` — and separately
`'founder'` — changed nothing the tests could see. The reason is a fact about
the codebase worth writing down: **`getCurrentUser` does `SELECT * FROM users
WHERE id = payload.user_id` and hands back the ROW**, so the `role` claim in a
token is never read for authorisation and a wrong one cannot grant reach. The
branch's own `users` table decides. That is a stronger property than the test
was written expecting; the mutations were re-aimed at what *can* break it (the
token minted for a different id, and an over-narrowing that refuses an admin
target), and both are caught.

**20 mutations applied, 18 caught, 2 escaped and re-aimed.** Two others landed
nowhere on their first attempt — a `perl` anchor spanning JSX lines matched
nothing — and were re-run with exact anchors, because a mutation that edits no
bytes is not evidence either.

### A number in prose has no guard behind it

`auth.ts`'s `hydrateSuperAdmin` docblock said `requireSuperAdmin` gates **24**
routes. When D132 came to cite it the real figure was **40, across eleven route
files** (42 across twelve after this PR). `DECISIONS.md` D106 carried the same
stale 24. Both are now gone rather than corrected: the property is that every
super-admin route funnels through that one flag, and that is what the sentence
says. The same docblock already warned, one paragraph up, that a list of paths
goes stale the next time a route is added — it was carrying a count that had
done exactly that.

### Files

`cloudflare-worker/src/routes/admin.ts` (the `toggle-active` admin-target
guard) · `routes/monitoring_analytics.ts` (three gates raised) · `auth.ts` (the
stale count) · `frontend/src/pages/AnalyticsTab.jsx` (`Refusal`, and
`PlanAuditHistory` reading the status) ·
`cloudflare-worker/test/super_admin_exclusive_powers.test.ts` (new, 13) ·
`cloudflare-worker/test/branch_isolation_invariants.test.ts` (new, 5) ·
`frontend/test/analytics_refusal_d132.test.mjs` (new, 5) ·
`UNRESOLVED_ITEMS.md` U1 · **D132**. **No migration — 264 remains free**, for
the sixth consecutive PR.

---

## D133 — the admin-over-admin reach D132 left behind, and a cap that was only a sentence

**Date:** 2026-09-16 · **Task:** #255 · **Status:** shipped

D132 raised three cross-admin reads to the super admin and wrote the rule that
decides the rest, in `monitoring_analytics.ts`'s own header: *"a route that
reaches `admin_audit_log a LEFT JOIN users u` is a cross-admin read whatever it
renders, and gating some of them is gating none of them."* It then applied that
rule **inside one file**. Auditing the platform against the owner's words rather
than against D132's own plan found four surfaces outside it that were the same
claim, and one invariant that was never an invariant at all.

### The four, sharpest first

| surface | what it was | now |
| --- | --- | --- |
| `POST /admin/impersonate/:userId` | the only target check was `isSuperAdmin(target) && !isSuperAdmin(caller)`, so **a plain admin could take over a peer's session** — strictly worse than reading their record, one route from the `toggle-active` hole D132 fixed | an **admin** target needs the super admin; the holder-vs-holder refusal keeps its own sentence above it |
| `GET /admin/users/:user_id/profile` | no role check on the target at all. It returns the target's **last 100 `activity_logs`** matched on `user_id OR actor`, so pointed at a peer it is that admin's own **actor-side** feed: every `user_toggled`, `role_changed`, `admin_impersonate` they wrote | an admin target needs the super admin; **reading your own drawer is not a cross-admin read**, so the self case passes ahead of the check |
| `GET /admin/cohort/impersonation-audit` | `impersonation_sessions` joined to `users` twice, for actor and target names and emails — byte-for-byte D132's shape, one file over | `requireSuperAdmin` |
| `moveAccountOut` | deactivates by id with **no role check**; only the HQ route's `requireSuperAdmin` stood in the way, and `rpc/index.ts` says an entrypoint is *"callable by any Worker in the account"* | refuses an admin target **inside the RPC**, because a control that lives only at one caller is a control the function does not have |

The last one also refuses the super admin, deliberately: deactivating a branch's
administrator would leave `licence_admins` pointing at a dormant account and the
subsidiary with nobody able to sign in. Unbinding at HQ is the tool for that, and
D134 is where it lands.

### "Only one super admin exists" was a migration that had already run

Migration 207's `DELETE` is a one-shot. `super_admins`' only constraint is
`user_id PRIMARY KEY` — which says an admin holds the elevation **at most once**,
not that **at most one admin holds it**. `POST /super-admins/:userId` counted
nothing. The UI said *"One holder **by decision**"* and offered *"Every admin
already holds it"* as an empty state, a string that only makes sense if many are
expected. A holder could elevate a second, a third, an nth.

The ceiling now sits beside the floor `DELETE /:userId` already had
(`last_super_admin`) — the same rule read from the other end, in one file so
neither can be changed without the other.

### THE CEILING WAS A WALL, AND A MUTATION IS WHAT SAID SO

With exactly one holder, revoke refuses **three ways**: `cannot_revoke_self` for
the holder's own row, `last_super_admin` for the only row, and there is nobody
else to ask. So "revoke first, then grant" is not a path that exists, and a bare
ceiling would have frozen the elevation on whoever held it, **permanently**.

The test that should have caught this passed for the wrong reason: it revoked
the holder's row and then asserted a grant was *not refused with 409* — but a
caller with no elevation is stopped by `requireWriteBar` with **403**, and 403 is
not 409. It asserted nothing. Only the mutation `> 0` → `>= 0` exposed it.

The fix is an explicit, atomic transfer: the holder names a successor with
`?transfer=1`, and the grant and the revoke go in one `DB.batch`, so the set
moves from `{holder}` to `{successor}` without ever being two or empty. The page
follows — with a holder present the control says **Transfer**, because a Grant
button that reliably 409s is the bare refusal D132 was written about.

### A conjunct that cannot be false is not a guard

The transfer branch's first draft also required `held[0].id === actor.id`, and
no mutation could kill it: `requireWriteBar` has already proved the caller is a
super admin, and reaching that line proves `held.length === 1`, so the one active
holder **is** the caller. A database predating this ceiling that carries two
holders fails the length test and gets the 409 — the right answer, since it
should be reduced to one first. The conjunct is gone rather than decorative, and
the test that covered it now names the control that actually refuses a
non-holder: the write bar, asserted as **403** rather than as "not 200".

### Mutations

**18 aimed, 16 caught, and both escapes changed something real.** The first
(`> 0` → `>= 0` on the ceiling) exposed the wall described above and the dead
conjunct beside it. The second pointed `superAdminGrant` at a different path and
still passed, because the guard's 300-character window ran past it into
`superAdminRevoke`, whose own URL satisfied the assertion — the single failure
mode a bounded substring scan has, now bounded at the next method instead.

**Two more landed somewhere other than where they were aimed and were re-run
rather than counted:** one left the original `requireSuperAdmin` in place beside
the injected `requireAdmin`, so the guard never came off; the other swapped in a
symbol `admin_super_admins.ts` does not import, failing on an unresolved
reference rather than on the loosened gate. Neither is evidence, and the tally
says so.

### A fifth guard that pinned a spelling

`super_admin.test.ts`'s api.js check matched `superAdminGrant`'s exact
single-parameter source line, so giving it the options argument a transfer needs
failed a test that protects nothing about that signature. Re-pointed at the
property — each method exists, reaches its own path, and uses its own verb —
which is what it was written for. That is the fourth such case in this
programme, after `branch_rail_mount`, `branch_approvals_board_d130` and the
`flushSurface` quartet.

### Files

`routes/admin.ts` (impersonate + profile drawer) · `routes/admin_cohort.ts` ·
`routes/admin_super_admins.ts` (the ceiling and the transfer) ·
`rpc/branchOps.ts` (`moveAccountOut`) · `frontend/src/lib/api.js` ·
`frontend/src/pages/hq/SuperAdminHolders.jsx` ·
`cloudflare-worker/test/admin_over_admin_d133.test.ts` (new, 15) ·
`frontend/test/super_admin_one_holder_d133.test.mjs` (new, 5) · **D133**.
**No migration — 264 remains free**, for the seventh consecutive PR.

---

## D134 — opening and closing an admin account, through the licence

**Date:** 2026-09-16 · **Task:** #256 · **Status:** shipped

The owner's model is one super admin who can *"open, ban, close and supervise
admin accounts"*, with *"many admin profiles … as subsidiaries"*. D132 gave
**ban**, D133 gave **supervise**. Measured against the code rather than against
the plan, **open** and **close** had no route at all:

| power | before D134 |
| --- | --- |
| **open** | `PATCH /admin/users/:userId/role` refuses `role === 'admin'` with `admin_promotion_disabled`, for everyone including the holder — and its super-admin override is validated deliberately **above** that guard so it can never reach it. `POST /admin/licences/:uid/admins` wrote the `licence_admins` binding and **left `users.role` alone**. The only path was SQL against production, or `branch-provision.yml`'s single seeded principal — a GitHub Actions permission, not an elevation. |
| **close** | The same route refuses demotion with `admin_demotion_disabled`, on the same terms. SQL again. |

So the table that answers *"which licence does this administrator run?"* could
name an account that was not an administrator, and an administrator could exist
with nothing naming the territory behind them. Both halves now have a door.

### Open is ONE act; close is TWO, and the asymmetry is the design

`POST /:uid/admins` writes the binding **and** `users.role = 'admin'` in one
`DB.batch`. Neither write alone is a state anybody wants: a binding without the
role is an administrator who cannot administer, and the role without a binding is
the unscoped admin the whole door exists to prevent. One statement, so neither
can be left behind by a failure somebody would have to notice and repair by hand.

`DELETE /:uid/admins/:userId` refuses with **409 `still_an_admin`** while the
target holds the role, and the refusal names the demote route rather than stating
a policy — a 409 that does not say which door is next is a dead end. The order is
therefore **demote → detach**, and between the two the account is a non-admin
still holding a binding. That transient state is on the screen rather than
inferred: `GET /:uid/admins` now returns `u.role` and `u.is_active`, and the row
reads *"no longer an admin — detach"*.

### The demote is its own route, not a hole in the role route

`POST /admin/users/:userId/demote-admin`. The alternative — opening
`admin_demotion_disabled` for the holder — was rejected on the role route's own
terms: its override exists to be narrow, is validated above both admin guards for
exactly that reason, and a test pins the ordering. Loosening it would also put
the power on a route gated by plain `requireAdmin`. The new route takes the
**write bar** instead, which is strictly higher and is what the rest of this
power already carries.

**The destination is `exploring`, not a role the caller picks.** Nobody has
decided what a former administrator is, and offering founder/investor/advisor in
a dropdown would put that decision where nobody thought about it. `exploring` is
the platform's own holding state, it is where every signup lands, and it routes
the account back through `/admin/exploring`, where assigning a real role needs a
signed binding agreement. The honest answer and the one with a gate behind it.

Two refusals, each a way to lock the platform out of itself: **yourself**
(the elevation sits on the `admin` role, so self-demotion would leave a
`super_admins` row pointing at a non-admin, which `holders()` filters out — the
platform would read as having no super admin), and **the elevation holder**,
which names the revoke step.

### A third refusal was written, and it was dead

The first draft carried a `last_admin` floor mirroring `last_super_admin`:
refuse when `COUNT(*) WHERE role='admin' AND is_active=1 AND id != target`
reaches zero. **The test written to drive it could not.** The count can never be
zero: the caller has passed `requireSuperAdmin` (role `admin`) through
`getCurrentUser` (which refuses an inactive account with 401) and cannot be the
target. At least one active admin — the caller — always survives, by
construction. The floor holds; the check that claimed to hold it could not fail,
and a conjunct that cannot be false is not a guard. It is gone, with the reason
in the handler, and the test now pins the property it rested on: a deactivated
super admin is refused at **authentication**, not there.

This is the second such removal in two PRs — D133 struck `held[0].id === actor.id`
for the same reason. Both were found by writing the failing case first.

### One write bar, in `auth.ts`

`requireWriteBar` — TOTP-minted session, recent step-up, then the elevation — was
module-private in `routes/admin_super_admins.ts`. D134 gives the same bar to
appointing and detaching an administrator and to demoting one, in two more files.
Three hand-written copies of a three-line gate is how two of them come to check
only two of the three, so it is now `requireSuperAdminWriteBar` in `auth.ts`,
beside the gates it composes. Reads keep `requireSuperAdmin` alone on purpose: a
step-up on every list trains the holder to type a TOTP code without reading why.

`super_admin.test.ts:223` asserted the bar's three checks **out of the router
file**, so the move failed a correct change. It is re-pointed at what that router
actually owns — no `requireAdmin`, both writes through the shared bar, no local
copy — and the bar's contents are pinned once, beside the definition. **The fifth
guard in this programme to pin a location or a spelling rather than a property**,
after `branch_rail_mount`, `branch_approvals_board_d130`, the `flushSurface`
quartet and D133's `superAdminGrant` line.

### A live defect this PR landed on, and fixed: `step_up_required` was 400

`AUTH_ERROR_STATUSES` carried `'TOTP required': 403` and **no `step_up_required`
entry**; `app.onError` handled it as a special case *above* the lookup. So the
**31 route files that catch their own throws and call `mapError`** — never
reaching that handler — answered a step-up refusal with **400 Bad Request**,
carrying neither the `code` the SPA prompts off nor the TTL it shows.

That is D110's finding one key over, and D110's own comment predicted it: *"not a
message and a key drifting apart, but two tables of keys."* D134 is the PR that
first routes a step-up gate through `mapError` — `admin_licences.ts` catches its
own throws — so without the fix the new write bar's most common refusal would
have shipped as a status the SPA cannot act on. The body is now built by
`stepUpRefusalBody()` in `util/authErrors.ts` and both readers call it.

### The first UI `licence_admins` has ever had

Migration 190 shipped the table in May; `api.licenceAdmins`, `licenceAdminAdd`
and `licenceAdminRemove` shipped with its routes and had **zero callers**, so
naming a subsidiary's administrator meant SQL. The Administrators section sits
beside History on the licence detail — **unnumbered, because appointing an
administrator is not a step of the six-step issue flow**: a licence can be issued,
activated and deployed with nobody on it, and an administrator can change years
later without any of the six running again.

Detach is **disabled** while the account holds the role rather than offered and
refused, because a UI that let the server pick teaches the operator that one of
its two buttons is a lie. A failed read renders the server's sentence and
explicitly is not an empty list: *"nobody administers this licence"* is a claim
about the business and must never be produced by a request that did not arrive.

### Two stale sentences retired

Both refusals said the role *"can only be granted / changed via direct database
SQL (security policy)"*. True when written; false the moment this PR shipped. Each
now names the route that does the job — the same rule this programme has applied
to a notice that outlived its fact in D129, D131 and D132.

### What this does NOT do, stated so it is not read as an oversight

- **A demote has no UI outside a licence.** An admin who holds no `licence_admins`
  row can be demoted only by calling the route. That surface is D138's, whose
  subject is the admin accounts themselves.
- **Terminate is not this.** Demote + detach leaves the account active and its
  audit intact. Deactivation is D132's `toggle-active`; the compliance ladder that
  decides *when* is D135.

### Files

`auth.ts` (the shared write bar) · `util/authErrors.ts` + `index.ts` +
`routes/_t13t14t15_helpers.ts` (the `step_up_required` fix) ·
`routes/admin_licences.ts` (appoint, list, detach) · `routes/admin.ts` (demote,
the extracted `resetExploringReview`, the two corrected sentences) ·
`routes/admin_super_admins.ts` (uses the shared bar) · `frontend/src/lib/api.js` ·
`frontend/src/pages/admin/AdminLicences.jsx` ·
`cloudflare-worker/test/licence_admin_lifecycle_d134.test.ts` (new, 19) ·
`frontend/test/licence_admins_ui_d134.test.mjs` (new, 7) ·
`cloudflare-worker/test/super_admin.test.ts` (re-pointed) · **D134**.
**No migration — 264 remains free**, for the eighth consecutive PR.

---

## D135 — the compliance ladder: a notice, a clock, and a freeze that is not a ban

**Date:** 2026-09-16 · **Task:** #257 · **Status:** shipped

The owner's requirement, in full:

> *"Super admin (HQ) should be able to notify admins and send warnings or
> notifications, on licence renewal terms, fees, term violations … if admins do
> not respect the terms of the contracts and agreement terms of the Super admin
> (HQ), admin accounts can be terminated, but first admins get notified; if
> admins do not act on notifications, admin accounts are frozen until they act
> on things from what they have been notified; and lastly if they don't comply
> admin accounts are terminated."*

D132 gave **ban**, D133 **supervise**, D134 **open and close**. This is what
gives all four their meaning: the evidence and the sequence behind them.

```
ACTIVE ──notice issued──▶ ISSUED ──deadline passes unanswered──▶ OVERDUE
                             │                                      │
                   admin responds                         admin responds
                             └──────────▶ RESPONDED ◀───────────────┘
                                             │
                              HQ accepts ────┴──── HQ rejects
                                   │                    │
                              ACCEPTED              REJECTED
                         (freeze lifts if this   (freeze stays; HQ's next
                          was the last holder)    move is a new notice or
                                                  a deliberate termination)
```

### The state is the licence's own — a second flag would be a second truth

`territory_licences.status` already carries the two end states with the comments
that prove the semantics were chosen deliberately (migration 187): `suspended` —
*"not trading, STILL HOLDS ITS TERRITORY"* — and `terminated` — *"over;
territory released"* — beside `suspended_at`, `terminated_at` and `status_note`.
`/suspend`, `/reinstate` and `/terminate` exist, are super-admin-only, and are
audited through `licence_events`' CHECK. **Migration 264 supplies the reason and
the clock; the licence supplies the state.** The reuse is sound because the
subjects match: renewal terms, fees and term violations are licence matters, and
`licence_admins` is `UNIQUE(user_id)`.

### The freeze goes inside `requireAdmin` — one edit, not a path list

271 call sites across 51 files. A list of frozen paths in `index.ts` would go
stale the next time a route is added — the failure D106 avoided by putting the
branch gate inside `hydrateSuperAdmin`. Four properties are deliberate:

- **It never gates a read.** `requireBranchNotSuspended` states the rule for its
  branch-side twin; the reason is sharper here, because an admin who cannot see
  what they were asked cannot do the thing that lifts the freeze.
- **It never freezes the super admin**, and the code says so rather than relying
  on there being nobody to do it.
- **It does nothing on a branch.** `admin_notices` is HQ's table; a branch has
  the twin, reading its own pushed copy. Two tiers, two lookups.
- **An unreadable table is not a freeze.** A database between deploy and
  migration reads as not frozen — inferring a freeze from a missing row would
  freeze every admin exactly when somebody is trying to work.

**423, not 403**, for D107's stated reason about the twin: a frozen admin *may*
take this decision, and HQ has stopped them taking it today.

### The response route is not an admin route, so there is no exception list

The reply lives on `routes/licence.ts` — already *"one licence, for the person
who administers it"*, already `requireAuth`, already mounted. Behind
`requireAdmin` the freeze would lock the addressee out of the one action that
lifts it, and the usual patch is a list of skipped paths, which is the thing that
rots. Ownership is in the WHERE, so somebody else's notice answers **404** rather
than 403 — a 403 confirms it exists.

**Responding lifts the freeze; HQ's acceptance is not what unblocks writing.**
`responded` is not a freezing status, so an admin who answers can work while HQ
reads. Holding the freeze through a review of unknown length would punish
somebody for doing exactly what they were asked. A rejection freezes again, and
that is a decision somebody made rather than a queue they sat in.

### Three corrections the code forced on the plan

1. **`notify()` is not the only sanctioned path, and the plan's "never a direct
   `sendEmail`" conflated two different things.** `services/email/send.ts`'s
   `send()` renders a designed template, queues through JOB_QUEUE so a failure
   retries into the DLQ, writes `email_send_log`, **and mirrors the message into
   the inbox** with its category and CTA — six modules already use it. `notify()`
   has no template at all: its mail is `[Axal] <title>` plus the body as plain
   text, and `template_key` is only *stamped* on the inbox row as metadata. So a
   template added for `notify()` to render would have been a template nothing
   reaches. The notice — the one piece of mail on this ladder worth designing —
   goes through `send()`; the freeze and the licence transitions go through
   `notify()`, because by then the person is looking at a 423 and what they need
   is one sentence and the route back.
2. **The sweep's two writes had to become two passes, and a test is what found
   it.** The first shape suspended the licence inside the flip loop, so a pass
   that flipped the notice and then failed to suspend could never retry: the next
   pass no longer selects a row that is not `issued`, and the account would read
   frozen while its licence went on trading. The suspend is now its own pass,
   selecting *every active licence with a notice currently holding it frozen* —
   true of a row flipped a second ago and of one whose suspend failed an hour
   ago. The test written for the retry is what caught it.
3. **`check-sql-prepare` refuses a generated placeholder list**, so
   `FREEZING_STATUSES` could not be spread into the SQL. It is a fixed-length
   **tuple type**, so adding a third status is a compile error at every binding
   site rather than a silent under-bind, and a test counts the placeholders
   against its length.

### `respond_by` is named so the timestamp guard can see it

`check-timestamp-comparisons.mjs` has **no allowlist by design**, so a deadline
column outside `TTL_COLUMN` is a column nobody is watching — and a deadline swept
against the clock is precisely the defect class it exists for. The name goes in
the guard in the same commit the column is created, and every write goes through
`datetime('now', '+N days')`, so the format is the sweep's own rather than an ISO
string that would not bite until the UTC date rolled over.

### The sweep: five-minute cadence, no new cron, never terminating

No new cron expression — `* * * * *` already fires every minute and every block
gates on the **wall clock**, so this is one `if` and nothing in `wrangler.toml`.
**Not gated on `hqCadences`**, on the D122 precedent one block up: a branch holds
no notices, so the sweep's own predicate is the tier discriminator and a better
one — it selects rows by what they are, not by which deployment is asking.
`froze_at` is stamped with the **computed deadline**, never the sweep's clock, so
the cadence bounds how long an account writes past its deadline and never changes
what a row says.

**It never terminates.** A clock owns the reversible rung; ending an account
stays a deliberate human act. That split is what makes the automatic half safe to
run every minute, and a test asserts it against a notice 400 days overdue.

### Two escapes that were the same discovery from opposite sides

Widening the sweep's SELECT and making its flip unconditional both escaped their
first tests. The reason is one fact: **in a single-threaded run the two conjuncts
are each independently sufficient**, so neither can be killed while the other
stands. They are not redundant in production — two isolates can race, both SELECT
the row while it is `issued`, and only the conditional UPDATE decides which owns
the transition. Each is now pinned where it is actually observable: the SELECT
through the reported `due` count, the UPDATE through two interleaved sweeps over
one database. 22 mutations, 22 caught.

### One guard re-pointed — the sixth

`licence_admins.test.mjs` banned `c.req.param('uid')` across the whole of
`routes/licence.ts`, to express *"the licence must come from the session, never
from the request"*. D135 adds a route taking a **notice** uid, scoped by the
session in its own WHERE — which does not cross that line, but failed the
spelling. The ban is now bounded to the `/mine` handler it was about, and the new
route carries the same claim in the form that applies to it: ownership in the
read's WHERE *and* in the write's. The file also reads through `codeOnly()` now,
because its `requireAdmin` ban was tripping on a comment explaining why this
router deliberately does not use `requireAdmin`.

### Files

`sql/migrations/264_admin_notices.sql` (new) ·
`scripts/check-timestamp-comparisons.mjs` (`respond_by` joins `TTL_COLUMN`) ·
`util/authErrors.ts` (`ADMIN_FROZEN`, `FREEZING_STATUSES`, `adminFrozenBody`) ·
`auth.ts` (the freeze inside `requireAdmin`) · `index.ts` + `routes/_t13t14t15_helpers.ts`
(both error readers) · `services/complianceLadder.ts` (new — the sweep and the
fan-out) · `routes/admin_licences.ts` (issue, list, review, and the three
transitions that now tell the holder) · `routes/licence.ts` (the addressee's two)
· `templates/email/{layout,registry}.ts` (the `compliance` category and one
template) · `frontend/src/lib/api.js` ·
`cloudflare-worker/test/compliance_ladder_d135.test.ts` (new, 25) ·
`frontend/test/licence_admins.test.mjs` (re-pointed, +1) · **D135**.
**Migration 264 — the first new store in eight PRs.** Next free is **265**.

## D136 — the ladder's two surfaces, and the door D135 did not build

**Date:** 2026-09-16 · **Status:** accepted · **Supersedes:** nothing ·
**Builds on:** D135 (the ladder's backend), D134 (open and close), D107 (the
branch-side 423 and its banner), #204 (unreadable is not empty).

### The finding this entry exists for

D135 shipped the compliance ladder complete: migration 264, the freeze inside
`requireAdmin`, the two-pass minute sweep, three routes for HQ, two for the
addressee, and five methods in `frontend/src/lib/api.js`.

**Every one of those five methods had zero callers.** `AdminLicences.jsx` had no
case-insensitive match for "notice"; `MyLicencePage.jsx` called exactly one api
method. So HQ could not issue a notice and a frozen administrator could not
answer one — and that is worse than inert rather than merely incomplete, because
the sweep runs every minute: a notice inserted by SQL would have frozen an
account whose only screen said nothing about why, with no form anywhere to lift
it. A ladder nobody can climb is a trap.

This is the seventh time in this programme that a store or a route shipped
without the surface that reaches it (`licence_admins` went five months, D134;
`branch_benchmarks` still has neither writer nor reader, task #252). The pattern
is not a scheduling accident — a backend PR is testable on its own and a surface
PR is not, so the surface is the half that slips. Recording it here so the next
split is made knowing which half tends to be left.

### What lands

**HQ issues and reviews, on a third unnumbered tab.** `NOTICES_STEP =
STEPS.length + 3`, beside History (+1) and Administrators (+2) and deliberately
NOT inside `STEPS`: the six-step issue flow is what it takes to create a
licence, and a compliance notice is something that happens to one that has been
running for months. Adding it there would renumber the canvas and say a licence
cannot be issued without a notice. `NoticesEditor` copies `AdminsEditor`'s six
idioms exactly — three-state `useState(undefined)`, a `useCallback` load keyed
on the uid, `refresh`, `run(fn)`, a `can…` gate mirroring the server's own
floors, and the closing step-up note.

**Accept and Reject are disabled until the addressee has answered.** The server
answers 409 `not_responded` every time otherwise, so this is D134's
`still_an_admin` decision one route over: a UI that offers a button the server
always refuses teaches the operator that its buttons are advisory.

**The addressee is a `<select>` over this licence's own administrators**, not a
free-text email box, because `POST /notices` resolves the address against
`licence_admins` and 404s `not_an_administrator` for anybody else — a text field
would be a field whose wrong answers are only discoverable by submitting.

**The response window is a bounded count of DAYS, never a date picker.**
`respond_by` is computed server-side as `datetime('now', '+N days')` so that the
deadline and the sweep that reads it share one format and one clock. A date
input would put the deadline in the browser's zone, which is the timestamp
defect class this repo has now fixed four times.

**One clock, and it counts up.** Per the owner's call there is no second
deadline: the screen states "frozen since \<date\>, N days" and sorts worst-first
(freezing statuses, then waiting-on-HQ, then waiting-on-them, then closed; oldest
first inside a band). Terminating stays the deliberate act it already was, at the
top of the page. A countdown would say the platform decides when an account has
had long enough; it does not.

**The addressee gets a banner above the page, not instead of it.** A freeze stops
writes and not reading, so a page that replaced itself would enforce something
the server does not — and the licence terms are exactly what somebody answering a
notice about fees needs to look at. It is **not dismissible and persists
nothing**: `components/InfoStrip.jsx` and both `*Banner*` components clear
themselves through `localStorage`, which is right for content and wrong for a
compliance freeze. And the three ladder states are three claims, not one:
`issued` is a reminder with nothing frozen, `overdue` and `rejected` are a
freeze. One banner for both would be a false alarm in one direction and a silent
freeze in the other.

**423 finally has a client-side identity.** `423` appeared NOWHERE in
`frontend/src` before this — measured, not assumed — while
`routes/branch_escalations.ts` had been citing "the frozen banner (D107)" as
though one shipped. `api.js` now learns 423 the way it already knows 402 and
`step_up_required`: a refusal carrying `code: 'admin_frozen'` fans out
`studioos:admin_frozen`, and a bar mounted once beside `GlobalPaywallMount`
names the notice and links to `/admin/my-licence`. Nothing is needed server-side
— `adminFrozenBody` already puts the causing notice in the body, because the gate
had the row in hand. **The throw is unchanged**, so every page's own catch still
receives the structured error.

**Why both the bar and the banner**, rather than one: the page explains the state
where it can be acted on, the bar explains it at the moment of the refusal,
wherever the administrator happened to be. Neither substitutes for the other, and
both read the one sentence the worker already ships twice
(`services/complianceLadder.ts` and the email template) rather than inventing a
third wording — a test asserts all three agree.

### The defect this PR found and fixed on the way

**`daysTo` could not read the stamps the notice store writes.** It was
`new Date(iso)`, correct for `territory_licences.renews_on` (a bare
`YYYY-MM-DD`, UTC midnight by spec) and wrong for `admin_notices.respond_by` and
`froze_at` (SQL `YYYY-MM-DD HH:MM:SS`): that shape is not in the spec's grammar,
V8 accepts it and reads it as the **reader's local time**, and other engines
return `NaN`. So "in 6 days" would have been wrong by the reader's UTC offset, on
exactly the column a deadline is read from. `toUtcInstant` normalises it; the
bare-date form is untouched.

### Three lessons about the tests, because each cost a mutation

1. **An assertion that cannot fail on the machines that run it is not a guard —
   and CI runs UTC.** The first version of the `daysTo` test compared the two
   parses on a UTC machine, where they are the same instant, so it passed with
   the normalisation deleted. It now sets a non-UTC zone for the duration and
   asserts the runtime honoured the change.
2. **`Math.round` swallows a four-hour misread at every exact day multiple.** The
   second version still passed, because 6.0 and 6.167 are both "6". It now sweeps
   all 24 hours of the day and asserts that the SQL spelling and the explicit-Z
   spelling of the same instant agree — a claim that needs no knowledge of the
   offset.
3. **Markup inside an unreachable branch satisfies a source scan.** Two
   assertions passed with their gates replaced by `false`, because the element
   was still in the file. Both now read backwards from the element to its own
   gate and require the gate to consult the value — the property, not the
   spelling.

All three are the same failure from different sides, and it is the one this
repo keeps re-learning: the version anybody writes first is the version that
cannot fail.

### Files

`frontend/src/pages/admin/AdminLicences.jsx` (`NOTICES_STEP`, the tab,
`NoticesEditor`, a notice tone map, `toUtcInstant`) ·
`frontend/src/pages/subsidiary/MyLicencePage.jsx` (the second read, the banner,
the notice list, the response form) · `frontend/src/lib/api.js` (the 423 branch)
· `frontend/src/components/AdminFrozenBar.jsx` (new) · `frontend/src/App.jsx`
(one mount) · `frontend/test/compliance_ladder_ui_d136.test.mjs` (new, 18) ·
**D136**.

**No new `/api/*` method** — all five existed, so `check-api-drift` has nothing
to say. **No migration**: 264 shipped in D135 and **265 is still free**.

### What this does NOT do

HQ's suspend still reaches no branch: `applyLicence` has no caller (D137, task
#259). It does not block this, because no branch has been provisioned and the
whole ladder runs on HQ — but it must close before the first one is, or a frozen
subsidiary keeps trading.

## D137 — the licence push pipe, connected before a branch exists

**Date:** 2026-09-16 · **Status:** accepted · **Builds on:** D111 (a push is
reported, never thrown), D107 (the branch's licence copy), D135/D136 (the
compliance ladder), migration 257 (the first field the copy omitted).

### The defect

**`applyLicence` had no caller.** The `HqEntrypoint` method whose entire job is
to hand a branch its licence appeared in `cloudflare-worker/src` exactly twice —
its definition and its one-line delegation — plus three tests. Nothing in
`frontend/src`, `scripts` or `.github` called it either, and symmetrically
`BranchEntrypoint.licence()` had no branch-side caller; `fanOut` was only ever
invoked with `'overview'` and `'health'`.

So `POST /api/admin/licences/:uid/suspend` changed four columns in HQ's ledger
and **changed nothing on the subsidiary**. D135 turned that from latent into
urgent: the compliance sweep now suspends a licence on a clock, every minute,
so without this an account HQ believes is frozen belongs to a branch that goes
on trading — and nobody would be looking, because the freeze looked done at HQ.

It is still true that no branch has been provisioned, so nothing is broken in
production today. That is precisely why it is fixed now: after the first
provisioning it would be a live incident rather than a gap.

### The push is reported, never thrown

`routes/admin_escalations.ts:94-116` states the rule for D111's escalation
answer and this is its fourth instance. HQ's ledger is the record; the branch
is a second, fallible thing. A 502 for an unreachable branch would ask an
operator to re-suspend something already suspended, and the retry would find it
done. So each transition keeps its own write, its own `licence_events` row, its
own notification and its own 200, and carries `pushed: {ok, reason?, code?}`
beside the outcome.

**One helper, five callers** — `services/licencePush.ts`. Four licence
transitions plus the sweep's own suspend. Copying D111's twelve lines five
times is how five call sites come to disagree about what "landed" means; this
repo has now made that consolidation for `likeNeedle`, the absence helpers, one
`GROUP BY role`, one definition of open and one zone formatter.

**Three refusal states, three sentences**, because they need different actions:
no deployment row (nothing to push to, and no licence has one yet), a
deployment with no service binding (provisioning ran, HQ has not been
redeployed), and a branch that threw or refused (its own message survives).

**The sweep counts `pushed` separately from `suspended`.** Folding them would
report a freeze as complete when only half of it happened.

### The eight fields, and why it was not six

The plan said "six mis-renamed fields". Measured, it was **eight broken fields
in two classes**, and the distinction is the work:

`MyLicencePage` reads HQ's vocabulary — `LicenceRow`'s columns, which `hydrate`
spreads verbatim. The branch payload emitted the **table's** names instead:
`term_start`, `renewal_at` and `suspended_note` where the page reads
`starts_on`, `renews_on` and `status_note`. And five more the copy **never
stored at all**: `registered_address`, `signatory_name`, `signatory_title`,
`term_years`, `terminated_at`.

So on a branch the Entity panel printed "Not recorded" four times about facts HQ
holds, the term and renewal date were blank, a terminated licence never showed
when it ended — and `status_note`, the sentence saying **why** a licence was
suspended, was blank on the page a suspended administrator is sent to.

`licence.ts:174-181` already carried the rule: *"THE KEYS ARE HQ'S, NOT THE
TABLE'S … a copy that renamed its own fields would render blank on exactly the
tier it was built for — which is what it did until this line."* It was applied
to `legal_entity` and stopped. This finishes it.

**Migration 265** adds the five, additively, on `257_branch_licence_ref.sql`'s
shape — same table, same operation, for the same reason. 257's header already
argues why a new migration beats editing an applied one *"even when the table it
corrects is empty in every database that exists, because the rule is what makes
that emptiness something we can stop having to check."*

**`term_end` is pushed as NULL rather than derived.** The copy has the column
and HQ has no such fact: it holds a duration (`term_years`) beside `starts_on`.
Computing an end date would be the copy asserting something HQ never said.

### The guard is derived, not typed

`branch_licence_copy.test.ts` asserted four key names, typed in — which is how
the other eight survived. It now parses **every `l.<key>` the page reads** out
of `MyLicencePage.jsx` and requires the payload to supply each, and refuses the
table's own spellings alongside them. The next field added to the page fails
here rather than rendering blank on a tier nobody has run yet.

### Two fixtures were narrower than the schema

`branch_licence_copy` and `branch_rpc_fanout` both hardcode `branch_licence`'s
DDL, and neither had 265's columns — so the SELECT threw and the payload
degraded to `licence_not_pushed`, i.e. six tests reported "HQ has not pushed
this branch its licence" about a row sitting in front of them. The D133 lesson,
twice: a fixture narrower than the schema does not fail honestly.

### Files

`cloudflare-worker/sql/migrations/265_branch_licence_entity.sql` (new) ·
`services/licencePush.ts` (new) · `services/complianceLadder.ts` (the sweep
pushes, and counts it apart) · `routes/admin_licences.ts` (five transitions) ·
`routes/licence.ts` (the payload speaks HQ's vocabulary) ·
`rpc/branchOps.ts` (`applyLicenceCopy` binds the five) ·
`test/licence_push_d137.test.ts` (new, 12) · two fixtures widened · **D137**.

**Migration 265 used; next free is 266.** No new `/api/*` method.

### What this does NOT do

The branch-side 423 still has no machine-readable `code` of its own, so the
frozen-branch banner D107 is cited for remains unbuilt; that is S7/S13's, with
the three false "the banner shipped" claims to correct. And `publishTemplate`,
`applyBenchmarks`, `templates()`, `governanceFeed` and the partner pair are
still unbuilt producers — `applyLicence` was the first of six to get a caller.

## D138 — the supervision surface, and a picker that was reading a page

**The owner's sentence is "HQ needs to be able to supervise all admins."** Five
merged decisions built every power it implies — D134 opens an account through a
licence, D135 freezes one and gives the freeze a reason and a clock, D136 builds
the two screens that work a notice, D137 pushes the decision to a branch — and
until this one **there was no screen anywhere whose subject was the
administrators.** Supervising meant opening one licence at a time:
`/admin/licences` → a licence → its Administrators tab → its Notices tab. "Who
is frozen right now" could not be asked, only assembled, and the ladder has been
live in production since 2026-09-16 20:10Z.

So `GET /api/admin/hq/admins` and `pages/hq/HqTeamTable.jsx`, mounted on
`/admin/accounts` between the holder console and the Admin Console's directory.
It is the canvas's **H9**, which closes #243 and #260 as one screen rather than
two.

### The defect it carries, and it is functional rather than cosmetic

`SuperAdminHolders.jsx:41` called `api.adminListUsers()` **with no arguments** —
`ORDER BY created_at DESC LIMIT 100` — and filtered that PAGE to
`role === 'admin'` in the browser. Admins are among the **oldest** accounts, so
past a hundred rows an admin is not in the list at all, and the `<select>` reads
*"No other admin to hand it to"* about a database that has several. In a
**picker**, absence is not a display problem: the elevation cannot be granted.

The new route filters on role **server-side with no LIMIT**, which is sound
because the query has a predicate — admins are one per licence plus HQ, not a
directory. It is the shape `routes/users.ts` already runs for `?role=`.

**The test for that needed a fixture nobody would write by accident.** A LIMIT on
a role-filtered query is invisible until there are **more than a hundred
admins**: the first fixture seeded 120 *founders*, and the mutation that added
`LIMIT 100` passed, because the predicate excluded them before the limit was
reached. The fixture now seeds 120 admins plus five founders, so the predicate
and the limit fail differently and each has its own assertion. An assertion that
cannot fail on the machines that run it is not a guard.

### What the screen reads, and the one thing it refuses to infer

Four reads, each with its own failure state: the roster (`users WHERE role`), the
licence and `admin_role` (`licence_admins ⋈ territory_licences`, read
user→licence for the first time — D134's route reads licence→users, one licence
at a time, which is the walk this replaces), the rung
(`admin_notices GROUP BY user_id, status`, riding
`idx_admin_notices_user(user_id, status)` which migration 264 already created and
no route had read for a third party), and the elevation (`super_admins`). Plus
`users.last_active_at`, written by `middleware/lastActive.ts` and **absent from
every list payload until now**, so "when was this admin last here" had no answer
anywhere.

**An unreadable `admin_notices` reports `ladder_readable: false` with its reason
and NO rung at all — never four rungs of "clear".** `auth.ts`'s own freeze gate
states the rule in the same words: being under notice is a claim somebody MADE,
and inferring its absence from a failed read is how a screen comes to say the
opposite of the truth. It is also the D133 lesson twice over — two fixtures
narrower than the schema once had seven tests reporting "HQ has not pushed this
branch its licence" about a row sitting in front of them.

**The deadline and the freeze stamp are the EARLIEST of an admin's open notices,
not the newest**, because what a supervisor needs is the oldest unanswered thing;
taking the latest would make a long-frozen account look freshly frozen. That
choice was also unreachable by the first test: `GROUP BY user_id, status` already
reduces same-status rows with `MIN()`, so two `overdue` notices arrive as one
group and the per-admin reduction never saw two candidates. The fixture now uses
two different statuses.

### The groups are H9's own model

> *"There is no global accounts table. HQ asks each branch over its private link
> and groups what comes back, so a search result is really four answers and a
> fifth for HQ-held accounts — and when one branch does not answer, its group
> says so instead of showing zero."*

So the HQ-held roster is complete and always returned, and `q` is what HQ **asks
the branches** — through `fanOut(env, 'searchAccounts', [q, 20])`, which already
existed with its three states (`ok` / `unreadable` / `not_deployed`). With no
branch provisioned `branches` is `[]`, every admin is HQ-held, and the Branch
column says so: a fact about where the row lives, not a placeholder.

The browser narrows the roster as you type. **That is honest here and was the bug
there:** filtering a complete list narrows it; filtering a page hides rows.

### What is NOT drawn, measured rather than deferred

**H9's "Move to another branch".** Its route exists —
`POST /api/admin/branches/:code/accounts/:userId/move` (D.6, `admin_support_sessions.ts:191`)
— and it requires a **source** branch code and a **destination** branch code,
each a live `BRANCH_*` binding, refusing when they are equal. With no branch
provisioned there is neither end, so the control could only ever refuse. D134
already named that mistake on this tier: *a UI that offered both and let the
server pick teaches the operator that one of its buttons is a lie.* The page says
what a move is and that it needs two provisioned branches. It rejoins #243 when
the first branch exists.

### One definition of what freezes — the sixth consolidation

D136 shipped its two surfaces on one day and each declared its own copy of the
freezing set, the notice kinds and the worst-first ordering; this screen would
have been the third. `frontend/src/lib/notices.js` now holds them once, on the
rule `lib/README.md` already states. The ordering is expressed **once and read
two ways**: `RUNGS` is the precedence, `rungRank` keys it by rung (the Team table
sorts admins), `noticeRank` keys it by status through `rungOfStatus` (the licence
detail sorts notices) — so the two screens cannot come to disagree about which
state is urgent, and the file does not hold two lists meaning the same thing.

**The two `NOTICE_TONE` maps deliberately did not move.** Their hue assignment
agrees in all six statuses, but one is a bordered chip in HQ's light console and
the other a dark-mode-aware pill, and **Tailwind cannot build a class name at
runtime** — the JIT pass scans source for literals, so `bg-${hue}-50` emits
nothing. Merging them would mean changing one page's appearance or shipping
classes the build purges. That is D117's `money` lesson verbatim, stated in the
new file's header rather than left for whoever tries next.

D127 one `GROUP BY role`, D128 one LIKE escaper, D130 one definition of open,
D131 one count, D132 one zone formatter, D138 one definition of what freezes.

### Two findings recorded rather than changed

1. **`admin.ts:113` is the only `GROUP BY role` of five without
   `WHERE is_active = 1`** (`rpc/branchOps.ts:202`, `admin_hq.ts:60`,
   `market_intel.ts:963` and `licence.ts:157` all have it). **It stays as it is.**
   The four others count seats used and platform health, where active is the
   right denominator; `admin.ts:113` totals a **directory** whose list below it
   is likewise unfiltered and carries a state column. A tile counting active
   above a list showing deactivated rows would be the tile-vs-table disagreement
   D128 was written to end. Changing a live tile on a pattern-match rather than a
   reading is what this note prevents.
2. **`admin.ts`'s back-compat comment named a reader that stops reading.** It
   said the flat array was *"load-bearing: `SuperAdminHolders.jsx` still reads
   this as a flat array"*. It does not any more, and it was the last flat caller
   in the SPA. The **behaviour stays** — removing a response shape is a breaking
   change for anything outside this repo — and the **comment is corrected**,
   because a comment naming a reader that no longer exists is the same class of
   stale claim as D129's seat store and D131's six blocks. A guard now asserts no
   caller under `frontend/src` reads the flat form.

**No migration. 266 stays free.** `check-api-drift` is satisfied by the one new
method carrying its route in the same commit.

### And a lesson from the harness, not the code

One mutation reported "not applied — anchor not unique" twice, and the second
time it was because the *harness patch itself* had landed nowhere: a two-space
indent against a one-space source, with the write still succeeding and printing
"fixed". A harness edit that silently changes nothing is the same failure as a
mutation that lands somewhere other than where it was aimed, one level up. The
edit is now asserted to have changed the file before it is trusted.

---

## D139 — the licence ledger's own integrity: an event its constraint rejects, three transitions with no state machine, and a freeze that outlived its licence

**#261 was filed as "eight licence-area defects the ladder audits turned up".**
This repo's own rule is that an audit finding is true as of its date and is not a
live bug until re-checked, so all eight were re-measured against `bb0e768c2`
before anything was written. **Six are live and two are struck**, and the six are
not one concern — this decision carries only the ones that are the *licence
ledger's own integrity*. The rest are filed with their measurements.

### The sharpest one, and it is worse than it was filed

`admin_licences.ts` calls `logEvent(c.env, licence.id, 'contract_instantiated', …)`
when HQ instantiates a licence agreement. Migration 187's `licence_events` CHECK
admits **nine** values and that is not one of them — 187 predates licence
contracts, which arrived in 259.

`logEvent` is a **bare `await` with no try/catch**, and it sits **after** the
contract INSERT and **before** the `201`. So on real D1, in order: the previous
contract is superseded, the new contract row lands, the event raises on the
CHECK, and `mapError` answers **400**. The operator is told *Bad Request* about a
contract that **was created**, and pressing the button again supersedes that one
and writes another — every retry silently stacks a superseded draft.

**It has never fired, and saying so is part of the fix.** Read-only against
production `studioos-db`, aggregates only: `licence_events` **0 rows**,
`territory_licences` **0**, `licence_contracts` **0**. No licence has ever been
issued, so no contract has ever been instantiated and the 400 has harmed nobody.
This is **latent, not live**, and the PR does not claim an incident. What the
emptiness changes is the **cost**: migration 266's rebuild copies zero rows,
which makes now the cheapest moment this will ever have. Migration 257's header
already wrote the argument one table over — the rule holds *"even when the table
it corrects is empty in every database that exists, because the rule is what
makes that emptiness something we can stop having to check."*

### Why a rebuild, and why not the three cheaper answers

SQLite cannot `ALTER` a CHECK. The only supported way to widen one is the
documented rebuild — create the table anew with the corrected constraint, copy,
drop, rename — which is a departure from this repo's additive-only habit and is
stated in **266**'s header rather than discovered. The table is append-only,
nothing carries a foreign key **at** it, and its one index is recreated by name.

- **Not "drop the CHECK".** It is the thing that would have caught this.
- **Not "rename the event" to one of the nine.** `terms_changed` and `activated`
  are smaller acts than instantiating the agreement, and the trail is what the
  table exists for. **The constraint is wrong, not the write.**
- **Not "wrap `logEvent` in a try/catch".** That converts a loud 400 into a
  silently missing audit row, which is the worse of the two.

### The fixture was the blind spot, and it is now read off disk

`licence_contract_instantiate.test.ts` recreated `licence_events` with
`event TEXT NOT NULL` and **no CHECK**, then asserted the row — so the suite was
green against a table production does not have. That is the same class as an
assertion that cannot fail, and `compliance_ladder_d135.test.ts` had already
stated the rule it kept: *"The CHECK is migration 187's, copied rather than
relaxed."* The fixture now slices the CREATE out of **266**, falling back to 187
if 266 is ever removed, so it cannot silently lose the constraint again.

**Proved both ways rather than asserted.** With 266 present the suite is 14/14;
with 266 withheld, three contract tests **fail** — which is the demonstration
that the fixture, not the assertion, was what hid the defect. And relaxing the
fixture back makes them pass **even without 266**, which is the same fact from
the other side.

### The state machine, which existed only in prose

Migration 187 wrote the semantics down in its own comments —

```
active      — trading
suspended   — not trading, STILL HOLDS ITS TERRITORY
terminated  — over; territory released
```

— and **nothing enforced them**. Measured: `suspend` 0 status guards, `renew` 0,
`terminate` 0, `reinstate` **1**. So a **terminated** licence — one whose
territory has been released and may already have been granted to somebody else —
could be suspended or renewed, and a renewal would push a date onto a licence
that is over.

`transitionRefusal()` is one helper carrying the rule once, and the three
transitions each answer **409 `bad_transition`** on `reinstate`'s own refusal
shape rather than inventing a second one.

**Re-suspending an already-suspended licence is refused too, and the ladder is
what made that real.** The UPDATE overwrites `suspended_at`, which HQ's Team
table (D138) and the addressee's own page (D136) both read as *"frozen since"*.
Silently restarting the clock an administrator is measured against is worse than
refusing, so the refusal names the alternative: reinstate first, or edit the
note.

### The freeze that outlived its licence

Terminate deletes `licence_territories` and updates `territory_licences`, and
nothing else. Since **D135 shipped the freeze** that leaves a live contradiction
the original filing predates: `auth.ts`'s gate reads `admin_notices` by
`user_id` and **never consults the licence's status**, so a terminated licence's
open notices go on freezing its administrators forever — over a licence that no
longer exists to comply with, where answering the notice cannot help because
there is nothing left to comply *with*.

That half is not a product call, it is the ladder contradicting itself, and
migration 264 already has the word for a notice HQ is no longer pressing:
**`withdrawn`**. Terminate now withdraws the licence's `issued`, `overdue`,
`responded` and `rejected` notices. `accepted` and `withdrawn` are **left
alone** — they are already closed, and rewriting a closed row would lose which
way it closed.

**It runs outside the `DB.batch`, and that is deliberate.** A database that has
not applied 264 has no `admin_notices` table; inside the batch its absence would
fail the termination itself. So it is **reported rather than thrown**, the D111
precedent this file has now applied four times: the termination is recorded
whatever happens, and `notices_withdrawn: {ok, count} | {ok: false, reason}` is
its own field beside `pushed`. A withdrawal that fails says so in a sentence
naming the consequence — *an administrator frozen by one may still be frozen* —
rather than letting a completed termination look like a failure.

### The two struck, with their measurements

1. **`renewalSweep` binds ISO against a bare `expires_at`** — filed as the
   bound-parameter timestamp defect. **Not a defect.** `trust.ts:1174-1181` binds
   ISO on **both** sides against a column written as ISO, which is consistent,
   and this plan file already said so in an earlier pass: *"the companion sweep
   700 lines away reads the same column correctly."* What is real is that **no
   lexical guard can see it** — that is `check-timestamp-comparisons`'s blind
   spot and it belongs to **#253**, not here.
2. **`licence_contracts` has four statuses and only `draft` is reachable** —
   **not a defect, an unbuilt feature already recorded as one.** `ROUTE_MAP.md`
   row 41: *"Still not shipped: sending a contract for signature (`status` and
   `envelope_uid` exist and nothing writes them)."* Honest absence.

### Filed rather than folded in, each with its measurement

- **`hq_escalations.due_at` has an SLA band and no cron.** Written at
  `rpc/hqOps.ts:90`, no reader in `index.ts`. A breached HQ SLA changes a badge
  colour and notifies nobody. Its own task.
- **`/inbox` is a dead CTA.** `notify.ts:480` builds `${root}/inbox`; `App.jsx`
  registers **zero** `path="/inbox*"`. Either a route or a different link — a
  product call about where a notification should land.
- **`notifications` is both a view and a runtime table.** Migration 053 creates
  the back-compat VIEW; `services/notifications.ts:29` a
  `CREATE TABLE IF NOT EXISTS`. Which wins depends on which ran last on a given
  D1 — a schema-collision question, and the `metrics_snapshots` precedent (#183,
  #202) says it is its own piece of work.
- **What terminate should deprovision beyond the notices** — admins keeping
  `role='admin'`, the deployment row, seats, contracts. A product call, and
  D134's demote/detach primitives are what it would compose.

### One `frontend/src` file did not move, so `docs/` did not either

D139 is worker-and-SQL only. The freeze it lifts is felt on two shipped screens
and neither needed a line changed: the rung they render is derived from
`admin_notices.status`, and `withdrawn` was already outside `FREEZING_STATUSES`
before this decision existed. The test asserts the lift **through**
`FREEZING_STATUSES` itself rather than restating the four strings, so the two
cannot drift apart.

---

## D140 — branch S4: a calendar nobody can move, an index of four consoles, and the third promise that outlived its fact

`/branch/programs` and `/branch/community` were the last two branch artboards
blocked on nothing — S5 and S6 wait on `publishTemplate` and `applyBenchmarks`,
which F.5 listed and nobody built. So S4 shipped on its own, and researching it
before building it is what shaped it, because **the notice it replaces promised
two things and neither survived measurement.**

### The promise, and why it is deleted rather than reworded

`/branch/programs` rendered: *"The cohort calendar with **dates you adjust**, and
assessment runs whose results are yours."*

**No route anywhere lets an admin move a cycle or a week.** Measured across the
whole worker rather than taken from the plan file: there is **no
`UPDATE week_windows` at all**, and every `UPDATE cohort_cycles` touches
`status`, `app_status`, `force_proceed` or `applications_open_at/close_at` —
**never `start_at`/`end_at`**. The four week windows are pure month arithmetic
(`cycleWeekWindows(year, month)`), and both rows are written by
`INSERT OR IGNORE`, so re-materialising a cycle cannot move one either.

A date picker here would be the `still_an_admin` mistake D134 already named on
the tier above: *a UI that offered a button and let the server pick teaches the
operator that one of its buttons is a lie.* So the page draws no date control,
no form, and says on the calendar itself — where a reader meets the dates rather
than in a footnote — that they are derived and read here rather than set.

**This is the third promise in this programme to outlive its fact**, after
D129's seat store and D131's six S1 blocks. The rule the branch README states is
applied again and the sentence is **deleted at source**, with a scan refusing it
anywhere under `frontend/src` — the `NO_VERDICT_SNAPSHOT` precedent.

### What a branch genuinely controls is the outcome, not the calendar

Per company, per week: `grace` (1–168h, reason mandatory) and `override`, both
audited through `applyWeekDecision` into `company_week_status` and
`stage_transition_log`. That is a real and defensible reading of *"timing is
yours"* — it is simply not a date picker, and the page says which it is.

**And it links to those two writes rather than re-implementing them.** They
already have a working console — `AdminCohortTiming`, a **tab** of
`/admin/spinout-lab` rather than a route of its own — and two audited writes
drawn twice is how two surfaces come to disagree about what was decided.

### Assessment ships as analytics, not as runs

`admin_assessment.ts` has **23 routes and 17 of them are behind
`requireHqAuthoring`** (D106): authoring is HQ's, and offering a branch admin a
button that 403s is the same lie as the date picker. The page draws none, and
says so.

What it cannot draw is the artboard's *"assessment runs"*: there is **no
`GET /sessions` and no `GET /results`** in that file, and the one session-shaped
route, `POST /sessions/:id/rescore`, needs a `public_id` no console surfaces. So
a table of runs would have nothing to read. The gap is named on the page rather
than only in the rail, and **the test reads the absence out of the worker** — the
day somebody ships a list route, the assertion fails and the page gets its table
instead of the claim going quietly stale.

### Community is an index, not four new screens

All four consoles are real, working and **already branch-reachable**:
`admin_events.ts` (9 routes), `admin_jobs.ts` (5), `admin_circles.ts` (8) and
`admin_network_profiles.ts` (6) carry **zero** `requireHqAuthoring` between
them, and each has a live SPA route. What did not exist is the page the sidebar's
Community row points at.

**Each card says what its console actually does, because three of the four are
narrower than their names** and a reader who assumes otherwise goes looking for a
control that is not there:

- **Events** — moderation and analytics. Members write the events; the console
  approves, rejects, unpublishes, features, cancels and sets capacity. It does
  not author one.
- **Job board** — **moderation only.** Five routes, and there is no admin create,
  edit or delete.
- **Circles** — full CRUD. The one community surface a branch authors outright.
- **Network profiles** — CRUD, photo and reorder, and **not a member
  directory.** The only public route over that table is `network_public.ts`'s
  single photo-blob proxy, and the only other reader in the whole worker is
  `services/decks/axalSpinoutDemoDay.ts`. There is no member-facing list
  endpoint at all; what the table feeds is the Demo Day deck's Mentors & Network
  slide. The card says that rather than letting the name imply otherwise.

**The page fetches nothing, deliberately.** Four counts would each be a second
read of a console's own list, and a count here disagreeing with the table one
click away is the tile-vs-table defect D128 was written to end. The cards link;
the consoles count.

### One zone formatter — the fifth consolidation

`inZone` was written on `BranchHome` for S1's week deadline (D131) and S4's
calendar is its second caller. `lib/README.md` already states the rule — *"If a
helper appears in two places, put it here once rather than a third time"* — so it
moved to **`frontend/src/lib/zoneTime.js`** with `dateInZone` beside it, and
`BranchHome` imports what it used to declare. The existing S1 test was
**re-pointed rather than deleted**: its assertions pin the zone as a *required*
argument and are worth the same wherever the function lives.

It is deliberately **not** merged with `lib/spinoutLab.js`'s date helpers, which
bake `COHORT_TZ` in. Those format a programme date for a founder who is *on* the
programme clock; this one formats an instant for a reader who is not and must be
told which clock it is. Two behaviours under one name is D117's `money` trap, so
the split is stated rather than left for whoever tries next.

**And the zone itself is read, never retyped.** `lib/spinoutLab.js` already
exports `COHORT_TZ` and the worker declares its own in
`services/cohortTiming.ts`; the two cannot import each other, so the test pins
them equal. A rename on one side now fails the build instead of going unnoticed.

D127 one `GROUP BY role`, D128 one LIKE escaper, D130 one definition of open,
D131 one count, D132 one zone formatter *(planned and not taken — this is where
it actually landed)*, D138 one definition of what freezes, **D140 one zone
formatter.**

### The defect the new guard caught before it shipped

`cycleLabel(null, 10)` returned **`'October null'`**. The guard was
`Number.isFinite(Number(year))` — and `Number(null)` is `0`, which *is* finite,
so a missing year walked straight through and would have rendered on screen. The
empty values are rejected before the numeric check now. Worth recording because
it is the same shape as every other assertion-that-cannot-fail in this file: the
test was written first, and it failed on the first run for the right reason.

**No new `/api/*` method, no worker route, no migration — 267 stays free.** Every
read this PR needs already exists and is already branch-reachable on plain
`requireAdmin`, so `check-api-drift` has nothing to say. `frontend/src` moves, so
`docs/` is rebuilt.

## D141 — the Programme Brief: seventy-six bindings, six of which the platform can answer

**The ask, in the owner's words:** *integrate the new PROGRAMME BRIEF at
`https://axal.vc/spinout-lab/brief`, PDF-exportable, using the artifact,
**plugged to a backend that auto-updates every `{}` bracket element***.

**The mechanism is right and the scope is not, and this entry says so rather
than quietly building the smaller thing.** The design artifact is a Claude
Design canvas whose payload is a `<script type="text/x-dc">` model, and the
first thing it settles is the notation. It carries **two**, doing two different
jobs:

| notation | count | what it is |
| --- | --- | --- |
| `{{ binding }}` | **76** unique | the canvas rendering its OWN data — tracks, tools, gates, jurisdictions |
| `{dotted.path}` | **6** | the platform fields, which is what the `{}` ask names |

The six, verbatim from the canvas's `renderVals()`: `{brief.generated_at}`,
`{brief.year}`, `{cohort.name}`, `{cohort.close_at}`, `{cohort.start_date}`,
`{cohort.places}`. Task #239's title said "the six `{}` tokens" and was exact.
The canvas states the split itself, in its own header:

> *"One source: the same TOOLS / TRACKS / JURS the public page renders, so the
> brief cannot describe a programme the page does not. **Live values stay as
> fields — a generated PDF fills them from the platform, never from this
> file.**"*

So the seventy-six sort into three groups with three different homes, and
choosing a store for the third would have been a mistake this programme has now
made and deleted twice:

| group | roughly | home |
| --- | --- | --- |
| measured, and changes on its own | 6 | **`GET /api/spinout-lab/brief`** — new, public, no store |
| already one shared SPA source the Lab pages read | ~20 | `lib/spinoutLabArsenal.js`, read rather than copied |
| the programme's own prose and diagrams | ~50 | **`lib/spinoutBrief.js`** — content in git, reviewed in a diff |

**Giving the third group a D1 table would be D129's seat store and D140's
adjustable dates a third time** — a store built so a page could look dynamic,
holding values nobody measures and nobody edits. It is content. It changes by
someone editing it, and a reviewer reads the change.

### What the brief was, and why "finish it" was the wrong framing

`/spinout-lab/brief` already existed: four landscape slides
(`SpinoutLabBriefPage.jsx`, 195 lines) with print CSS, a Save-as-PDF button and
a live stats read through `useSpinoutStats`. What it did **not** have was any of
the artifact's structure — no tracks, no gates, no arsenal, no jurisdictions, no
terms — and no route of its own. So this is a rebuild against the canvas, not a
completion.

*(A correction on the record: an earlier note in this session called the page
"fully static — no `api.` call, no state." That was wrong. It read live data
through the `useSpinoutStats` **hook**, which a grep for `api.`/`useState`
does not see. The rebuild changes what it reads, not whether it read.)*

### The route — six fields, no store, no migration

`GET /api/spinout-lab/brief` on `spinout_lab.ts`, public the way `/stats` and
`/cohort` already are (auth here is per-handler; a route is public by not
calling `requireAuth`). **Five of the six read no table at all** —
`resolveApplicationTarget` and `monthLabel` are wall-clock arithmetic in
`COHORT_TZ` — and the sixth, `places`, comes through the shared
`getCohortSizeSettings`, whose product default IS the operative number until an
operator overrides it. The fixture therefore creates **no cohort tables**, so
anyone who later "improves" the route by reading a cycle row fails the test
rather than emptying the brief on a database that has not run those migrations.

`COHORT_TZ` is imported from `cohortTiming`, which **declares** it;
`cohortApplications` imports the constant without re-exporting it, so
destructuring it there is `undefined`. That was caught by the worker typecheck,
not by reading.

**The route names the zone beside the instants**, and the page formats every
date with the zone the route sent rather than one it assumes. A reader anywhere
is told that 23:59 is Delaware's. That is `lib/zoneTime.js`'s third caller, and
its required-zone argument is exactly this case.

### Nothing on the page may be typed that is derivable

The arsenal's heading reads *"Nineteen working tools. Count them."* — an
invitation to check. It is `numberWordCap(TOOL_COUNT)`, and the test asserts
both halves: the rendered heading spells the count `LAB_TOOLS` actually holds,
**and** the word does not appear as a literal anywhere in the page source. Same
for `LAB_TRACKS.length` and for the twenty-eight days, which are `COHORT_WEEKS
× 7`. The brief has already carried a frozen number once — *"Cohort 4 · closes
August 1, 2026"*, past by the time anyone read it — and this is the one page a
founder prints and forwards to an investor.

### The nine mini-charts ship labelled as examples, or they do not ship

The canvas gives nine of the nineteen tools a small chart, and every figure in
them is invented for the design: `'9 interviews · 6 need-to-have'`, `'$2.4B ·
$340M · $34M · cited'`, `'$1.5M target · 30% committed'`. The canvas's own
comment calls them *"a simplified reading of their real screen … so a founder
who later opens the tool recognises the picture"* — the SHAPE, not a
measurement. And the brief is public: it is read by exactly the person who has
no account, so there is no founder's data that could go there even in
principle. Unlabelled, a chart with a figure under it reads as measured, which
would make these the most convincing wrong thing on the page. Every one renders
under `EXAMPLE_LABEL`, and the test counts labels against charts.

### Two absences, not one

A failed read and a month with no open cohort are different facts, and the page
says which. `resolveApplicationTarget` reports `ok: false` between a close and
the next month's opening; the brief then has no cohort to name and says so,
rather than naming the wrong one. `places` is answered on both paths and keeps
rendering. The test asserts that a failed read does **not** claim to know that
no cohort is open — it knows nothing.

### The finding that earned its own assertion

The SPA computes the cohort window **itself** — `resolveOpenCohort`
(`lib/spinoutLab.js`), which is what the marketing hero and the Lab intro quote
— while this brief's route answers from `resolveApplicationTarget`
(`services/cohortApplications.ts`). Two independent implementations of one rule
(seven days before the 1st, 23:59:59 Delaware) in two languages. Compared across
48 probes spanning mid-month, either side of a close, and DST boundaries:
**they agree on every one**. So this is latent drift, not a live defect — and
the day they disagree, two pages on the same site quote different deadlines for
the same cohort. `spinout_brief_d141.test.mjs` pins them equal, importing both
real implementations rather than restating either. The frontend test loader
resolves the worker's TypeScript, which is what makes a cross-language
behavioural assertion possible here at all.

### PDF export is print CSS, by the owner's call

`window.print()` plus `@page { size: letter portrait; margin: 0 }` and a page
break per section. No new dependency, no worker route, works offline, and the
artefact the founder saves is the page they were reading. Cloudflare Browser
Rendering is already a binding if a byte-identical server PDF is ever wanted;
that is filed, not built.

**The document is white in both themes, deliberately.** Only the chrome around
it follows the reader's theme. A dark-mode page that prints white is two
different documents under one URL, and this one is a document.

`check-dark-mode` was right to flag the first draft's seven `bg-white` cards,
and the answer is not its exemption pragma. The document already declared its
own palette as constants and painted its page ground with an inline colour;
`bg-white` was the one part of it reaching for a theme-aware utility, which is
the wrong MECHANISM rather than a forgotten pair. `PAPER` joins the palette,
the guard has nothing left to pair, and no exemption has to be trusted. The
toolbar keeps its `dark:` variants because it is app chrome. Both halves are
asserted — the document may carry no theme-aware class, and every light surface
in the chrome must still carry its dark counterpart. The second of those was
written weakly first (it only checked that *some* `dark:` survived in the
chrome) and passed a mutation that stripped the pair off the Back link; it now
reads each class string.

### One thing kept against the canvas: the track record

The artifact draws no outcomes block, and the brief it replaced had one —
`companiesLabel(companies)` and `raised`, read from the public
`/spinout-lab/stats` the marketing hero reads. **Those two figures are
measured**, they are the load-bearing fact for the investor this brief gets
forwarded to, and dropping a true number because a layout omitted it is the
wrong trade. It moves to page 4 and keeps the one hook, so the brief and the
hero cannot quote different track records on the same day — which is why
`useSpinoutStats` was lifted into `lib/` in the first place. The third figure,
"28 days", is `COHORT_WEEKS × 7` rather than a literal.

That block also produced the one mutation that escaped the first battery:
`spinout_brief_live_data.test.mjs` asserts the page *reads* the hook, which is a
source scan an empty render survives intact. Deleting the block passed both
files until a render assertion existed. **A guard that reads the source cannot
see a component that stopped drawing.**

### The guard that had to be re-aimed rather than deleted

`spinout_brief_live_data.test.mjs` predates this and lost four assertions to the
rebuild. Two were restored by keeping the track record. The other two pinned
`openCohortCopy()` and its interpolations — a mechanism the page correctly no
longer has, since it reads the cohort from the route. Their RULE survives and is
now enforced harder: "the brief and the hero cannot quote different dates" used
to rest on a shared call and now rests on the parity assertion above, comparing
two implementations on their output. What stays in the old file is the property
that belongs to that page — it must not compute a second cohort of its own, and
an absent one must not become a date. This is the D129/D131/D140 rule applied to
a guard rather than to a promise: the fact moved, so the assertion moves with
it rather than being reworded around the gap.

### `BriefDocument` is exported, and that is the testing decision

`renderToStaticMarkup` never runs an effect, so a component that fetched its own
data could only ever be asserted in its loading state — and the loading state is
not the one that has to be right. The document is therefore pure and
prop-driven, the wrapper does the one fetch, and both states are rendered and
read: six fields filled, and six stating their own absence. That is #516's
`MarkHistory` precedent applied to a whole page.

**The unsurvivable failure, asserted directly:** no `{{`, no `{cohort.`, no
`{brief.` may reach the rendered output in any of the three states. A binding
printed as text in a document somebody is being asked to rely on is the one
thing this page cannot come back from, and it is a property of the OUTPUT that
no source scan can see.

### One shared name kept, two collisions named

`spinoutBrief.js` declares no tool and no track — it carries the prose and the
brief reads `spinoutLabArsenal.js` for the rest, so the brief cannot describe a
programme the product does not have. The guard for that refuses the arsenal's
**shape** (`blurb:`, `route:`, `leads:`, `who:`, `group:`) rather than trusting
names, because a name can collide by coincidence and a key cannot — and the two
real collisions are named rather than waved past: "Office hours" is a support
row on page 4 as well as a tool card on page 3, and "Form" is both a track and
the name of the third gate on that track. A collision that disappears fails the
test as a stale entry, on `check-inline-project-pickers`'s shape.

`LAB_TRACKS` gained a `brief:` short form beside its longer `who:` — one source
read two ways, the D138 `RUNGS`/`rungRank` shape — because the screen's sentence
wraps to a ragged list in a print column. Two lists of the same three tracks is
what `lib/README.md`'s rule forbids.

**One new `/api/*` method with its route in the same commit; no migration — 267
stays free.** `frontend/src` moves, so `docs/` is rebuilt.

## D142 — the branch's own view of being frozen, and of being watched (S7, S13)

**Every power around this was already built and the branch could not be told
about any of it.** HQ can suspend a licence (D135), the suspension reaches the
branch (D137), the branch can escalate (D112) — and a suspended branch's badge
was byte-identical to an active one, a frozen write surfaced as a generic page
error, and while HQ was inside a branch admin's account the branch rendered its
ordinary purple *"Admin Mode"* bar with a working View-as picker.

### The 423 was anonymous on the wire, and nothing could be built on it

`requireBranchNotSuspended` threw `new Error(BRANCH_SUSPENDED)` — a sentence
written for a person — which shipped as `423 {"detail": …}` and nothing else.
Its HQ twin `adminFrozenBody` sends `{detail, code:'admin_frozen', notice}`, and
`frontend/src/lib/api.js` keys **strictly** on that `code`. So the branch 423
reached no handler.

**That is why three places in this repo could claim the frozen-branch banner had
shipped.** It had not, and it could not have: there was nothing on the wire to
key one on. `branchSuspendedBody` is the twin now, carrying
`code: 'branch_suspended'` plus HQ's own `suspended_at` and `suspended_note` —
HQ's words rather than this worker's paraphrase, because the admin reading the
refusal is being asked to act on somebody else's decision. Both production error
paths route through it (`app.onError` and `mapError`, the two D110 and D134
exist to keep in step), and a test pins that rather than trusting it.

### What a suspension actually freezes — the artboard drew four rows and one was enforced

Re-counted against the code: `requireBranchNotSuspended` had exactly **four**
call sites, all Approvals-or-admissions. Mapped against S7's Locked column:

| S7 draws as locked | before | after |
| --- | --- | --- |
| **Approvals** | ✅ three lanes | unchanged |
| **Programs** — *"admissions closed; the running cohort continues"* | ✅ `admin_cohort.ts`'s gate is on `/applications/:id/decide`, admissions exactly | unchanged — the running cohort's week decisions stay open, which is what the canvas asks for |
| **Community** — *"cannot be published"* | ❌ **zero** gates | **gated** |
| **Seat assignment** | ❌ nothing to gate | **recorded, not drawn** |

**The rule for Community, because it is three files and fifteen handlers.** A
suspended branch may not put anything **new** under the brand, and may still
take things **down**. So `approve`, `publish`, `feature` and the two circle
writes that can set `published` are refused; `reject`, `unpublish`, `cancel`,
`delete` and a capacity edit are not. Freezing a takedown would trap a frozen
branch with content under its own brand it cannot remove — worse than the freeze
it implements — and the canvas asks for exactly this split. Asserted from both
sides: the seven that must refuse, and the eight that must not.

**Seat assignment locks a control that was never built, and this corrects a
claim the task list still carried.** `seat_assignments` has **no migration**
(zero hits in `cloudflare-worker/sql/`, absent from the baseline), **no route**
and **no `api.js` method**; its only trace in the worker is a comment at
`routes/licence.ts` recording that the store was promised and never delivered.
D127 and D129 chose a different design — seats-used is counted from `users.role`
and `seats_used_basis` says so on screen. Drawing a freeze on it would be the
same false claim this programme has deleted three times (D129's seat store,
D131's six S1 blocks, D140's adjustable dates), so it lives in
`lib/branchFreeze.js`'s `NOT_BUILT` with its measurement, and a test fails the
day a migration creates the table — at which point the row can be drawn for
real.

### One list, read by the screen and asserted against the server

`lib/branchFreeze.js` names, per locked row, the route **files** that enforce
it. `branch_shell_s7_s13.test.mjs` reads the worker and asserts the named set
and the enforcing set are identical: a sixth gate with no row fails, and a row
whose file stopped gating fails. Without it the screen drifts from the product
silently — and here that is worse than a stale promise, because a branch would
be told a write is frozen when it is not.

That is the seventh consolidation on this argument: D127 one `GROUP BY role`,
D128 one LIKE escaper, D130 one definition of open, D131 one count, D138 one
definition of what freezes an ADMIN, D140 one zone formatter, D142 one
definition of what freezes a BRANCH.

### A defect this change introduced, and the fixture that caught it

The first draft selected `status, suspended_at, suspended_note` in one
statement, which reads as tidier. On any database whose `branch_licence` is
narrower than migration 256 that throws `no such column`, the gate's existing
catch reads it as *"unreadable, so not suspended"*, and **a branch HQ suspended
goes on trading.** The freeze test went 200 where it had been 423.

The decision is made on `status` alone now, exactly as before, and the reason is
fetched afterwards in its own try: **a copy that cannot say why it is suspended
is still suspended.** This is D133's lesson arriving from the other side —
there, fixtures narrower than the schema made a present row read as absent; here
one made an enforced freeze read as lifted.

**Two stand-ins were narrower than the thing they stood in for**, and both are
widened: the fixture's `branch_licence` was two columns, and the test app's
`onError` hand-built `{detail}` under a comment promising it could not drift
from production — it had, the moment the refusal grew a `code`. It calls the
real body builder now. The structural test also walked only the **first** gate
per file, which was fine while every file had one; events and circles now have
two and four.

### S13 — the payload written, never read, and never cleared

`SupportRedeemPage` has written `localStorage.supportSession` since D120 under a
comment saying it is *"stored for the banner"*. That key occurred **exactly
once** in all of `frontend/src` — the setter. No reader, and nothing removed it:
`clearSession` purged five keys and left this one, so the blob outlived the
thirty-minute session **and** outlived sign-out on that browser. A banner built
on it naively would have told the branch user's *next ordinary session* that HQ
was inside their account.

`lib/supportSession.js` owns the key, expires the payload against its own
`expires_at`, clears it on the way past, and is what `clearSession` calls — so
the purge and the reader cannot be renamed apart.

**And what rendered before was worse than nothing for an admin target.**
`isImpersonating = !!realUser`, which a support session never sets (the operator
is a row in HQ's database this deployment cannot read), so supporting a branch
**admin** mounted `PortalSwitcher`'s ordinary purple bar with a working View-as
picker — an HQ-driven session dressed as the admin's own — and supporting anyone
else rendered nothing. `HqSupportSessionBar` mounts **above** `PortalSwitcher`,
and the test asserts the order, so that bar can never be the only chrome on a
session the viewer did not start. It has **no dismiss control at all**, unlike
the frozen bars: it describes something still happening, not a refusal that
already finished.

### The false claims, re-counted rather than trusted

An earlier pass recorded "six false claims plus two tests". Re-measured against
this tree there is **one** genuinely false attribution —
`branch_escalations.ts` credited *PR 5* with shipping the banner, which it
never did — and it is corrected. The others (`branch_approvals.ts`,
`util/branch.ts`, `BranchApprovals.jsx`, and the two test comments) were
forward-looking sentences about what the banner tells a branch to do, and D142
makes them true rather than needing deletion. **The count is what the code says,
not what a previous note remembered.**

### Not built, and stated rather than left looking overlooked

S13's *"audit line it leaves"* panel. Every reader of `impersonation_sessions`
is an HQ route (`admin.ts`, `admin_cohort.ts`, `admin_security.ts`); there is no
branch-side read of the branch's own rows, and D122 made those rows close
correctly but gave nobody on the branch a way to see them. The canvas's
justification is exactly right — *"the branch database is what was read, and a
tenant should not have to ask HQ what was done to it"* — so it is filed as its
own route rather than faked from the client's own stored payload, which knows
only about the session it is in.

**No migration — 267 stays free.** No new `/api/*` method, so `check-api-drift`
has nothing to say. `frontend/src` moves, so `docs/` is rebuilt.

## D143 — a breached HQ SLA tells somebody, and the guard learns the column it was missing

**Context.** `hq_escalations` (migration 259) is how a branch asks HQ for
something it cannot decide alone — moderation, brand approval on localised
content, a seat increase. Every row carries a `due_at` computed from the kind's
SLA band (`SLA_HOURS`, `rpc/hqOps.ts`), and `slaBand()` derives `ok` /
`due_soon` / `past` from it on every read, so S3 and H1 both draw the band and
both draw it correctly.

**Nothing acted on it.** `due_at` had no reader anywhere in the scheduled
handler. A subsidiary that escalated something and heard nothing was waiting on
an answer no clock was chasing: the badge turned red and the silence was the
whole feature. Filed as one of the eight licence-area defects in D139 and
deferred there as its own concern, which is what this is.

**The decision: a breach notifies HQ.** A sweep in `services/`, on the existing
`* * * * *` trigger at a fifteen-minute cadence, through `notify()` with
`category: 'compliance'` — the category `notify.ts` and `TemplateCategory` have
both carried since D135, so this needed no new plumbing. It never answers an
escalation; it reports that a deadline passed, and answering stays a deliberate
act on `PATCH /api/admin/escalations/:uid`. That split is the same one that makes
the compliance ladder's automatic half safe to run on a clock.

### The finding that shaped it, which is not the one in the task title

`hq_escalations` carries **two timestamp formats in one row.** `created_at` and
`updated_at` default to `datetime('now')` — SQLite's `YYYY-MM-DD HH:MM:SS` —
while `due_at` is written from JavaScript as ISO-8601
(`new Date(...).toISOString()`, `rpc/hqOps.ts`). So the obvious predicate,
`due_at <= CURRENT_TIMESTAMP`, compares two different text shapes. It does not
fail: `T` (0x54) sorts after a space (0x20), so an ISO stamp compares GREATER
than a SQL one naming a later instant, and the sweep silently skips every breach
until the UTC **date** rolls over and the date prefix starts deciding. That is
the bound-parameter defect class that has bitten the magic link, the support
code and two trust sweeps.

**And the guard could not see it.** `scripts/check-timestamp-comparisons.mjs`
watches a fixed `TTL_COLUMN` list with no allowlist by design — a column outside
it is a column nobody is watching. `respond_by` is on that list because D135
obeyed the guard's own header when it created the column
(*"Adding the name here and the column there in one commit is what keeps that
true"*). **`due_at` was not**, so the guard watched every deadline column except
this one, on precisely the sweep it exists for. D143 adds it, in the same change
that gives the column its first reader.

The sweep itself wraps **both** sides — `datetime(due_at) <= datetime('now')` —
which normalises either stored format to one, so the comparison is correct
whichever way a row was written. The guard's negative lookbehind blesses exactly
that shape, and `complianceLadder.ts` already uses it one table over.

### Two things that read like mistakes and are not

**The claim is a column, not a state flip.** Every minute-cadence sweep in this
repo is idempotent by construction — the WHERE matches only rows in the
pre-transition state — and reserves a ledger row for side effects that are not a
state flip. Sending mail *is* such a side effect, and here there is no flip to
hang it on: a breached escalation is still `open` afterwards, because a breach
does not answer it. Adding a `breached` status would have been worse, not
better: it would drop the row out of `openEscalations()`, which reads
`status = 'open'`, so a breach would have hidden the very thing it was reporting.
Migration 267's `sla_breach_notified_at IS NULL` is the claim, and the
conditional UPDATE is what makes owning it atomic.

**It stamps the sweep's own clock, and that honours the D122 rule rather than
breaking it.** `complianceLadder.ts` states the rule for `froze_at`: stamp the
computed deadline, never the sweep's clock, because the account stopped being
able to write at `respond_by` and recording the sweep's clock would make the
audit late in the direction that flatters the operator. Here the act being
recorded is the **notification**, which genuinely happened when the sweep ran,
and the breach's own moment already has a column — `due_at`. Both stamps say
when their own event happened, which is the rule, not an exception to it.

A consequence worth stating: **the cadence is visible here in a way it is not in
the ladder.** D135 can run every five minutes and say the interval affects
nothing a row says. This sweep's whole output is a message, so the interval *is*
the worst case for how late HQ hears — fifteen minutes against an SLA measured
in hours, which is slack of about a percent.

**A send that fails does not un-claim the row.** Re-claiming would re-warn on
every subsequent pass, turning one unreachable mailbox into an unbounded stream.
The failure is logged and the row stays reported.

**Not gated on `hqCadences`**, on the D122 precedent and for its stated reason: a
branch holds none of this table's rows, so the predicate is the tier
discriminator and a better one — it selects rows by what they are, not by which
deployment is asking.

### Measured before writing

Read-only against production `studioos-db`, aggregates only: `hq_escalations`
holds **0 rows**, 0 of them open, 0 with a `due_at`. So migration 267's `ALTER`
copies nothing, which is both why it is safe and why now is the cheapest moment
it will ever have. The ledger carries 269 rows against 269 migration files on
disk — nothing pending, nothing orphaned. Zero branches are provisioned, so no
escalation has ever been raised and the silence has harmed nobody; this is a
**latent** defect that fires on the first real use of a shipped surface, and the
entry does not claim an incident.

**Migration 267 is used, against D142's "267 stays free" — which was true when
D142 was written.** No new `/api/*` method, so `check-api-drift` has nothing to
say. No `frontend/src` change, so `docs/` does not move.

## D144 — the inbox had everything except an address

**Context.** `services/notify.ts` builds `${root}/inbox` into every notification
email it sends, under a comment describing *"the in-app inbox at `/inbox`"*.
`App.jsx` registered **zero** `/inbox` routes. So every notification email
carried a link to a 404 — filed as a dead CTA in D139's list of eight, and
deferred there as its own concern.

**Re-measured, the filing was wrong about what was missing.** The in-app inbox
is built and has been mounted in the shell all along:
`components/NotificationBell.jsx` reads `api.listNotifications()`, renders the
rows, marks one or all read, and navigates per row. Every worker route behind it
exists — `routes/notifications.ts` mounted at `/api/notifications`, with `GET /`,
`/unread-count`, `/mark-read`, `/read-all`, `/:id/read` and `DELETE /:id` — and
both `api.js` methods exist and are consumed.

**What was missing is a URL.** A dropdown does not have one, and an email CTA
needs one. That is the entire gap, and it is why D144 is a **page**: no
migration, no new `/api/*` method, nothing for `check-api-drift`, and no edit to
`notify.ts` — the link it already writes becomes true the moment the route
exists.

### The consolidation is the point, not the page

The obvious way to build the page is to write the rows again. That is the thing
to avoid, and `frontend/src/lib/README.md` already states the rule: *"If a
helper appears in two places, put it here once rather than a third time."* Two
renderings drift, and what they would drift about is **what a person believes
they were told**.

So `components/NotificationList.jsx` is the rows, **lifted out of the bell
rather than copied**, and both the bell and `/inbox` render it. Deliberately
with no `variant` prop: the dropdown is narrow and the page is wide, the same
row reads correctly in both, and giving the page its own row shape would re-open
exactly the gap the component closes. The test asserts neither caller declares a
row of its own.

Eighth consolidation on this argument — D127 one `GROUP BY role`, D128 one LIKE
escaper, D130 one definition of open, D131 one count, D138 one definition of
what freezes, D140 one zone formatter, D142 one freeze list, D144 one
notification row.

### A second defect, found while lifting

`NotificationBell`'s load had `catch { setItems([]); }`, and an empty list
renders *"You're all caught up."* So a failed read told the reader their inbox
was empty — a claim about the store that nothing measured, and the same
honest-absence rule this repo applies everywhere else. The list now renders
three distinct states — loading, unreadable, empty — and **both** callers
distinguish them. The page also offers a retry; the bell re-reads on next open.

**The bell gains a link to the page.** A surface reachable only from an email is
one that gets built and then never found.

**Route roles include `exploring`**, which is not an oversight: an application
decision arrives as a notification, and the person waiting on one holds no other
role.

**No migration — 267 was used by D143 and 268 is free.** No new `/api/*` method.
`frontend/src` moves, so `docs/` is rebuilt.

## D145 — terminating a licence now deprovisions the people who administered it

**Context.** `POST /api/admin/licences/:uid/terminate` released the territory,
set `status = 'terminated'`, recorded the event, and — since D139 — withdrew the
licence's open compliance notices so the ladder stopped freezing administrators
over a licence that no longer existed. It never touched `users.role`,
`licence_admins` or `is_active`.

So after a termination its administrators still held `role = 'admin'`, bound to
a licence that had been ended. **That is the unscoped admin D134's door was
built to make unreachable, arriving through the back** — D134 made promotion
licence-bound by construction precisely so no path could produce one.

**The decision: revoke and unbind, keep the record.** Per administrator, in one
batch: `role = 'exploring'`, `is_active = 0`, and the `licence_admins` row
deleted. The account, the audit and the licence's history all survive —
"terminated" here has always meant role revocation and deactivation, never
deletion, because no account of any role can be deleted anywhere in this
codebase and the audit depends on the rows staying.

### Three things the code decided differently from the plan

**1. One floor, not two — and `admin.ts` had already argued why.** The plan
named two: never demote a `super_admins` holder, and never demote the last
active admin. The first is real and is enforced: the elevation sits **on** the
admin role, so demoting its holder leaves it pointing at a non-admin, which is
the same reason `POST /users/:userId/demote-admin` refuses that target.

The second was **not** added, and the demote route's own header already
explains it — it retired exactly that check for exactly this reason: *"the count
can never be zero, because the caller has just passed `requireSuperAdmin` …
So at least one active admin — the caller — always survives, by construction.
The floor holds; the check that claimed to hold it was dead, and a conjunct that
cannot be false is not a guard."* The terminating actor is a super admin, is
active, and cannot be one of the licence's administrators being demoted. Adding
the floor here would have been re-introducing the dead conjunct one file over.

**2. The order is `notify` → `deprovision`, and that is load-bearing.** The
existing comment above `notifyLicenceAdmins` says the administrators are still
bound at that point *"so the lookup still finds them"*. Deprovisioning first
would send the "your licence has been terminated" mail to nobody, because the
bindings are how the recipients are found.

**3. An unreadable `super_admins` demotes NOBODY — it fails closed.** The
asymmetry is deliberate. Failing open would risk stripping the elevation's
holder of the role it sits on, which is not recoverable through the API; failing
closed costs a manual cleanup. The termination itself is recorded either way and
the reason says so.

### What it deliberately does not carry over from the demote route

`seedObligations(..., { pruneStaleForRole: true })` **is** called, so the
admin-only trust obligations are waived rather than deleted and the audit
survives — the same call the demote route makes. `resetExploringReview` is
**not**: it is module-private to `routes/admin.ts`, and more to the point these
accounts are being deactivated, so they are in no review queue to reset.
Reactivating one is a deliberate act that goes through the role route and its
own bookkeeping.

**No extraction of the demote route's body.** Sharing one definition was
weighed — it is the pattern this repo has taken eight times — and rejected here
because `resetExploringReview` is private to a live, carefully-documented route,
and moving it would widen a licence fix into a refactor of the admin lifecycle.
What is shared instead is the *value that matters*: both paths write
`role = 'exploring'`, and both write `role_changed` / `your_role_changed` rather
than a new action name, because a distinct action would be invisible in
`admin_security.ts`'s allowlist and `ActivityPage`'s label map until three
sweeps had been done.

**Reported, never thrown** — D139's shape on D111's precedent, returned as
`admins_deprovisioned` beside `notices_withdrawn`, per account with its reason.
A recorded termination must not be undone by a failure in the cleanup after it.

**No new `licence_events` value**, and a test pins that: widening migration
187's CHECK needs a migration, which is what D139 learned the expensive way.

**No migration — 268 is free.** No new `/api/*` method. No `frontend/src`
change, so `docs/` does not move.

## D146 — the coverage grid gets its sort and its click, and a comment stops contradicting its own guard

**Task #241. The title is wider than the work, and the canvas said so before I
did.** `#241` reads "the nav naming and H2's coverage-grid sort and open-licence
click". `design/canvases/integrated/Admin · Super.dc.html` carries its own
changelog, and it settles the scope better than the task title:

> `{ where:'H2', what:'Coverage grid: sort control and open-licence affordance',`
> `why:'Held-active, held-suspended and white space were already the three`
> `states; **the sort and the click are the additions.** Renewal pipeline`
> `already carried days and fee.' }`

So H2's three states and its renewal pipeline shipped in D110 and are untouched
here. Two things were missing, and the third item — the nav — turned out not to
be about the nav at all.

### 1 · The grid had no sort

`coverageCells()` emits the 27 cells in `EU_CODES` order and `Coverage` rendered
them straight through. The canvas draws a two-option control, `mapSort:
['By state','A–Z']`.

`sortCells(cells, mode)` is a **pure exported helper in
`lib/licenceCoverage.js`**, not a comparator in the component, because what
order the grid is in is a fact about coverage and that file already owns the
other two — which cells exist, and what state each one is in. A comparator in
`Coverage` would have been the third place that has to know what
`held_suspended` means.

**`'az'` is the identity, not a second sort.** `coverageCells()` already emits
alphabetical order, so `'az'` returns the cells as they came rather than
re-deriving an order that is already true — and `'state'` breaks its ties by
leaving that incoming order alone, which `Array.prototype.sort` guarantees
because it is stable. That is what makes the two options agree by construction
wherever state does not decide, instead of by two comparators that have to be
kept in step.

**"By state" ships selected, and that changes what the grid opens as.** The
canvas styles the first segment as chosen and the first segment is "By state",
so this is a visible change and is meant to be. It also serves the zone's own
stated purpose: `licenceCoverage.js`'s header says the white space is the point,
and in code order the free cells are scattered through 27 tiles and have to be
counted — grouped, they are one block whose size reads at a glance. *Strike it
and the initial state goes back to `'az'`: one word.*

### 2 · Clicking a held cell did nothing

Every cell was a plain `<div>` with a `title`. **No data change was needed** —
`coverageCells()` already puts `licence: { uid, … }` on every held cell — and the
mechanism already existed one screen down, where the licence rows are
`<button type="button" onClick={() => setSel(l.uid)}>`. `Coverage` closes at 1470
and `AdminLicences` opens at 1472, so the call site is inside the component that
declares `setSel`; `onOpen={setSel}` needed no lifting and no context. A click on
a held country and a click on its row now land in exactly one place.

**Free cells stay `<div>`.** There is nothing to open behind a country nobody
holds, and a button that refuses is the `still_an_admin` mistake D134 named — it
teaches the operator that some of this grid's controls are a lie.

### 3 · The nav rows were right; the sentence above them was not

This is the item the task title misdescribes, and it is worth stating because
the repo had the answer on both sides already. `sidebarConfig.js` shipped
**eleven** HQ rows. The comment directly above them said *"The approved canvas
has eight rows … All eight resolve today"*, omitting Revenue, Content and
Platform — **the three rows whose own explanatory comments sit a few lines
below it**. And `super_admin_shell.test.mjs` has a test literally named *"all
eleven rows are present, in canvas order"* that `deepEqual`s all eleven.

So a guard said eleven, a comment said eight, and they described one array in
one repo. The array was never wrong. **A comment that a guard already
contradicts is the cheapest kind of false claim to leave lying around and the
most misleading to read** — the same class this programme deleted in D129's seat
store, D131's six blocks and D140's adjustable dates, one layer down. The
comment now names all eleven, and the guard asserts the *sentence* contains each
one, so a future count cannot go stale the way this one did without failing.

`AdminLicences.jsx:3` also cited the canvas's `"Licenses"` nav row; the canvas
now spells it Licences, and so does the comment.

**No migration — 268 is free.** No new `/api/*` method, so `check-api-drift` has
nothing to say. `frontend/src` moves, so `docs/` is rebuilt through the root
build.

## D147

**HQ's master template library reaches a branch, and the branch says what the
copy is** — `publishTemplate`, the first of the two producers F.5 specified and
nobody built (#234's S5/S10 half; migration 268).

### What was actually missing, and two filed claims that did not survive measurement

`publishTemplate` had **zero occurrences** in `cloudflare-worker/src`. So
`/branch/contracts` rendered a notice naming three things and the tier had no
way to produce any of them. That much was right.

**The second "live defect" behind this task is STRUCK — it was a
mis-attribution.** The filed note said *"`GET /api/legal/templates` does not read
the template store at all; it maps a hardcoded in-module `TEMPLATES` constant."*
True, and not a defect: `routes/legal.ts`'s `TEMPLATES` is the founder
**incorporation-kit** generator — `layer`, `content`, `fillContent`,
`JURISDICTION_TEMPLATES` — a different family from `legal_templates`, HQ's master
**contract** library. And the generation path already prefers the D1 store:
`getActiveTemplateBody(env, tkey)` first, the inline body only as the documented
fallback. Nothing there is wrong.

**The first defect is real and far narrower than filed.** `templates_reason` in
`admin_licences.ts` says *"HQ has authored no master templates yet."* Its route
is `requireSuperAdmin`, which on a branch answers **"HQ only"** (D106), so a
branch never reads that sentence; and on HQ migration 085 seeds **66** rows (the
note said 67), so `listTemplates()` is never empty and the reason never fires. It
is dead copy, and it is reworded here rather than sold as the motivation.

### The store: a `branch_*` copy, not columns on `legal_templates`

A branch **already has** `legal_templates` and `legal_template_versions` — both
are in `schema_baseline.sql`, so a bootstrapped branch gets them empty, and
`services/legalTemplateStore.ts` carries a lazy `CREATE TABLE IF NOT EXISTS` on
top. What it lacks is a `pushed_at`. Adding `source` and `pushed_at` to
`legal_templates` would have meant editing a migration **and** a runtime
bootstrap in lockstep — the `metrics_snapshots` collision (#183, #202), one table
with two definitions that disagree depending on which ran first — and it would
have put HQ's copy in the table a branch is refused write access to, so
`requireHqAuthoring` would be the only thing separating the two.

So migration **268** adds `branch_templates` and `branch_templates_sync`, on the
rule migration 256 already set: *a pushed copy lives in its own `branch_*` table
with its own `pushed_at`* — `branch_licence`, `branch_promo_ceiling`,
`branch_benchmarks`, and now this.

### Three things the copy deliberately does NOT carry, each with its measurement

1. **`body_md`.** Nothing on a branch renders or instantiates a template body:
   S5's picker shows the library, and `licence_contracts` (migration 259) is
   HQ's table behind `requireSuperAdmin`. A body column with no reader is the
   store-built-so-a-page-looks-complete mistake this programme has deleted four
   times (D129's seat store, D131's six blocks, D140's adjustable dates, D141's
   invented bindings). When instantiation lands it is one additive `ALTER`.
2. **`is_active`.** S10 draws archived versions as *"visible and unusable"*, and
   **HQ cannot produce that state**: `listTemplates` filters `is_active = 1`, so
   HQ's own library shows only active templates, and the contract route's own
   comment says *"the current version is the only one HQ is offering today."* A
   column here could only ever hold 1, and the page branch rendering a 0 would
   be code production never reaches. `version` carries the true statement.
3. **A version history.** Pushing every historical row so a picker could grey
   them out would model a choice HQ refuses to make.

### The write is a reload, and the two forms tried before it were both wrong

A library is a **set**, so a push that only inserted and updated could never say
*this one is gone* — a template HQ withdrew would stay offerable on every branch
forever. Two SQL forms for that withdrawal were written and discarded:

- `DELETE … WHERE slug NOT IN (…)` builds its placeholder list with `${…}`,
  which lands in the query **text** where no binding protects it.
  `check-sql-prepare` refused it, correctly.
- `DELETE … WHERE updated_at < ?` against this push's own stamp **looks** exact
  and is not: two pushes inside the same millisecond share a stamp, the
  comparison is false for every row, and nothing is withdrawn. The test that
  found it was **flaky rather than failing**, which is worse than either — a
  silently inert sweep that passes most runs.

So the write is a reload — `DELETE`, then insert what HQ sent, then the sync row
— in one `DB.batch`, which runs as a single transaction: the `DELETE` only takes
effect if every `INSERT` after it does, so a push that fails part-way leaves the
previous library standing rather than an empty picker. The withdrawn count is a
set difference computed in JS, because a before/after total is wrong the moment
a push both adds and withdraws.

### `branch_templates_sync` exists so two absences are two sentences

An empty `branch_templates` means either *HQ pushed a library and it was empty*
or *HQ has never pushed*, and only the first is a statement about HQ. The sync
row is written in the same batch as the library, so its presence **is** the fact
that a push happened. D107's `licence_not_pushed` is the precedent: an empty copy
and an absent copy are two claims, not one. The route renders three states —
unreadable, never pushed, pushed-and-empty — and the test asserts the ordering,
because a never-pushed branch tested *after* the empty-list branch can never be
reached.

### The HQ half is in this PR, or the producer has no caller

`POST /api/admin/contracts/templates/publish` (`requireHqAuthoring`) reads
`listTemplates(env)` and fans out through `services/branches.ts`, **reported and
never thrown** — D111's rule, the shape an escalation answer and a licence
transition already use: HQ's library is HQ's whether or not a branch answered,
and a 502 for one unreachable branch would tell an operator that a push to the
other three did not happen. `AdminTemplates.jsx` gains the control. A producer
whose only caller is a test is the defect being fixed, one level up.

**Zero branches is a real answer.** `fanOut` over an env with no `BRANCH_*`
binding returns `[]`, and the route answers `branches: []` with its own
`branches_reason` — supplied by the **server** so the page cannot drift from it,
and the test refuses a second copy of that sentence in the SPA.

### No authoring control on the branch page, and the refusal is stated

D.9 puts authoring at HQ; `requireHqAuthoring` already enforces it server-side.
A greyed pencil here would be the `still_an_admin` mistake D134 named — a control
that exists to be rejected teaches the operator that some of its buttons are
lies. The page says what changing a template actually is: a Content submission.

### Still not shipped, and named rather than drawn

**S5's Active contracts and Pending signature.** `licence_contracts` is HQ's
table and every route over it is super-admin-only, so a branch has no contracts
read of its own. The block states that with its reason instead of rendering an
empty ledger under a heading that implies rows are coming.

**Migration 268** is used; **269 is free.** One new `/api/*` method each side,
both with their routes in the same commit. `frontend/src` moves, so `docs/` is
rebuilt through the root build.

## D148

**What HQ can honestly publish a median of, and the branch's one tick** —
`applyBenchmarks`, the second producer F.5 specified and nobody built. Closes
**#252**: `branch_benchmarks` was created by migration 256 and had neither a
writer nor a reader.

### The threshold is three, and the reason is arithmetic rather than policy

Migration 256's header says HQ *"withholds the row entirely below its own
k-threshold"* and does not say what k is. It has to be **3**:

| n | why it is not enough |
| --- | --- |
| 1 | the median **is** that branch's figure, published under a name that hides whose it is — the "never another branch's figure" the same header forbids |
| 2 | the median is the mean of the two, so a branch that knows its own number subtracts it and reads the other's **exactly** |
| 3 | the smallest n at which no single branch is recoverable from the median plus its own value |

`MIN_BRANCHES` is one exported constant carrying that argument in its own
header, and the test reads it rather than restating it. The threshold is applied
**per metric**, not once per fan-out: a branch can answer and still have no
readable backlog, and a median over two of three branches is exactly as
recoverable as a median over two of two.

### What can honestly be medianed — measured, not chosen from the canvas

S6 draws four stats. Read against `branchOverview()` — the only cross-branch
call returning comparable per-branch numbers — exactly **three** of its fields
are measurements and one is not:

| field | publishable? |
| --- | --- |
| `accounts.total` | ✅ a count of active accounts |
| `seats_used` | ✅ a count, with its own stated basis (D127) |
| `backlog[].count` | ✅ the four local queues (D130) |
| `revenue_mtd_cents` | ❌ **`null` by construction**, with its own reason — and `branchRevenueSummary` agrees: every stream it returns is `available: false` |

Activation and programme throughput have no branch-side read anywhere. So
**three of S6's four drawn stats cannot be benchmarked**, and the page states
that instead of deriving them. Revenue is the interesting one: the *rate* is on
the pushed licence and the *amount* is not knowable on a branch — subscription
charges live in the Stripe API and a subsidiary charges no onward licence fee —
so a rate times a number nobody has is not a figure.

### An unreadable branch is excluded from n, never counted as a zero

`fanOut` returns three states and the middle one gets forgotten: `unreadable` is
not a claim that the branch is down. A branch that did not answer contributes
**nothing** — not a zero, which would drag every median toward the floor and
make the platform look worse the flakier its network is. `n_branches` is the
count that **answered**, and it travels with the median so the screen says "of
N". The test seeds four branches with one throwing and asserts the median is 20
rather than 15, so counting a silence as a zero fails.

### The write is a reload, for the reason D147's was

A benchmark set is a **set**: a push that only upserted could never retire a
metric HQ stopped publishing — and a metric withheld *because it fell below k*
is precisely the one that must disappear rather than linger at its last value, a
median the screen would go on asserting after HQ stopped standing behind it.

### The cron is gated on `hqCadences`, which is the opposite call from its neighbours

D122, D135 and D143 each deliberately **refused** that gate, because those
sweeps act on **this deployment's own rows** and their `WHERE` clause is the
better tier discriminator. This one is the other direction: it **fans out**, and
a branch has no branches. The gate and the function agree rather than one
covering for the other — `publishBenchmarks` refuses on a branch outright. Daily
at 04:55 UTC on the existing `* * * * *`, **no new cron expression**: every
published row carries its own `period` and HQ's `pushed_at`, so the cadence
bounds nothing a row says, and an hourly recompute of a quarterly figure would
be N remote calls an hour to move a number that moves in weeks.

### With zero branches this publishes nothing, and that is the deliverable

The fan-out returns `[]`, `withheld_reason` says why in the branch's own terms,
and the cron logs *withheld* rather than a success with zero rows. The branch
page renders the absence with the same argument. That is the D129 / D131 / D140
/ D147 pattern for a fifth time: ship the truth and state what is missing,
rather than a tick against a median of one.

### One defect the tests found rather than review

`median()` sorting with the default comparator — `[9, 10, 11].sort()` is
`[10, 11, 9]` and the median comes back **11**. It only shows up once a value
crosses a digit boundary, which is exactly the class that survives a small
fixture, so the comparator is explicit and the fixture crosses one.

### Two assertions were re-aimed rather than the code changed

A banned-word scan for `rank` **failed on correct code**: it forbids the page's
own sentence *"never a ranked list"* — the refusal itself. A lexical scan cannot
tell a rule from its violation, so the assertion is structural now: `BenchmarkRow`
carries no field naming a branch, so a ranked list is **unrepresentable** rather
than merely absent. The route-window assertion took a fixed 400 characters and
reached into the next route's notice; it is bounded by the next `<Route` now,
and asserts the window actually contains its own element.

**No migration — `branch_benchmarks` is migration 256's and 269 stays free.**
One new `/api/*` method with its route in the same commit. `frontend/src` moves,
so `docs/` is rebuilt through the root build.

**Still not shipped: S11 Settings.** `/branch/settings` keeps its notice. Owner
chips per row are a different artboard from a benchmark, and the licence summary
they would frame is already readable at `/admin/my-licence`. Filed as the
remainder of #234.

---

## D149 — three HQ figures that did not show their own state (#242)

**Date:** 2026-09-17 · **Scope:** `frontend/src` only. No migration, no worker
change, no new `/api/*` method — every field rendered here was already on a
payload the page fetched.

#242 is "audit H8, H10 and H11 against their new artboards". Its scope came
from the canvas's own changelog rather than the task title, which is the third
time running that has corrected a task, and the audit split it into work of
very different sizes. This takes the part that is render-level and honest
today; the rest is filed below with its measurement.

### 1 · H8 — a failed deployment rendered exactly like one nobody had started

`AdminLicences.jsx`'s deploy timeline had the canvas's eight steps with
matching labels and drew them `const done = at >= 0 && i <= at` — a check or an
empty circle. Two states for three, and `failed` is **not one of the eight
steps** (migration 258's vocabulary is `requested … linked` plus `failed`), so
`at` was **-1** and every one of the eight steps rendered blank. A deployment
that failed was byte for byte a deployment that had not begun; and a run still
working on step 4 was byte for byte one that failed after step 3.

Two different states drawn the same way is this programme's recurring defect —
D107's empty-vs-absent licence copy, D128's tile-vs-table, D147's
never-pushed-vs-pushed-empty — and it is the fourth time.

**What is drawn is bounded by what the store holds, which was measured rather
than assumed.** `licence_deployments` carries ONE `status` and ONE
`status_note`, with no per-step history. So:

| the canvas draws | shipped |
| --- | --- |
| a per-step state | ✅ `ok` behind the step reached, `wait` ahead of it |
| the summary *"N of 8 complete · M waiting"* | ✅ from the same |
| a per-step **note** | ✅ for the deployment, labelled as the deployment's |
| a per-step **time** | ❌ **stated, not drawn** |
| which step a failure happened at | ❌ **stated, not drawn** |

The two ❌ rows are said on the page — the D140/D147 rule. Deriving seven
timestamps from the one `requested_at` is the class of figure this file exists
to refuse.

**A failed step reads `unknown`, never `fail`, and the word matters.** `status`
was overwritten with `'failed'`, so the progress it had reached is gone. Marking
all eight `fail` would claim the request was never even made, while the row
saying it was is right there — replacing one false statement with another.

### 2 · H10 — `owed` rendered without the rate it was computed from

H10 is otherwise shipped, and in one place better than the canvas: where the
canvas draws a bare `{{ p.issued }}` the promo table renders `<Unrecorded/>`
with its own reason. The one gap is the canvas's `× {{ h10SharePct }} owed`
column. `owed` is `gross × revenue share`, computed server-side by
`drawStatement`, and it rendered as a bare number — so an operator disputing a
statement had to open the licence to check it. **The rate was already on the
row**: `admin_statements.ts` declares and writes `revenue_share_bps` precisely
so a statement records the rate it was drawn at rather than the rate the licence
carries today.

A licence with no rate recorded prints **no rate**, not `× 0%` — the clause
drops, `zoneFilterBuilder`'s rule one surface over. `× 0%` beside an owed figure
says HQ is owed nothing.

### 3 · The consolidation that forced, and the count was wrong by half

Rendering that rate needed bps → percent, **which already existed six times**.
The task filed three; three is what a scan keyed on one body finds, and the
other three had each written their own format:

| site | name | drift |
| --- | --- | --- |
| `pages/admin/AdminLicences.jsx` | `pct` | — |
| `pages/subsidiary/MyLicencePage.jsx` | `fmtBps` | — |
| `pages/NeedsBoardPage.jsx` | inline | — |
| `pages/CompanySettingsPage.jsx` | inline | no trim: 150 bps read **"1.50%"** |
| `pages/IntroductionsPanel.jsx` | `feePct` | `toFixed(bps % 100 ? 2 : 0)`: 3550 read **"35.50%"** |
| `pages/NetworkEffectsPage.jsx` | inline | `toFixed(0)`, which **rounds a rate** |

So one 3550 rendered "35.5%" on three surfaces and "35.50%" on a fourth. The
last is latent only — `COMPOUNDING_BPS` is `[10000, 5000, 2500]`, every value a
whole percent — but a formatter that rounds a rate is one non-round value from
misreporting one. `frontend/src/lib/bps.js` is now the one definition; D127 one
`GROUP BY role`, D128 one LIKE escaper, D130 one definition of open, D131 one
count, D138 one definition of what freezes, D140 one zone formatter, D142 one
freeze list, D144 one notification row, and this is the **ninth**.

**It splits the way D117 split `text` and `titleCase`**: the helper returns
`null` for an absent value and does arithmetic only, and each page keeps its own
absent copy — `'Not recorded'` on `MyLicencePage` to match the eight absences
around it, `'no rate recorded'` on `IntroductionsPanel` beside its own "no
economics attached". **A fallback is a human-written sentence.**

**AND THE MOVE IS ALSO A CORRECTION.** None of the six guarded the empty
string: `Number('')`, `Number('   ')` and `Number([])` are all **0** and all
finite, so a `Number.isFinite` test alone renders a value nobody recorded as
**"0%"** — on a revenue share, the statement that a branch owes nothing. The
first draft of the guard listed the empty string by name and `[]` walked
straight through, which is why the rule is the **type** and not the value.

**Two strings change, and they are named rather than absorbed:** a carry of 150
bps now reads "1.5%" where the toast said "1.50%", and a referral fee of 3550
reads "35.5%" where the panel said "35.50%". Whole percents are unchanged
everywhere, so the other four surfaces render exactly what they rendered.

### The derivation was lifted so the fix could be tested at all

`DEPLOY_TIMELINE` and the new `deployProgress` live in
`frontend/src/lib/deployTimeline.js`, on `sortCells`'s precedent (D146): which
steps a status implies is a fact about migration 258's vocabulary, not about a
layout. It is also the only way the central assertion can exist — **a source
scan over the page can see that three markers are written and cannot see that a
running deployment and a failed one now differ**, which is the entire defect.
`hq_licences_h2h3.test.mjs` follows the list to its new home with its
assertions unchanged, which is what proves the move was a move.

### Filed rather than folded in, each with its measurement

- **H11's publish confirmation** — *"Publishing v3.2 notifies N branches on
  older versions."* D147 built the push this would count; the **pre**-publish
  count needs a branch-side `templateVersions()` on `HqEntrypoint` that does not
  exist. That is a producer, not a render.
- **H11's rollout percentage and Roll back.** Measured: **zero** occurrences of
  `Roll back`, `rollout` or `Open diff` in `frontend/src`, and no rollback route
  in the worker. It is a Cloudflare versions-API operation — F.8 item 5's
  gradual deployments — blocked on the widened `CLOUDFLARE_API_TOKEN`. Drawing a
  Roll back button that cannot roll back is the `still_an_admin` mistake D134
  named.
- **H8's "link to Platform" beside the credential block.** The block itself was
  already shipped and is better than the canvas draws it: the Deploy button
  disables on the server's `dispatch_available` and renders the server's own
  `dispatch_reason`, rather than offering a control that 409s. The link is not
  added, because the credential is a Worker secret set outside the app entirely
  — a link to Platform would suggest the fix lives there.

**No migration — 269 is still free.**

---

## D150 — HQ Home refused figures the server was already sending it (#244)

**Date:** 2026-09-17 · **Scope:** one SELECT and two type widenings in the
worker, plus `frontend/src`. No migration — **269 stays free** — and no new
`/api/*` method: both fields have been on the payload since D108.

#244 reads "HQ H13: the AI rail's scope chip, its cost line and its four
rules". Researching it before building — the fifth time running that has
corrected a task — found that three of those four parts cannot be built, and
that a sharper defect sits underneath on a shipped HQ screen.

### The defect

`GET /api/admin/hq/overview` computes and returns **`branches`** (the fan-out
over every `BRANCH_*` binding, each entry in one of D108's three states) and
**`branches_coverage`** (`{total, answered, complete, unreadable[]}`).
**`HqHomePage` read neither.** Its "Subsidiary health" zone was drawn from the
licence ledger alone, so **Accounts** and **MTD · backlog** rendered
`<Unrecorded/>` under a footnote saying they *"need every account to name its
licence; none does yet"*.

**That reason was never the blocker for a branch.** U1 is a fact about HQ's own
database. A branch is a separate Worker over a separate D1 (D.2), so every
account there is that branch's **by construction** — which is exactly why
`branchOverview` can count them, why D148 could publish medians of them, and
why they were already on the wire. The page was refusing figures the server was
sending it.

**Three independent facts, not one reading:** the page contained zero
references to `branches` outside comments; `hq_home.test.mjs` contained zero;
and D108's own plan named two guards — `branch_rpc_fanout.test.ts` **and**
`hq_home_branches_h1.test.mjs`. The worker one exists. **The frontend one never
did.** The producer shipped and was tested; the consumer was not built, and
nothing was watching the gap.

Same class as **#252**, **D142** and **D149**. **Sixth instance.**

### What the fix needed that did not exist

A branch entry **could not be joined to a licence**. `deployedBranches` selected
`code, hostname, status` and not `licence_uid`, though migration 258 declares it
`UNIQUE`; `BranchResult` and `withRegistry`'s registry type carried none either.
So `licence_uid` is projected and threaded through — and `withRegistry` had a
one-word bug on the way: it `continue`d on any code it had already seen, so a
branch that **answered** never received the licence at all. The case a caller
most wants to join was the one the loop skipped.

**An unregistered branch keeps a null licence rather than borrowing one.** A
binding can exist before HQ holds a row for it, and guessing would attach one
territory's figures to another's contract — the worst thing this join can do.

### The three states are three sentences

`ok` shows figures **with the time the branch answered**; `unreadable` is
`<Unrecorded/>` with a reason and is **never a zero** — a silence read as zero
shrinks a total and makes the platform look worse the flakier its network is
(D148's lesson, one surface up); a licence with no branch has not been
deployed. Where the branch supplies its own reason (`seats_used_reason`,
`backlog_reason`) that sentence wins, because the server writes a better one
than the page can.

### H13 rule 3, which is the one rule of four that is real today

*"Unreadable is a word in the answer."* The rail summarises the coverage lines
beside it — `workspace_explain` runs over exactly those and deliberately not the
rows — so a line that omits an unanswered branch yields an answer that totals
over the rest in silence. `coverage()` already returns the unreadable branch
**codes**, so the line names them. With none deployed it says so instead of
counting zero: the D129 / D131 / D140 / D147 / D148 pattern for a sixth time.

### Three reasons that had outlived their blockers

Twelve of the fifteen `unavailable` rows across the five HQ rails are accurate.
Three were not, and are corrected rather than reworded:

- *"Revenue per subsidiary — that call is not built"* — **false**; D111 built
  `reportUsage` and `revenueSummary`. What is missing is that no branch has
  **reported** one.
- *"Seat utilisation — needs `seat_assignments`"* — half stale. D127 decided
  **against** that store and counts seats from `users.role`. What has no store
  is *which seat id* a person holds, so that is what the row now says.
- Security's *"no tenant-scoped view to return from; that is the same U1"* —
  wrong reason. The overlay is **unbuilt (#235)**, not blocked. Corrected in the
  payload, which is the one copy both surfaces render.

### The guards that were enforcing the refusal — THREE of them, and that is the number worth recording

`hq_home.test.mjs` **asserted** that Accounts and MTD · backlog render
`<Unrecorded/>`, and its header said *"None is computable"*. `hq_governance_h7.test.mjs`
required the overlay's reason to match `/U1/`. `admin_governance.test.ts` required
the same of the payload. All three failed on the fix, correctly, and each had to
follow its property rather than its wording.

**A guard that pins a refusal has to be re-aimed the day the refusal stops being
true, or it becomes the thing preventing the fix.** With D149's
`territory_licences.test.mjs` and `hq_licences_h2h3.test.mjs` that is **five
instances across two PRs**, which is enough to call it a class rather than a
coincidence: this programme deletes false claims for a living, and every false
claim it has shipped had a test holding it in place.

Three of this PR's own assertions were wrong first, and the mutation run is what
said so rather than review:

- a cell window of a fixed 420 characters **failed on correct code** the moment a
  cell grew a comment — D147's fixed-window trap, bounded by the next `<dt>` now;
- a negative scan forbidding the U1 sentence **failed on the comment recording
  why the sentence was removed** — *a lexical scan cannot tell a rule from its
  violation*, which is D148's `rank` scan exactly. It asserts what the footnote
  must **say** instead;
- and the re-aimed `hq_home.test.mjs` first asked only that the word `live`
  appear somewhere in each cell. A mutation replacing the gate with a constant
  `false` — the page hard-wired back to refusing, which is the whole defect —
  **passed it**, because `live?.…` survives in the fallback. It pins `{live &&`
  now. *An assertion that cannot fail on the defect it was written for is not a
  guard*, and the only reason this one was caught is that the mutation was aimed
  at it deliberately.

### Not built, each with its measurement

- **H13's scope chip as a control.** The page decides what it fetched before the
  rail runs, so both options produce the same read. A picker whose options
  cannot differ is the `still_an_admin` mistake D134 named and D138 refused for
  H9's Move modal.
- **Rule 2's per-scope cost multiplier** — one run, one price.
- **Rule 4's audit row** — the rail reads no branch, so logging it as a
  privileged branch read would write a **false** audit entry.
- **H13's "HQ margin, shown only on this tier"** — `ai_usage_logs.est_cost_usd`
  is a cost with no price beside it, and `admin_revenue.ts` already ships that
  refusal on H5. **Third time this canvas figure has had to be refused.**
- The canvas's *"What the scope changes"* panel is an **artboard explanation**
  beside two rail previews, not a UI element: the four rules govern behaviour
  and are not copy to render.

## D151 — three branch zones told the rail nothing, and the guard that names the rule watched the other tier (#246)

**Date:** 2026-09-17 · **Scope:** `frontend/src` only. No migration — **269 stays
free** — no worker change, and no new `/api/*` method: every field was already on
a payload the page already fetched.

#246 is "branch S12: the AI rail scoped to one branch, and the cross-branch
decline card". Measured before building — the sixth time running that has
corrected a task — **half of S12 had already shipped**, and the half that had
not was a defect rather than a missing drawing.

| S12 element | state before this |
| --- | --- |
| *"Searching Axal VC France accounts"* | ✅ D129 |
| The decline card | ✅ **refused with a measurement** (D126): the rail has no free-text input, `aiRouter.ts` carries no branch awareness, and a branch Worker has one D1 binding — the question cannot be **asked**, so a card refusing it is theatre about a wall that is already load-bearing |
| Rule 4, cost before the run | ✅ the rail's own meter |
| Rule 1, *"scope is fixed"* | ◐ the sentence said *"this deployment"* and never named it |
| Rule 3, *"it points at the copy it does have"* | ❌ |

### The defect

`WorkerRail`'s `canRun = coverage.length > 0`. With no coverage it renders
**"Not recorded"** and disables its only button under *"Nothing to read back yet
— this page has not loaded a summary."*

**Three of the seven branch zones passed no coverage**, and on two of them that
sentence was **false**: `/branch/insights` had loaded its stats, a benchmark and
a server-written `unavailable` list; `/branch/contracts` had loaded HQ's library
and its push stamp. (`/branch/community` fetches nothing **deliberately** — D140
refused four counts there for D128's reason — so there the sentence is true.)

**The rule was already in the repo, watching one tier.**
`branch_rail_mount.test.mjs` pins three HQ pages with the message *"without
coverage the rail's only button stays disabled"* — and **D126 is the PR that both
fixed those three and mounted the branch rail.** It fixed the tier it was
auditing and left the tier it was building.

### `pushed_at` was read zero times in the SPA

S12 rule 3: *"HQ pushes one anonymised median with a timestamp. The rail may
cite that, **and says when HQ computed it**."* D148 shipped
`branch_benchmarks.pushed_at`, `branch_insights.ts` selects it, and
`BranchInsights.jsx` contained **no occurrence of it** — a pushed copy drawn
without its age, which is the defect D147 and D149 both landed on. **Seventh
instance of a producer with no reader** (#252, D142, D149, D150).

Same page, same shape a second time: it rendered the server's `unavailable` list
as its own card and never forwarded it to the rail's block for exactly that.

### The judgement call: a sentence, not a chip

The canvas draws the scope as a caret-less chip reading the branch's name. **It
ships as the rail's own sentence instead**, for two measured reasons: the
territory badge already names the branch on every branch screen, so a chip is a
second copy of one string on one screen; and **D150 refused H13's HQ chip**, so a
branch chip would contrast with nothing. The chip's information content — *this
one, and it does not open* — was already the note. What the note lacked was the
name. *Strike this and the alternative is a `scope` prop on `WorkerRail`.*

`branchLabel(user)` lands in `lib/shellRole.js` beside `branchOfUser`, because
`BranchAccounts` already derived it for the S0 search sentence and the frame
would have been the second copy. **Tenth consolidation** (D127, D128, D130,
D131, D138, D140, D142, D144, D149).

### Six guards were pinned to a spelling, and one of them was this PR's own

Passing `user={user}` to seven routes failed **six** pre-existing assertions that
matched `<BranchHome />`, `<BranchInsights />`, `<BranchApprovals />` and so on —
the prop-less spelling — while asserting a fact the prop does not change: which
component the route mounts. A seventh pinned the rail's note as a literal, and an
eighth compared `indexOf('benchmarks_available === false')` against
`indexOf('benchmarks.length')` **across the whole file**, so the new rail
coverage line inverted it while the render's order was untouched — the unbounded
window D147 hit with a 400-char route slice and D150 with a 420-char cell.

**And the new guard made the same mistake before it was run.** Its first draft
required `[…].filter(Boolean)` — one zone's idiom — and failed three pages whose
coverage was already correct, because the branch tier builds coverage four
legitimate ways. It asserts the property now: coverage is built in the component
and gated on its reads, so a failed one drops its line. Two more of this PR's own
assertions were wrong first: a phrase matched across a string concatenation the
source wraps, and an apostrophe that is backslash-escaped in a single-quoted
literal. *An assertion about prose has to be written against how the source
stores it.*

### One mutation escaped, and it is the guard's limit rather than its failure

`const coverage = ['literal'] || […]` passed the new gated-on-reads assertion:
the `||` short-circuits past the gating at runtime while **leaving it in the
file**, and the assertion reads source. Re-aimed at the shape it actually
claims — the whole construction replaced by a constant array — it is caught.
So the guard enforces its property and the first mutation landed somewhere
other than where it was aimed, which is not evidence either way; the real
limit is that **a source-reading guard cannot see evaluation**, the class D141
recorded as *"a guard that reads the source cannot see a component that stopped
drawing"*. That limit is written into the test beside the assertion rather than
left for the next reader to find. **18 mutations, 18 caught** once M3 is aimed
at its own claim.

### What the code corrected after the plan

The plan said Contracts' coverage would count archived templates. **There is no
archived state**: D147 dropped `is_active` from the push on its own rule, and the
payload's `not_carried` says so in the server's words. The line is gone and the
rail forwards `not_carried` rather than typing a second copy of it.

## D152 — HQ's Security page denied a store it had, one click from the page that draws it (#235)

**Date:** 2026-09-17 · **Scope:** one service, one route, one page, three test
files. **No migration — 269 stays free** — and **no new `/api/*` method**: both
fields were already on payloads `SecurityPage` already fetched.

#235 is "H12 view-as overlay as shell state, guardrail hits by branch, AE audit
mirror". Measuring it before building — the seventh time running that has
corrected a task — found that H12 draws **three frames**, that the third has a
refusal in front of it, and that the refusal is **false on two of its three
clauses** while being rendered on a shipped HQ screen. That correction is this
entry; the overlay is the next PR.

### The defect: one sentence, two zones, and two of its three clauses wrong

`admin_security.ts` carried one constant with two consumers by design — its own
comment said *"One sentence, two zones"*:

> *"No guardrail-hit, flagged-output or token-anomaly counter is stored for the
> AI rails."*

| clause | true? | measured |
| --- | --- | --- |
| **guardrail-hit** | **FALSE** | `ai_usage_logs.safety_score` (migration 040) is written by `recordUsage` on **every** router call; `task = 'safety'` rows are llama-guard's verdicts |
| **flagged-output** | **FALSE** | `advisor_turn_audit.shadow_flagged` (migration 043), with its own index `idx_advisor_turn_audit_flagged`, written from seventeen call sites in `routes/advisor.ts` |
| **token-anomaly** | **true** | the phrase occurs **nowhere** in the repo except that constant |

**And it was already aggregated and already on screen.** `loadAiUsageReport`
rolled up `evaluated / safe_count / unsafe_count`, served at
`GET /api/monitoring/ai-usage` and rendered by `AiUsageTab` as *"Guardrail
safety (llama-guard)"*. So HQ's security desk refused a figure the same admin
console was drawing one click away — **the sixth refusal that outlived its fact**
(D129's seat store, D131's six blocks, D140's adjustable dates, D147, D150's
three rail rows, D151's three zones) and the first where what was denied was
visible elsewhere in the product.

### The consolidation, and it is the twelfth

The rollup was **inline inside `loadAiUsageReport`**, so `admin_security.ts`
needing it would have been the **second copy of the SQL** — and two copies of a
safety rollup is how two screens come to disagree about what a guardrail hit is.
`loadGuardrailCounters(env, days)` is now the one definition and
`loadAiUsageReport` is its first caller. D127 one `GROUP BY role`, D128 one LIKE
escaper, D130 one definition of open, D131 one count, D138 one definition of what
freezes, D140 one zone formatter, D142 one freeze list, D144 one notification
row, D149 one bps formatter, D151 one name for the branch, **D152 one guardrail
rollup**.

**Two stores, because they count different things.** `ai_usage_logs` holds what
llama-guard **thought** (the verdict); `advisor_turn_audit` holds what the
platform **did** (`refusal_reason = 'safety_block'` → blocked, `shadow_flagged`
→ flagged). Reporting one as the other is how a safety figure comes to mean
nothing. Each half carries its **own** `available` flag, because
`advisor_turn_audit` is lazily bootstrapped (`ensureAuditSchema`) — its absence
is a state the read can actually meet, and *"0 turns blocked"* is the most
reassuring possible way to be wrong on a security page. That is the #204 class,
on the worst surface for it.

**`safe_rate` is `null`, not `0`, when nothing was evaluated.** A rate over an
empty denominator is undefined, and *"0% judged safe"* is the opposite claim from
*"the guard never ran"*. `loadAiUsageReport` keeps its own zero-defaulted copy —
`AiUsageTab` is shipped and changing what its tiles mean is not this PR's
concern.

### The refusal is narrowed, not deleted (the D111 pattern)

Three things are still genuinely uncounted, each now its own row rather than one
sentence covering them:

- **Token anomalies.** Nothing watches per-account consumption for a spike. A
  spend cap being hit is recorded as a refusal, and a limit reached is not an
  anomaly detected.
- **Which guardrail rule fired.** `classifyInput` returns the violated category
  on every hit and the 422 body sends it to the caller — and **no store has a
  column for it**: `writeTurnAudit`'s parameter list records the score, the
  refusal and the flag and drops the category. A producer with no store; the
  **eighth instance** of that shape in this programme, and the sharpest single
  finding here. **Filed with its measurement, not built** — it is a migration
  plus a writer change, a different concern from correcting a false sentence.
  This is also exactly why H7's artboard rows stay undrawn: it draws
  `{ what, meta, n }`, a **count per category**, and the category is the field
  that is thrown away. The counters are real; the rows are not.
- **By branch — H12's third frame.** Neither table carries a branch, tenant or
  licence column; no branch RPC returns safety counters; and Analytics Engine
  has no branch index (below). So the row says the figures are platform-wide and
  why, rather than splitting one deployment's numbers four ways.

### `/governance` gets a pointer, not a second copy

`guardrails` had **zero readers in the SPA**, and both payloads land on the same
page — `SecurityPage` fetches `/overview` and `/governance` together, and the
page's own header records that H7 was reconciled **into** this surface rather
than drawn beside it. So H7's guardrail panel **is** the AI-safety zone. Serving
the block twice would have put two renders of one rollup on one screen (D128's
tile-vs-table, one page over) and spent a second pair of D1 reads on a field
nothing reads. It carries `{counters_on, field, window_days, not_counted}`
instead — the shape `audit: { total, feed }` at the top of `/overview` already
uses, which likewise has no SPA reader and is a self-documenting pointer.

### Refused with its measurement

**H12's "Passed on retry" column cannot exist.** `aiRouter.ts` routes `safety` to
`@cf/meta/llama-guard-3-8b` and records that `safety` has **no alternates**, so a
safety call structurally cannot fall back; `retry` has zero hits in
`guardrails.ts`, and `ai_usage_logs.fallback_used` is a *model* fallback meaning
something else. Drawing the column would invent a number.

**A smaller one worth recording:** `'safety_block'` is declared in `aiRouter`'s
`RefusalReason` union and **never written to `ai_usage_logs.refusal`** by any
code — the only writers of that value are `advisor.ts`'s two `writeTurnAudit`
calls and one HTTP error body. That is why the block count has to come from the
audit table, and it is the reason stated in the function's header rather than a
preference.

### A finding recorded, not fixed here — D105's premise is half-built

D105 justified keeping the Analytics Engine dataset **shared**, against the
per-branch isolation the whole design rests on, on the grounds that it is
*"indexed by `BRANCH_CODE`"*. **It is not.** The repo's sole `writeDataPoint`
(`middleware/observability.ts`) writes `indexes: [path.slice(0, 96)]` and no
branch code in any index, blob or double; the reader hardcodes
`FROM studioos_metrics` with no branch predicate. So the write-side half of
D105's own justification was never built, and any per-branch AE query returns
nothing today — **a decision record stating a capability that does not exist,
which is the same class this entry corrects one layer up.** Not fixed here: it
changes what every request writes, and it belongs with the AE audit mirror (F.8
item 1), which also does not exist.

### Three guards had to be re-aimed, and that is the sixth, seventh and eighth

`admin_governance.test.ts` asserted `guardrails.available === false` and matched
the refusal's text; `hq_governance_h7.test.mjs` asserted
`guardrails: absent(NO_AI_SAFETY_STORE)` under a title saying the artboard's rows
*"have no store"*. **The guards pinning the refusal were the thing standing in
the way of correcting it** — the same shape D150 hit one line above one of them.
Each now asserts the property that replaced it, in both directions.

**And one of this PR's own new guards was wrong before it ran**, in the way this
programme keeps repeating: banning the table names in `admin_security.ts` failed
on correct code, because the *"by branch"* reason **names both tables** to
explain why the counters are platform-wide. *A lexical scan cannot tell a rule
from its violation* (D148's `rank`, D150's U1 comment) — **third instance**. It
asserts the SQL shape instead: a query reaches a table through `FROM` or `JOIN`,
and no sentence about a table does that.

### One mutation escaped, and it found a hole in a rule this page already had

`value={v?.available ? num(v.evaluated) : 0}` passed everything. The page's
"absent is not zero" rule is enforced by scanning for `|| 0` and `?? 0`, and a
**ternary** falling back to zero is neither — so a counter the platform could
not read would have rendered `0` on a security page, which is the defect this
entry is about, in the place it is worst. The fix was to strengthen the new
assertion (each tile's absent arm must be `null`) rather than to drop the
mutation: **an assertion that cannot fail on the defect it was written for is
not a guard**, and this one is mine. **19 mutations, 19 caught** once it was
re-aimed.

Two more of this PR's own guards were wrong before they ran, both in shapes
already named here: a ban on the table names failed on the sentence that
explains why the counters are platform-wide (*a lexical scan cannot tell a rule
from its violation*), and spreading the server's rows into the rail's
`unavailable` array broke the line-oriented `[title, detail]` guard two files
enforce — the entry was still a pair, and **a spread hides the row shape from
exactly the check that exists to see it**. The detail is computed above the JSX
and the array stays one literal pair per line.

## D153 — HQ could read a branch and had no way to look at one (#235's remainder, H12 frames 1 and 2)

**The defect.** D108 built the per-branch read, D150 wired its figures into HQ
Home's health cards, and D152 corrected the sentence that used to say a
tenant-scoped view was blocked by U1 — it said, correctly, that the view had
**not been built**. So HQ could read one branch's accounts, seats, backlog and
escalations and had **no screen that showed one branch at a time**. Every HQ
figure was either a platform total or one card in a fan-out.

**What the canvas asks for, and it is the whole design:**

> *"The overlay is not a filter on an HQ table — it is one private-link read,
> of one branch, rendered with every action removed. Each figure carries the
> branch and the time it was read, so nothing on the screen can be mistaken for
> a platform total."*

Each clause is built and each is pinned by an assertion in
`frontend/test/hq_view_as_h12.test.mjs`.

**One read, of one branch.** `GET /api/admin/hq/overview` and `/admins` learn
`?branch=<code>`; both answer a deliberately smaller payload — `{scope,
branches: [one], branches_coverage}` — and neither runs HQ's own platform
queries on that path. **No new `/api/*` method**: `hqOverview` and `hqAdmins`
gained an argument, so `check-api-drift` has nothing to say.

**Not a filter, structurally.** HQ Home's own fetch is skipped under the
overlay, and the scoped route returns before its roster and ledger reads. There
is no platform payload sitting behind the scoped screen to have been narrowed —
which is what makes the canvas's sentence true rather than merely claimed.

**The thirteenth consolidation.** `branchByCode(env, code)` in
`services/branches.ts`, read by the four sites that hand-rolled
`branchBindings(env).find((x) => x.code === code)` (`licencePush.ts`,
`admin_support_sessions.ts`, `admin_statements.ts`, `admin_escalations.ts`) and
composed twice by the fifth, which resolves a pair. Those five were a **second
definition of how a code matches a binding**, sitting beside the one definition
of how a binding's code is derived — the same rule read from opposite ends,
free to drift the day one of them normalised. **The absence carries no copy**:
each caller keeps its own tailored sentence (*"so the change is recorded at
HQ"*, *"so there is nothing to open a session on"*, *"so the ceiling is set at
HQ"*, *"so the decision is recorded at HQ"*), which is D117's rule that a
fallback is a human-written sentence, re-applied. Beside it `branchRead` returns
**one** branch in the fan-out's own three states, so an unbound code answers
`not_deployed` rather than `unreadable` and an unreadable branch is never a page
of zeros.

**Every action absent, not disabled.** The overlay body draws **no** button,
link, form or input — asserted as the absence of controls rather than the
absence of the word *disabled*, since the latter is a legitimate word elsewhere.
A greyed control claims the action exists here and is momentarily unavailable;
it does not exist here, which is D134's `still_an_admin` lesson one tier up.

**Every figure stamped, per tile.** The branch and the read time sit on each of
the four tiles rather than once in a header a reader scrolls past, because the
stamp is the single thing that stops a number here being read as a platform
total. Two clocks travel, answering different questions: `read_at` is when this
screen was filled, `as_of` is how old the branch's own figure was when it left.

**Two absences stated rather than drawn.** H12's *"Queues · as the branch sees
them"* zone has **no producer at all** — measured, not assumed: twelve
`HqEntrypoint` methods and fifteen `branchOps` exports, and none is a decision
feed — so the heading is drawn and the reason stated, the shape D140, D147 and
D151 all used. And MTD revenue is `null` **by construction** (`branchOverview`
returns `revenue_mtd_cents: null` with its own reason), so the tile renders the
server's sentence; the canvas draws a number there and the branch does not have
one.

**The chrome is in the SHELL and persists nothing.** `HqViewingAsBar` mounts
above `PortalSwitcher`, on D142's rule one tier up: the ordinary admin chrome
must never be the only frame on a view the operator is not in by default. The
scope is plain React state in `ViewAsBranchContext` — no `localStorage`, no
`sessionStorage`, no URL — on `AdminFrozenBar`'s stated rule, and that is
exactly why `clearSession` needs no line for it: there is no key to remove, and
signing out unmounts the layout.

**The way IN is drawn only where there is a branch behind it** — a health card
whose branch answered. A "view as" on an unbound or unreadable branch would open
a screen of absences. The way OUT is the shell bar, because the overlay frames
every page it covers rather than the one that entered it.

**THE REFUSAL IS DELETED, NOT REWORDED — the ninth instance.**
`/governance`'s `tenant_view_available` went true and its sentence now says what
the overlay *is not* (a read, not a role; no action runs from it), because that
is the part a reader can still get wrong. **Eight assertions across two files
were re-aimed**, and the old guard was never wrong in kind: its failure message
was *"a 'Return to HQ view' control appeared with **no tenant scope behind
it**"* — conditional, not absolute. D153's whole job was to put something behind
it, so the re-aim is structural rather than a loosening.

**Two more stale guards surfaced while re-aiming those**, both legitimately
re-pointed rather than loosened: `hq_home.test.mjs` pinned `hqOverview`'s
zero-argument signature and is now explicit about the distinction D153 draws —
the **tenant switcher** narrows this page over a payload it already has and must
keep sending nothing, while the **view-as overlay** changes what the server
reads and must send `?branch=` — and `hq_team_h9.test.mjs` pinned `hqAdmins(q)`.

**And one of my own new comments broke a guard before it ran** — fourth
instance of *a lexical scan cannot tell a rule from its violation*. The h7 test
derives the tables `admin_security.ts` reads by matching what follows the word
`FROM`, and a comment reading "THIS WENT FROM false TO true" added a phantom
table called `false` to that set. The comment is worded around it and says why.

**A TENTH GUARD PINNED THE SAME REFUSAL, in the worker** —
`admin_governance.test.ts` asserted `tenant_view_available === false`, which
`test:drift` found rather than review. And **one of my own new assertions could
not fail**: the mount-order check read `App.jsx.indexOf('HqViewingAsBar')`,
which finds the IMPORT line at the top of the file and is therefore before every
mount whatever the order is. Caught by moving the bar below `PortalSwitcher` and
watching it pass; it anchors on `<SafeMount name="HqViewingAsBar">` now.
**Fourteen mutations applied, fourteen caught**, the last only after the
assertion it exposed was strengthened.

**And the mutation run itself demonstrated the rule it is run under.** One
restore reached for `git checkout --` instead of the snapshot, on a file the
snapshot did not cover (`SecurityPage.jsx`) — which silently reverted that
file's whole D153 edit to `main` and baked the reverted page into a `docs/`
rebuild. `test:drift` caught it, from the very guard re-aimed two paragraphs
above. **A mutation harness must restore from a snapshot, never from git**, and
the snapshot must cover every file the run can touch.

**No migration — 269 stays free.** **Deliberately not built:** H12's frame 3
(D152 shipped its counters), H9's Trust column (a branch hit carries no trust
field; trust is HQ's own service over HQ's own accounts and is not a per-branch
figure), and H13's scope chip — which D153 **unblocks**, because D150 refused it
on the ground that *"the page decides what it fetched before the rail runs, so
both options produce the same read"*, and under the overlay they demonstrably
differ. `WorkerRail` has no `scope` prop today, and building it is #244's
remainder rather than this PR's; under the overlay HQ Home therefore renders no
rail at all, since the rail's coverage lines summarise HQ's own ledger and would
be four false sentences beside four true figures.

## D154 — H13's four rules: one built, one restated, one re-asserted, and one whose refusal D153 made false (#244)

**Where H13 stood.** D150 shipped rule 3 and refused rules 1, 2 and 4, each with
its measurement. Two of those refusals rested on the same fact — that HQ read in
exactly one scope — and D153 removed it.

| rule | before | now |
| --- | --- | --- |
| **1 · Scope precedes the question** | refused: *"the page decides what it fetched before the rail runs, so both options produce the same read"* | **BUILT.** Under the overlay they demonstrably differ |
| **2 · Cost is per scope** | refused: one run, one price | **still refused**, restated on screen with its measurement |
| **3 · Unreadable is a word in the answer** | shipped (HQ Home's branch line) | re-asserted, now on both surfaces |
| **4 · Anything about a named branch is logged** | refused: *"logging that as a privileged branch read would write a FALSE audit entry"* | **BUILT**, narrowed to the scoped case |

**Rule 1 — the chip reports, it never offers, and that is the decision.** D150
refused a *picker*, correctly: a picker whose options cannot differ is the
`still_an_admin` mistake D134 named. The canvas never asked for one — *"the chip
is what the viewing-as banner set"* — so `WorkerRail` gains a `scope` prop that
renders the scope the page **was already in**, and changing it stays the shell
bar's job one layer up, where the mode actually lives. A chip that offered a
scope the rail cannot change would be the refused control wearing the accepted
one's clothes, and the guard asserts the absence of anything clickable inside it
rather than the absence of a word.

Absent draws nothing: a rail with no scope makes no claim, because "the page did
not say" is not "platform-wide".

**Rule 4 — the refusal had a premise, and it is gone.** D150's words were exact:
the rail reads no branch, it summarises coverage lines the page rendered, so a
row saying a branch was read would be **false**. Under D153's overlay those same
lines *are* one branch's figures, so the canvas's rule applies on its own terms —
*"reading a branch is a privileged act even when it is only a question."*

So `POST /api/ai/workspace/explain` takes an optional `branch` and writes one
`admin_audit_log` row — `ai_branch_readback`, the table HQ's Security feed
already reads — **when and only when** a branch is named. An unscoped run still
writes nothing, because it is still true that nothing privileged happened: the
refusal is **narrowed rather than reversed**, which is the D111 pattern for a
reason that half-expires. Three further properties are pinned because each is a
way of getting an audit trail wrong: the row is written **before** the run (the
reads an operator most wants to see are the refused ones, and "what was asked of
this branch" is the question it answers, not "what came back"); the code is
**validated** against `BRANCH_CODE_RE`, so client text cannot land in a column an
operator reads as a branch; and the **label and the identifier are separate
props** — `scope` is copy a person reads, `scopeBranch` is what the row is keyed
on, and conflating them would send the words "All branches" as a branch code.

**Rule 2 stays refused, and says so on the screen.** The canvas prices "All
branches" as up to four reads and four drafts with the estimate multiplying
before the run. This read-back performs one run at one price whatever its scope,
because it summarises lines the page already has and does not fan out. The
multiplier is real only once the read-back itself fans out, which is a producer
nothing has built — so the rail states it as an absence rather than showing a
number nothing measured.

**Two things this exposed in my own work.** The `ai_workspace_explain` fixture
**could not authenticate**, so the first version of rule 4's two negative tests
went green while the route never ran a line — vacuous in exactly the way this
programme keeps catching. The user lookup goes through a tagged-template helper
returning an array rather than `.first()`, and a live `user_sessions` row is
required as well; both were found by probing the real route rather than reasoning
about it. And D153's own comment saying `WorkerRail` had no `scope` prop became
false the moment this landed, so it is corrected rather than left to be cited by
the next surface.

**No migration — 269 stays free.** No new `/api/*` method: `aiWorkspaceExplain`
gained a field. **#244 is closed.**

## D155 — S11 Settings: the artboard names the wrong owner on two of its five rows (#234's remainder)

**The last branch route.** `/branch/settings` was the one row still rendering
`BranchZonePending`; S4 shipped as D140, S5+S10 as D147, S6 as D148. With this
every row in the branch sidebar resolves to a real page.

**What the artboard is for, and why a wrong owner is fatal to it.** S11's whole
subject is ownership — *"HQ-owned rows show the request path instead of a
disabled input: a greyed field invites a ticket asking to enable it; a chip
saying HQ and a route saying 'escalation' answers the question on the page."* A
row that names the wrong owner is therefore not a cosmetic error on this screen;
it is the screen being wrong about the only thing it exists to say.

**And it names the wrong owner twice.** The canvas marks **Subsidiary name** and
**Staff & roles** as the branch's to edit. Measured:

| row | canvas | measured |
| --- | --- | --- |
| Subsidiary name | Yours · Edit | **HQ's, twice over.** The name this deployment answers by is `BRANCH_NAME`, a Worker var set at provisioning — `routes/auth.ts` says so where it builds `/me.branch`: *"THE VARS ARE THE SOURCE, NOT THE DATABASE"* — so changing it is a redeploy, not a form. And the licence copy's `brand_name` is HQ's: there is not one `UPDATE branch_licence` in the worker, by design (D.9), so an edit would be overwritten by HQ's next push |
| Territory | HQ · Request | ✅ |
| Staff & roles | Yours · Edit | **SPLIT, and the editable half is not roles.** `PATCH /users/:userId/role` answers `admin_promotion_disabled` to everyone but the super admin, and `hydrateSuperAdmin` returns 0 on a branch without querying (D106) — so a branch admin can *never* change a role, and D134 made the licence the only door for granting one. What a branch does own is deactivating a **non-admin** account on its own database: `toggle-active` refuses only an admin target (D132) |
| Brand kit | HQ · Ask | ✅ — and the canvas wrote the absence itself, which D.10 had already decided: no brand-kit store exists |
| Licence summary | HQ · Request seats | ✅ |

So the split is **four of five HQ-owned**, not the canvas's three, and the count
on screen is derived from the rows rather than typed — the canvas typed it and
got it wrong. The correction is stated **on the page**, not only in a comment,
so a reader who notices the artboard says otherwise gets the reason rather than
a discrepancy.

**No field is drawn anywhere.** Every row's action is a link to somewhere that
works, and the test asserts each destination is a registered route. A disabled
input here would be the `still_an_admin` mistake D134 named, at its worst: on a
page whose subject is who may act, a greyed control claims the action exists and
is merely switched off.

**Ninth producer with no reader.** `GET /api/branch/insights` ran
`GROUP BY role`, walked the rows, and returned only the totals — the breakdown
S11's staff line is a sentence about was computed and dropped. It is returned
now, with `by_role_active_only` beside it so a reader is not left to infer why
it does not match the directory. **No new `/api/*` method:** the page composes
`myLicence()` and `branchInsights()`, both of which the branch already had.

**`BranchZonePending` is deleted, and its guard re-aimed — the inverse of the
stale refusal.** The component existed so the sidebar could match the canvas
while the pages landed one at a time. With S11 built it has nothing to stand in
for, and a component named Pending with nothing pending is the stale artefact
D129 and D131 deleted in their own areas. Its guard asserted
`uses.length >= 1` — *the scaffolding had to exist* — so it began failing the
day its own job was finished. What is pinned now is the stronger property it was
approaching: **every row in the branch sidebar resolves to a real page.** The
same lesson as the eleven re-aimed refusals, arriving from the other side: a
guard tied to an interim arrangement has to be re-aimed when the interim ends.

**One of my own new assertions caught a real defect in my own code**, which is
the point of writing them: `lic.territories?.length || 0` would have rendered
*"0 territories held"* for a licence copy that arrived without the array — a
claim about this branch's licence that nothing measured. Both zero-defaults are
gone. **No migration — 269 stays free.**

---

## D156 — three audit tables were append-only by convention; migration 269 makes the database say so

**Task #236, the first of F.8's standalone improvements.** F.8 item 1 asked for
immutability triggers on the audit stores. Measured before building — the
seventeenth time in this programme that measuring a filed item corrected it —
**three of F.8's items are stale and one is genuinely unbuilt**, and the reading
of two of them was mine to correct:

| F.8 item | measured against the code, 2026-09-18 |
| --- | --- |
| **1 · immutability triggers** | **genuinely unbuilt.** No `BEFORE UPDATE`/`BEFORE DELETE` trigger exists on `admin_audit_log`, `impersonation_sessions` or `licence_events`. The only trigger in the repo is `sql/historical/lp_investors_seal.sql`, which is the precedent this copies |
| 7 · `requireAdmin` on `/monitoring/throughput` | **stale.** `routes/monitoring.ts:255-258` already refuses anyone outside `admin`/`partner`/`investor`; the route's own heading calls it *"operator-visible limited stats"* and that is what it is |
| 7 · retire the `admin_news.ts` twin | **~~stale~~ — SUPERSEDED BY D166, and this row was wrong twice over.** The first reading called the file dead: the scan matched `^r\.` while this router's const is `adminNews`, so it reported zero handlers against a real **11**. Correcting that was right; stopping there was not. *"It is alive"* is an argument that retiring it is **not free** — it is not an argument that there is nothing to retire, and this row never quoted the handler that decides it. `admin_news.ts:194` accepted `['approved','in_review']` at publish where `admin_articles.ts:206` requires `approved` exactly, under the comment *"No skipping straight from in_review → published, even by an admin."* D166 retired it |
| 7 · step-up on `/impersonate-sessions/:id/end` | **refused with the measurement.** The UPDATE is bounded `AND admin_user_id = ?`, so an admin can only close their own session; it is the client's best-effort close on exit, and a step-up in front of it would leave sessions permanently open — which is precisely the state D122 was written to end |

### The defect: "immutable" was a description of the writers' habits

HQ's Security page renders all three stores and the feed is described as
immutable. Measured repo-wide, across `.ts`, `.py`, `.mjs`, `.js` and `.sql`:

| table | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- |
| `admin_audit_log` | **33** | **0** | **0** |
| `licence_events` | **2** | **0** | **0** |
| `impersonation_sessions` | **2** | **2** | **0** |

So nothing in the repo rewrites an audit row. What was missing is anything that
would **refuse** one. `frontend/test/territory_licences.test.mjs` holds a
source-scan over `licence_events` — *"a contract dispute is exactly when an
overwritten history is useless"* — and that scan is structurally blind to a
`wrangler d1 execute`, a queue job reaching `DB.prepare()` directly, or any
writer that does not live in the file it reads. **A lexical scan of the source
cannot see a write that is not in the source.** Migration 269 moves the
guarantee into the only place it can hold against every writer.

### The third table cannot take the same seal, and that is the finding

`impersonation_sessions` has exactly one legitimate mutation: stamping
`ended_at` on a session that is still open, written by `routes/admin.ts:1699`
(the operator's own exit) and by `util/supportSessionSweep.ts:91` (**D122**'s
sweep, for the branch rows HQ's route can never match because
`admin_user_id = 0`). Both are guarded `ended_at IS NULL`.

**A blanket UPDATE seal here would have broken D122** and left every branch
support session reading `not closed` on HQ's Security page for ever — the exact
defect D122 exists to fix, reintroduced by the migration meant to strengthen the
same table. So that table gets a `WHEN`-guarded seal instead, permitting the
close and refusing everything else: no re-closing a session whose end time has
already been reported to the supervised party, no re-opening one, and no
rewriting who supported whom, when it started, or the typed reason.

### The guard was half-exempt, and migration 269 is what found it

`scripts/check-sql-migrations.mjs` refused this migration on
**`ROLLBACK / END`** — on the line that closes a trigger body its own comment
(`:27-29`) says is legal: *"`BEGIN` also opens a TRIGGER body, and a trigger is
perfectly legal in a migration."* The carve-out was written for the opener and
not for the closer, so a trigger was legal to open and illegal to close. It went
unnoticed because **269 is the first migration in the repo to install one**.

Fixed in this same PR, on D143's precedent (`due_at` joined `TTL_COLUMN` in the
PR that created the column): a `stripTriggerBodies` pass excises
`CREATE TRIGGER … END;` spans before the scan — **strictly stronger** than
exempting the keyword, because outside a trigger `END;` stays refused, and that
is the statement that aborted migration 200's deploy. The widening is asserted
in both directions in `frontend/test/migration_column_shapes.test.mjs`, which
the guard's own header names as the place for exactly that, on its stated
principle that *a widening no test exercises is a widening nobody notices*.

### Verification

**15 mutations, 15 caught** — and one escaped first, on my own assertion rather
than on the code. `M8` dropped `OR NEW.ended_at IS NULL` from the `WHEN` clause
and nothing failed, because the re-open test acts on a **closed** row, which the
neighbouring `OLD.ended_at IS NOT NULL` conjunct catches either way. The conjunct
guards a different case — an update that touches an open session and leaves it
open — and that case had no test. An assertion that cannot fail on the mutation
it exists for is not a guard, so the test was written rather than the conjunct
dropped.

The guard is a real `node:sqlite` test applying the migration file **verbatim off
disk**; restating the trigger bodies in the test would test the copy. Foreign
keys stay **on**, with stub parents, so a row that could not exist in production
cannot exist in the fixture either.

**No new `/api/*` method, no route change, no SPA change.** Migration **269** is
used; **270 is free**.

**A note for anyone rebuilding a sealed table.** SQLite cannot `ALTER` a CHECK,
so widening one means create-copy-drop-rename — which is what migration 266 did
to `licence_events`. `DROP TABLE` drops its triggers with it. Any future rebuild
of a table sealed here must re-run 269's statements at the end of its own
migration, or the seal silently disappears. That is stated in the migration
header and asserted by the guard, so a rebuild that forgets fails the build.

---

## D157 — D132 closed a question that only needed narrowing: an admin could not read their own record

**Task #236, F.8 item 7's self-audit read.** The second of the standalone
improvements, and the second in a row where the filed item was right and the
measurement changed its shape.

### The defect

D132 raised `/analytics/audit`, `/analytics/audit/export.csv` and
`/analytics/exports/recent` to `requireSuperAdmin`, and its reasoning is
correct and still stands, in its own words at `monitoring_analytics.ts:233-239`:

> *"this reads OTHER ADMINS' activity. The rows are `admin_audit_log a LEFT
> JOIN users u ON u.id = a.admin_user_id`, so a plain admin was reading every
> other admin's export history by name and email."*

But that **closed** a question rather than narrowing it. *"What have I done"* is
not *"what has my peer done"*, and after D132 an administrator could not see
their own privileged-action record at all — on a platform whose Security page
describes that record as the thing an operator is accountable to.

**Narrowed rather than reversed**, which is the D111 pattern D154 applied to
rule 4 one decision earlier. The three refusals D132 made are untouched, and
`self_audit_d157.test.ts` asserts all three still hold rather than assuming it.

### Why `requireAdmin` is the right gate, from this file's own rule

The file's header already wrote the test, before this route existed:

> *"a route that reaches `admin_audit_log a LEFT JOIN users u` is a cross-admin
> read whatever it renders, and gating some of them is gating none of them.
> Keep new routes here on `requireAdmin` unless they cross that line too."*

`GET /analytics/audit/mine` does not cross it. There is **no join to `users`**,
because the caller is the only subject and there is no other person's name to
render. And the subject is **not an input**: `admin_user_id` is bound from
`adminUser.id` and the query string is never consulted for it, so there is no
parameter that could name somebody else. That is the **structural** form of
D132's rule rather than a validated form of it — nothing to validate, because
nothing is read.

So the header's count stays **three**, and the header now says so explicitly.

### Three things the code decided against the obvious reading

1. **No action filter, on `admin_security.ts`'s precedent rather than
   `/audit`'s.** `/audit` admits `ALLOWED_ACTIONS = ['analytics_export',
   'subscription_plan_update']` — two of the many actions written to this table.
   HQ's own feed deliberately admits all of them, and `hq_security.test.mjs:130`
   pins exactly that: *"the audit zone reads every action, not the two the
   monitoring read allows."* An administrator's own record is the same kind of
   thing: showing them two of their actions and silently dropping the rest
   would be a feed that is wrong about the one subject it has. The guard asserts
   the difference **both ways** — `/audit/mine` has no filter and `/audit` still
   does — so it is a real divergence between two handlers rather than a property
   nothing could break.
2. **A tenth producer with no reader, at the index level.**
   `idx_admin_audit_user_ts(admin_user_id, exported_at DESC)` is created by
   `ensureAdminAuditLogTable` and **no read uses its leading column** — both
   existing reads pass `adminUserId: null` into `buildAuditWhere`. The index was
   built for exactly this query and had no caller. The `ORDER BY` matches its
   second column so it applies whole, and that is asserted.
3. **The page states what it does NOT show.** A feed of privileged actions that
   does not say whose it is invites being read as the platform's, which is the
   claim D132 closed. The scope is **echoed by the server** and rendered, and
   the page says in one line that another administrator's record is not readable
   here and never was for this tier — so a reader who wonders gets the reason
   rather than a silence.

### The unreadable state is not the empty one

`admin_audit_log` is lazily bootstrapped, so its absence is a state this read can
genuinely meet — the #204 class, one surface up. A failed read renders its own
reason and the sentence *"This is not a claim that you have taken no privileged
actions"*; an empty one says nothing was recorded. Two different states, drawn
differently, which is this programme's most repeated correction.

### One correction the guard made to itself, before it ran

The first draft asserted the cross-admin rule by **counting two totals** — join
statements against `requireSuperAdmin` calls — and they are not one to one:
each gated handler runs **two** joined queries, items and count, so the
arithmetic was wrong (5 against 3) while the rule it meant was right. It now
**sweeps every handler in the file** and asserts that any handler joining
`users` gates on the elevation, which says the actual thing and catches a fourth
added later. A second draft then built its handler slicer as a `new RegExp` from
data — the shape Semgrep has flagged three times in this repo — and took the
literal form instead, which also fixed a real hole: the slicer matched `r.get('`
only and silently skipped the file's one POST handler.

### Verification

`test:drift` exit 0 from a redirected log. **14 mutations, 14 caught.** No
migration — **270 stays free.** One new `/api/*` method with its route in the
same commit, so `check-api-drift` is satisfied. `frontend/src` moves, so `docs/`
is rebuilt by the root build.

---

## D158 — the guardrail category was computed on every guarded turn and thrown away

**Task #276, filed from D152's own research and built here.** The third of
#236's standalone improvements, after D156 and D157.

### The defect

`services/advisor/guardrails.ts:122-138` — `classifyInput` runs llama-guard and
parses its reply into `{ blocked, score, category }`, where `category` is the
**S-code naming which rule fired** (`out.split('\n')[1]`, e.g. `s1`, `s10`), or
one of `empty` / `safe` / `router_failed` / `error`.

Measured repo-wide before anything was written:

| where the category went | measured |
| --- | --- |
| `routes/advisor.ts:891`, `:1895` | the 422 response body — **the only two consumers** |
| `TurnAudit` | **no field** |
| `advisor_turn_audit`, migration 043 **and** the runtime bootstrap | **no column, in either** |
| `guardrail_category` / `refusal_category` in any migration | **zero** |

So **which rule fired was unrecoverable the moment the response was sent.** HQ
could count *that* a guardrail blocked a turn — D152 shipped those counters —
and could never say *what for*, on the one screen whose subject is AI safety.
**Eleventh producer-with-no-store** in this programme.

### The twelfth stale refusal, and the first this codebase filed against itself

`admin_security.ts`'s `AI_SAFETY_NOT_COUNTED` carried a row reading *"Which
guardrail rule fired … no store has a column for it"*, rendered on HQ's Security
page. D152 wrote that row from this very measurement. **D158 makes it false**,
so it is **removed rather than reworded**, and both guards pinning it were
re-aimed — one of which stated the premise outright: *"a row carrying an `n`
here would be a per-category count invented for a column no table has."*
Migration 270 gives the table that column.

Every previous instance of this class was a refusal that outlived a fact
somebody else had changed. This is the first where the codebase filed the gap,
and the filing is what got it closed.

### The trap, and it is the #183/#202 class

`advisor_turn_audit` has **two definitions**: migration 043's lineage and
`ensureAuditSchema`'s `CREATE TABLE IF NOT EXISTS`. **A CREATE-IF-NOT-EXISTS
cannot add a column to a table that already exists**, so migration 270 alone
would have left the bootstrap stale and the resulting shape would depend on
which ran first — the `metrics_snapshots` collision that cost two PRs to unwind.
Both move in the same commit: the bootstrap's `CREATE` gains the column *and* a
PRAGMA-guarded `ADD COLUMN`, copying `ensureGuardrailColumns` in that same file
rather than inventing an idiom. **A test builds both shapes and asserts their
column sets are equal** — the property nobody had been checking.

### Three things decided against the obvious reading

1. **The field is REQUIRED on `TurnAudit`, not optional.** There are **seventeen**
   `writeTurnAudit` call sites; **seven** have a `safety` result in scope and ten
   do not. An optional field would let an eighteenth be added with the category
   silently missing. Required, **the typechecker refuses the call** — a guard
   that cannot be forgotten to run. The rule it enforces is *the category travels
   with the score*, asserted in both directions.
2. **`rules` and `states` are returned apart.** An S-code is a rule that fired;
   `safe` / `empty` / `router_failed` / `error` describe the classification
   itself. Mixing them would put *"the router failed"* in a list headed *"what
   tripped the guard"* — and a router failure is the guard **not running**.
3. **Nothing is backfilled, and `unclassified` is its own figure.** Production
   holds **121 rows, 8 carrying a refusal**, none with a category because none
   was stored. Those read **unknown**; a null rendered as `safe` would be a
   verdict nothing reached, which is the defect class this programme keeps
   deleting. The page says so in words rather than leaving a silent gap between
   the breakdown and `blocked`.

### Deliberately not done

- **The raw model output is not stored.** `classifyInput` already narrows it to a
  short token; persisting the completion would put user-adjacent text in an audit
  table, which is the opposite of what redaction exists for.
- **Not split by branch.** That absence keeps its own row: neither
  `ai_usage_logs` nor `advisor_turn_audit` carries a branch column, and this
  change does not add one.

### Verification

`test:drift` exit 0 from a redirected log. **12 mutations, 12 caught** — including
a migration that backfills existing rows as `safe`, a bootstrap that loses the
repairing `ALTER`, and putting the stale refusal row back. Real `node:sqlite`
fixtures, applying migration 270 **verbatim off disk** against a table built in
its pre-270 shape. Migration **270** is used; **271 is free**.

---

## D159

**One `logAdminAction`, and the two copies that dropped the audit write.**
(F.8 item 7's "one `logAdminAction`", task #278)

### The defect

`logAdminAction` was declared **four times** with the same five-parameter
signature, and the four did not do the same thing:

| copy | writes |
| --- | --- |
| `routes/admin_exploring.ts:83` | `activity_logs` **+** `admin_audit_log` |
| `routes/admin_partners.ts:46` | `activity_logs` **+** `admin_audit_log` |
| `routes/admin_advisor_audit.ts:37` | `activity_logs` **only** |
| `services/matchAudit.ts` | `activity_logs` **only** |

`matchAudit.ts`'s own header said it *"mirrors admin_advisor_audit.ts
::logAdminAction (same columns)"*. That was true, and it is exactly how it
inherited the gap.

**What it cost is not bookkeeping.** HQ's H7 governance feed
(`routes/admin_security.ts` `GET /governance`) unions four stores, and an
action reaches it two ways only: from `admin_audit_log`, which
`FEED_AUDIT_ALL_SQL` reads **unfiltered**, or from `activity_logs` — but that
arm is `WHERE l.action IN (?,?,?,?,?,?,?,?)` against `ACTOR_SIDE_ACTIONS`, a
fixed list of eight (`role_changed`, `user_toggled`, four KYC actions, two
contract actions). So **four privileged admin actions reached neither arm**:

- `advisor_shadow_cleared` — an admin clears a user's AI-safety shadow flag
- `advisor_locked` / `advisor_unlocked` — an admin locks or unlocks an advisor
- `match_list_generated` — an admin generates a match list over people

They were invisible on the one screen whose entire subject is privileged
actions, and `/security/overview`'s `audit.total` undercounted by exactly them.
**D156 sealed `admin_audit_log` against UPDATE and DELETE three days earlier;
a row that never arrives gets nothing from that seal.**

### What lands

`cloudflare-worker/src/services/adminAudit.ts` — one exported helper, in
`services/` and not `util/` on `util/README.md`'s own line about domain
knowledge. The four call-site files import it and delete their copies. It
imports `ensureAdminAuditLogTable` from `routes/admin.ts`; a service reaching
into routes has **ten precedents** here (`services/catalog.ts`,
`services/promos.ts` → `routes/billing`) and `routes/admin.ts` imports neither
audit service, so there is no cycle.

**The bootstrap moves in with it.** The two copies that did write to
`admin_audit_log` swallowed failure under a bare catch reading *"admin_audit_log
may not exist in some envs"* — while `ensureAdminAuditLogTable` exists precisely
so that it does, and nine other writers call it first. The catch was hiding a
condition its own neighbour already fixes. It is kept only for what is
genuinely best-effort: an audit write must never be the reason an admin action
fails **after it has happened**.

### The correction the build made, which is the sharper half

The plan said the key naming a subject was `target_user_id` **unanimously**.
Measured across all eleven call sites, five name a person and it is
`target_user_id` in **four of the five**. The fifth,
`partner_firm_link_set` (`routes/admin_partners.ts`), passed **`user_id`** — so
attaching a person to a partner firm would have been recorded with **no subject
at all**: the quiet version of this same bug, surviving the fix for it. D159
renames that one key, and a guard pins the spelling, because a convention that
is only four-fifths true is not a convention — it is a coincidence with a
counter-example already in the tree. Nothing parses `admin_audit_log.filters_json`
by key (the parsers are all on the unrelated `publications` table), checked
before renaming.

**The target is filled at all**, which neither surviving copy did: they bound
three columns, so every row they wrote had a blank Target on a feed that
`LEFT JOIN users t ON t.id = a.viewed_user_id` to render one. Validation mirrors
the callers' own (`Number.isFinite(uid) && uid > 0`) rather than being stricter
— a helper that silently dropped a target its caller had already validated would
be this same bug again, one layer down.

### Verification

`test:drift` exit 0 read as the exit code from a redirected log. **No migration
— 271 stays free.** No new `/api/*` method, no `frontend/src` change, so `docs/`
does not move. **9 mutations, 9 caught**, one only after the mutation itself was
corrected: the first M6 *added* a second audit write instead of collapsing the
two try blocks, so the row still landed and the assertion correctly still
passed — the mutation was wrong, not the guard.

**Two of my own assertions were wrong before they ran, and both are recorded
rather than quietly fixed.** The fixture reported *"activity_logs did not
receive the action"* because `activity_logs` carries
`project_id INTEGER REFERENCES projects(id)` and the fixture had no `projects`
stub — a failure the helper **swallows by design**, so the test was reporting a
defect that was its own. And the convention scan used a 400-character window
that reached past each call into the `return c.json({ ok: true, user_id: uid })`
below it, reporting four violations that were not violations — **the same
overreach as D147's**, now bounded by matching parentheses instead, with a
mutation that reverts it to the window and must fail.

---

## D160

**A raw ISO bind met a bare timestamp comparison, and the window lost a day.**
(#253 — D125's timestamp audit, second half: the bound-parameter blind spot)

### The defect

`scripts/check-timestamp-comparisons.mjs` watches for a bare TTL column compared
against the clock, and its own header states what it cannot see:

> *"A column compared against a BOUND PARAMETER (`created_at >= ?`) is the same
> defect and is invisible here, because the format lives at the bind site. That
> is how `rpc/branchOps.ts` came to drop every row dated on a quarter's first
> day. Finding those needs the bind traced, which is a different tool."*

Traced. SQLite compares TEXT lexically, and three bind shapes reach these
queries — only one is wrong:

| bind | value | against `datetime('now')` storage |
| --- | --- | --- |
| `.toISOString()` | `2026-08-19T12:44:00.000Z` | ❌ **wrong** |
| `…slice(0,19).replace('T',' ')` | `2026-08-19 12:44:00` | ✅ exact |
| `…slice(0,10)` | `2026-08-19` | ✅ correct by prefix alignment |

At index 10 the raw ISO has `'T'` (0x54) where the column has `' '` (0x20), so
**every row dated on the bind's own date sorts below it and is dropped**, while
later dates pass. A thirty-day window quietly returns twenty-nine.

`market_intel.ts` already documented this hazard and already fixed it in its
Citations query — `WHERE datetime(created_at) >= datetime(?)`, with a comment
spelling out the `T` separator. Three queries 650 lines below it did not.

### What the sweep corrected about the filing

The plan named three sites. Measured, the picture is both narrower and wider:

- **Narrower.** Of 47 grep candidates, most are correct. `aiRouter.ts` (D152's
  guardrail counters and D158's category breakdown) and `aiSpend.ts` normalise
  with `.replace('T', ' ')`; `admin_revenue.ts`'s `quarterOf` emits bare dates,
  which are correct by prefix alignment; and `branchOps.ts:553` is a **comment**,
  not a comparison — the lexical-scan trap again.
- **Wider.** The new guard found **seven more** the manual sampling missed, in
  `advisors.ts`, `portfolio.ts`, `wellbeing.ts`, `market_intel/extractors` and
  `xAggregator.ts`. That it found defects its author had not is the strongest
  evidence it works.

Every `created_at` in the schema is SQL-format — **308 columns** default to
`datetime('now')` or `CURRENT_TIMESTAMP`, and **zero** INSERTs write one from a
JS ISO string — so all of them are real.

### What lands

24 comparisons across six files wrapped as `datetime(col) … datetime(?)`, and
`cloudflare-worker/test/iso_bind_comparisons_d160.test.ts`.

**It deliberately does not require every comparison to be wrapped.** 46 sites
bind against a bare timestamp column and all but the ten fixed here are correct.
A blanket rule would mean rewriting 36 working queries — churn on correct code,
and a diff nobody can review for the lines that matter. The rule fires only where
a **raw ISO bind** and a **bare comparison** meet.

The cost of wrapping is that an index on the column cannot serve the predicate.
Accepted, and stated rather than discovered: these are analytics reads over small
tables, and the Citations query set that precedent already.

### The guard corrected itself before it shipped

Its first draft carried a `(?<!datetime\()` lookbehind — *skip it if the COLUMN
is wrapped* — which is the wrong test, and would have waved through a real
defect. **The placeholder side is what decides it**: `col >= datetime(?)` is
correct even with a raw ISO bind, because `datetime()` normalises the bind to the
column's format; `datetime(col) >= ?` is still broken, because the left becomes
SQL format while the right stays ISO. The lookbehind is gone and an assertion
pins the half-wrapped form as a defect.

### Verification

`test:drift` exit 0 from a redirected log — frontend 2703, worker 3480 (3477 pass
+ the 3 pre-existing environment-gated skips), retention 35, zero `not ok`. Worker
typecheck, `check-sql-prepare`, `check-sqlite-dialect` and
`check-timestamp-comparisons` exit 0. **3 mutations, 3 caught** — reverting a fix,
blinding the classifier so its assertion cannot fail, and restoring the bad
lookbehind. No migration; **271 stays free**. No `frontend/src` change.

---

## D161

**The branch dimension D105 justified sharing a dataset for was never written,
and the config var that would have let a preview read its own writes had no
reader.** (#277 — D105's half-built premise)

### The defect, both halves

**D105 traded isolation for a capability that did not exist.** Every other
Cloudflare resource is per branch; the Analytics Engine dataset alone is
shared, and the reason given was that *"One dataset indexed by `BRANCH_CODE` is
what makes those two numbers possible without a cross-branch read."* Measured:
the repo's only `writeDataPoint` (`middleware/observability.ts`) wrote
`indexes: [path]` and carried **no branch code in any index, blob or double**,
and the reader (`services/analyticsReports.ts`) hardcoded `FROM
studioos_metrics` with **no branch dimension at all**. So the write-side half
of D105's own justification was never built and every per-branch AE query
returned nothing — a decision record stating a capability that did not exist,
which is the class this programme has now deleted a dozen times.

**And `AE_DATASET` was a producer with no reader, which already cost
something.** The generated branch configs have written it since D105, whose own
comment says it exists so *"the SQL-API reader"* stops *"hardcoding HQ's"* —
and `AE_DATASET` had **zero hits anywhere in `cloudflare-worker/`**, the `Env`
type included. Meanwhile `[env.preview]` writes `studioos_metrics_preview`
(`wrangler.toml`) while the reader queried `studioos_metrics`, so **a preview
deployment's AE reads could not see its own writes** — invisible, because a
failed read returns `null` and silently falls back to D1 `system_metrics`.

### A blob, not an index — and D105's sentence is corrected rather than satisfied

Three reasons, in order:

1. **The first index is the sampling key**, and the sampling key is the route.
   Making the branch an index changes it for every request on the platform, so
   samples either side of the change stop being comparable and route-level
   sampling fairness — the reason `path` is the key — is lost.
2. **The blob slots are a stated contract** (*"must match SQL reads in
   analyticsReports.ts"*), so appending after the last used slot breaks nothing.
   blob1–blob5 are unchanged; blob6 is new.
3. **The decisive one.** `AnalyticsEngineDataPoint.indexes` is typed
   `((ArrayBuffer | string) | null)[]` — an **unbounded** array — so a second
   index *typechecks*, and the write site swallows failures with a
   `console.warn`. If the runtime rejects a second index the failure is silent
   and unverifiable from here. **The blob design does not depend on that fact,
   which is the point of choosing it.**

**How many indexes AE accepts per data point could not be read from this
environment**, in six attempts across two channels: the Cloudflare docs MCP
returns empty for every phrasing tried, and `developers.cloudflare.com` is
`EGRESS_BLOCKED` by this environment's proxy. Recorded as unreadable rather
than asserted from memory.

So D105's paragraph now says what is true — the dataset is shared and
**filterable** by branch, not indexed by it — corrected in **all three** places
that restated the false claim (`DECISIONS.md`, `scripts/lib/branchConfig.mjs`,
`scripts/lib/branchConfig.test.mjs`). Fixing one and leaving two is exactly how
this class survives.

### The gate is the design, not a detail of it

`/monitoring/analytics/technical` and `/management` are **`requireAdmin`**, and
on this platform's tier model a plain admin **is** a branch admin. Today those
routes return platform-wide **aggregates with no branch attribution**, which a
branch admin may defensibly see. Letting the branch dimension flow through them
would turn an aggregate into **per-branch attribution** — every branch admin
reading every other branch's traffic, the exact isolation the branch programme
exists to create. That file's header already states D133's rule: *a route that
reaches a cross-admin read is one whatever it renders, and gating some of them
is gating none of them.*

So the rule is narrow and costs nothing:

> **The dimension is WRITTEN on every request. The per-branch SPLIT is
> super-admin-only. The existing platform-wide aggregate on `requireAdmin` does
> not change at all.**

Zero behaviour change for every admin who is not the holder is the property
that makes this safe to ship ahead of the first branch being provisioned.

### The throw on the hot path, reasoned about rather than inherited

`branchOf(env)` **throws** on a malformed `BRANCH_CODE`, deliberately
(`util/branch.ts`): *"A branch Worker that quietly ran as HQ would serve HQ's
console over branch data, and every request failing loudly is the safer of the
two."* That is a throw on every request's metrics write, so it needed an
argument rather than a habit. It is safe here structurally: the AE write
already sits inside its own `try/catch` that warns and continues, so a
malformed code costs **a dropped metric, not a failed request** — correct,
because such a deployment is already failing loudly at boot
(`assertBranchAppUrl`) and on every authed path. `env.BRANCH_CODE` is
deliberately **not** read raw, which would write a garbage dimension verbatim.

### What lands

| path | change |
| --- | --- |
| `middleware/observability.ts` | the one `writeDataPoint` appends `branchOf(env) \|\| 'hq'` as **blob6**; `indexes` untouched. Also drops an `as unknown as` cast working around `Env.ANALYTICS`, which is properly declared, and makes the `MiddlewareHandler` import type-only — the file was the only middleware importing it as a value, and that is what kept the module from loading under the test runner |
| `types.ts` | `Env` gains **`AE_DATASET`**, defaulting to `studioos_metrics` so HQ is unchanged |
| `services/analyticsReports.ts` | `aeDataset(env)` gives the var its reader; `aeSql(env, sqlText)` consolidates the one fetch shape; **`loadTrafficByBranch`** is the split, returning `available/reason/as_of/rows` |
| `routes/monitoring_analytics.ts` | `/traffic-by-branch` on **`requireSuperAdmin`**. `/technical` and `/management` unchanged, with the reason stated in place |
| `frontend/src/lib/api.js`, `pages/hq/PlatformPage.jsx` | one method and its HQ consumer, in the same commit so `check-api-drift` is satisfied |
| `test/ae_branch_dimension_d161.test.ts` | new |

**No migration — 271 stays free.** No new store.

### Two states that must not render alike

An empty split has two entirely different causes — **no branch has traffic**,
or **AE could not be read at all** — and `loadTrafficByBranch` returns them
differently (`available: true` with no rows, against `available: false` with a
reason naming the store). The surface renders them as different sentences,
neither of them a zero. That is the rule this programme has applied since D107
and D129, and the reason the unreadable path is exercised by three separate
fixtures rather than assumed.

### An optional branch predicate was written first, and deleted before it shipped

`loadTechnicalFromAnalyticsEngine` briefly gained an optional branch filter.
Nothing would have called it — the split answers the per-branch question by
**grouping**, not filtering — so it was a producer with no reader, which is the
shape this entry exists to correct. Removing it also deleted the only path by
which a caller-supplied value could reach AE SQL, and that matters: the AE SQL
API takes `text/plain` and has **no binding mechanism at all**, so every value
in those queries is interpolated. The interpolation surface is now enumerated
and pinned by a test — only the configured dataset name and the parsed range
reach it — and `BRANCH_CODE_RE` is shown to **refuse** a quote-bearing value
rather than escape it.

### Verification

`test:drift` exit 0 read as the exit code from a redirected log. **13
mutations, 13 caught** — one only after the assertion it exposed was
strengthened. On the worker: the branch tidied into `indexes`; the branch
written into blob1; `env.BRANCH_CODE` read raw; the split served on
`requireAdmin` (the one this change exists for); the dataset hardcoded back
over `AE_DATASET`; the branch dimension added to the `requireAdmin` aggregate;
an unreadable store rendered as an available empty list; a caller-influenced
value interpolated into the `text/plain` SQL. On the surface: the unreadable
state drawn as a zero; the empty-but-readable sentence deleted; the one-row
clarification dropped; the zone removed; a `?branch=` grown on the
`requireAdmin` method. Every anchor asserted unique before it was applied,
every mutation proved to have changed bytes, every restore from a **snapshot**
and verified byte-identical.

**The one escape, and it is the D147 lesson again.** "The empty-but-readable
sentence deleted" passed at first, because the Deployments zone four hundred
lines up renders *"an empty registry, not an unreadable one"* — so a whole-file
match on that phrase held with this zone's own sentence gone outright. An
assertion a NEIGHBOURING zone can satisfy is not an assertion about this one.
The check is now bounded at both ends to the traffic zone's own markup, and the
mutation is caught.

**The absent-branch case is exercised, not assumed**, and it is two cases: with
zero branches provisioned every row carries `hq` and the split renders exactly
one group, and separately AE may be unreadable in three distinct ways. **A
preview-shaped fixture proves the dataset fix** — `AE_DATASET` pointed at
`studioos_metrics_preview`, with both AE queries asserted to name it and to
carry no trace of the hardcoded name.

---

## D162

**The bound-parameter rule stops being a typed list of six, and four
entitlement reads stop losing a day.** (#253 — D125's timestamp audit, the
remainder D160 left)

### What D160 left, and why a list was always going to leave it

D160 closed D125's stated blind spot — a raw `.toISOString()` bind meeting a
bare timestamp comparison, which drops every row dated on the bind's own date,
because SQLite compares TEXT lexically and index 10 is `'T'` (0x54) against
`' '` (0x20). It watched **six column names, chosen by hand**. Measured against
the wider vocabulary those six miss **four live sites in three files**, every
one of them money- or entitlement-adjacent:

| site | column | what it did |
| --- | --- | --- |
| `routes/news.ts` | `article_submission_log.submitted_at` | the three-per-week submission limit **under-counted**, so an author whose earlier submission fell on the window's own date got a fourth |
| `routes/wellbeing.ts` (the count) | `expert_profile_views.viewed_at` | the free-tier monthly cap **under-counted**, so views taken on the 1st were free |
| `routes/wellbeing.ts` (the already-seen check) | the same column | a founder who viewed an expert **on the 1st** was told they had not, and was charged a second unit for it |
| `services/xAggregator.ts` | `market_intel_indexes.computed_at` | `safeHasMIChart` answered **false** for a chart computed on the period's first day — the same wrong answer its own header records the previous version always giving |

**The two wellbeing sites pull OPPOSITE ways on the same day**, which is why
the class is worth stating rather than assuming understood. On the 1st of a
month the paid cap both **leaks** (the count misses views, so the quota reads
low) and **over-charges** (the already-seen check misses the prior view, so one
expert costs two units) — on one request path, from one date boundary. Fixing
either alone leaves the cap wrong in the other direction.

### The rule, and it needs no list

The defect is not "a raw ISO bind". It is a raw ISO bind meeting a column
**SQLite itself wrote**. A column declared `DEFAULT (datetime('now'))` or
`DEFAULT CURRENT_TIMESTAMP` holds `YYYY-MM-DD HH:MM:SS`; a column with no
default holds whatever JavaScript bound, which in this codebase is ISO — and
ISO against ISO is consistent. So the schema already knows which is which, and
`test/_sqlFormatColumns.mjs` asks it instead of curating a list.

It separates the seven measured candidates perfectly. The three with a clock
default are exactly the three broken columns; the four without are exactly the
four struck — `advisor_office_hour_slots.starts_at` (no default, bound verbatim
from the request), `legal_obligations.expires_at` and `pairwise_ndas.valid_until`
(written `.toISOString()`; **D125 struck these explicitly**), and
`users.mi_digest_paused_until`, whose own comment already documented it as ISO
and said comparing as strings is safe.

### Three things proving the subsumption found, none of which a list would have

D160's scan stays, as a backstop against the derivation silently returning
nothing — and proving it is subsumed rather than claiming it turned up all
three of these:

1. **`paid_at` has no DDL default and IS SQL-format**, set with
   `datetime('now')` or `CURRENT_TIMESTAMP` at four sites
   (`services/incorporations.ts` ×2, `services/orders.ts`, `routes/network.ts`).
   A schema-only rule would have called a money column clear. The derivation
   reads the code's clock writes as well.
2. **The clock-write rule had to be TABLE-AWARE, and its first draft was not.**
   Attributing a clock write to every table at once looked like the safe
   direction — err toward flagging — and it is not: `expires_at` is written
   with the clock on one table and with `.toISOString()` on `legal_obligations`,
   so the table-agnostic set demanded a rewrite of the very query D125 examined
   and struck. **A false positive here costs churn on correct code, which D125
   refused by name.**
3. **Two of D160's six names are declared by nothing at all.** `occurred_at`
   has zero occurrences in the baseline, in any migration and in any runtime
   bootstrap; a standalone `recorded_at` likewise (the only such text in the
   tree is `outcome_recorded_at`, a different column its own word boundary
   correctly does not match). A hand list can carry a name nothing has ever
   declared and never fail for it — which is the whole argument, arrived at by
   measurement rather than by preference.

### What lands

| path | change |
| --- | --- |
| `routes/news.ts`, `routes/wellbeing.ts` ×2, `services/xAggregator.ts` | four comparisons wrapped `datetime(col) >= datetime(?)` |
| `test/_sqlFormatColumns.mjs` | **new** — the derivation, plus `rawIsoNames` lifted out of D160's test file so one definition serves both and importing one test file no longer re-registers its tests inside another's run |
| `test/iso_bind_comparisons_d160.test.ts` | imports `rawIsoNames` instead of declaring it; its scan and its three unit tests are otherwise untouched |
| `test/iso_bind_sql_columns_d162.test.ts` | **new** |

**No migration — 271 stays free.** No `frontend/src` change, so no `docs/`
rebuild. Wrapping costs the column's index for that predicate, accepted for the
reason D160 accepted it and stated rather than discovered: these are small
tables read once per request, and a correct count beats a fast wrong one.

### Verification

`test:drift` exit 0 read as the exit code from a redirected log. **7 mutations,
7 caught**: each of the four comparisons un-wrapped; the half-wrapped form (a
normalised column against a raw ISO bind, which is still the defect); the DDL
derivation made to return nothing, which must fail the subsumption assertion
rather than let the sweep pass **vacuously**; and the clock-write rule made
table-agnostic again, which must fail the assertion that one table's clock
write cannot make another table's column look SQL-format. Every anchor asserted
unique before it was applied, every mutation proved to have changed bytes,
every restore from a **snapshot** and verified byte-identical.

---

## D163

**HQ's own branch-targeting acts survive the branch going dark.**

Every HQ→branch push reports whether it LANDED as its own field and never
throws — the D111 rule `services/licencePush.ts:13-19` states outright, and it
is right: HQ's ledger is the record, and a 502 for an unreachable branch would
make an operator re-enter a decision that is already stored.

**But that report is per-call and ephemeral.** It reaches the operator who made
the call, in that one response, and nothing keeps it. HQ's D1 records the
transition; it does not record that the branch refused the copy, or that no
Worker answered. So the question an outage post-mortem actually asks — *which
branch was unreachable, and which of HQ's own acts against it failed while it
was* — had no store that could answer it. D161 named this as its own next step
and built the prerequisite: the branch dimension on the Analytics Engine write.

### The finding the whole design turns on

**`HqEntrypoint` is exported BY THE BRANCH** (`rpc/index.ts:41`). It is the
class HQ calls, and it runs on the branch's own `env`. So a `writeDataPoint`
placed inside those handlers — the obvious home for it — would be lost in
exactly the case the mirror exists to survive. The write belongs at **HQ's call
site, in HQ's isolate**, recording what HQ OBSERVED rather than what the branch
managed to say.

Analytics Engine is the one store that satisfies both halves: every deployment
already writes to it (D105's shared dataset), and it does not live on the
branch whose silence is the thing being recorded.

### The one that would have corrupted two live reports

Neither existing AE reader filtered by row kind, because until now there was
only one kind. Without a predicate, a mirror row appears in
`loadTechnicalFromAnalyticsEngine` as an endpoint named `hq:branch_action`
(`GROUP BY blob1`) and is counted into a branch's `hits` in
`loadTrafficByBranch` (`GROUP BY blob6`) — **both figures on a live HQ screen.**
So both queries gain `AND blob1 LIKE '/%'` in this same commit.

It matches on **blob1 rather than index1** for a verifiability reason rather
than a performance one: blob1 is the slot both queries already project and
group by, so a WHERE over it is a demonstrated construct in this repo, and
`developers.cloudflare.com` is `EGRESS_BLOCKED` from this environment, so an
untested one could not be confirmed. An HTTP row's blob1 always starts `/api/`
(`middleware/observability.ts:26` meters nothing else); the sentinel cannot
collide with it.

### Security · Governance is NOT the home, and that was measured

`admin_security.ts`'s feed is stated three times in the live code to be HQ's
own record of what HQ did, and not a branch's to show — the file header (quoted
at `frontend/src/pages/hq/SecurityPage.jsx:55-56`), the rail row at `:379`, and
`tenant_reason` at `admin_security.ts:664`. That is a deliberate boundary, not
an oversight, and this decision does not touch it. It does not need to: the
mirror carries **only HQ's own acts**, grouped by which branch they concerned —
the same thing `licence_events` already does with `brand_name`, which that file
calls "the one column that is real here, and only here."

### What lands

| path | change |
| --- | --- |
| `cloudflare-worker/src/services/auditMirror.ts` | **new** — `mirrorBranchAction(env, action, outcome, code)`. Synchronous (`writeDataPoint` is fire-and-forget, so it costs the request nothing), own try/catch, `console.warn` only, never throws |
| `cloudflare-worker/src/services/licencePush.ts` | `pushLicenceToBranch` mirrors at its three code-carrying exits — **one edit, six callers** (`admin_licences.ts` ×5 and `services/complianceLadder.ts:307`) |
| `cloudflare-worker/src/routes/admin_support_sessions.ts` | `openSupportSession`, `moveAccountOut`, `inviteAccount` — the move mirrors against **whichever end** is unbound, never both |
| `cloudflare-worker/src/routes/admin_escalations.ts` | the escalation-answer push |
| `cloudflare-worker/src/routes/admin_statements.ts` | the promo-ceiling push |
| `cloudflare-worker/src/services/analyticsReports.ts` | `loadBranchActionMirror`, plus the two `HTTP_ROWS_ONLY` guards above |
| `cloudflare-worker/src/routes/admin_deployments.ts` | `GET /deployments` gains a `branch_actions` block beside `registry_available` and `dispatch_available` — **no new `/api/*` method** |
| `frontend/src/pages/hq/PlatformPage.jsx` | the Deployments zone renders it per branch, with the unreadable state said **once** |

**The row shape**, aligned with the per-request row rather than packed tight:
`index1` and `blob1` the sentinel, `blob2` action, `blob3` outcome, `blob6` the
branch — **the same slot** `observability.ts:126` uses — and no doubles.

**No migration; AE is not D1. 271 stays free.**

### Three calls made rather than asked, each cheap to reverse

1. **The mirror carries no identity at all** — no actor id, no email, no reason
   text. HQ's own D1 holds the actor authoritatively
   (`admin_audit_log.admin_user_id`, `licence_events.actor_user_id`) and is
   always readable, because it is HQ's. The mirror exists for the one dimension
   D1 cannot give; identity in a shared analytics store would add exposure and
   no information. *Strike it and the actor id rides in double3, the slot the
   per-request row already uses for `user_id`.*
2. **A licence with no deployment is not mirrored at all.** It has no branch, so
   there is no branch the act concerns, and a row with an empty branch would put
   a non-branch in the per-branch grouping. `not_deployed` is kept for the
   narrower, real case: a deployment row exists and no Worker is bound to it.
3. **The two fan-out pushes are excluded** — `applyBenchmarks`
   (`services/branchBenchmarks.ts:220`) and `publishTemplate`
   (`routes/admin_contracts.ts:1382`) broadcast to every branch rather than
   targeting one, so they are a different row shape: one per branch per publish,
   off the `fanOut` result array. Filed, not built.

**And one refused with its measurement:** a genuine unreachable-vs-refused
split. Every call site collapses those two into one `catch` today
(`licencePush.ts:180-182` and the four others), so `failed` collapses them here
too rather than claiming a distinction its own inputs cannot make.

### Verification

`test:drift` exit 0 read as the exit code from a redirected log. **8 mutations,
8 caught** — the exclusion predicate dropped from **both** readers (which fails
two assertions, one per report, read off the SQL on the WIRE rather than out of
the source, so a predicate written but not sent still fails); the branch moved
out of blob6; the `BRANCH_CODE_RE` refusal removed; the AE write allowed to
throw; and on the surface, the zone-level unreadable sentence deleted, the
server's reason replaced by one written on the page, the nothing-recorded guard
dropped, and a count given a `|| 0` fallback. Every anchor asserted unique
before it was applied, every restore from a **snapshot** and verified
byte-identical.

**One thing the build corrected in its own test.** The first fixture returned a
bare array where `aeSql` unwraps `{ data }`, so the populated-read assertion
measured zero rows and failed — correctly. A fixture shaped differently from
the thing it stands in for is how a test passes against its own mistake, and
this one failed instead.

---

## D164

**Eighteen unused declarations, one sweep, and the two guards that could not see
any of them.**

Eighteen Copilot-autofix PRs opened against `main` within a day of each other,
every one deleting a declaration CodeQL had found unreferenced, every one a
draft, every one red on the same stale-`docs/` gate. Resolved one at a time that
is eighteen merge-rebuild-CI cycles — and **seven of them delete adjacent blocks
of one file**, `frontend/src/decks/templates/axal_spinout_demoday_app.tsx`, so
each one merging re-conflicts the other six. `Dashboard.jsx` and
`FounderRaisePitch.jsx` pair the same way.

So they land as one commit. What made that the right shape is not the CI
arithmetic, though: it is that **every one of the autofixes is right about the
symbol and incomplete about the residue**, and no single-symbol PR can see it.

### What one sweep can do that eighteen cannot

Each deletion strands a comment describing the thing deleted. Five did:

- **`axal_spinout_demoday_app.tsx:372-375`, the sharpest.** It said eight slides
  render their index *"via `<Eyebrow>`"*. **Zero do** — seven take it from
  `<HeadRow>`, three inline the markup, and `SlideCover` carries none. The
  sentence was already false; deleting `Eyebrow` and leaving it would have told
  the next reader that a component which no longer exists is load-bearing for
  eight slides.
- **`PartnerBucketRoutes.jsx:178-183`** — six lines explaining why
  `PartnerEngagements` takes no `embedded` prop, about a binding this commit
  removes.
- **`buildDeck.js:324`** — *"Mirrors the in-app `Avatar`"*, a cross-reference
  about to point at nothing.
- **`TrustCenterPage.jsx`'s file header** — *"legacy KYB / Accreditation / NDA
  cards consume the older `/trust/summary` endpoint shape"*. All three cards are
  gone and the page no longer calls that endpoint.
- **`eslint.config.mjs:42-47`** — *"the SPA has no tsconfig at all"*, untrue
  since #201/D96 created `frontend/tsconfig.json`.

### Three of the twenty findings would have been WRONG to delete

This is why the sweep verified each symbol instead of trusting the scanner.

1. **`{ plan, tier, investor_tier, ...rest }` and `{ project_id, ...patch }` are
   omit-by-destructuring.** The bindings exist *in order to be unread* — naming
   them is what keeps the keys out of `rest`. Deleting them, which is what an
   unused-variable fix means, would have carried the keys through: a behaviour
   change dressed as cleanup, in a subscription-taxonomy selector and a need
   patch. Both sites carry a comment saying exactly this. The answer is
   `ignoreRestSiblings: true`, not an edit.
2. **`AdminXFull` is deliberately preserved** with a re-enable plan three lines
   above it and a `codeql[js/unused-local-variable]` pragma on its own line
   saying so. It keeps its parked state and gains the ESLint dialect of the same
   claim.
3. **`_` in `for (const _ of str) n++`** is a throwaway binding the syntax
   requires. Covered by the ignore pattern, not removed.

### The one that was a cost, not dead code

**#639 proposed `const [legacy, setLegacy]` → `const [, setLegacy]`**, keeping
the setter. That would have kept `api.getTrustSummary()` alive as the **only
caller of `/trust/summary` in the entire frontend** — a route that runs
`requireAuth`, `ensureTrustSchema`, `seedObligations` and two D1 reads
(`routes/trust.ts:600-632`) **on every Trust Center load**, for a payload stored
in a state nothing read. Every field had already been repointed: `role`, `score`
and `obligations` to `/trust/me`, the NDA card to `/nda/required` after its rows
turned out to be the wrong shape, and `kyb`/`accreditation` are hardcoded `null`
server-side, which is why their cards were deleted. So the whole read goes, not
the binding.

**The route itself stays**, with the canary at
`frontend/test/trust_center_contract.test.mjs:93-96` that asserts those nulls as
the premise for the card deletion. Retiring it server-side is its own decision;
this commit stops paying for it on every page load and says so in the file.

### Why nothing in the repo could see any of this

| check | why it missed them |
| --- | --- |
| `check-unused-imports.mjs` | its detection is `const\s*(?=\{)` (`:266`) — a lookahead that **requires** a brace, so `const Foo = …` is invisible by construction, and the file has no `function` handling at all. Its own header scopes it to two shapes: a named import and a destructured local |
| `eslint.config.mjs` | `no-unused-vars` was not configured — the config is deliberately `no-undef` only — **and** its glob is `{js,jsx}`, so it never reached the `.tsx` file holding seven of the eighteen |
| `frontend/tsconfig.json` | existed since #201 and checked types only |

Both gaps close in this commit, and the division of labour is now clean: this
config takes `.js`/`.jsx`, the frontend tsconfig takes `.ts`/`.tsx`, and
`check-unused-imports.mjs` takes the five trees neither reaches — the worker,
`scripts/` and both test trees — for the two shapes it was written for.

**`"noUnusedLocals": true`** was free: `tsc --noEmit` was already clean, and
with the flag it reported exactly seven errors, all TS6133, all in the one deck
template, zero across the other 26 TS files. `noUnusedParameters` is **not** set
— it adds 11 findings, all positional callback parameters.

**`no-unused-vars`** is scoped four ways, and the numbers are why. Bare, it
reports **523**. `args: 'none'` drops 78 positional React-callback parameters
you cannot remove without rebinding the rest. `caughtErrors: 'none'` leaves
`catch (e)` alone. `ignoreRestSiblings: true` is finding 1 above.
`varsIgnorePattern: '^(React|_)$'` drops **425** — the legacy
`import React from 'react'` that 446 files still carry although both the Vite
plugin and the tsconfig use the automatic JSX runtime. That is one codemod
awaiting its own PR, so it is a **scoping decision, not a suppression**, and
`check-unused-imports.mjs:18` already declines default imports for a related
reason.

**What survives all four is 20 real findings, which is why there is no baseline
file.** `scripts/inline-project-pickers-baseline.json` argues in its own note
that a ledger is kept empty on purpose; one holding twenty entries this same
commit deletes would exist only to be deleted again.

### Three cascades the guards caught, which is the point of having them

Deleting a dead declaration can orphan its only input, and each of these would
have become the *next* round of alerts:

- `isOperator` was the only reader of `operator_workspace` in Dashboard's
  destructure — caught by `check-unused-imports.mjs`, which does cover that
  shape;
- `Title` was the only consumer of `Ed`, which was the only consumer of
  `EdProps` — caught by `noUnusedLocals`, and it bottoms out there:
  `Editable` has 21 live uses and `OnEdit` is read by `SlideProps`;
- `shows` was the only reader of `known` in `InvestorDealsWorkspace` — and since
  `shows` itself had no callers, **that component had already stopped filtering
  by zone**. Deleting the pair makes that visible rather than causing it; the
  four `/deals/*` zones each render their own page since #189-A. The `zone` prop
  stays in the signature, now accepted and unread, because removing it is a
  change to the component's contract.

`Title`, `Ed` and `EdProps` had **no autofix PR**: `noUnusedLocals` found them
the moment it was armed, which is the guard paying for itself inside its own
commit.

### Deliberately filed, not folded in

- **`/trust/summary` server-side**, above.
- **`EngagementsPage`'s orphaned `view` prop, and the guard gap behind it.**
  `PartnerOperationsWorkspace.jsx:46` passes `embedded`, which the page never
  reads — exactly the seam `advisor_network_zones.test.mjs:261` exists to catch,
  except its scanner walks only `frontend/src/workspaces`, so a shell living
  under `pages/` is invisible to it. The same latent bug sits at
  `AdvisorAdvisoryWorkspace.jsx:47`. Widening that scanner is its own PR.
- **The 425 legacy `React` imports**, above.

### Verification

`test:drift` exit 0 read as the exit code from a redirected log. **12 mutations,
12 caught**, every restore from a snapshot and verified byte-identical.

Four of the twelve mutate the **config** rather than the source, which is the
only honest way to test an ignore pattern: dropping `React` from it must surface
the legacy imports (it did — **425**, independently reproducing the figure the
scoping decision was made on), dropping `_` must surface the throwaway binding,
dropping `ignoreRestSiblings` must flag the omit idiom, and dropping
`noUnusedLocals` must let the same dead `.tsx` const through. Adding an unused
`React` import to a source file **cannot** test the pattern — 446 files already
import React, so a second one is a duplicate binding and a syntax error, and the
first draft of the harness failed for exactly that wrong reason before it was
corrected.

Two more pin the shape from the other side: an unused **non-rest** destructured
name must still fail, so `ignoreRestSiblings` is not a blanket exemption; and
removing `AdminXFull`'s disable directive must fail, so that directive is live
rather than joining the inert `no-console` ones this repo already carries. Its
placement matters and the first attempt got it wrong: an explanation between
`eslint-disable-next-line` and the declaration makes the directive target the
comment, which is how an inert directive happens.

### A guard failed, and it was right to — one assertion could not fail for the defect it names

`investor_shell.test.mjs` refused the `shows`/`known` deletion, asserting *"the
investor Deals page must narrow to the zone it was given"*. Read rather than
worked around, it is the strongest finding here:

- the assertion is `assert.match(page, /const shows = \(section\) => …/)` — a
  **source-text match on the DECLARATION**. It never asserts the predicate is
  called;
- `no-unused-vars`, newly armed, proves it never was;
- and **twenty lines above, the same test asserts the four stage sections are
  GONE from that file**, because ID1–ID4 moved each onto its own route. The
  file's own closing comment agrees: *"All four decision panels are gone. This
  file now draws only what no artboard does: the deal-invitation queue."* One
  `<section>` remains.

So the two assertions contradicted each other, and the text match was the one
that could not tell a working predicate from a declared-and-uninvoked one —
only scope analysis can, which is the whole argument for arming the rule. The
narrowing had already stopped happening when its subject was removed; deleting
the predicate makes that visible rather than causing it.

Re-aimed at the property that is load-bearing now: the page renders **exactly
one** section, so the stacking defect the test is named for cannot recur without
a second appearing — and if one does, the failure message says the narrowing has
to come back with it. Mutation-checked: adding a second `<SectionHeading>` fails
it, which the old assertion would have passed.

Fourth instance of a guard needing to be re-aimed the day its premise changed
(D150, D152, D158), and the first where the guard pinned a **mechanism** after
the thing it operated on was deleted rather than pinning a refusal.

**No migration — 271 stays free.** No new `/api/*` method; the Trust Center
change removes a call.

## D165

**HQ could sign out everybody or nobody, and three revokes promised something
the strict comparison never gave them.**

`POST /api/admin/security/force-reauth` was `UPDATE users SET jwt_min_iat = ?
WHERE is_active = 1` and it was the only revoke HQ had. So signing out one
compromised administrator meant signing out **every account on every tenant,
including the operator's own session** — which in a real incident makes the safe
action the one nobody is willing to take.

The primitive was already per-account and had been since NICE-AUTH-04:
`bumpJwtMinIat(env, userId)` writes one row, and `getCurrentUser` re-reads that
row's floor on every request. What was missing was a door. `POST
/admin/security/force-reauth/:userId` is that door, behind the same bar as the
bulk route, with a reason ≥ `MIN_REASON` stored with the act and the target
named in the audit row.

### The `+1`, which is the part nobody would have found by reading

`getCurrentUser` compares `tokenIat < minIat` — **strictly**. So a token whose
`iat` equals the floor **survives**. Two writers knew that and said so in a
comment; three did not:

| writer | floor | what its own copy claims |
| --- | --- | --- |
| `bumpJwtMinIat` | `floor(now) + 1` | — |
| `admin_security.ts` bulk revoke | `floor(now) + 1` | *"+1s so tokens issued in this same second are bounced too"* |
| `settings.ts` `/sessions/revoke-all` | `floor(now) + 1` | *"+1s so that even tokens issued in this same second (rounding) get bounced"* |
| `settings.ts` email-change revoke | **`floor(now)`** | activity log: *"all sessions invalidated"* |
| `settings.ts` post-recovery TOTP re-enrolment | **`floor(now)`** | *"the lower-assurance session minted at recovery time is invalidated"* |
| `settings.ts` TOTP repair | **`floor(now)`** | response: *"Your existing sessions have been signed out."* |

So on three security paths a token minted in the **same wall-clock second** as
its own revocation stayed valid, and two of the three told the user in their own
words that it had not. One second later the floor is indistinguishable from a
correct one, so the gap never shows in a manual test and never shows in a log.

**This is why the consolidation is a bug fix rather than deduplication.** The
rule lived in a comment and was re-typed by hand four times; three of the four
re-typings dropped it. `jwtMinIatFloor()` is now the one definition of the floor
and `bumpJwtMinIat` the one definition of the write, and the D165 test proves the
fix **behaviourally** — the floor goes into a real database and is then run
through `getCurrentUser`'s own comparison, because a source scan for `+ 1` shows
the character is present and cannot show that a token minted this second bounces.

**One site deliberately does not call the helper.** The post-recovery
re-enrolment clears `recovery_step_up_due_at` and writes the floor in ONE
statement; splitting that to reuse `bumpJwtMinIat` would open a window where the
step-up nag is cleared and the weak session is still valid. It shares
`jwtMinIatFloor()` instead and says so in place, and the guard permits exactly
one inline write and asserts it is that one.

### Two more consolidations, each a copy this repo had already decided against

- **The write bar was hand-rolled for the fourth time.** The bulk route inlined
  `requireFactor(c,'totp')` → `requireStepUp(c)` → `requireSuperAdmin(c)` while
  `requireSuperAdminWriteBar` bundles exactly those three, in that order, with
  the argument for the order in its own docblock. Three copies is how one of
  them comes to check two.
- **It wrote a raw `INSERT INTO admin_audit_log`** instead of `logAdminAction`
  — the third such copy, and the one **D159 missed**. The governance row is
  byte-identical; what the shared writer *adds* is the `activity_logs` row D159
  requires, and what it *removes* is a failure mode: a bare `await …run()`
  throws, so a failed audit turned a **completed** platform-wide sign-out into a
  500 and told the operator their act had not happened.

**`bumpJwtMinIat`'s docstring was false**, and that is why the drift survived:
it said `/settings/sessions/revoke-all` shared the helper while `settings.ts`
inlined the UPDATE four times. A sentence asserting a consolidation had happened
is what stopped anyone checking. It now names its five real callers and the one
documented exception, and a test reads it.

### Three guards re-aimed, and the third went the other way

Two pre-existing guards pinned the **mechanisms** being consolidated, so both
failed on a change that strengthened what they exist to protect — the tenth and
eleventh instance of this class, and each re-aim is stronger than what it
replaced:

- `super_admin.test.ts` matched the three gates as adjacent source text *inside
  the handler* — pinning the fourth hand-rolled copy of a shared helper, and it
  would have gone on passing while a fifth route composed the same three in the
  wrong order. It now asserts the route takes the bar, and asserts the **bar's
  own composition where it is defined**, which covers all five callers.
- `hq_security.test.mjs` counted handlers against the literal `await
  requireSuperAdmin(c)` and made the two revoke routes look ungated, although
  `requireSuperAdminWriteBar` satisfies that rule *more*. It counts both doors
  now. Its scan was also a **slice to end of file**, and D165 put a second
  `/force-reauth` handler in that file — the D147/D161 failure exactly, so both
  handlers' scans are bounded at both ends.

**The third went the other way, and that is worth recording.**
`hq_team_h9.test.mjs` bans `new Date(` outright, for SQL-format stamps that V8
reads as the reader's local time. The first draft of the Sessions cell rendered
`new Date(revoked_at * 1000)` — **epoch seconds, which are unambiguous**, so the
guard fired for a reason that did not apply. It was still right: the operator has
just pressed the button, so the second adds nothing, and a clock rendered
client-side beside an act whose authoritative stamp is the audit row invites
being read *as* that stamp. **The code changed, not the guard** — a blanket ban
is what catches the next real SQL stamp, and weakening it to admit this case
would have spent that.

### The control's surface, and why it is scoped for free

The per-row revoke goes on **HQ · Team** (D138's supervision surface), on the
reason + acknowledge shape `SecurityPage`'s bulk control already uses, with one
form open at a time rather than one per row.

It is drawn **only on HQ-held rows**, and that is structural rather than a
condition: `AdminRow` renders only when there is no view-as overlay, and a
branch's hits render as a list, not as rows of this table. That matters because
the route writes **HQ's** `users` table — a branch admin's account lives in the
branch's own database, so the same button on a branch hit could only ever refuse,
which is the `still_an_admin` mistake D134 named and what D153's overlay copy
already promises.

**A distinct action name.** `security_force_reauth_user`, not the bulk route's
`security_force_reauth`: signing out one account and signing out the platform are
different acts with different blast radii, and one name for both would flatten
exactly the distinction the governance feed exists to show. The per-user row also
carries `viewed_user_id`, so the feed can name who was signed out.

**Filed, not folded in:** the audit feed tones a force-reauth as a plain `note`
(`action.includes('export') ? 'warn' : 'note'`), so a platform-wide sign-out
renders less loudly than a CSV export. That is a judgement about the feed's
rendering, not about this route.

### The gap this PR fell into, which is D164's other half

CodeQL flagged an unused `nowSec` on this PR's own diff: consolidating the
email-change revoke onto `bumpJwtMinIat` moved the write into the helper and
left the floor it used to bind assigned to a local nothing read. Correct
finding — and the interesting part is that **every local check passed.**

D164 armed `noUnusedLocals` in `frontend/tsconfig.json` and `no-unused-vars` in
`eslint.config.mjs`. Both are scoped to the SPA, so after eighteen
unused-declaration alerts were swept, **`cloudflare-worker/src` still had no
unused-local check of any kind.** The same lever closes it, and measuring the
cost turned up a second finding and a third blind spot:

| finding | what it was |
| --- | --- |
| `settings.ts` `nowSec` (TS6133) | D165's own, above |
| `positions.ts` `User` (TS6196) | **pre-existing** — a type imported and used nowhere |

The second one is the argument for the flag rather than a cost of it, because
`check-unused-imports.mjs` **does** reach this tree and still could not see it.
Its detection is `^import\s+(?:[\w$]+\s*,\s*)?\{` — the brace must follow the
keyword, or a default import and a comma must come first — so in
`import type { Env, User }` the word `type` sits exactly where the brace has to
be. **`import type { … }` is invisible to that regex by construction**, a third
blind spot beside the two D164 measured.

Widening the regex is deliberately NOT the fix: `import type` is TypeScript-only,
so `noUnusedLocals` on both tsconfigs already covers every file that can contain
one, and it decides by scope analysis rather than by pattern — the argument
`eslint.config.mjs` makes at length for preferring a real checker to a fourth
bespoke script. With both findings cleared, `tsc` reports zero.

**And the first measurement of that cost was wrong, which is recorded rather
than quietly corrected.** It said "exactly one", because it grepped a CLI run
for `TS6133` — an unused *local* — while an unused *type* is `TS6196`. Putting
the flag in the config reported both. A grep scoped to one diagnostic code is
how a cost looks smaller than it is.

**No migration — `jwt_min_iat` already exists, and 271 stays free.** One new
`/api/*` method with its route in the same commit.

---

## D166

**A "deprecated alias" was an approval-gate bypass, and D156 ruled it away on a
handler count.**

`/api/admin/news` and `/api/admin/articles` declared **11 handlers each over
identical paths**, both reading the same `articles` table, both gated by plain
`await requireAdmin(c)`. Their `transition()` tables matched verbatim. The whole
divergence sat in two handlers, and one line of it was not cosmetic:

| | `admin_news.ts:194` | `admin_articles.ts:206` |
| --- | --- | --- |
| publish gate | `if (!['approved', 'in_review'].includes(row.status))` | `if (row.status !== 'approved')` |

The canonical route's comment, three lines above its own gate: *"Approval gate:
publish requires explicit /approve first. No skipping straight from in_review →
published, even by an admin."* The other path let exactly that happen.

**Severity, stated so this entry does not overclaim.** Both publish handlers are
`requireAdmin`, so **no role boundary is crossed and this is not privilege
escalation.** What the twin removed is the *recorded approve step*: an article
could go `in_review → published` with nobody having called `/approve`. It is
workflow- and audit-integrity, and it is filed as that.

### The `use('*')` that reads like a gate and is not one

`admin_news.ts:35` is `adminNews.use('*', …)`, which looks like a perimeter until
you read its first statement: `await next()`. It runs the handler, then rebuilds
the response to stamp RFC 8594 `Deprecation: true` and a `Link: …
rel="successor-version"` header. It blocks nothing. So the bypass was reachable
by any admin who knew the path — which is what every document describing the file
as "a deprecated alias with no SPA caller" quietly assumed away. **Having no
caller in our own frontend is not unreachability.**

### Six more differences, every one a silent loss

| | `admin_news.ts` | `admin_articles.ts` |
| --- | --- | --- |
| publish 409 body | `{error, status}` | `{error, status, expected: 'approved'}` |
| publish follower fan-out | absent | `notifyAuthorFollowers` (Task #66) |
| publish cache-bust | `bustEdgeCache(env, slug, id)` | `bustArticleEdgeCache(env, slug, id, row.author_user_id)` |
| unpublish revision snapshot | absent (a tell-tale `void admin;`) | `snapshotRevision(…, 'manual')` |
| unpublish author notice | absent | `notifyArticle('author_changes_requested', …)` |
| unpublish cache-bust | `bustEdgeCache` | `bustArticleEdgeCache` |

So publishing through the twin skipped the approve step, told no follower, and
**left the author's own page cached**.

### What supersedes D156, and the shape of that error

D156's row read: *"stale, and my own first reading of it was wrong. I reported it
as carrying zero handlers. The scan matched `^r\.`; this router's const is
`adminNews`. It registers 11 handlers … There is no twin to retire."*

The correction inside it was right — the scan genuinely missed the const. The
**conclusion drawn from the correction** does not follow. "It is alive" is an
argument that retiring it is *not free*; it is not an argument that there is
nothing to retire, and it is the opposite of reassuring once the publish handler
is read. D156 never quoted it. **A count answers how much code there is and
never what it does.**

### The delete strands two things, and nothing in the repo could have caught them

This is the finding the blast-radius sweep missed and this entry exists to
record, because shipping it would have made D166 an instance of the class it
closes:

- **`bustEdgeCache` (`services/newsRender.ts`) had exactly two callers, both in
  the retired module.** An **exported** function with no caller is invisible to
  `noUnusedLocals` — armed on the worker one PR ago, in D165 — because it is not
  a local; and invisible to `check-unused-imports`, because nothing imports it to
  be unused. Deleting it loses nothing: Task #3 had already made
  `bustArticleEdgeCache` a strict superset that busts the deprecated `/api/news*`
  edge keys alongside the `/api/articles*` ones, and the new guard asserts that
  superset rather than assuming it.
- **Five of `NewsNotifyKind`'s seven members became unreachable.**
  `author_in_review`, `author_changes_requested`, `author_approved`,
  `author_published` and `author_rejected` were fired only from
  `admin_news.ts:132` and `:206`. `routes/news.ts` keeps `author_submitted` and
  `admin_submitted` — the author's own submit path — and nothing else. The
  header claiming *"the seven state-transition events"* would have gone on
  claiming it. The review transitions are not lost: `services/articleNotify.ts`
  carries the full seven for the queue that survives, and the guard asserts
  **that** too, since narrowing one union while the other had quietly lost a kind
  would be a real regression rather than a tidy-up.

### The dead deep link is fixed HERE, and it is not a consequence of the delete

`newsNotify.ts` emailed every admin a link to `/admin/news/${articleId}` on
submission. That 404s, and did so before this PR: `App.jsx:2200` is an
exact-path `<Navigate>` with no wildcard, so the deep link never matched a route.
It is tempting to read the retirement as fixing it. **It does not** — that kind
is fired from `routes/news.ts:384`, which D166 does not touch, so the link would
have survived the delete untouched. It points at `/admin/articles` now, carrying
`articleNotify.ts`'s own comment: the admin queue has no per-id route and
surfaces the specific article through its own selection state.

### Two stale claims corrected while the files were open

Both routers' headers said they sat *"inside the existing `/api/admin/*`
Cf-Access perimeter"*. **There is no such perimeter.** Task #33 removed it, and
the removal is recorded in `index.ts` directly above the `/api/admin` mounts: the
Access app is configured on the apex while the SPA uses a relative API base, so
`app.axal.vc/api/admin/*` could not carry the `Cf-Access-Jwt-Assertion` header
and `requireCfAccess()` fail-closed with 403 for every legitimate admin.
`requireAdmin` is not the inner half of a perimeter — it is the whole gate, which
is precisely why the publish divergence mattered. `admin_articles.ts` and
`admin_assessment.ts` are corrected here because this PR was already editing
their headers; four more files carry a variant of the claim
(`admin_telegram.ts`, `jobs_public.ts`, `network_public.ts`, `events_public.ts`)
and are **filed, not folded in**.

### Three assertions of one premise, and only ONE of them fails loudly

The plan for this PR said there was a single tripwire and named the other
candidate as a header comment. **That was wrong, and the way it was wrong is
the finding.** Three places assert "news is not a third system", and they
divide into two kinds:

- **It reads the file.** `frontend/test/hq_content_platform_h6.test.mjs:77-79`
  did `raw('…/routes/admin_news.ts')` and asserted `FROM articles` and
  `Deprecation` on its contents. The delete makes that throw ENOENT — loud,
  unmissable, impossible to ship past.
- **It reads the SENTENCE.** `hq_content_platform_h6.test.mjs:70-73` and
  `cloudflare-worker/test/admin_content_platform.test.ts:183` both match
  `/News is no longer a third/` against `admin_content.ts`'s
  `unified_pipeline_reason` — **a live API response body the SPA renders**,
  which says news "already answers with a Deprecation header". Nothing about
  deleting the router changes that string. Had the wording not moved with the
  delete, **both would have gone on passing while the product told operators
  that a router which no longer exists is answering requests.**

The second file was missed by the blast-radius sweep for a reason worth
writing down: the sweep searched for the name `admin_news`, and that file's
assertion does not contain it — it matches a prose fragment of the reason. **A
grep for the symbol cannot find a guard that pins a sentence about the
symbol.** It surfaced only because the drift suite ran, which is the argument
for reading the exit code of the whole suite rather than the files you expected
to touch.

Both sentence-readers now pin the retirement and explicitly refuse the alias
wording, so neither can drift back to describing a live deprecated alias. A
guard that keeps passing on a sentence the code made false is this programme's
recurring defect, and here it sat one layer above the defect being fixed.

### What stays, deliberately

**`App.jsx:2200`'s `/admin/news → /admin/articles` SPA redirect.** It is a
different route from the worker one, an admin with the old URL bookmarked still
lands on the queue, and `admin_route_reachability.test.mjs` pins
`REDIRECTS === ['/admin/news']`. **`routes/news.ts` and the public `/api/news*`
surface** are untouched: the author-facing news path is not the admin queue, and
`bustArticleEdgeCache` still busts its edge keys.

**`scripts/sql-prepare-baseline.json`'s entry went too, and that was optional.**
`check-sql-prepare.mjs` exits 1 only on *added* entries and merely reports ones
that have gone. It is removed because a ledger is only worth reading if every
line still points at something, not because anything failed.

**No migration — 271 stays free. No new `/api/*` method**; eleven are removed,
and `check-api-drift` harvests every `request()` call in `api.js` rather than
only `api.*` properties, so the module and the namespace had to go in one commit
or the build fails.

---

## D167

**The RPO we commit to is the backup cadence, not the recovery point — and the
monthly drill rehearsed a restore that would land production data outside the
EU.**

`DEPLOY.md` §3 ends on a sentence nothing finished: *"Rollback reverts the
worker. It does not revert D1."* So for a data incident — a bad bulk write, a
deletion nobody meant — the runbook stopped exactly where the operator needed
it. `documentation/operations/D1_RECOVERY.md` is the other half.

### What the measurement changed, and two of these were wrong in the plan

**1 · Time Travel is in-place, and that is the whole argument for preferring
it.** Read off `wrangler --help` at **4.131.0** rather than recalled, because
the Cloudflare docs are `EGRESS_BLOCKED` from this environment — the same
block that stopped #277 four times, hit twice more here:

```
wrangler d1 time-travel restore <database> --timestamp <unix|RFC3339>
```

`<database>` is **positional and is the database being restored**. There is no
target argument; the command acts on that database, remotely, in place. So
nothing is created — which is why this path cannot lose the jurisdiction, and
why it is the primary one.

**2 · `INCIDENT_RESPONSE.md` committed to an RPO of "24 hours (daily
backups)".** That is the *export cadence* (`backup-d1.yml`, cron `10 2 * * *`),
not the recovery point. Time Travel restores to an instant within the last 30
days, so for damage inside that window the recovery point is the instant the
operator picks. **The 24-hour figure is kept, repositioned as the fallback** —
it is exactly right for damage older than 30 days or a database that is gone
rather than wrong, and deleting it would replace one wrong commitment with
another.

**3 · The jurisdiction hazard is measured from the live account, not inferred
from a grep — and the plan's evidence for it was stale.** The plan said "zero
`jurisdiction` hits repo-wide". That stopped being true when D109 shipped
`branch-provision.yml`, which passes `--jurisdiction` in ten places. The
substance survives and is sharper read the right way round:

| | |
| --- | --- |
| `studioos-db` | `"jurisdiction": "eu"` |
| every other database in the account | `null` |
| `wrangler.toml` | no `jurisdiction` key at all |
| `restore-d1.sh` | none |

A jurisdiction is fixed at creation and cannot be changed after. So the repo
demonstrably **knows how** to pass the flag — it does so when provisioning a
branch — and the recovery path does not. That is a gap, not an unknown.

**4 · THE FINDING, and it is live rather than latent.** `dr-drill.sh:93` ran
`wrangler d1 create "${TARGET_DB}"` with **no `--jurisdiction`**, on the 1st of
every month. The drill therefore proved the backup was present, recent and
importable — all real — while rehearsing a restore into a **non-EU** database.
An operator following the shape the drill validates, in a real incident, would
recover production data into the wrong jurisdiction with no way to move it.
**That one flag is the only executable change in this PR**, and the guard
asserts it on the create line rather than anywhere in the file.

**5 · `restore-d1.sh`'s default target does not exist, which is a stronger
claim than the plan's.** The plan said the `REPLACE_WITH_PREVIEW_D1_ID`
placeholder in `wrangler.toml` made it unrunnable. Measured, the placeholder is
the symptom: wrangler resolves a target **by name**, and `studioos-db-preview`
is simply **not among the account's six D1 databases**. It was never created.
`INCIDENT_RESPONSE.md`'s RTO row promised *"a one-liner against a
freshly-provisioned preview DB"*; nothing provisions one, and that row is
corrected too.

**6 · `dr-drill.sh` re-implements the import rather than calling
`restore-d1.sh`** — `d1 create`, `d1 execute --file`, `d1 delete`, none of them
through the script an operator is told to use. The two can drift, and the drill
is the one that runs. Recorded rather than unified: merging them is a change to
a live monthly workflow and is its own decision.

### The guard hazard was narrower than the plan feared, and saying so matters

The plan flagged `check-folder-docs`'s TRUTH rule as a hazard for a runbook
made of commands, because it harvests backticked paths **inside fenced code
blocks too** (`:206-213`, added after a route README cited a file that has
never existed). True — but the rule only reads `<dir>/README.md` for dirs in
`DOCUMENTED`, and **`documentation/operations` is not in that list**. So the
runbook itself is never scanned. The only place D167 must satisfy TRUTH is the
row added to `documentation/README.md`, and `CITED_EXT` does not include `.sh`
or `.yml` either. Stating the real scope stops the next writer contorting a
runbook around a rule that does not reach it.

### Riding along — the two one-line touches item 1 dissolved into

**`api.monitoringThroughput` is deleted.** One occurrence in all of
`frontend/src` — its own declaration. A producer with no reader, and invisible
to both guards D164 armed, because an `api.js` method is an object property
rather than an unused variable.

**`/monitoring/throughput`'s wider gate is NOT changed**, and the reason is now
written at the route. D156 ruled the item stale and it has been re-opened
twice since as "the one route in this file that is not `requireAdmin`". Its
nine siblings are admin-gated because they return per-user, per-firm or
per-branch figures; this one returns two bare `COUNT(*)`s over an hour with no
attribution, so it never reaches the cross-admin shape D133's rule covers. The
comment cites both decisions so a fourth pass does not re-derive them.

### One mutation escaped, and it is the D147/D161 class for the third time

The guard's first draft asserted the runbook names the two commands with a
whole-file `BOOK.includes('wrangler d1 time-travel restore')`. Renaming the
**synopsis** to `wrangler d1 restore-point` — a command wrangler does not have
— **passed**, because the worked example forty lines below still spelt it
correctly. That is exactly D147's finding and D161's: *an assertion a
NEIGHBOURING occurrence can satisfy is not an assertion about this one.* It is
worse here than in either of those, because the synopsis is the authoritative
statement of the command surface and the thing an operator reads first under
time pressure.

Re-aimed: the command assertion is bounded to the synopsis fence at both ends,
and the worked examples are asserted **separately**, so the two halves of the
document must agree rather than covering for each other. Re-run after the
re-aim: **12 mutations, 12 caught.**

**No migration — 271 stays free. No new `/api/*` method**; one is removed.
