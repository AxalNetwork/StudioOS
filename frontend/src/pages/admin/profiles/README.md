# Partner profiles

D989 (#2380): Partner profiles at `/admin/partner-profiles`, built to the owner's
canvas (PRF1–PRF12, `design/incoming/Partner Profiles Page.dc.html`) under the
shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`). It sits under
Approvals; its tabs are sub-paths: To review and `/all`. The Admin Console's
`?tab=profiles` forwards here with `?moved=profiles`, in
`../LegacyContractsRedirect.jsx`.

- `PartnerProfiles.jsx` — the page inside `AdminBoardFrame` (board S7, "Entity
  profiles"): the header; To review's four tiles and the queue of waiting
  profiles with its age pills, Source, Account and Identity check; All
  profiles' weekly and categories charts, status chips (Drafts their own),
  filters, sorts and table (D994). Review opens the console's
  `ProfileReviewModal` (`../consoles/PartnerProfilesConsole.jsx`) until D989
  part 6 redraws it.
- `ppModel.js` — pure. The addresses and tabs, the moved sentence, a row's
  words, the age pill, the tiles from the counts read, the weekly and
  categories chart specs, the list read's parameters and the pages.

## Rules

- Every figure comes from D990's reads (`../../../lib/api/partnerProfiles.js`):
  the counts and the list, asked again on Refresh, never polled. What a part
  has not recorded yet (review dates, the changed-since-verified flag,
  envelopes) says "Not recorded" and why, never a zero (D994).
- Each list read is logged by reference (D625), so search, filters, sort and
  pages are asked of the Worker, one read per change.
- "Onboarding category", never "persona": Persona segments are another page.
- A failed read is said in the page, never in a browser pop-up.
- No email goes in an address: one profile's address waits for its reference
  (part 1).
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
