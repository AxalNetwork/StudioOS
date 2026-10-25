# Investor narrative — what the code serves, board by board (2026-10-24)

**A snapshot, not a spec.** S1 made this map for #2454 on 2026-10-24 by reading the code on
`claude/spinout-lab-workspace-wuyyqd` at `850fc1f` (on `origin/main` at `724902c`), to integrate the owner's
"Investor narrative" canvas (NAR1–NAR21, D906) and split the rest into slot tasks. It was not checked against
production, and nothing here is maintained afterwards: re-read the code before acting on a line.

Path short forms: Worker paths are under `cloudflare-worker/src/` and frontend paths under `frontend/src/` unless a
path says otherwise. `P:line` is `design/incoming/Investor Narrative Page.dc.html`; `B:line` is
`design/incoming/Investor Narrative · Boards.dc.html`.

**Two part numberings.** "2454-P1…P8" below are the parts #2454's body proposed. D906 §6 regroups the work into
its own eight parts (D907–D914), so cite D906's numbers in a task.

## Part A — the boards against the code

### 0. Owner key and status words

| Tag | Owns | On this tree? |
|---|---|---|
| **2430** | `raise_claims`, `raise_claim_evidence`, Evidence pack, the wider `FIGURES` list, Source labels | No. Searching `cloudflare-worker/src`, `cloudflare-worker/sql` and `frontend/src` for `raise_claims` and `raise_claim_evidence` finds nothing. |
| **2431** | Proposal sheet, `fill_provenance` columns, never-fill `money_term` and `score_rating` | Partly. The generic proposal store exists: `GET /api/ai/rail/proposals`, `POST /:uid/decide` (`cloudflare-worker/src/index.ts:885`, `routes/ai_rail_proposals.ts:28-58`). The never-fill categories are only `signature_consent \| payment_amount \| identity_number \| legal_attestation` (`services/fills/neverFill.ts:18`). `score_rating` appears nowhere. |
| **2434** | `DECK_SOURCES` and deck bindings: D894 part 2, #2675, D896 (`documentation/architecture/decisions/D894.md:73`) | No. `DECK_SOURCES` and `snapshot_hash` find nothing. |
| **2447/2448** | The check fixes: honour `check_against`, name the metric source | Not landed. `check_against_json` is read only for the Edit form (`services/records/raise.ts:246,322,337`). |
| **2457** | `raise_prospect_feedback` and its `answer` field | The writer exists (`services/raiseWriters.ts:728`). `answer` is never read. |
| **2433** | The readiness `narrative` item | `services/raiseCycle.ts:227-245` |
| **2454-P1…P8** | The issue's own parts: P1 bugs 3–5; P2 Worker stores and `/narrative/*`; P3 shell, Home, versions, compare; P4 Story and bound figures; P5 Positioning and its redirect; P6 Claims and the check; P7 Objections; P8 deleting the old page | — |
| **2454-new** | A piece that none of the issue's parts names | — |

Status words used below:
- **EXISTS**: a Worker read or write supplies the block today.
- **PARTLY**: something supplies part of it; the cell says what is missing.
- **NO**: nothing supplies it; the cell names the proposed store or route.

Unless a path says otherwise, Worker paths are under `cloudflare-worker/src/` and frontend paths under `frontend/src/`.

---

### 1. The shell (every desktop board, P:14-79, P:492-527)

| Block | Draws | Supply | Status | Owner |
|---|---|---|---|---|
| Sidebar, top bar | Founder shell, "Raise" lit | App shell. `/raise` zone row at `sidebarConfig.js:350` | EXISTS (frontend) | — |
| Eyebrow, h1, muted line | "RAISE · WHAT RESOURCES…" / "Investor narrative" / "The story you tell investors…" | `CycleHeader({cycle,cards,active,action,title,sub,…})` (`pages/cycles/CycleOverview.jsx:31-48`); eyebrow from `cycleModel.js:29` | EXISTS (frontend) | 2454-P3 |
| Call for Capital | Violet primary button | `CycleHeader` draws it only when it gets `action.href` or `action.onClick` (`CycleOverview.jsx:44-46`). CycleRoute builds `openAction` from `/${cycle}/${def.path}` (`CycleRoute.jsx:815-817`) | EXISTS (frontend) | 2454-P3 |
| Moved notice | Dismissible line (NAR18) | No slot in `CycleHeader`. The pattern to copy is `?moved=` (`PitchWorkspacePage.jsx:47-48`) | EXISTS as a pattern; needs composing | 2454-P5 |
| Venture pill "[Northwind Labs] ▾" | Chooser | No chooser exists. An in-page project picker is banned (`scripts/check-inline-project-pickers.mjs:57-59,111-120`) | NO; draw a read-only label | decision |
| Module rail (9 pills) | `nav "Raise modules"` | `cycleTabs()` (`cycleModel.js:264-280`). Calls goes to `/raise/capital-relationships#calls`, not the canvas's `/raise/capital-relationships/calls` (P:496), which would hit `/raise/:slug/:id` (`App.jsx:3469`) | EXISTS (keep the code's href) | — |
| Phone module select | "Module · Investor narrative ▾" | `CycleOverview.jsx:57-65` (`lg:hidden`) | EXISTS | — |
| Tool tabs | Home · Story · Positioning · Claims · Check · Versions (P:497, P:520) | No routes. Every one of those segments matches `RECORD_ID` and would mount record mode (`cyclePaths.js:6`, `App.jsx:3469`) | NO (routes are frontend-only) | 2454-P3 |
| Version picker "v4 · Seed fund ▾" | Picker | `GET …/modules/investor-narrative/form-options` → `versions:[{value:'4',label:'v4 · seed fund'}]` (`records/raise.ts:356`), or the module's `records.rows` | EXISTS | 2454-P3 |
| Saved stamp | "Saved · 2 min ago" | Module `cells.date` is a day only (`raiseCycle.ts:546`). Record `activity[]` is newest first, with `created_at` (`cycleActivity.ts:264`) | PARTLY | — |
| Eadwyn spine | Collapsed rail | `RailFrame` + `WorkerRail`; page key `Founder · Raise · Investor narrative` (`lib/railPages.js:122-124`) | EXISTS | — |

---

### 2. Board by board

#### NAR1 · Home, founder (P:448, P:296-317; B:44)

