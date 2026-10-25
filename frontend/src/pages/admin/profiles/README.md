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
  filters, sorts and table (D994). Review and Open go to the profile's own
  address, `/admin/partner-profiles/<ref>` (D995).
- `ProfileRecord.jsx` — one profile as PRF3's lightbox over the list it was
  opened from (D995): Who they are with the tax ID shown for 60 seconds,
  Founder track details, Eadwyn's summary, the live onboarding conversation,
  an invitation's and Eadwyn's answers (PRF4), History, and the sticky
  Decision card with PRF6's send results; Previous and Next through the list.
- `ProfileDialogs.jsx` — PRF5's dialogs: Verify, Reject, Reopen and a Super
  Admin's Unbind, each saying what it changes and any refusal in place.
- `profileModel.js` — pure. The record's blocks and words, the dialogs' and
  the send results' sentences, and Previous and Next.
- `ppStyles.js` — the class strings the record and its dialogs share.
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
- No email goes in an address: one profile's address is its reference
  (`pp_…`, migration 556).
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
