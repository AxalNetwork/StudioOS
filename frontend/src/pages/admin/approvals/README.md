# pages/admin/approvals — Admin › Approvals

D1038 (#2390): the owner's "Approvals" canvas (APR1–APR16) at `/admin/approvals`,
under the shared admin header (D936). `/admin/held/approvals` forwards here with
`?moved=held-approvals`.

| File | What it is |
|---|---|
| `approvalsModel.js` | Pure functions: the tabs and boards by address, the twenty lanes in the canvas's groups, HQ's nine, Not a queue, ages and bands, and every block built from the reads. No React, so `node --test` loads it alone. |
| `inboxModel.js` | D1045 (#2893): pure functions for part 7 — the inbox's query from the address, its rows, tiles, page line and the two charts; the item at `/admin/approvals/items/<lane>-<id>`, Assign and History; each lane's Notifies and HQ's counts; Decided's rows and notes; Waiting on HQ. |
| `AdminApprovals.jsx` | Inbox, the item drawer, Lanes and Decided (APR1–APR3, APR9–APR14) on HQ's inbox, item and decision reads, with the Studio glance for the lane counts. `LaneDoor` and `HqDoor` write each lane's door as a literal link; the item link is a literal template. |
| `LaneBoards.jsx` | The three lane boards (APR4–APR8), chosen by address. D1046 (#2894): each board opens one item at `/admin/approvals/<board>/<id>` as a drawer over the tab it came from. |
| `TesterBoard.jsx` | Product testers (APR4, APR5) on D1042's store: five tabs, the facts, intake paused (#2318), three tiles, the chart by profile, the toolbar and table, the tester's drawer, and dialogs A (approve), B (decline), C (pause or remove) and Resume. |
| `PitchBoard.jsx` | Co-marketing pitches (APR6, APR7) on D1043's paged queue and D1132's one-pitch read: five tabs, the tiles over 30 days, the pitch's drawer, and the Approve, Decline and Publish dialogs. Co-marketing's own Review queue is retired into it. |
| `ExpertBoard.jsx` | Wellbeing experts (APR8) on D1043's review read: five tabs with Declined, the tiles, the credentials column, the expert's drawer, and the Verify (with "I checked their credentials"), Decline, Hide, Restore and Remove verification dialogs. The `/admin/wellbeing` roster's toggles are retired into it. |
| `boardParts.jsx` | What the boards share: styles, a tile, the failed card, a pager, one read answered alone, and the decision dialog that says what changes, who is told and what is recorded. |
| `HeldApprovalsRedirect.jsx` | The old address, forwarded with its query and hash. |

The rule for adding here: a lane joins `LANES` with its glance key once the
Worker counts it, and its door joins `LaneDoor` as a literal `<Link to="…">`,
never a mapped one: `frontend/test/admin_route_reachability.test.mjs` reads
navigation syntax, and for several consoles this page is the HQ-held shell's
only door. A count is a number, "Could not be read" or "Not read here yet",
never a 0 for a missing value.

D1046: every decision opens `DecisionDialog`, never `alert` or `confirm`, and a
refusal is the Worker's own sentence. A board's tab and item links are literal
paths and templates; the reachability test reads the board files through
`LaneBoards.jsx`'s entry in its `COMPOSED` table.
