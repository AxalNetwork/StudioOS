# pages/admin/approvals — Admin › Approvals

D1038 (#2390): the owner's "Approvals" canvas (APR1–APR16) at `/admin/approvals`,
under the shared admin header (D936). `/admin/held/approvals` forwards here with
`?moved=held-approvals`.

| File | What it is |
|---|---|
| `approvalsModel.js` | Pure functions: the tabs and boards by address, the twenty lanes in the canvas's groups, HQ's nine, Not a queue, ages and bands, and every block built from the reads. No React, so `node --test` loads it alone. |
| `inboxModel.js` | D1045 (#2893): pure functions for part 7 — the inbox's query from the address, its rows, tiles, page line and the two charts; the item at `/admin/approvals/items/<lane>-<id>`, Assign and History; each lane's Notifies and HQ's counts; Decided's rows and notes; Waiting on HQ. |
| `AdminApprovals.jsx` | Inbox, the item drawer, Lanes and Decided (APR1–APR3, APR9–APR14) on HQ's inbox, item and decision reads, with the Studio glance for the lane counts. `LaneDoor` and `HqDoor` write each lane's door as a literal link; the item link is a literal template. |
| `LaneBoards.jsx` | The three lane boards (APR4, APR6, APR8): Product testers (no store yet), Co-marketing pitches (the admin queue per state) and Wellbeing experts (the experts read). They read; deciding stays on today's pages until D1038's parts 4 and 7. |
| `HeldApprovalsRedirect.jsx` | The old address, forwarded with its query and hash. |

The rule for adding here: a lane joins `LANES` with its glance key once the
Worker counts it, and its door joins `LaneDoor` as a literal `<Link to="…">`,
never a mapped one: `frontend/test/admin_route_reachability.test.mjs` reads
navigation syntax, and for several consoles this page is the HQ-held shell's
only door. A count is a number, "Could not be read" or "Not read here yet",
never a 0 for a missing value.
