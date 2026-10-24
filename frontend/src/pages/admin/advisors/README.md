# Advisors & Partners

D972 (#2369): Advisors & Partners at `/admin/advisors-partners`, built to the
owner's canvas (AP1–AP14, `design/incoming/Advisors Partners Page.dc.html`)
under the shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`).
Its tabs are sub-paths: Overview, `/firms` and `/deck`. People waits for its
read (D972 part 1).

Two old doors forward to the Deck roster tab, keeping the query and hash and
adding `?moved=network-profiles` ("Mentor & partner network is now Advisors &
Partners, under Community."):
- `/admin?tab=network-profiles`, in `../LegacyContractsRedirect.jsx`;
- `/admin/network-profiles`, in `ApRedirect.jsx`.

- `AdvisorsPartners.jsx` — the page inside `AdminBoardFrame` (its rail): the
  header, Overview's tiles, Needs you and the charts waiting, the Firms table,
  and the Deck roster, which is today's `../AdminNetworkProfiles.jsx` embedded.
- `apModel.js` — pure. The address and tabs, the moved sentence, and the
  tiles, Needs you and the firms table from the reads, each `ready`,
  `loading`, `unreadable` or `notyet`.
- `ApRedirect.jsx` — the old bare address.

## Rules

- Every figure comes from a read that exists today (D972 §2), and each read
  answers alone. A block that waits for a part says "Not read here yet" and
  which part brings it. It is never a zero and never a sample.
- Guard L: a list that comes back at its cap says what it covers ("500+",
  "the newest 200").
- Nothing is decided here that another page decides (the canvas's DO NOT
  DRAW): attaching a firm, a deal, a host decision and an account each open
  the page that decides. Attaching moves to the Firms tab with #2728.
- No email reaches this page; the partner directory read carries them.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