| Block | Draws | Supply | Status | Owner |
|---|---|---|---|---|
| Tile "Versions" | `[4]`, "Newest v4 · Seed fund" | `records.total` (`raiseCycle.ts:538`); `card.series[1].items[0].label` = `Newest · v<n> · <type>` (`:521`) | EXISTS | — |
| Tile "Claims backed" | `[9] of [12]` | — | NO | 2430 |
| Tile "Open mismatches" | `[1]`, "MRR, in Traction" | Count from `card.series[1].items[1].value` (`:522`). Figure from `items[2+].label` (`:523`). The section exists only inside the value sentence as `Narrative · <field_key>` (`mismatchSentence`, `:495-497`). A "mismatch" can also be `Deck · projects.mrr`, which the version never states (`:452-454`, bug 3) | PARTLY | 2454-P1, 2447 |
| Tile "Objections answered" | `[2] of [3]` | `raise_prospect_feedback.answer` is written (`raiseWriters.ts:728`) and never read. The denominator exists only in a version record's `side[feedback]` (`records/raise.ts:298-304`) | NO for the numerator | 2457 + 2454-P7 |
| Card "All versions" | Bars by audience, the newest line, "No version yet for…" | `card.series[0]` = `{kind:'hbar', items:[{label,value,tone:'v1'}]}` (`raiseCycle.ts:517`). The newest line is `items[0].value = day(saved_at)` (`:521`). Missing audiences are `records.filters[0].options` (`:551`) minus the hbar labels | EXISTS. Caveat: `saved_at = MAX(o.updated_at)` (`:484`) does not move when only Why now or Check against changes | — |
| Table: Version, Audience | | `cells.version`, `cells.investor_type` (`:543`) | EXISTS | — |
| Table: Based on | | Only the record's `facts[3]` "Based on" (`records/raise.ts:261`). `loadVersions` does not join `narrative_version_meta` (`raiseCycle.ts:484-488`) | PARTLY | 2454-P2 |
| Table: Claims backed | | — | NO | 2430 |
| Table: Mismatches | Count, or "Not checked" | `cells.mismatches:{text,tone}` (`:545`). Zero cannot be told apart from "nothing compared" or "not checked": `runCheck` runs on every save (`raiseWriters.ts:232,296`) and stores only mismatches | PARTLY | 2447 / 2454-P6 |
| Table: Read by deck | "Pitch deck v6" | `cells.deck` = the newest `pitch_decks.version` at save time (`raiseWriters.ts:207-210`), labelled "Used by deck" (`raiseCycle.ts:539`). No reader of version > 0 exists; the Spin-Out reader is `version = 0` (`services/decks/spinoutDeckOverrides.ts:266`). This is bug 4 | NO | 2434 (#2675) + 2454-P1 |
| Table: Saved | `[20 Oct]` | `cells.date` | EXISTS (a day) | — |
| Table: By | `[Name]` | Not in the rows. Only the record's `activity` "Created by …" (`cycleActivity.ts:231-236`) | NO in the list | 2454-P2 |
| Table controls | Search, Audience, Sort, pager, row link | `q`, `filter=investor_type:<k>`, `sort=newest\|oldest` (`raiseCycle.ts:535-537,551-552`); `total/page/page_size` (25); `linkable` (`cycle_raise.ts:141`) | EXISTS | — |
| Footer line | "Positioning now lives here. The Pitch deck studio reads your narrative." | Second sentence is false today (bug 4) | NO for sentence 2 | 2434 |
| Card "Needs you" | Mismatch, Not backed, Stale, "Open claim ›" | Mismatch rows: card rows, newest version only. Not backed and Stale: none | PARTLY | 2430 |
| Card "Objections heard" | Text, count, "Answered in [Market]", "Answer it" | `side[feedback].rows:[{a:'"<objection>"', b:'raised N time(s)'}]` (`records/raise.ts:298-304`). It is project-wide, but it needs a version record to read, so with no version there is no read. No answer or section link. No `draft:narrative/objection` | PARTLY | 2457, 2454-P2/P7 |
| Card "From Mercury" | 4 figures, "Insert in Story" | `parts.mercury.figures[]` keys `revenue_last_month \| revenue_growth \| net_burn \| runway`, each `{label,value,unit,source,fact_id}` (`services/mercury/raiseFeeds.ts:493-507`), founder only (`cycle_raise.ts:149-158`). Insert needs a binding store. The canvas labels "[6%] a month" and "… a month" differ from the Worker's labels (`:501,503`) | EXISTS (figures) / NO (Insert) | 2454-P2/P4 |

#### NAR2 · Story, founder (P:449, P:270-293; B:45)

| Block | Draws | Supply | Status | Owner |
|---|---|---|---|---|
| Sections rail | 9 sections with state dots, drag | Record `main[narrative].rows` gives 5 rows (One-liner, Problem, Why now, Traction, The ask), each `{a,b}` or `{a,b:'',c:'Not recorded'}` (`records/raise.ts:237-239,267-280`). That is enough for Empty and Written on those 5. Solution, Market, Business model, Competition and Team are not read. Business model has no deck key (`spinoutDeckOverrides.ts:49-72`). The Mismatch dot can only be inferred from `stated_source`. Stale: none. Order: none | PARTLY | 2454-P2 (`narrative_sections`), 2430 |
| Writing surface "Traction" | Text | Read: the `Traction` row from `traction.takeaway`. Write: `WORD_FIELDS` is only `cover.thesis` and `ask.title` (`raiseWriters.ts:134`); `why_now` goes in the meta | PARTLY (read) / NO (write) | 2454-P2 |
| Inline bound chips | "[$16,950] MRR · Connector · Stripe…" | — | NO | 2434 + 2454-P2/P4 |
| Typed figure with Mismatch pill | Inline underline | `narrative_checks` covers 3 figures, gives a field key and no text span | PARTLY | 2430 |
| "Not backed" sentence, "Back this claim" | | — | NO | 2430 |
| Audience note | "For seed funds…" | — | NO (`narrative_sections.audience_note`) | 2454-P2 |
| Toolbar | Insert a figure · Back a claim · Ask Eadwyn ▾ (draft, shorten, plain words, answer an objection) | Nothing behind any of them. The cost quote "[$0.0011] a run" can be a client estimate from `GET /api/ai/pricing` (`lib/api.js:2925`, `hooks/useAiSpend.js:37-84`) | NO (cost: EXISTS) | 2434, 2430, 2454-P2 + 2431 |
| Right panel tabs | Claims · Objections · Notes | Claims: 2430. Objections: see NAR10. Notes: see NAR13 | NO / PARTLY / NO | — |
| Save version | Primary | `PATCH /api/cycles/raise/narrative-versions/:version?project=` (`cycle_raise.ts:200-210`) writes `investor_type, one_liner, why_now, ask, based_on_version, check_against` | PARTLY | 2454-P2 |

#### NAR3 · Insert a figure (P:320-330; B:46)

| Block | Supply | Status | Owner |
|---|---|---|---|
| Grouped items with value, source, date, grade | Each cycle's overview `figures[]` gives `{key,label,value,unit,source,as_of,state,reason}` (`services/cycleCards.ts:40-48`). Validate figures are interviews, pain themes, hypotheses and waitlist (`services/cycleValidate.ts:554-556`). Mercury figures are as in NAR1. There is no grade, no `snapshot_hash` and no single registry | PARTLY | 2434 (`DECK_SOURCES`), SCORING #2428 |
| "Churn · Not recorded…" row | `project_metrics.monthly_churn_pct` is written by Stripe (`integrations/providers/stripe.ts:404-411`); there is no registry entry | PARTLY | 2434 |
| Foot "update when the record changes" | — | NO (bindings and staleness) | 2454-P2, 2434 |

#### NAR4 · Positioning (P:333-346; B:47)

| Block | Supply | Status | Owner |
|---|---|---|---|
| Core fields (one-liner, elevator pitch, lines 1-5, category, wedge) with "Proposed by Eadwyn / Typed" | No store. `POST /api/decks/positioning` returns `{project_id, project_name, one_liner, elevator_pitch, positioning_lines[≤6], sourced_from}` and stores nothing (`routes/decks.ts:692-709`). It has no category or wedge | NO | 2454-P2 (`narrative_positioning`) |
| For whom / Instead of chips | Validate modules `ideal-customer-profile` and `market-intelligence` exist (`pages/cycles/adapters/validate.js:29-30`). I found no read that returns segment or competitor chips for this tool | NO | 2454-P2 |
| Line 3 "Backed" claim chip | — | NO | 2430 |
| "This version" card (uses, Adjust toggles) | — | NO (per-version override, owner question 2) | 2454-P2 |
| "Ask Eadwyn to propose positioning · [$0.0011]" | The run exists, but: gated to `ensureTier(…,'studio')` (`decks.ts:564`); rail page "Pitch deck" (`:681`); no store; figures go in (bug 6) | PARTLY | 2454-P5 (`POST /narrative/positioning/draft`) |
| Foot "reads your Validate and Build records. It writes no numbers." | False today. It reads `projects` columns, the financial model and updates (`decks.ts:641-654`), and nothing filters the output (`:692-696`) | NO | 2454-P5 |

#### NAR5 · Positioning proposal (P:347-352; B:48)

| Block | Supply | Status | Owner |
|---|---|---|---|
| 6 proposed lines on lavender, each with Accept/Discard, plus "Accept all (6)" | The text comes from `/decks/positioning`. No proposal rows are written. The proposal route decides one at a time with "no bulk decision" (`ai_rail_proposals.ts:13-15`), which conflicts with "Accept all" | PARTLY | 2431 + 2454-P5 |
| "Read from" chips | `sourced_from:{team,advisors,team_status,traction,updates,financials}` (`decks.ts:632-639`). These are not the canvas's Validate and Build sources | PARTLY | 2454-P5 |
| "A line with a number was removed." | No filter | NO | 2454-P5 (bug 6) |
| Cost foot | No cost in the response; a client estimate only | PARTLY | — |

#### NAR6 · Claims (P:355-370; B:49)

- Every block is **NO** and belongs to **2430**: the table, the filters, the stacked bar by best source and the legend. The grades also need SCORING #2428.
- The only nearby data is the 3-figure Mismatch rows in `narrative_checks`.

#### NAR7 · Claim drawer, Not backed (P:374-378) and NAR7b · Mismatch (P:379-380); B:50

| Block | Supply | Status | Owner |
|---|---|---|---|
| NAR7: Evidence candidates, Eadwyn links, "Link it", "Open Evidence ›" | — | NO | 2430 (+2431 for the proposed links) |
| NAR7b: "YOU STATE" / "THE RECORD SAYS" cards | A `narrative_checks` row has `{figure, stated_value, stated_source, metric_value, metric_source}` (`raiseCycle.ts:397,511-514`). It reaches the client only as `"stated $X · metrics $Y"` (`records/raise.ts:292`) or inside the card sentence. The date is embedded in `metric_source` as `on <snapshot_date>` (`raiseCycle.ts:468`). Nothing records who typed the figure | PARTLY | 2454-P2 (structured rows), 2430 |
| "Use the record's figure" | — | NO (bindings) | 2454-P2/P4 |
| "Keep mine, with a note" | — | NO (note store) | 2430 / 2454-P2 |

#### NAR8 · Check (P:386-401; B:51)

| Block | Supply | Status | Owner |
|---|---|---|---|
| "Check against" chips | `check_against_json` is returned only as the Edit form value (`records/raise.ts:321-322,337`). The check ignores it. The "v6" label: no deck version is used | PARTLY | 2447 (bug 1), 2454-P1 (bug 3) |
| Summary "[7] compared · [6] agree…" | Record `main[consistency].rows` gives Mismatch, OK or Not compared for 3 figures (`records/raise.ts:282-297`) | PARTLY (3 figures only) | 2430 (wider FIGURES) |
| Column: In this narrative | Values exist only on mismatch rows; OK rows read "consistent everywhere" with no value | PARTLY | 2454-P2 |
| Column: In Pitch deck v6 (card) | The deck side is project columns (`raiseCycle.ts:451-454`) | NO | 2434 + 2454-P1 |
| Column: In metrics (source, date) | `metric_source` on mismatch rows only; no Mercury or Validate reads (`:464-476`) | PARTLY | 2447 (bug 2), 2430 |
| Column: Result | OK is reported without comparing values (finding E1 in §5) | PARTLY | 2447 / 2454-P1 |
| "Nothing compared yet." | Can be derived when all 3 rows read `Not compared` | EXISTS (derived) | — |
| "Run the check" | `runCheck` runs only on save (`raiseWriters.ts:171-181`) | NO (`POST /narrative/:version/check`) | 2454-P2 |
| "Last checked …" | `narrative_checks.checked_at` is in no response, and a check with no mismatch leaves no row. Every save runs the check, so the newest `narrative_version_created\|updated` activity row (`cycleActivity.ts:264`) gives the time | PARTLY (derived from activity) | — |

#### NAR9 · Phrase the fix (P:381-383; B:52)

| Block | Supply | Status | Owner |
|---|---|---|---|
| The two mismatch cards | As NAR7b | PARTLY | — |
| "Ask Eadwyn to phrase the fix · [$0.0006]" | `POST /api/research/drafts {surface:'raise/narrative-fix', scope_key, page}` returns 201 `{item}` (`routes/research.ts:3705-3766`). It always takes the **newest version's first** mismatch (`services/narrativeFix.ts:40-54`), never the row clicked. The cost before the run is a client estimate; `item.cost_usd` comes after | PARTLY | 2454-P2/P6 |
| Proposed wording plus "AS THE CHECK FOUND THEM" | One `item.body` holds `wording + "\n\nAs the check found them: <sentence>."` (`narrativeFix.ts:92-95`); split it on the client. The canvas says the wording carries no number, but `unfoundFigures` lets numbers through when they agree with either side (`:75-85`) | PARTLY | 2454-P6 |
| "Accept into Traction" | No accept hook (`research.ts:3615-3620`). PATCH stamps `accepted_at` only (bug 11) | NO | 2454-P2/P6 |
| Discard | `DELETE /api/research/drafts/:uid` | EXISTS | — |

#### NAR10 · Objections panel (P:287-290; B:53)

| Block | Supply | Status | Owner |
|---|---|---|---|
| Objection and "Raised N times" | `side[feedback]` (`records/raise.ts:298-304`); grouped on the exact objection text | EXISTS (needs one version record read) | — |
| "✓ Answered in [Market] ›" | `answer` is never read; no link from objection to section | NO | 2457 + 2454-P7 |
| "Answer it" | — | NO (`draft:narrative/objection`) | 2454-P2/P7 |

#### NAR11 · New version (P:404-410; B:54)

| Block | Supply | Status | Owner |
|---|---|---|---|
| "Creates v5 for Series A funds. Nothing in v4 changes." | Next number = `COALESCE(MAX(version),0)+1` (`raiseWriters.ts:204-206`); derive it from form-options `versions` | EXISTS (derived) | — |
| Audience, 7 chips | form-options `investor_types` (`records/raise.ts:354`) | EXISTS | — |
| Start from "[v4 · Seed fund]" | `start_from:'version'`, `based_on_version` (`raiseWriters.ts:199-201`) | EXISTS | — |
| Start from "Pitch deck v6's words" | — | NO (`start_from` gains `deck`) | 2454-P2 + 2434 |
| Start from "Blank" | `start_from:'blank'` | EXISTS | — |
| "The Spin-Out deck wording" (Spin-Out ventures only) | `live` = version 0 (`raiseWriters.ts:211-217`), offered to everyone as "The live deck" (`records/raise.ts:355`). No Spin-Out flag in form-options | PARTLY | 2454-P2 |
| "Copies its sections, claims and positioning" | Copies override rows only. Why now and Check against are **not** copied (finding E2) | PARTLY | 2454-P1 |
| Check against: Pitch deck, Metrics | Stored, never read | PARTLY | 2447 |
| Create version | `POST /api/cycles/raise/narrative-versions?project=` returns 201 `{version, mismatches}` (`cycle_raise.ts:190-198`) | EXISTS | — |

#### NAR12 · Versions and compare (P:413-422; B:55)

| Block | Supply | Status | Owner |
|---|---|---|---|
| Version list with "from v1" | The based-on value exists only per record | PARTLY | 2454-P2 |
| Side-by-side compare, changed sentences outlined | No endpoint. Interim: two record reads give 5 `main[narrative].rows` each, which can be diffed on the client | PARTLY (5 rows) / NO (`GET /narrative/compare?a=&b=`) | 2454-P2 |
| Claim states on both sides | — | NO | 2430 |
| "Read by": "Pitch deck v6 · cards …" | — | NO | 2434 |
| "Duplicate v4" | `POST …/records/:id/actions/duplicate` (`records/raise.ts:325-328`; `raiseWriters.ts:650-658`) | EXISTS (with E2) | — |
| "Make v3 the start of a new version" | POST with `{start_from:'version', based_on_version:3, investor_type}` | EXISTS | — |
| "cannot be deleted while a deck reads it" | No delete action is declared | NO, so draw no Delete | 2454-P2 |

#### NAR13 / NAR13hq · Admin and Super Admin, read only (P:467; B:56)

| Block | Supply | Status | Owner |
|---|---|---|---|
| Read only: no toolbar, no Save | The Worker treats admins as full writers: `canWrite` returns true for `role==='admin'` (`routes/_founder_validate_helpers.ts:90-93`); Super Admin is admin plus the `super_admins` table (`auth.ts:401`). The frontend can hide controls the way `isReadOnly` does (`pitchStudioModel.js:62`) | NO on the Worker | 2454-new (as D894 part 1, #2674) |
| Notes thread visible to the founder | No narrative notes store. Pitch's is D894 part 11, #2684, migration 538 (`D894.md:82`) | NO | 2454-new, or reuse #2684 |
| Logged reason for the read | Searched for `access_reason`, `read_reason`, `view_reason`: only `tenant_view_reason` prose (`routes/admin_security.ts:969`) | NO | 2454-new / epic #2459 decision 3 |
| Admin and HQ shells (Programs, Funds lit) | `/raise/*` sits only in the founder shell | NO | 2454-new |

#### NAR14a / NAR14b · No permission (P:470-471; B:57)

| Block | Supply | Status | Owner |
|---|---|---|---|
| NAR14a, other profiles | The Worker answers 403 `{detail:'Forbidden'}` (`cycle_raise.ts:94`). `RoleGuard` silently `<Navigate>`s before any page draws (`App.jsx:1819-1832`), so the panel needs those roles admitted to the route and the boundary drawn in the page | EXISTS on the Worker; frontend-only change | 2454-P3 |
| NAR14b, another venture | 403 `Forbidden` (`:94`), 404 `Project not found` (`:93`). The page draws the Worker's sentence on 403 (`CycleRoute.jsx:784-786`) and "unreadable" on 404 | EXISTS; map the 403 to the canvas copy | 2454-P3 |

#### NAR15a/b/c · Empty (P:472-474; B:58)

| Block | Supply | Status | Owner |
|---|---|---|---|
| 15a No version, "New version" | Card `{state:'empty', reason:'No narrative saved yet…', next:{text:'New version', href:'…&add=1'}}` (`raiseCycle.ts:502-504`) | EXISTS | — |
| 15b No positioning | No store, so "empty" cannot be known | NO | 2454-P2 |
| 15c No records to back a claim | — | NO | 2430 |

#### NAR16 · Loading (P:468; B:59)

Frontend only (skeletons). **EXISTS.**

#### NAR17a-d · Errors and limits (P:475-478; B:60)

| Crop | Supply | Status | Owner |
|---|---|---|---|
| 17a Stripe unreadable | The module has no Stripe part; its only parts are `calls` and `mercury` (`cycle_raise.ts:146-158`). Mercury has `{state:'unreadable', reason}` (`:157`) | PARTLY (Mercury only) | 2434 registry / 2454-P2 |
| 17b AI assistance off | `useAssistMode('Raise')` (`CycleRoute.jsx:681`); drafts route 403 `assist_off` (`research.ts:3743`) | EXISTS | — |
| 17c Out of AI tokens | The balance read exists: `GET /api/ai-budget/me` ("AI allowance and top-up balance", `routes/ai_budget.ts:25-29`), plus `ADD_TOKENS_PATH` (`lib/aiTokens.js:27`). But the drafts route turns every budget refusal into 503 `draft_unavailable` (`research.ts:3749-3750`). Positioning does answer 402 through `refuseRun` (`decks.ts:688`) | PARTLY | 2454-new (map budget refusals on `/research/drafts`) |
| 17d Save failed, text kept | `writeFailed` → `{detail}` with the writer's status (`cycle_raise.ts:100-106`); keeping the text is frontend work | EXISTS | — |

#### NAR18 · Moved notice (P:469; B:61)

- The notice: **EXISTS** as a frontend pattern (`?moved=<key>`, `PitchWorkspacePage.jsx:47-48`, `pitchStudioModel.js` `movedTarget`). Owner 2454-P5.
- The block under it (`posK(3)`: one-liner, elevator pitch and line 1, each with provenance): **NO** (positioning store).

#### NAR19a-d · Phone (P:479-481; B:62)

| Frame | Supply | Status |
|---|---|---|
| Phone header and Module select | `CycleOverview.jsx:57-65` | EXISTS |
| 19a: Versions and Claims backed tiles, "Needs you" | As NAR1 | PARTLY |
| 19b: Section picker, writer | As NAR2 | PARTLY / NO |
| 19c: Claim sheet (Mismatch) | As NAR7b | PARTLY |
| 19d: Positioning lines, Accept/Discard | As NAR5 | PARTLY |

#### NAR20 · Story, dark (P:455; B:63)

NAR2 plus NAR7b in the dark theme. Same supply. The dark token pairs exist (`PitchStudio.jsx:36-47`).

#### NAR21 / NAR21d · Components (P:482-490; B:64)

- Presentational only: the bound chip (normal, stale, missing), the 5 claim pills, the section dots, the 5 source chips and the grade ramp.
- They can be built as components. With nothing to feed them, they must not reach a page: "a board waits for its store" (`pages/raise/pitch/README.md:17-29`).
- The grade words need #2428 and the Source labels need 2430. Owner 2454-P4.

---

### 3. What can be built NOW from existing reads (no new Worker code)

#### 3.1 Whole boards

| Board | Reads |
|---|---|
| NAR15a | Module `card.state==='empty'`, `card.reason`, `card.next` |
| NAR16 | None (skeletons) |
| NAR17b | `useAssistMode`; drafts 403 `assist_off` |
| NAR17d | Writer `{detail}`; keep the text in the form |
| NAR14b | Module 403/404 → canvas copy; "Open your own narrative" → `useProject`'s first venture (`CycleRoute.jsx:361-403`) |
| NAR14a | Frontend routing only: admit the role, draw the boundary. The Worker already refuses |

#### 3.2 Boards in part, block by block, with the placeholder each missing block needs

**Shell**
- Build: header, CfC, module rail (keep `#calls`), phone select, the tool tabs as static routes, the version picker (form-options `versions`), the rail.
- Placeholders:
  - Venture pill: a read-only label of the active venture, never a picker.
  - Saved stamp: `Saved <day>` from `cells.date`, or the time of the newest activity row.

**NAR1 Home**

| Block | Build from | Placeholder |
|---|---|---|
| Tile Versions | `records.total` + the newest label | — |
| Tile Open mismatches | Card count + figure labels | Source sentence shown verbatim (it may read `Deck · projects.*`) |
| Tile Claims backed | — | `—` "No claim check on StudioOS yet" |
| Tile Objections answered | Count heard only | `—` "Answers are not recorded"; optional sub "[n] heard" from the feedback section when a version exists |
| All versions bars and footnote | Card `series[0]`, `series[1].items[0]`; missing audiences from `records.filters[0].options` | — |
| Versions table | Version, Audience, Mismatches, Saved, search, filter, sort, pager, row link | Drop Based on, Claims backed and By. "Read by deck": drop it, or relabel it "Newest deck when saved" with `cells.deck`, never "Read by" |
| Needs you | Mismatch rows from the card; "Open claim ›" → the version record or NAR7b | No Not backed or Stale rows |
| Objections heard | Feedback section of the newest version record | "Answered in" and "Answer it" omitted |
| From Mercury | `parts.mercury` (already rendered by `MercuryRaiseFeed`) | "Insert in Story" omitted |
| Footer | First sentence only, once Positioning moves | Second sentence dropped |

**NAR11 New version**
- Build: Audience, Start from (saved version · Blank · "The live deck"), Check against, Create.
- Placeholders:
  - "Pitch deck v6's words": omitted, not shown disabled.
  - Spin-Out label: keep today's honest "The live deck", for everyone.
  - The "Copies…" line: say only "Copies its wording".

**NAR12 Versions**
- Build: the list, Duplicate, "Make vN the start of a new version", and an interim compare of the 5 record rows from two record reads.
- Placeholders:
  - Read by: "No deck reads this version." This is literally true of every version today (`spinoutDeckOverrides.ts:266`).
  - No Delete control.
  - No claim pills.

**NAR8 Check**
- Build: a 3-row table from record `main[consistency]`, Result pills, "Nothing compared yet." when all three are Not compared, and "Last checked" from activity.
- Placeholders:
  - Deck column: drop it. The Worker's "deck" is project fields (bug 3).
  - Metric column: Mismatch rows only.
  - No "Run the check". The check runs on Save.
  - Check against chips: shown read only, from the Edit form value. They must not claim they filter anything until #2447.

**NAR9 Phrase the fix**
- Build: the drawer from the existing surface, with Run, Discard, and the body split at `"\n\nAs the check found them: "`.
- Placeholders:
  - Title it for the newest version's first mismatch.
  - Accept: keep today's "Keep this wording" and its true foot ("changes neither the narrative nor the metrics", `CycleRoute.jsx:220`), never "Accept into Traction".

**NAR10 Objections and NAR19a/c**
- Build from the reads above, with the same placeholders.

**NAR2 Story (thin)**
- Build: the 5 record rows. One-liner, Why now and The ask are editable through the existing Edit form; Problem and Traction are read only.
- Placeholder: a dashed "Not recorded on StudioOS" card for the other 4 canvas sections.
- No chips, toolbar, audience note or claims panel.

**NAR4 / NAR5 / NAR18 Positioning**
- Interim: embed today's generator, read `?project_id`, label the result "Not saved: copy what you keep", and keep its studio gate.
- Under NAR18, show the notice above that generator. Do not show `posK`'s stored fields.

**Not buildable**
- NAR6, NAR7 (Not backed), NAR13, NAR15b, NAR15c, NAR3.
- Each needs its tab or entry point hidden, or a single dashed "not on StudioOS yet" card.

---

### 4. Bugs 3–11 from the issue body at HEAD

| # | Bug | At HEAD | Evidence |
|---|---|---|---|
| 3 | The "deck" side is not a deck | **Present** | `checkInputs` states `projects.mrr`, `.paying_customers`, `.funding_needed` as `'Deck · projects.<col>'` (`raiseCycle.ts:448-454`). No `pitch_decks` read |
| 4 | "Used by Pitch deck v[n]" is not true | **Present** | `deck_version` = newest `pitch_decks.version` at save (`raiseWriters.ts:207-210`). Shown as "Used by" (`records/raise.ts:255,259`) and "Used by deck" (`raiseCycle.ts:539,544`). The only Spin-Out reader is `version = 0` (`spinoutDeckOverrides.ts:266`) |
| 5 | Readiness calls nothing checked perfect | **Present** | `score: Math.max(0, 10 - 2 * mismatches), evidence: 'measured'`, plus a `'no mismatch'` row (`raiseCycle.ts:236-243`). A figure with no metric is skipped (`:439`). Nuance: a blank version still "states" the project columns (`:452-454`), so it holds no figure only when those columns are ≤ 0 |
| 6 | Positioning gets an internal score and financial figures | **Partly fixed** | The score tier was removed in `f310860` (#2636, 2026-10-23); no `score_snapshots` read is left in `decks.ts:563-710`. Still sent: `runway_months, ltv_cac_ratio, avg_monthly_burn` (`decks.ts:651-652`) and `revenue, tam, sam, som, users, funding_needed` (`:646-649`). Still no check of the output for figures (`:692-696`); only the prompt forbids invented metrics (`:673`) |
| 7 | "Team" can be anyone on the cap table | **Fixed** | `bbd99f9` (#2633, 2026-10-23). The team is now `users` with a matching `founder_id` plus accepted `project_members` (`owner, cofounder, advisor`), with advisors split out (`decks.ts:581-605`). Comment at `:581`: "Share ownership is never a team record." Prompt line at `:675` |
| 8 | Positioning ignores the venture in the address | **Present** | `api.listProjects()` then `setProjectId(String(list[0].id))` (`PitchPositioningPage.jsx:42-55`). There is no `get('project_id')` in the file |
| 9 | The UI and the Worker gate different plans | **Present** | UI: `GROWTH_TABS` and `hasTier(user,'growth')` (`PitchWorkspacePage.jsx:37,46,105`). Worker: `ensureTier(…,'studio')` (`decks.ts:564`). `TIER_RANK` is `{free:0,growth:1,studio:2}` (`sidebarConfig.js:42`; `middleware/requireTier.ts:30`) |
| 10 | Investors and partners can run positioning | **Fixed** | `projectOwned`: an investor gets `NotFound` or `Forbidden` (`middleware/projectContentAccess.ts:23-26`). Any non-owner needs an accepted `owner` or `cofounder` membership to write (`:30-34`). Same commit `bbd99f9` (#2633). Investors, partners and advisors still bypass the *tier* gate (`requireTier.ts:32,70`) but are refused by `projectOwned` |
| 11 | "Keep this wording" keeps nothing | **Present** | Band `accept: 'Keep this wording'`, with the foot "changes neither the narrative nor the metrics" (`CycleRoute.jsx:217,220`). "There is no `accept` hook" (`research.ts:3619-3620`) |

### 5. Defects found while mapping (not in the issue's list)

| Id | Defect | Evidence | Owner |
|---|---|---|---|
| E1 | The consistency row reads "OK · consistent everywhere" whenever both a stated figure and a metric exist, without comparing them. After metrics change, a figure that now differs still reads OK | `records/raise.ts:293` | 2447 / 2454-P1 |
| E2 | Duplicate and "start from version" drop Why now and Check against. `saveNarrativeVersion` inserts meta `why_now = null` and `check_against_json = null` when they are not sent, and the duplicate passes neither | `raiseWriters.ts:203,228-231,657` | 2454-P1 |
| E3 | The Phrase-the-fix band loads drafts unscoped, so it can show another venture's newest draft. CycleRoute passes no `scoped` prop | `CycleRoute.jsx:1002`; `workspaces/ZoneDraft.jsx:153,205` | 2454-P3 |
| E4 | A disagreement between project columns and metrics is stored as a *narrative* mismatch even when the version never states that figure. The fix material then says "The narrative states …" | `raiseCycle.ts:452-454`; `narrativeFix.ts:60` | 2454-P1 (bug 3) |
| E5 | Fix wording may contain numbers (those that agree with either side are allowed), against the canvas rule | `narrativeFix.ts:75-85` | 2454-P6 |
| E6 | The card's "Reconcile…" `next` links back to the page it sits on, and uses `?project=` | `raiseCycle.ts:528` | 2454-P3 (point it at `/check`) |
| E7 | NAR5's "Accept all (6)" conflicts with the one-at-a-time proposal rule | `ai_rail_proposals.ts:13-15` | decision |
| E8 | `/raise/pitch/positioning` stacks `founderWorkspace('raise', founderEditor(...))` | `App.jsx:2919` | 2454-P5 |

### 6. Where the canvas and the issue disagree (settle before building)

- **Sections.** The canvas has 9 (`P:277`: Problem … The ask). The issue's `NARRATIVE_SECTIONS` has 13 (it adds One-liner, Customer evidence, Use of funds and Closing, and names others differently).
- **Compare address.** The canvas tabs have no `/versions/compare` (`P:497`); the issue lists it.
- **Calls pill.** The canvas uses `/raise/capital-relationships/calls` (`P:496`); the code uses `#calls` (`cycleModel.js:30`).
- **Start from.** The canvas offers "Pitch deck v6's words" and a Spin-Out-only option (`P:408`); today's options are `live | version | blank`.
- **NAR14a.** The canvas expects a panel for other profiles, but today the route redirects them before anything draws (`App.jsx:1831`).
- **Plan gate for the whole tool.** Today the narrative routes are free and positioning is `studio` (owner question 4).

## Part B — the Worker reads and writes, with their shapes

### 0. Mounts and access

| Mount | Router | Cite |
|---|---|---|
| `/api/cycles` (generic record, activity, action and form-options routes) | `cycleRecords` | `cloudflare-worker/src/index.ts:1433` |
| `/api/cycles/raise` (module read, writers, Mercury) | `cycleRaise` | `cloudflare-worker/src/index.ts:1434` |
| `/api/research` (zone drafts) | `research` | `cloudflare-worker/src/index.ts:1178` |
| `/api/decks` (positioning) | `decks` | `cloudflare-worker/src/index.ts:1160` |

`cycleRecords` defines no `/:cycle/modules/:slug` GET, so the module read always reaches `cycleRaise` (`cloudflare-worker/src/routes/cycle_records.ts:113-163`).

**Who gets in (`canWrite`).** `canWrite` returns true for `admin`, and otherwise defers to `ownsVenture` (`cloudflare-worker/src/routes/_founder_validate_helpers.ts:90-93`). `ownsVenture` admits:
- a user with `role==='founder'` whose `founder_id === project.founder_id`, through `canAccessFounderResource` (`cloudflare-worker/src/auth.ts:834-840`);
- or a user with `spinout_lab_active===1` and a matching `founder_id`, whatever their role (`_founder_validate_helpers.ts:31-43`).

Everyone else gets 403: partners, investors, advisors, and also co-founders, because `canWrite` never reads `project_members`. The Raise route says the same in prose (`cloudflare-worker/src/routes/cycle_raise.ts:44-48`). No tier gate covers `/api/cycles`: it is not in `STUDIO_PREFIXES` (`cloudflare-worker/src/index.ts:795-816`).

**Raise `scope()` refusals** (`cycle_raise.ts:81-96`):

| Status | Body |
|---|---|
| 401 | `{detail:'Unauthorized'}` |
| 400 | `{detail:'project is required'}` (`?project=` must match `^[1-9][0-9]{0,9}$`) |
| 404 | `{detail:'Project not found'}` |
| 403 | `{detail:'Forbidden'}` |

Admin is a full writer. No read-only admin mode exists on these routes (NAR13 has nowhere to plug in).

---

### 1. `GET /api/cycles/raise/modules/investor-narrative?project=&q=&filter=&sort=&page=`

**Route.** `cycle_raise.ts:127-161`.
- An unknown slug answers 404 `{detail:'No such module', modules:[…7 slugs]}` before auth (`:130`).
- The card comes from `CARD_FOR['investor-narrative'] = narrativeCard` (`cloudflare-worker/src/services/raiseCycle.ts:1392`) and fails on its own through `safeCard` (`cloudflare-worker/src/services/cycleCards.ts:87-104`).
- The records come from `RECORDS_FOR[...] = narrativeRecords` (`raiseCycle.ts:1421`) and also fail on their own (`cycle_raise.ts:138-145`).

**Query parsing.** `recordQuery` lower-cases `q` and caps it at 120 characters. `filter` is `key:value,…` and each part is charset-checked. `sort` must match `^[a-z_]{1,32}$` (`cloudflare-worker/src/services/cycleValidate.ts:985-1003`). Page size is 25 (`cycleCards.ts:189`).

#### Literal shape (ok state)

```jsonc
{
  "module": { "slug": "investor-narrative", "name": "Investor narrative", "records_title": "Versions" },   // raiseCycle.ts:44
  "card": {                                   // raiseCycle.ts:499-532; meta() :1382-1384 (no source/as_of emitted)
    "slug": "investor-narrative", "name": "Investor narrative", "range": "All versions",
    "caption": "Saved narrative versions by investor type, and what the consistency check found in the newest.",
    "state": "ok",                            // 'ok'|'empty'|'unreadable' here
    "series": [
      { "kind": "hbar", "items": [ { "label": "Seed fund", "value": 2, "tone": "v1" } ] },   // count per investor_type (null → 'other')
      { "kind": "rows", "items": [
          { "label": "Newest · v4 · Seed fund", "value": "2026-10-20" },                    // day(saved_at)
          { "label": "Mismatches", "value": 1, "tone": "warn" },                            // 'ok' when 0
          { "label": "MRR", "value": "MRR: $12,000 in Narrative · cover.thesis, $9,800 in Metrics · project_metrics.mrr on 2026-09-30", "tone": "warn" }
      ] }
    ],
    "next": { "text": "Reconcile 1 figure the narrative states differently from the metrics", "href": "/raise/investor-narrative?project=42" },  // null with no mismatch
    "reason": null
  },
  "records": {                                // raiseCycle.ts:534-555, paged() :1414-1417
    "cols": [ {"key":"version","label":"Version"}, {"key":"investor_type","label":"Investor type"},
              {"key":"deck","label":"Used by deck"}, {"key":"mismatches","label":"Mismatches"}, {"key":"date","label":"Date"} ],
    "rows": [ { "id": 4,                      // number: the version number (record id)
                "cells": { "version": "v4", "investor_type": "Seed fund", "deck": "v6",   // deck null when deck_version null
                           "mismatches": { "text": "1", "tone": "warn" },              // tone 'ok' when 0
                           "date": "2026-10-20" } } ],
    "total": 4, "page": 1, "page_size": 25,
    "filters": [ { "key": "investor_type", "label": "Investor type", "options": [ {"value":"angel","label":"Angel"}, "…7" ] } ],
    "sorts": [ {"key":"newest","label":"Newest"}, {"key":"oldest","label":"Oldest"} ],   // first is default
    "linkable": true                          // hasRecords('raise'), cycle_raise.ts:141; services/records/index.ts:11,15-18
  },
  "parts": { "mercury": { /* §6; present for the project's own founder only */ } }       // key omitted when parts is empty (:159-160)
}
```

**Card in other states.**
- Empty card: `{state:'empty', series:null, next:{text:'New version', href:'/raise/investor-narrative?project=<pid>&add=1'}, reason:'No narrative saved yet. Each version appears here.'}` (`raiseCycle.ts:502-504`).
- Unreadable card: `{state:'unreadable', series:null, next:null, reason:'Narrative versions could not be read'}` (`cycleCards.ts:93-102`).
- Unreadable records: `{state:'unreadable', reason:'Investor narrative records could not be read', cols:[], rows:[], total:null, page, page_size:null}`, with no `linkable` (`cycle_raise.ts:144`).

#### How a version row is keyed

`loadVersions` (`raiseCycle.ts:480-491`) runs over `spinout_deck_overrides` where `version > 0`, grouped by `version` and ordered `version DESC`:

```ts
type VersionRow = { version: number; investor_type: string|null /*MAX*/; deck_version: number|null /*MAX*/;
                    saved_at: string /*MAX(updated_at) over the version's rows*/;
                    mismatches: number /*COUNT narrative_checks for (project, version)*/ };
```

- **No created date.** `saved_at` is the newest row write. An edit that changes only Why now or Check against touches `narrative_version_meta.updated_at`, not the override rows, so `saved_at` does not move.
- **`narrative_version_meta.created_at` is never read.**
- **No `by` field** in the list or the card. The creator shows only in the record activity (§2).

**List controls** (`raiseCycle.ts:535-537`):
- `q` matches the type label or `v<n>`.
- `filter=investor_type:<key>` filters by type.
- `sort=oldest` reverses the list; any other value means newest first.

---

### 2. `GET /api/cycles/raise/modules/investor-narrative/records/:id?project=`

**Route.** `cloudflare-worker/src/routes/cycle_records.ts:123-148`. `scoped()` (`:48-76`) checks, in order:
1. `CYCLES` (`:11`)
2. the spec (`specFor`)
3. `RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/` (`cloudflare-worker/src/services/records/owned.ts:7`)
4. the project
5. the gate, `spec.read` = `'write'`, i.e. `canWrite` (`cloudflare-worker/src/services/records/raise.ts:119-124`)
6. `ownedRow('spinout_deck_overrides', id)`, which runs `SELECT 1 … WHERE project_id=? AND version=?` and needs `id` to match `^[1-9][0-9]{0,9}$`. Version 0 can never be addressed (`owned.ts:224-227`).

**Id to version.** The record id is the version number as a string (`records/raise.ts:233,241-244`).

#### Literal shape

```jsonc
{
  "cycle": "raise", "module": "investor-narrative", "id": "4",
  "title": "v4 · seed fund",                                              // raise.ts:254
  "sub": "Saved 2026-10-20 · used by deck v6",                           // :255 (date = saved_at)
  "pills": [ {"text":"Seed fund","tone":"vio"}, {"text":"1 mismatch","tone":"amb"} ],   // 'ok' tone at 0
  "facts": [                                                             // :257-262; fact() :51-52
    {"label":"Investor type","value":"Seed fund"},
    {"label":"Used by","value":"Pitch deck v6"},       // or {value:null, reason:"No deck version was recorded with it"}
    {"label":"Mismatches","value":1},
    {"label":"Based on","value":"v3"}                  // 'The live deck' | 'Blank' | 'v<n>' | {value:null, reason:"Saved before versions recorded their source"}
  ],
  "main": [
    { "key":"narrative", "title":"The narrative", "gate":"write", "action":"edit",      // :267-280
      "rows": [ {"a":"One-liner","b":"…"},                 // spinout_deck_overrides 'cover.thesis' of this version
                {"a":"Problem","b":"","c":"Not recorded","tone":"grey"},   // 'problem.framing'
                {"a":"Why now","b":"…"},                   // narrative_version_meta.why_now
                {"a":"Traction","b":"…"},                  // 'traction.takeaway'
                {"a":"The ambition","b":"…"} ] },            // 'ask.title' — label is literally "The ask" (:237-239)
    { "key":"consistency", "title":"Consistency check", "gate":"write",                 // :282-297
      "rows": [ {"a":"MRR","b":"stated $12,000 · metrics $9,800","c":"Mismatch","tone":"bad"},
                {"a":"Paying customers","b":"consistent everywhere","c":"OK","tone":"ok"},
                {"a":"The raise","b":"stated or stored in one place only","c":"Not compared","tone":"grey"} ] }
  ],
  "side": [
    { "key":"feedback", "title":"Investor feedback", "gate":"write", "side":true,        // :298-304 (see §7)
      "rows":[ {"a":"\"Too early for us\"","b":"raised 2 times"} ], "empty":"No investor feedback recorded." },
    { "key":"versions", "title":"Versions", "gate":"write", "side":true,                 // :305-313, up to 12 others
      "rows":[ {"a":"v3 · angel","b":"2026-10-01","href":"/raise/investor-narrative/3?project_id=42"} ],
      "empty":"No other version saved." }
  ],
  "actions": [                                                           // :314-349; declaration() cycle_records.ts:20-24 strips execute/references
    { "key":"duplicate","label":"Duplicate","kind":"write","tone":"default","multipart":false },
    { "key":"edit","label":"Edit","kind":"form","tone":"primary","multipart":false,
      "form": { "title":"Edit v4","cta":"Save version","fields":[
        {"key":"investor_type","label":"Investor type","kind":"CH","options":[…7],"value":"seed_fund","required":true},
        {"key":"one_liner","label":"One-liner","kind":"T","value":"<cover.thesis>"},
        {"key":"why_now","label":"Why now","kind":"T","value":"<meta.why_now|''>"},
        {"key":"ask","label":"The ask","kind":"T","value":"<ask.title>"},
        {"key":"check_against","label":"Check against","kind":"CK","options":[{"value":"deck","label":"Pitch deck"},{"value":"metrics","label":"Metrics"}],"value":["deck","metrics"]} ] } }
  ],
  "next": { "text":"Edit", "action":"edit" },   // nextFor() cycle_records.ts:30-46: no row status matches STATUS_NEXT, so the first section action
  "activity": [ { "a":"Created by Ana", "b":"2026-10-01 09:00:00", "action":"narrative_version_created", "created_at":"…" } ],
  "activity_total": 2
}
```

Correction to the snippet above: the last row of "The narrative" reads `{"a":"The ask","b":"…"}`. "The ambition" was a typo; the row comes from `ask.title` and its label is "The ask" (`records/raise.ts:237-239`).

**Activity.**
- `activityFor` returns items `{a, b, action, created_at}` (`cloudflare-worker/src/services/cycleActivity.ts:236,304-327`).
- `narrative_version_created` counts as a create row because its action ends in `_created` (`cycleActivity.ts:231-233`), so it renders as "Created by <name>".
- When no create row exists, the creator falls back to the `_version` marker's `updated_by` (`cycleActivity.ts:132-136`).
- Paged reader: `GET …/records/:id/activity?page=` (`cycle_records.ts:113-121`).

**Actions.**
- `POST …/records/:id/actions/duplicate` with any body calls `duplicateNarrativeVersion`. It returns `{ok:true, record:{version, mismatches}}`, or 409 `{detail:'This version records no investor type, so it cannot be duplicated'}` (`cloudflare-worker/src/services/raiseWriters.ts:650-658`).
- `PATCH …/records/:id` or `POST …/actions/edit` calls `updateNarrativeVersion`, the same writer as §3 (`records/raise.ts:339-346`; `cycle_records.ts:150-151`).
  - Sending `start_from` answers 400.
  - `based_on_version` is accepted but is not a form field. When sent, `references` proves it with `ownedRow` (`records/raise.ts:347`).
- `DELETE …/records/:id` answers 404 `{detail:'No such action on this record.'}`: the narrative record declares no `delete` action (`cycle_records.ts:90,152`).

**Form options.** `GET /api/cycles/raise/modules/investor-narrative/form-options?project=` uses the write gate (`cycle_records.ts:154-163`) and returns (`records/raise.ts:350-359`):

```
{ investor_types:[{value,label}×7],
  start_from:[{value:'live',label:'The live deck'},{value:'version',label:'A saved version'},{value:'blank',label:'Blank'}],
  versions:[{value:'4',label:'v4 · seed fund'},…],
  check_against:[{value:'deck',label:'Pitch deck'},{value:'metrics',label:'Metrics'}] }
```

**Href query param differs.** Record hrefs use `?project_id=` (`records/raise.ts:54-55`), while card and module hrefs use `?project=` (`raiseCycle.ts:55`).

---

### 3. The writers

The route maps the body to writer fields in `narrativeFields` (`cycle_raise.ts:186-188`):

| Body key | Writer field |
|---|---|
| `investor_type` | `investorType` |
| `based_on_version` | `basedOnVersion` |
| `one_liner` | `oneLiner` |
| `why_now` | `whyNow` |
| `ask` | `ask` |
| `check_against` | `checkAgainst` |

Errors come back through `writeFailed`: `{detail: sentence}` with the writer's status, a thrown Response, or 500 `{detail:'The write failed'}` (`cycle_raise.ts:100-106`). `WriterError(status, sentence)` is defined at `cloudflare-worker/src/services/validateWriters.ts:42-50`.

#### `POST /api/cycles/raise/narrative-versions?project=` returns 201

Route at `cycle_raise.ts:190-198`; writer `saveNarrativeVersion` at `raiseWriters.ts:193-237`.

Body: `{ investor_type (required), start_from?: 'live'|'version'|'blank' (default 'live'), based_on_version?, one_liner?, why_now?, ask?, check_against?: ('deck'|'metrics')[] | null }`

**Validation:**

| Status | Sentence | Cite |
|---|---|---|
| 400 | `Unknown investor type` | `:195` |
| 400 | `start_from is live, version or blank` | `:197` |
| 404 | `The version to start from not found` (needs `start_from:'version'`; checked by `ownVersion` → `ownedRow`) | `:144-148,200` |
| 400 | `based_on_version goes with start_from: version` | `:201` |
| 400 | `check_against is a list of deck and metrics` (non-empty array of the two keys; stored re-ordered as JSON) | `:150-157` |

Trimmed text caps: `one_liner` 500, `ask` 300 (`:134`), `why_now` 2000 (`:203`).

**Writes, in order:**
1. `ensureSpinoutDeckOverridesSchema` (`cloudflare-worker/src/services/decks/spinoutDeckOverrides.ts:230-252`).
2. Version number N = `COALESCE(MAX(version),0)+1` over all of the project's rows (`raiseWriters.ts:204-206`).
3. `deck_version` = `pitch_decks.version`, preferring `is_current`, then the highest version, then the highest id (`:207-210`).
4. Unless `blank`: copy every row of version 0 (live) or of `based_on_version` except `_version` into version N, with `investor_type` and `deck_version` (`:211-217`).
5. Marker row: `field_key='_version'`, `value=investor_type` (`VERSION_MARKER_KEY`, `raiseCycle.ts:390`; `raiseWriters.ts:219-222`).
6. `setWords` deletes and re-inserts `cover.thesis` (from `one_liner`) and `ask.title` (from `ask`) for version N. An empty value deletes the row (`:160-168,223-227`).
7. `INSERT narrative_version_meta (project_id, version, start_from, based_on_version, why_now, check_against_json, created_by)` (`:228-231`).
8. `runCheck` (§4) (`:232`).
9. Log row.

**Log row** (`logRaise`, `raiseWriters.ts:47-49`, into `logCycleWriteStatement` at `cycleActivity.ts:71-80`):

```
activity_logs(project_id, user_id, entity_type='raise.investor-narrative', entity_id='<N>',
              action='narrative_version_created',
              details='Version N saved for <Label>[, based on version M]; k mismatch(es)', actor='user:<id>')
```

**Response:** `{ version: number, mismatches: Mismatch[] }`, where

```ts
Mismatch = { figure:'mrr'|'paying_customers'|'raise'; stated_value:number; stated_source:string; metric_value:number; metric_source:string }   // raiseCycle.ts:397
```

#### `PATCH /api/cycles/raise/narrative-versions/:version?project=` returns 200

Route at `cycle_raise.ts:200-210`; writer `updateNarrativeVersion` at `raiseWriters.ts:246-300`.

**Route-level refusals:**
- 404 `Version not found` when `:version` is not `^[1-9][0-9]{0,9}$` or is not this venture's.
- 400 `Start from is set when the version is made` when the body contains `start_from`.

**Writer validation:**

| Status | Sentence | Cite |
|---|---|---|
| 400 | `Unknown investor type` | `:257` |
| 404 | `The version to start from not found` | `:262` |
| 400 | `A version is based on an earlier one` (needs `based_on_version < version`; `null` clears it) | `:263` |
| 400 | `check_against …` (`null` clears it) | `:265` |
| 400 | `Nothing to change` (every field undefined) | `:267-269` |

**Writes:**
- `investor_type`: updates every row of the version, plus the marker's value and `updated_at` (`:271-277`).
- Words: through `setWords`, keeping the marker's `deck_version` (`:278-283`).
- Meta: if any meta field is sent, `INSERT … ON CONFLICT(project_id,version) DO NOTHING` with `start_from 'live'` (for rows saved before migration 463), then `UPDATE` of `based_on_version`, `why_now`, `check_against_json` and `updated_at` (`:284-295`).
- Then `runCheck`.
- Log row: action `narrative_version_updated`, `details='Version N edited: <investor type, one-liner, the ask, based on, why now, check against>; k mismatch(es)'` (`:297-298`).

**Response:** `{ version, mismatches }`.

**Not writable by any narrative writer:** `problem.framing` and `traction.takeaway`, which the record shows (`records/raise.ts:237-239`). `WORD_FIELDS` covers only `cover.thesis` and `ask.title` (`raiseWriters.ts:134`).

The live version 0 wording is written elsewhere:
- `PUT /api/projects/:projectId/spinout-deck/overrides` with `{overrides:{key:value}, remove?:[]}`, any key in `SPINOUT_OVERRIDABLE_KEYS` (`cloudflare-worker/src/routes/projects.ts:1171-1195`; `spinoutDeckOverrides.ts:49-72`; version 0 only, `:266,307`).
- `GET` of the same path is the reader (`projects.ts:1152-1162`).
- Its gate is `resolveSpinoutDeckAccess`: the premium method `axal_spinout_demoday`, which answers 402 `PAYWALL_PREMIUM_METHOD` (`projects.ts:1034-1048`).

**Frontend clients:**
- `raise.narrativeVersion` and `narrativeVersionUpdate` (`frontend/src/lib/api/cycleWrites.js:48-49`)
- `recordAction` (`cycleWrites.js:93-98`)
- `formOptions` (`cycleWrites.js:22-27`)
- module, record and activity reads (`frontend/src/lib/api/cycles.js:24,45-51`)
- forms (`frontend/src/pages/cycles/forms.js:402,425-444,1006`)

---

### 4. The consistency check (`narrative_checks`)

**When it runs.** Only inside `runCheck`, which deletes the version's rows and inserts one row per mismatch (`raiseWriters.ts:171-181`). That happens on POST, on PATCH, and on Duplicate (through POST).

It does **not** run when any of these change:
- `project_metrics`
- `raise_rounds`
- the `projects` figures
- the live wording

The stored rows go stale until the version is saved again. Nothing recomputes at read time.

**The three figures.** `FIGURES = ['mrr','paying_customers','raise']`, labelled `MRR`, `Paying customers`, `The raise` (`raiseCycle.ts:392-394`).

**Inputs** (`checkInputs`, `raiseCycle.ts:447-478`).

Stated figures:

| Source | Fields | Source string |
|---|---|---|
| Deck (from `projects` columns, not from a `pitch_decks` version) | `projects.mrr`, `.paying_customers`, `.funding_needed` when > 0 | `Deck · projects.<col>` |
| Narrative wording | every override row of the version except `_version`, plus `narrative_version_meta.why_now` | `Narrative · <field_key>` / `Narrative · why_now` |

The wording is parsed by fixed regexes, never by a model (`parseStatedFigures`, `:410-423`). Each field is read once per figure:
- MRR: `$N[k|m|b|thousand|million|billion] [in] MRR|monthly recurring revenue`, or `MRR [of|is|at|:|=] $N`
- Paying customers: `N paying customers|accounts`
- The raise: `rais(e|ing) [a|an|our] $N`

Stored metrics:

| Figure | Read | Source string |
|---|---|---|
| mrr | newest `project_metrics.mrr` (any `source`, including `'stripe'` rows written at `cloudflare-worker/src/integrations/providers/stripe.ts:404-411`) | `Metrics · project_metrics.mrr on <date>` |
| paying_customers | newest `project_metrics.paying_accounts` | `Metrics · project_metrics.paying_accounts on <date>` |
| raise | `raise_rounds.target_amount` where `status='active'` | `Pipeline · raise_rounds.target_amount (active round)` |

**Comparison.** A stated figure is a mismatch when `!agrees`, i.e. it differs by more than 2% and by more than 1 (`:426-428,435-444`). A figure with no stored metric is never a mismatch.

**`check_against_json` is stored but no check reads it.** The only readers are `records/raise.ts:246,322` for the Edit form value.

**Read back:**

| Where | What |
|---|---|
| Card | newest version's rows, via `mismatchSentence` (`raiseCycle.ts:495-497,511-525`) |
| Records | count per version (`:485`) |
| Record "Consistency check" | the 3 rows (`records/raise.ts:282-297`) |
| Readiness computed `narrative` item | score `10 − 2·mismatches` of the newest version (`raiseCycle.ts:227-245`) |
| `narrativeMismatch` | §5 |

In the record section, `Mismatch` comes from the stored rows, but `OK` and `Not compared` are recomputed from current inputs. If metrics change after the last save, a figure that now differs can show `OK`.

`narrative_checks.checked_at` is in no response. It is read only by the readiness re-score clock (`raiseCycle.ts:260-263`).

---

### 5. Phrase the fix (`raise/narrative-fix`)

**Surface.** `cloudflare-worker/src/routes/research.ts:3615-3635`:
- Material: `narrativeFixMaterial(m)`, four lines (`cloudflare-worker/src/services/narrativeFix.ts:57-64`).
- Instruction: `NARRATIVE_FIX_INSTRUCTION` (`narrativeFix.ts:27-32`).
- `finish`: `finishNarrativeFix`. It returns null when `unfoundFigures` finds a number the row does not carry; otherwise it appends `"\n\nAs the check found them: <mismatchSentence>."` (`narrativeFix.ts:75-95`).
- There is **no `accept` hook**: accepting writes neither the narrative nor the metrics.

**Which mismatch.** `narrativeMismatch` takes the first row (`ORDER BY c.id`) of the **newest** version only. It cannot target a chosen version or figure (`narrativeFix.ts:40-54`).

**Scope.** `scope_key` is the project id as a string. `founderProject` requires `users.founder_id = projects.founder_id` and `deleted_at IS NULL`. A scope that was sent but does not resolve gives null; with no scope, it works only when the user owns a single project (`research.ts:1307-1329`). Admins without a `founder_id` get `nothing_to_draft`.

**Endpoints:**

| Call | Request | Response |
|---|---|---|
| `POST /api/research/drafts` (`:3705-3766`) | `{surface:'raise/narrative-fix', scope_key?:'<pid>', page?:'<app path>'}` plus rail headers | 201 `{item}`. Errors: 400 `{detail:'unknown_surface'}`; 409 `{detail:'nothing_to_draft'}`; 403 `{error:'assist_off', message:'AI assistance is off on this page.', detail:same}` (`cloudflare-worker/src/util/railContext.ts:40-42`; `cloudflare-worker/src/util/refusal.ts:70-82`); 503 `{detail:'guard_blocked_output'\|'guard_unavailable', message, link?}`; 503 `{detail:'draft_unavailable'}`; 503 `{detail:'draft_unfaithful'}` |
| `GET /api/research/drafts?surface=raise/narrative-fix[&scope_key=]` (`:3638-3654`) | | `{items: Draft[]}`, newest 20, owner-scoped |
| `PATCH /api/research/drafts/:uid` (`:3775-3809`) | `{body?}` (≤8000 characters) | `{item}`; stamps `accepted_at` only. 400 `body_empty`, 404 `not_found` |
| `DELETE /api/research/drafts/:uid` (`:3812-3819`) | | `{ok:true}` or 404 |

```ts
Draft = { uid, surface, scope_key, body, model, cost_usd: number, accepted: boolean, accepted_at, created_at }   // draftDto research.ts:1247-1257
```

**Run.** `task:'workspace_explain'`, `maxTokens:500`, `surface: page`. The rail context is `railFor(c, {page:'Founder · Raise · Investor narrative', option:'draft:raise/narrative-fix'})` (`research.ts:3730-3738,3679`). Request headers `X-Rail-Page` and `X-Rail-Option` take precedence (`railContext.ts:33-37`).

**Plan gating: none.** No `ensureTier`/`requireTier` on `/api/research` or in this handler; `/api/research` is not in `STUDIO_PREFIXES` (`index.ts:795-816`).

**AI rail hold.**
- The page's assist switch is checked before the cache, the hold and the guard (`cloudflare-worker/src/services/aiRouter.ts:1669-1692`).
- The budget hold is `reserveAiBudget` (`aiRouter.ts:1902-1906`).
- The drafts route maps only `assist_off` and the two guard refusals. Every other refusal (`budget_user_day`, `budget_user_month`, `budget_org_month`, `budget_review`, `kill_switch`, `spend_limit`, `ai_paused`, `misconfigured`) answers 503 `draft_unavailable` (`research.ts:3743-3750`). `/decks/positioning` instead uses `refuseRun`, which answers 402 for a budget stop (`railContext.ts:53-63`). So NAR17c "Out of AI tokens" cannot be told apart from a failed draft on this route.

**Frontend.**
- API: `zoneDrafts`, `zoneDraftRun`, `zoneDraftAccept`, `zoneDraftDiscard` (`frontend/src/lib/api.js:5060-5076`).
- Band config: `frontend/src/pages/cycles/CycleRoute.jsx:216-217`.
- Rail option: `frontend/src/lib/railOptions/founder.js:142-143`.

---

### 6. Mercury citable figures

**Sync.** `POST /api/cycles/raise/mercury/sync?project=` returns `{ok:true, counts}` (`cycle_raise.ts:335-351`). It writes `mercury_raise_facts`:
- `kind:'revenue'`, `fact_key 'revenue:<YYYY-MM>'` for the 6 full months (`REVENUE_MONTHS=6`), plus `'revenue:growth'` (`value` = whole percent or null) (`cloudflare-worker/src/services/mercury/raiseFeeds.ts:88,365-374`).
- `kind:'runway'`, `fact_key 'runway'` (`value` = months to 1 decimal or null, `burn_cents`, `amount_cents` = cash) (`raiseFeeds.ts:306-314,129-136`).

Ledger rows go to `connector_fed_items`, with the module `investor_narrative`, and a second `deck:` row for revenue (`raiseFeeds.ts:99,269-279`). `DELETE /api/cycles/raise/mercury/facts/:id` removes a fact, and a later sync never brings it back (`cycle_raise.ts:391-400`).

**Module read** (`cycle_raise.ts:146-158`; `RAISE_PART_FOR['investor-narrative'] = citableFigures`, `raiseFeeds.ts:509-517,493-507`):

```jsonc
"parts": { "mercury":
  // no active integrations row (founderMercuryConnection, cloudflare-worker/src/services/mercury/raiseAccess.ts:22-26):
  { "state": "not_connected"|"sign_in_required"|"reconnect", "reason": "<sentence>", "connection": MemberMercury }
  // else:
  { "integration_uid": "…", "connection": MemberMercury,
    "figures": [ { "key":"revenue_last_month","label":"Revenue credits, 2026-09","value":1234500,"unit":"cents","source":"From Mercury, as of 2026-10-20","fact_id":11 },
                 { "key":"revenue_growth","label":"Revenue growth, 2026-09 over the month before","value":12,"unit":"percent",… },
                 { "key":"net_burn","label":"Net burn, average of the last 3 months","value":4500000,"unit":"cents",… },
                 { "key":"runway","label":"Runway","value":14.2,"unit":"months",… } ],      // each present only if its fact exists
    "months": [ { "month":"2026-04","cents":0,"fact_id":5 }, … ] }
  // read threw: { "state":"unreadable", "reason":"What Mercury fed this module could not be read" }
}
```

```ts
MemberMercury = { state:'connected'|'not_connected'|'sign_in_required'|'reconnect', connect_href, connect_label, sentence }
// cloudflare-worker/src/services/mercury/memberConnection.ts:20-49
```

A pasted-token connection still produces the figures shape, with `connection.state:'sign_in_required'`, but a sync answers 409 for it (`raiseAccess.ts:36-38`).

**Who sees it.** `mercuryFounderOnly` (`cycle_raise.ts:312-322`) requires all of:
- `user.founder_id === projects.founder_id` (admins excluded);
- the project in the active company;
- not a support session.

Anyone else's read has no `parts.mercury`, and the Mercury routes answer 403 `mercury_owner_only` or `support_session_refused`.

**The consistency check does not read `mercury_raise_facts`** (`raiseCycle.ts:447-478`). These figures are "citable" only: no writer turns them into wording or into a narrative claim.

---

### 7. Investor feedback and objections

**Store.** `raise_prospect_feedback(id, uid, prospect_id→raise_prospects, objection NOT NULL, answer, created_by, created_at, updated_at)` (`cloudflare-worker/sql/migrations/463_raise_record_stores.sql:107-117`).

**Readers:**

| Where | Query | Output |
|---|---|---|
| Narrative record, side section `feedback` | `GROUP BY f.objection`, joined to `raise_prospects` on project, `ORDER BY n DESC, objection LIMIT 10` | `[{a:'"<objection>"', b:'raised N time(s)'}]`, empty `'No investor feedback recorded.'` (`records/raise.ts:298-304`) |
| Prospect record, side section `feedback` (capital-relationships) | `objection, created_at WHERE prospect_id=? LIMIT 20` | `[{a:'"…"', b:'YYYY-MM-DD'}]`, action `add-feedback` (`records/raise.ts:946-951`) |

**Writer.** The prospect record action `add-feedback` takes `{objection (required, ≤1000), answer? (≤2000)}` and writes through `addProspectFeedback`, logged on `raise.capital-relationships` (`records/raise.ts:988-997`; `raiseWriters.ts:723-732`).

**Not read anywhere in `cloudflare-worker/src`:**
- `raise_prospect_feedback.answer`. Searching `cloudflare-worker/` for the table finds only the readers above and the writer, plus tests. So "Objections answered" (NAR1 tile) has no source.
- No objection-to-section link exists.
- `deck_share_feedback` (`cloudflare-worker/sql/migrations/071_deck_share_conversions.sql:24-38`) is written at `cloudflare-worker/src/routes/deck_share_actions.ts:456` and read by no route.

---

### 8. `POST /api/decks/positioning`

Route: `cloudflare-worker/src/routes/decks.ts:563-710`.

**Gating.**
- `ensureTier(user,'studio')` (comment `D683: Raise + Grow`, `:564`; the docblock's "Growth-tier" at `:560` is stale).
- It throws 402 `{error:'tier_required', required:'studio', message, plan:{tier,name,price_label}, checkout_path:'/api/billing/tier/checkout'}` (`cloudflare-worker/src/middleware/requireTier.ts:87-107`).
- Bypass roles: admin, partner, investor, advisor (`requireTier.ts:32,70`).

**Access.** `projectOwned(c, user, pid, {write:true})` (`cloudflare-worker/src/middleware/projectContentAccess.ts:15-47`):

| Caller | Outcome |
|---|---|
| admin | passes |
| investor | `NotFound` (404) or `Forbidden` (403) |
| owner | founder role with a matching `founder_id`, and the project must be in the active company or 404 |
| anyone else | needs accepted `project_members` role `owner` or `cofounder` (an advisor is refused for write), plus `canAccessProject`; the write logs `activity_logs` `project_content_write_authorized` |

This is a different admission model from `canWrite` in §0: co-founders pass here and are refused there.

**Request.** `{project_id}` (parseInt), plus rail headers. Frontend: `deckPositioning(projectId, headers)` (`frontend/src/lib/api.js:2750`).

**What it reads:**
- `projects.*`: name, sector, stage, description, problem_statement, solution, why_now, tagline, vision, tam, sam, som, users_count, revenue, traction_summary, growth_signals, funding_needed.
- Recorded team and advisors from `users` and accepted `project_members` (`:582-605`).
- `financial_models` `computed_json`, falling back to `assumptions_json`, where `updated_by IS NOT NULL` (runway_months, ltv_cac_ratio, avg_monthly_burn).
- Up to 5 submitted `portfolio_updates` (`:607-626`).

It reads **no** narrative version, override or check.

**Run.** `task:'rail_write'`, `surface:'/raise/pitch'`. Rail context: `{page:'Founder · Raise · Pitch deck', option:'draft:positioning'}` with record `project:<pid>`. `temperature 0.6`, `maxTokens 700` (`:677-686`).

**Response 200, nothing persisted:**

```jsonc
{ "project_id": 42, "project_name": "…", "one_liner": "…", "elevator_pitch": "…",
  "positioning_lines": ["…"],                       // ≤6, trimmed, non-empty
  "sourced_from": { "team": number|null, "advisors": number|null, "team_status": "recorded"|"not_recorded"|"unreadable",
                    "traction": boolean, "updates": number, "financials": boolean } }
```

**Errors:**

| Status | Body |
|---|---|
| 400 | `{error:'project_id required'}` |
| 404 | `{error:'not found'}` |
| 403 | `{error:'forbidden'}` |
| from `refuseRun` | 403 `assist_off`/`ai_paused`, 402 budget, 422 guard block, 503 guard unavailable/misconfigured |
| 503 | `{error:'ai_unavailable', code, message}` |
| 502 | `{error:'ai_failed', code, message}` |

No server-side filter drops lines that carry a number (NAR5's rule): only the prompt forbids invented metrics (`:673`). No positioning store exists in `cloudflare-worker/sql/migrations`: the "positioning" hits there are unrelated (`246`, `440`, `460`).

---

### 9. Audiences: seven investor types

```ts
INVESTOR_TYPES = ['angel','pre_seed_fund','seed_fund','series_a_fund','strategic','grant','other']   // raiseCycle.ts:384
INVESTOR_TYPE_LABEL = { angel:'Angel', pre_seed_fund:'Pre-seed fund', seed_fund:'Seed fund', series_a_fund:'Series A fund',
                        strategic:'Strategic', grant:'Grant', other:'Other' }                       // raiseCycle.ts:385-388
```

- `null` investor_type reads as `other` (`raiseCycle.ts:507,535`; `records/raise.ts:49`).
- The same list appears in the record filters (`raiseCycle.ts:551`), the Edit form (`records/raise.ts:333`), the form options (`:354`) and the writer validation (`raiseWriters.ts:195,257`).
- The frontend keeps its own copy (`frontend/src/pages/cycles/forms.js:402`).
- The canvas `AUD` matches the labels in the same order (`design/incoming/Investor Narrative Page.dc.html:404`).

---

### 10. Narrative-related tables

| Table | Columns | Cite |
|---|---|---|
| `spinout_deck_overrides` | `id, project_id, field_key, value NOT NULL, updated_by, updated_at`; then (442) `version INTEGER NOT NULL DEFAULT 0`, `investor_type TEXT`, `deck_version INTEGER`; unique on `(project_id, field_key, version)`. Version 0 is the live wording; N>0 is a narrative version; the `_version` row is the marker | `164_spinout_deck_overrides.sql:31-45`; `442_raise_cycle_stores.sql:69-74` |
| `narrative_checks` | `id, project_id, version, figure, stated_value REAL, stated_source, metric_value REAL, metric_source, checked_at`; index on `(project_id, version)` | `442_raise_cycle_stores.sql:76-87` |
| `narrative_version_meta` | `id, uid, project_id, version, start_from ('live'\|'version'\|'blank', default 'live'), based_on_version, why_now, check_against_json, created_by, created_at, updated_at`; `UNIQUE(project_id, version)` | `463_raise_record_stores.sql:119-132` |
| `raise_prospect_feedback` | see §7 | `463_raise_record_stores.sql:107-117` |
| `raise_prospect_events` | `id, uid, prospect_id, kind ('meeting','intro','email','call','note'), note, due_on, done_at, created_by, created_at, updated_at` | `463_raise_record_stores.sql:93-105` |
| `mercury_raise_facts` | `id, integration_id, project_id, kind ('runway','spend','revenue'), fact_key, label, months, amount_cents, burn_cents, value REAL, as_of, updated_at`; `UNIQUE(integration_id, project_id, fact_key)` | `520_mercury_raise_feeds.sql:28-42` |
| `research_zone_drafts` | `id, uid, owner_user_id, surface, scope_key, body, model, cost_micro_usd, accepted_at, created_at` | `221_research_ask_sessions.sql:133-158` |

All paths in this table are under `cloudflare-worker/sql/migrations/`. Searching `cloudflare-worker/sql/migrations/*.sql` for these table names found no other narrative tables.

---

### 11. What the canvas needs that the Worker does not have today

Where I looked: `cycle_raise.ts` (all routes, `:119-400`), `records/raise.ts:233-359`, `raiseWriters.ts:129-300,640-658`, `raiseCycle.ts:380-555`, `research.ts:3615-3819`, `decks.ts:563-710`, and `cloudflare-worker/sql/migrations/`.

**Story and claims**
- **Nine Story sections.** The canvas `SECTS` lists Problem, Solution, Why now, Market, Traction, Business model, Competition, Team, The ask (`Investor Narrative Page.dc.html:277`). The record has 5 rows, and the writers set only the one-liner, the ask and why now (§2, §3). "Business model" has no key in `SPINOUT_OVERRIDABLE_KEYS` (`spinoutDeckOverrides.ts:49-72`).
- **Claim states, grades, best source, Evidence pack** (canvas `ST`, `Investor Narrative Page.dc.html:224`; NAR6, NAR7): no store and no reader. The Worker only produces Mismatch, OK and Not compared for 3 figures.
- **Stripe-bound figure chips, Insert-a-figure** (NAR2, NAR3): the module read has no Stripe part. Its parts are only `calls` and `mercury` (`cycle_raise.ts:146-158`). Stripe reaches the check only indirectly, through `project_metrics`.

**Versions**
- **Version compare** (NAR12): no endpoint.
- **Version delete**: no route or action (§2). No "a deck reads this version" guard exists either.

**Positioning**
- **Positioning persistence and per-field provenance** (NAR4, NAR5): none; `/decks/positioning` is stateless.

**Phrase the fix**
- **Accepting changes the narrative** (NAR9): there is no accept hook (`research.ts:3620`).
- **Fix per figure or per version**: no; the draft covers the newest version's first mismatch only.

**Objections**
- **"Objections answered" tile and answer-in-a-section** (NAR1, NAR10): `answer` is never read (§7).

**Admin and limits**
- **Admin/HQ read-only, notes thread, logged read reason** (NAR13): none. Admin passes `canWrite` as a full writer.
- **Out of AI tokens on Phrase the fix** (NAR17c): the route answers 503 `draft_unavailable`, not 402 (§5).