# Advisors & Partners

D972 (#2369): Advisors & Partners at `/admin/advisors-partners`, built to the
owner's canvas (AP1–AP14, `design/incoming/Advisors Partners Page.dc.html`)
under the shared admin page header (D936, `../../../ui/AdminPageHeader.jsx`).
Its tabs are sub-paths: Overview, `/firms` and `/deck`. People is a separate UI part; its D973 read is already mounted.

Two old doors forward to the Deck roster tab, keeping the query and hash and
adding `?moved=network-profiles` ("Mentor & partner network is now Advisors &
Partners, under Community."):
- `/admin?tab=network-profiles`, in `../LegacyContractsRedirect.jsx`;
- `/admin/network-profiles`, in `ApRedirect.jsx`.

D952 (#2728): `/admin/partner-invitations/firm-links` (Partner invitations'
Firm links, D923) forwards to the Firms tab with `?moved=firm-links`, in
`FirmLinksRedirect.jsx`.

- `AdvisorsPartners.jsx` — the page inside `AdminBoardFrame` (its rail): the
  header, D977's Overview via `ApOverview.jsx`, the Firms table,
  and the Deck roster, `../AdminNetworkProfiles.jsx` embedded.
- `ApOverview.jsx` — D977: eight summary tiles, every Needs-you item (six on desktop, three on phone, Show all), C1–C4 and table toggles, independent read states and HQ scope. Charts use the shared `../../../ui/Charts.jsx`.
- `apOverviewModel.js` — D977: explicit D973 block states, stage/session chart specifications, queue items and the eight tile values. Settlement directions stay separate; founder demand stays Not recorded.
- `apModel.js` — pure. The address and tabs, the moved sentence, and the
  tiles, Needs you and the firms table from the reads, each `ready`,
  `loading`, `unreadable` or `notyet`.
- `ApRedirect.jsx` — the old bare address.
- `FirmLinks.jsx` — on the Firms tab, below the table: attaching a partner
  account to its firm, or detaching it, with a confirm before every save and
  the result as a line on the page. Moved from Partner invitations (D952);
  its copy and helpers stay in `../partners/partnersDeskModel.js`.
- `FirmLinksRedirect.jsx` — the old Firm links address.
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
  DRAW): attaching a firm, a deal, a host decision and an account each open
  the page that decides. Attaching an account to a firm is the one decision
  made here, on the Firms tab (D952), and it asks before it saves.
- No email reaches the page file or `apModel.js`; the partner directory read
  carries them. The one exception is `FirmLinks.jsx` (D952): an account with
  no name is known by its email in the attach table, from the same admin-only
  `links` read.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.

D977 reads `adminNetworkApi.overview()` on Overview only. Firms keeps its three reads and the Deck roster its existing read. Stage counts use D976 in the Worker; accountless identities have an explicit Not-recorded stage. A chart or queue source failure never blanks its healthy siblings. No new decision is made on Overview.
