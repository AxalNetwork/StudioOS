# Closing room map — 2026-10-26

The owner's "Closing room" canvas (#2424, boards CP1–CP21), read against the code on `origin/main` at `fc5e32007d`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1213.

## 1. The canvas

`design/incoming/Closing room · Boards.dc.html` holds the board grid, which imports `Closing Room Page.dc.html`.

| Boards | What they draw | Where |
|---|---|---|
| CP1 | The founder's room: every line, who acts next, the stepper | Raise › Capital relationships › Closing |
| CP2, CP20 | An investor's own line, the round's total only; the phone | Deals › [company] › Closing |
| CP3 | Prepare the paper (Admin): a template, its fields and sources, a counsel draft that cannot be sent | One closing |
| CP4 | Review and sign, with Axal's countersign | Raise › Capital relationships › Closing › SAFE |
| CP5 | Choose the route: direct, syndicate SPV, Axal VC fund, third-party fund | Dialog |
| CP6–CP8 | The SPV lead's view, the Axal VC fund route, a third-party fund drawer | One closing |
| CP9 | Payment instructions, the reveal and the account-change notice | Investor drawer |
| CP10 | Receipt evidence per line; only the receiving side's turns a line Received | Admin drawer |
| CP11 | The cap table change, one proposal with Raise › Cap table (CT11) | Founder dialog |
| CP12 | Reporting duties after Closed | Card and dialog |
| CP13, CP21 | The Closings desk, by deadline, light and dark | Contracts › Closings |
| CP14 | One closing, as the Super Admin and as an Admin | Contracts › Closings › [company] |
| CP15 | The activity drawer, append-only | Drawer |
| CP16–CP19 | Empty, loading, error and partial, no permission (Explorer, Advisor, another investor's line, an Operating Partner who ticks the checklist only) | States |

## 2. What each block can read today

| Block | Read | Drawn by D1213 |
|---|---|---|
| The lines (CP1, CP2, CP14) | `GET /api/deals/:id/commitments`: every line for an admin and the deal's founder, the investor's own rows, a confirmed total for anyone else | Yes. Status words: pending is Committed, confirmed is Received, withdrawn is Withdrawn |
| The round's total for an investor (CP2) | `GET /api/deals/:id` `capital_committed` (confirmed only) | Yes, as "Confirmed in the round" |
| The checklist (CP1, CP19) | `GET /api/deals/:id/closing-checklist` | Yes, for everyone but an investor |
| Recorded transfers (CP10, in part) | `GET /api/deals/:id/transfers` | Yes, for an Admin and an Operating Partner |
| The desk (CP13) | `GET /api/deals`, each deal's `closing_deadline` | Every deal with a deadline, by deadline; under 14 days marked |
| A closing as a record: lines waiting, next actor, owner | none: no `closings` store | Not read here yet |
| The paper and its fields with sources (CP3, CP4) | Contracts' templates and envelope preview exist; nothing ties them to a line | Not read here yet |
| The route (CP5–CP8) | none | Not read here yet |
| Payment instructions (CP9) | Axal entities only (`payInstructions.ts`); no company receiving account | Not read here yet |
| Evidence per line (CP10) | Mercury matches exist in three places, unlinked to a line | Not read here yet |
| The cap table proposal (CP11) | `addHolder()` exists; no proposal store | Not read here yet |
| Reporting duties (CP12) | none (`reporting_duties` is shared with #2427) | Not read here yet |
| Activity (CP15) | none | Not read here yet |

## 3. #2424's live bugs, re-checked

| Finding | On `main` today |
|---|---|
| Syndicate members' emails returned to any Studio caller | **Open** (`networkfx.ts` syndicate read) |
| Any account reads any cap table | **Open** (`captable.ts` read refuses only another venture's founder) |
| Syndicate capital calls use columns production lacks | **Open** (`legalcap.ts` capital routes) |
| A cross-fund call bills every LP of every fund | **Open** (`capital.ts` `capitalCall`) |
| A deck's deal pack fills a default cap and discount | Filed as #2443; re-check in part 1 |
| `legal/generate` invents terms; `PATCH …/sign` signs with no signature | **Open** |
| A syndicate is `funded` when commitments reach target | **Open** |
| A commitment needs no identity check | **Open** |

## 4. What waits, and on what

- **Worker parts** (1–4) start now. Part 2 takes migration **612** (the closings stores), part 4 takes **613** (company receiving accounts). Part 3 needs no migration if the envelope stages fit the booklet's columns. Otherwise it asks S1 for a number.
- **Frontend parts** (5, 6) follow parts 2 and 4; the runbook (7) follows them all.
- **Owner questions 1–8** take #2424's recommended answers until the owner says otherwise.
