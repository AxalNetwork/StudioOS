# Deal flow map — 2026-10-26

This audit reads the owner's "Deal flow" canvas (#2423, boards DLS1–DLS18) against the code on `origin/main` at `e0595c4aa4`. It is a snapshot, true as of that date and **not maintained**. D1236 is the decision that acts on it.

## 1. The canvas

`design/incoming/Deal flow · Boards.dc.html` holds the board grid. It imports `Deal Flow List Page.dc.html`.

| Boards | What they draw |
|---|---|
| DLS1, DLS2, DLS2b | The board (the investor's own stages) and the table (a column per scope, Fit to my thesis) |
| DLS3–DLS5 | Columns, card scopes and sort; the filters drawer; saved views |
| DLS6, DLS7, DLS7b | New for you; the deal peek drawer; the scoring breakdown panel (a placeholder) |
| DLS8, DLS9 | Compare, light and dark |
| DLS10 | Stage move dialogs: pass, move back, move to Commit, not allowed |
| DLS11, DLS11b, DLS12 | The Studio lens for an Admin and for an Operating Partner |
| DLS13–DLS17 | Empty, partial, loading, error, no permission and plan |
| DLS18 | Phone |

## 2. What each board can read today

| Board | Read | Drawn by D1236 |
|---|---|---|
| DLS1 board, own stages, drag and moves | none: one round status for everyone, moved by studio staff only | Not read here yet; today's zone board and deal rooms stay under Board |
| DLS2 rows | `GET /api/deals`, all rounds or `scope=mine` | Each row: venture, sector, the round's word, ask, days in stage |
| DLS2 scope columns, scope strip, confidence | none: SCORING (#2428) has no batch read | Not read here yet |
| DLS2 Fit to my thesis | none: no deal read uses `investor_profiles` | Not read here yet |
| DLS3–DLS5 columns, filters by score, saved views | none | Not read here yet |
| DLS6 Invited by the studio | `GET /api/deals/invitations/mine` | The pending invitations, each opening its deal |
| DLS6 thesis matches, introductions, syndicates, watchlist | none wired to deals | Not read here yet |
| DLS7 peek, DLS10 dialogs | none for the investor's own stage | Not drawn (parts 4, 5) |
| DLS8 compare | `GET /api/deals` for the picks | The picked ventures; the chart waits for the scores |
| DLS11, DLS12 Studio lens | `GET /api/deals`, `/advance`, `/pass`, `/draft`, `/funnel` | Unchanged: `DealsPage` until part 6 |
| DLS17 plan | `requireInvestorTier` (Professional) | Unchanged |

## 3. #2423's broken items, re-checked

| # | Finding | On `main` after D1236 |
|---|---|---|
| 1 | Invitations never show on `/deals` | **Fixed by D1236:** New for you lists them |
| 2 | Room links open deals the investor cannot read | **Fixed on the new table:** a row opens its deal only under Mine. `DealRoomsPanel` still links (part 1) |
| 3 | A room join records no firm | **Open** (part 1) |
| 4 | The client's `scope=mine` comment is wrong | **Open** (part 1) |
| 5 | An Operating Partner's pass closes the round for everyone | **Open** (parts 2, 6) |
| 6 | Intake writes Passed with no person | **Open** (part 6); the table already says "Not raising" for it |
| 7 | The board mixes two sets | **Open** (part 4) |
| 8 | The Free plan's room is unreachable | **Open** (part 1) |
| 9 | The rail says "recommendations" | **Open** (part 1) |

## 4. What waits, and on what

- The Worker parts (2, 3) start now. They need migrations 618 and 619.
- Part 1 starts now and needs no migration.
- The frontend parts follow their Worker parts. Scores wait on SCORING (#2428) as well.
- The eight owner questions take their recommended answers until the owner says otherwise (D1236 §5).
