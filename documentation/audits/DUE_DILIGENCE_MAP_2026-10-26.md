# Due diligence map — 2026-10-26

This audit reads the owner's "Due diligence" canvas (#2385, boards DDL1–DDL19) against the code on `origin/main` at `3f466ec0b7`. It is a snapshot, true as of that date and **not maintained**. D1244 is the decision that acts on it.

## 1. The canvas

`design/incoming/Due diligence · Boards.dc.html` holds the board grid. It imports `Due Diligence Desk Page.dc.html`.

| Boards | What they draw |
|---|---|
| DDL1, DDL19 | Cases, light and dark: four tiles, two charts, the stage strip, the toolbar, the table |
| DDL2 | Open a case: a subject picker, context, template cards, private fields |
| DDL3–DDL11 | One case's tabs: Overview, Checklist, Flags, Requests, Documents, Cross-checks, Team, Sign-off, Activity |
| DDL12 | My reviews, and a reviewer inside one case |
| DDL13 | Templates: Super Admin edits, an Admin reads |
| DDL14 | Dialogs A–H: verdict, raise and update a flag, decision, archive, notify founder, report, widen scope |
| DDL15 | The subject's requests page |
| DDL16, DDL17 | Empty, loading, error, paused; no permission |
| DDL18 | Phone |

## 2. What each board can read today

| Board | Read | Drawn by D1244 |
|---|---|---|
| DDL1 rows | `GET /api/dd/cases`, the newest 200 | Unchanged; the canvas's title, line and tabs above them |
| DDL1 tiles, charts, stage strip, paging | none: no overview read, no stage, no target IC date, no decision | Today's tiles from the loaded rows (part 6) |
| DDL2 | `POST /api/dd/cases`; the subject is a typed number | Unchanged (part 6) |
| DDL3 Overview | `GET /api/dd/cases/:uid` | Today's whole case page, under the case tabs |
| DDL4–DDL11 tab bodies | the same read, drawn on Overview | Each tab says where its blocks are on Overview today, then what waits |
| DDL5 flag state, owner, resolution, manual flags | none | Not read here yet (part 3) |
| DDL7 request files, item evidence, NDA download | none | Not read here yet (part 4) |
| DDL8 platform checks, taken on trust | none in the case read | Not read here yet (part 5) |
| DDL9 conflicts, expiry, remove | none | Not read here yet (part 5) |
| DDL10 decision, memo, IC hand-off, past reports | none (`dd_reports` rows are written, never listed) | Not read here yet (part 2) |
| DDL12 My reviews | none for a page (the dashboard's query only) | Not read here yet (part 5) |
| DDL13 Templates | none: Lite, Standard, Deep are fixed in `dueDiligence.ts` | Not read here yet (part 5) |
| DDL15 | `GET /api/dd/requests/mine` and the answer route | Unchanged (part 8) |

## 3. #2385's missing items, re-checked

| # | Finding | On `main` at `3f466ec0b7` |
|---|---|---|
| 1, 2 | No case decision or close; the Approvals lane never drains | **Open** (part 2). Only a section reaches `completed` |
| 3 | No case sign-off roll-up | **Open** (part 2) |
| 4 | No memo | **Open** (part 2) |
| 5 | No hand-off to IC | **Open** (part 2) |
| 6 | Reports are never listed again | **Open** (part 2) |
| 7, 8 | No manual flag, no resolve, no owner or state; no blocking sections | **Open** (parts 2, 3). `resolved_at` is read by the score, never written |
| 9–11 | Stub connectors write canned findings | **Fixed on main:** a connector with no live implementation or switched off returns `disabled` with "Not live", writes no finding and no score |
| 12 | A new case reads green | **Fixed on main:** `computeScore` returns a null band until something is reviewed. D1244 draws "Not scored yet" for it |
| 13–15 | Documents never reach the case; no item evidence; NDAs cannot be opened | **Open** (part 4) |
| 16 | Requests have no due date, reminder or withdraw | **Open** (part 4) |
| 17–19 | Assign by typed user ID; no conflicts, observer or expiry; a lead cannot record a verdict | **Open** (part 5; item 19 part 2) |
| 20 | The subject is a typed number | **Open** (parts 5, 6) |
| 21 | Advisor cases fail the CHECK | **Fixed on main** by migration 535 (D888, #2392) |
| 22 | A partner-deal case seeds no checklist | **Open** (part 1) |
| 23 | Templates are hard-coded | **Open** (part 5) |
| 24, 25 | Newest 200 only; no My reviews | **Open** (part 5); My reviews is now an address |
| 26 | Every button shows to every role | **Open** (parts 1, 7) |
| 27 | A browser pop-up for Notify founder; one word for every failure | **Open** (part 7) |
| 28 | A founder on `/due-diligence` is bounced home | **Open** (part 8) |
| 29 | Contracts' "Open in DD" never shows | **Open** (part 1) |
| — | Notices link everyone to `/admin/due-diligence/…` | **Open** (part 1) |

## 4. What waits, and on what

- The Worker parts (1–5) start now. Parts 2–5 take migrations 620–623; part 1 needs none.
- The frontend parts follow their Worker parts.
- The five owner questions take their recommended answers until the owner says otherwise (D1244 §5).
