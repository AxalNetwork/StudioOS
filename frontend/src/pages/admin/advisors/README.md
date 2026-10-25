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
  header, Overview's tiles, Needs you and the charts waiting, the Firms tab
  (`Firms.jsx`), and the Deck roster, `../AdminNetworkProfiles.jsx` embedded.
- `apModel.js` — pure. The address and tabs, the moved sentence, and the
  tiles and Needs you from the reads, each `ready`, `loading`, `unreadable`
  or `notyet`.
- `ApRedirect.jsx` — the old bare address.
- `FirmLinks.jsx` — on the Firms tab, below the table: attaching a partner
  account to its firm, or detaching it, with a confirm before every save and
  the result as a line on the page. Moved from Partner invitations (D952);
  its copy and helpers stay in `../partners/partnersDeskModel.js`.
- `FirmLinksRedirect.jsx` — the old Firm links address.
- `Firms.jsx` — the Firms tab (D979, AP5): search, the four filters, sort and
  pages from the Worker's list read (`GET /api/admin/partners/firms`, exact
  total), the "No firm" strip with Attach, the table, and `FirmLinks.jsx`
  below as See all. A row opens the firm at `?firm=<id>`.
- `FirmDrawer.jsx` — one firm (D979, AP6), from `GET
  /api/admin/partners/firms/:id`: accounts with Detach (AP9d), the Listed and
  Featured switches each behind a confirm, deals and settlements read only,
  the partner profile and office hours. Each block fails alone.
- `FirmAttachDialog.jsx` — AP10: attach an account to a firm, from the strip
  (the firm is chosen) or the drawer (the account is chosen).
- `firmsModel.js` — pure (D979). The toolbar's options and the list read's
  parameters, the rows, the strip, the drawer's blocks and every dialog's
  words.
- `deckRosterModel.js` — pure (D980). The Deck roster's rules: shown and
  hidden in the deck's order, each row's reach (D214's rule, held to the
  Worker's `cloudflare-worker/src/services/decks/deckRoster.ts` by its test), moves and their
  announcement, search and the Kind filter, the tiles, the slide preview, the
  card's errors and payload, and each confirmation's words.
- `DeckRosterDialogs.jsx` — the Deck roster's dialogs (D980): AP8's card (one
  Save, the photo previewed and uploaded with it, the member-account link,
  inline errors) and the Hide, Show, Archive and Restore confirmations. The
  roster itself is `../AdminNetworkProfiles.jsx` (AP7).

## Rules

- Every figure comes from a read that exists today (D972 §2), and each read
  answers alone. A block that waits for a part says "Not read here yet" and
  which part brings it. It is never a zero and never a sample.
- Guard L: a list that comes back at its cap says what it covers ("500+",
  "the newest 200").
- Nothing is decided here that another page decides (the canvas's DO NOT
  DRAW): a deal, a settlement, a host decision and an account each open the
  page that decides. Two decisions are made here, on the Firms tab, and each
  asks in a dialog before it saves: attaching or detaching an account (D952,
  D979) and a firm's directory switches (D979).
- No email reaches the page file or `apModel.js`; the partner directory read
  carries them. The exception is attaching (D952, D979): an account with no
  name is known by its email in `FirmLinks.jsx`'s table, in the strip of
  `Firms.jsx` and in `FirmAttachDialog.jsx`, through `firmsModel.js`'s
  `whoOf`, from the same admin-only `links` read. The firm reads select none.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
