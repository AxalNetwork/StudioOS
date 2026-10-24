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

D952 (#2728): `/admin/partner-invitations/firm-links` (Partner invitations'
Firm links, D923) forwards to the Firms tab with `?moved=firm-links`, in
`FirmLinksRedirect.jsx`.

- `AdvisorsPartners.jsx` — the page inside `AdminBoardFrame` (its rail): the
  header, Overview's tiles, Needs you and the charts waiting, the Firms table,
  and the Deck roster, which is today's `../AdminNetworkProfiles.jsx` embedded.
- `apModel.js` — pure. The address and tabs, the moved sentence, and the
  tiles, Needs you and the firms table from the reads, each `ready`,
  `loading`, `unreadable` or `notyet`.
- `ApRedirect.jsx` — the old bare address.
- `FirmLinks.jsx` — on the Firms tab, below the table: attaching a partner
  account to its firm, or detaching it, with a confirm before every save and
  the result as a line on the page. Moved from Partner invitations (D952);
  its copy and helpers stay in `../partners/partnersDeskModel.js`.
- `FirmLinksRedirect.jsx` — the old Firm links address.

## Rules

- Every figure comes from a read that exists today (D972 §2), and each read
  answers alone. A block that waits for a part says "Not read here yet" and
  which part brings it. It is never a zero and never a sample.
- Guard L: a list that comes back at its cap says what it covers ("500+",
  "the newest 200").
- Nothing is decided here that another page decides (the canvas's DO NOT
  DRAW): attaching a firm, a deal, a host decision and an account each open
  the page that decides. Attaching an account to a firm is the one decision
  made here, on the Firms tab (D952), and it asks before it saves.
- No email reaches the page file or `apModel.js`; the partner directory read
  carries them. The one exception is `FirmLinks.jsx` (D952): an account with
  no name is known by its email in the attach table, from the same admin-only
  `links` read.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
