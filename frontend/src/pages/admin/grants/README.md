# Program grants

D981 (#2376), completed by D987 (#2778): Program grants at
`/admin/licences/programs`, the Super Admin's page for which programs each
licensed studio may run, and on what terms. It is built to the owner's canvas
(GR1–GR15, `design/incoming/Program Grants Page.dc.html`) under the shared
admin page header (D936, `../../../ui/AdminPageHeader.jsx`). It is the second
item of HQ's Licences strip, beside the ledger (`../AdminLicences.jsx`). The
studio's side is the Programs tab of its licence page,
`../../subsidiary/licence/ProgramsTab.jsx`, at `/admin/my-licence/programs`.

- `ProgramGrants.jsx` — the page inside `AdminBoardFrame` (its rail). It
  reads the grid (D982) and the requests (D983), draws the header and the tabs,
  and picks the view from the address.
- `GridView.jsx` — GR1: the tiles, the two charts and the grid of studios
  against the nine programs, with + Grant; on a phone, a list of studios.
- `StudioView.jsx` — GR3 at `/admin/licences/programs/studio/:uid`: one
  studio's tiles, its programs with their acts, its partner deal types (D986),
  its requests and its recent changes, and Download CSV.
- `RequestsView.jsx` — GR5 at `/requests`: every studio's requests, Answer
  and Finish grant.
- `DefaultsView.jsx` — GR6 at `/defaults`: the terms new grants start from,
  "Can be granted" and Edit defaults.
- `GrantDialogs.jsx` — the dialogs: the reason dialog (pause, resume, end,
  send schedule, the switches), the grant lightbox (GR4 and its review),
  the answer dialog (GR5d) and Edit defaults.
- `grantsModel.js` — the pure model every view and the test share.

The programs, their groups and the words both sides read live in
`../../../lib/programGrants.js`.

## Rules

- Each read is its own block. A failed one reads Unreadable with Try again
  and never blanks another; an unknown figure is "Not recorded", never 0.
- Every write opens an in-page dialog, says what it changes and asks for a
  reason of 10 characters or more. The authenticator code is the app's
  step-up. A refusal is said in the Worker's words, inside the dialog.
- A suspended licence freezes Grant, Change terms, Resume and Send schedule,
  as the Worker does; Pause and End stay open.
- The tabs are literal `HeaderTab`s and the one-studio doors are literal
  links, so the reachability walk sees them.
- A tab is not added before its feature (D953's rule): there is no History
  tab until a read spans studios.
