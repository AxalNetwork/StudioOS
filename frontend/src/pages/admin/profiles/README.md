# Partner profiles

D989 (#2380): Partner profiles at `/admin/partner-profiles`, built to the owner's
canvas (PRF1–PRF12, `design/incoming/Partner Profiles Page.dc.html`) under the
shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`). It sits under
Approvals; its tabs are sub-paths: To review and `/all`. The Admin Console's
`?tab=profiles` forwards here with `?moved=profiles`, in
`../LegacyContractsRedirect.jsx`.

- `PartnerProfiles.jsx` — the page inside `AdminBoardFrame` (board S7, "Entity
  profiles"): the header, To review's tiles and queue, and All profiles' chart,
  chips, search and table. Review opens the console's `ProfileReviewModal`
  (`../consoles/PartnerProfilesConsole.jsx`) until D989 part 6 redraws it.
- `ppModel.js` — pure. The addresses and tabs, the moved sentence, the queue,
  the counts, a row's words, the categories chart, search and pages.

## Rules

- Every figure comes from a read that exists today (D989 §2). A block that waits
  for a part says "Not read here yet" and which part brings it.
- The list read writes an audit row (D625), so it is read once per visit and on
  Refresh, never polled.
- "Onboarding category", never "persona": Persona segments are another page.
- A failed read is said in the page, never in a browser pop-up.
- No email goes in an address: one profile's address waits for its reference
  (part 1).
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
