# Program grants

D981 (#2376): Program grants at `/admin/licences/programs`, the Super Admin's
page for which programs each licensed studio may run, built to the owner's
canvas (GR1–GR15, `design/incoming/Program Grants Page.dc.html`) under the
shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`). It is the
second item of HQ's Licences strip, beside the ledger (`../AdminLicences.jsx`).
The studio's side is the Programs tab of its licence page,
`../../subsidiary/licence/ProgramsTab.jsx`, at `/admin/my-licence/programs`.

- `ProgramGrants.jsx` — the page inside `AdminBoardFrame` (its rail): the
  header, the studios tile and three waiting tiles, the grid of studios against
  the nine programs, and the two waiting charts. It reads the licence ledger
  and nothing else. Its header carries HQ's tabs (Grid, History) and the More
  menu's Download CSV (D1126).
- `ProgramGrantsHistory.jsx` — D1126 (#3006): HQ's History tab at
  `/admin/licences/programs/history`: every licence's program decisions,
  newest first, with HQ's reason, filtered by program, a page at a time. It
  reads `GET /api/admin/program-grants/history` and writes nothing.

The programs, their groups and the words each side reads live in
`../../../lib/programGrants.js`, which both pages and their test share.

## Rules

- No grant is stored yet (D981 part 1). A grantable cell says "Not recorded",
  never "Not granted": not granting is a decision HQ has not recorded either.
- The fixed facts are drawn as the canvas states them: Product testing is HQ
  only, and two programs are not ready to grant.
- A failed ledger read says so; it is never an empty grid.
- Nothing here writes. Granting, pausing, ending and the default terms come
  with D981's parts, each behind the Super Admin's step-up and a reason.
- A tab or sub-address (Requests, Default terms, one studio) is not added
  before its feature (D953's rule). History came with its read (D1126); the
  other tabs join `GrantsTabs` with D981 part 6 (#2778).
- A failed CSV download says so on the page with the Worker's sentence.
