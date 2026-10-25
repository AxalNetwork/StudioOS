# Persona segments

D997 (#2378): Persona segments at `/admin/persona-segments`, built to the owner's
canvas (SEG1–SEG14, `design/incoming/Persona Segments Page.dc.html`) under the
shared admin page header (D936). It sits under Accounts on the Admin shell and
under Content on HQ's; its tabs are sub-paths: Overview and `/unclassified`. The
Admin Console's `?tab=personas` forwards here with `?moved=personas`, in
`../LegacyContractsRedirect.jsx`.

- `PersonaSegments.jsx` — the page: the header in the viewer's shell, Overview's
  tiles, charts and segment cards, and Unclassified's list. A Super Admin gets
  the rail (board H22); a plain Admin has no board here. Today's re-tag table
  (`../consoles/PersonasConsole.jsx`) stays at the foot of Overview until D997
  part 8 draws the Move dialog.
- `segModel.js` — pure. The addresses and tabs, the moved notices, and every
  block from the persona list and the taxonomy (`../../../lib/personas.js`).

## Rules

- Admin accounts are left out of every count.
- Guard L: the list stops at 500 accounts; at its cap, every figure says it
  covers the newest 500.
- A missing confidence or an unknown source is counted apart, never as 0% or
  as one of the three sources.
- What a member answered at sign-up is shown only as counts, never per person
  (parts 4 and 8); counts under 5 are hidden.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.

## D1128 gaps (#3008)

`NewSegment.jsx` is the HQ creation form at `/admin/persona-segments/new`.
It reuses SEG6’s name, profile, status and who fields, with confirmation before
creation; an ordinary Admin sees SEG13’s refusal. The header and Advisors card
link it. A custom segment starts with no invented questions, needs or offers.
The existing D997 Overview and its capped legacy list remain until #2819.
Its profile/sub-account filter is not built yet; that task owns the full filter
and all its blocks. SEG2’s completion read is available for #2820 through
`personaSegmentsApi.completion`; its full page remains that task’s.
