# Persona segments

D997 (#2378): Persona segments at `/admin/persona-segments`, built to the owner's
canvas (SEG1–SEG14, `design/incoming/Persona Segments Page.dc.html`) under the
shared admin page header (D936). It sits under Accounts on the Admin shell and
under Content on HQ's; its tabs are sub-paths: Overview and `/unclassified`. The
Admin Console's `?tab=personas` forwards here with `?moved=personas`, in
`../LegacyContractsRedirect.jsx`.

- `PersonaSegments.jsx` — the page: the header in the viewer's shell, Overview
  (D1004: the tiles, the profile filter and sub-account chips, the charts, the
  cards and the needs and offers table, each block answering alone from D999's
  segment counts and D1000's profiles and needs), and Unclassified's list. A
  Super Admin gets the rail on board H22; a plain Admin gets D1004's own key,
  `Admin · Accounts · Persona segments`. Each card's name opens its segment's
  page. D1005 retired the Admin Console's re-tag table that stood at the foot
  of Overview.
- `SegmentPage.jsx` — D1005 (#2820): one segment at
  `/admin/persona-segments/:key`, its tabs Profile (the address), `/members` and
  `/activity`, in the same rail frames. Profile is counts only (D999, D1128,
  D1001's answers and working styles, D1000's needs); Members is D1002's list
  with its filters, the move bar and each row's ⋯; Activity is D1002's read
  filtered to the segment.
- `MoveDialog.jsx` — D1005: SEG4's Move dialog, shared. It says what changes
  before D1002's move, refuses an admin account for an Admin, and is a bottom
  sheet on a phone. #2377's account drawer is to open it from "Retag…".
- `segmentPageModel.js` — pure: the segment page's addresses, counts ("<5" for
  a suppressed count, "Not recorded" for none), rows and the Move dialog's words.
- `segModel.js` — pure. The addresses and tabs, the moved notices, Unclassified
  from the persona list and the taxonomy (`../../../lib/personas.js`), and
  Overview's blocks from `personaSegmentsApi` (`../../../lib/api/personaSegments.js`).

## Rules

- Admin accounts are left out of every count.
- Guard L: the list stops at 500 accounts; at its cap, every figure from it
  (Unclassified's) says it covers the newest 500. Overview's counts are D999's,
  over every account, so it carries no Guard L.
- A block whose read failed says "Could not be read" with its own Try again;
  it is never drawn as zeros, and one failed block never blanks the page.
- A missing confidence or an unknown source is counted apart, never as 0% or
  as one of the three sources.
- What a member answered at sign-up is shown only as counts, never per person
  (parts 4 and 8); counts under 5 are hidden.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
  A segment's tabs are `` `/admin/persona-segments/${key}/members` ``, which the
  walk reads as one parameter followed by `/members` (D1005).
- A change opens the in-page Move dialog; never `confirm()` or `alert()`.

## D1128 gaps (#3008)

`NewSegment.jsx` is the HQ creation form at `/admin/persona-segments/new`.
It reuses SEG6’s name, profile, status and who fields, with confirmation before
creation; an ordinary Admin sees SEG13’s refusal. The header and Advisors card
link it. A custom segment starts with no invented questions, needs or offers.
The existing D997 Overview and its capped legacy list remain until #2819.
Its profile/sub-account filter is not built yet; that task owns the full filter
and all its blocks. SEG2’s completion read is available for #2820 through
`personaSegmentsApi.completion`; its full page remains that task’s.
