# Partner invitations

D923 (#2370): the admin Partner invitations desk, built to the owner's
"Partner invitations" canvas (PI1–PI12,
`design/incoming/Partner Invitations Page.dc.html`). `../PartnerInvitations.jsx`
is the routed page, in `AdminBoardFrame` workspace "Partner invitations", at
`/admin/partner-invitations` (Overview), `/admin/partner-invitations/invitations`,
`/admin/partner-invitations/invitations/:id`, `/admin/partner-invitations/deals`,
`/admin/partner-invitations/deals/:id` and `/admin/partner-invitations/referrals`.
`/admin/partners` redirects to `/admin/partner-invitations?moved=partners`.
`/admin/partner-invitations/firm-links` forwards to Advisors & Partners ›
Firms with `?moved=firm-links` (D952): attaching an account to its firm
lives there now, in `../advisors/FirmLinks.jsx`. It draws the shell: the crumb
"Community › Partner invitations", the moved notice, the header, the literal
tab strip with its counts, then the tab the address names, the record drawn
over its tab, and the dialogs.

- `PartnersOverview.jsx` — Overview (PI1; PI11a on a phone, PI12 in dark):
  the two tile rows, Needs you, C1–C4 (D929), the agreement-not-ready banner
  (PI9e) and first use (PI9b). Each chart is a block in D893's four states
  with "View as table", drawn with `../../../ui/Charts.jsx`. A C1 bar opens
  Invitations at `?stage=`, a C3 segment Deals at `?type=&state=`.
  Every tile, Needs-you row and chart reads part 4's overview read
  (`GET /api/admin/partners/overview`, D927; D929 §7); only first use reads R1.
  Overview's Needs-you row about unattached accounts opens the Firms tab.
- `PartnersInvitations.jsx` — Invitations (PI2; PI11b on a phone), on part 3's
  server list (D926, D950): search, stage chips, type, inviter, first send,
  sort and page are the Worker's, with an exact total; the Email column; Export
  CSV of the current view, never with the link or its token; the row menu.
  On a phone, cards, a Filters bottom sheet and the sort as a select.
- `InvitationRecord.jsx` — one invitation (PI3; PI11c on a phone), on part 4's
  read (D927, D950): the message, the seven step dates, the latest send, what
  was offered and seen, the chosen deal, the agreement's refusals and the
  history, each block alone.
- `NewInvitationDialog.jsx` — New invitation (PI4) and its result (PI4d,
  PI4n): the five cards from part 4's offer preview, and the two warnings from
  part 3's lookup (D950).
- `PartnersDeals.jsx` — Deals (PI5) and Top deals by redemptions.
- `DealRecord.jsx` — one deal (PI6).
- `PartnersReferrals.jsx` — Referrals (PI7), under Guard F; `?deal=<id>`
  narrows it to one deal.
- `PartnerDialogs.jsx` — Resend (PI8a), Revoke (PI8b) and Terminate (PI8c).
- `parts.jsx` — the card, pills, stage dots, tiles, read states, copy button,
  row menu, pager and refusal line the tabs share.
- `usePartnerDesk.js` — the reads, each made alone, and `useRead` for a
  record's own reads. R1 keeps the Worker's exact `total` (D950).
- `useInvitationList.js` — the Invitations tab's page from the Worker: one
  debounced request per filter change, a late reply for old filters dropped
  (D950).
- `invitationsModel.js` — pure, D950's rules: the server query, the Email
  column, the CSV, one invitation's blocks (steps, offers, chosen deal,
  refusals, history), the offer preview, the lookup's warnings and Resend's
  result.
- `partnersDeskModel.js` — pure. Addresses, the words, Guard L (lists that
  stop at their cap), Guard F (sums over the redemptions fan-out), Guard I
  (the stage word and its repair after a resend), the agreement-ready rule,
  tiers and term, each tab's derivations, C1–C4's blocks and their links
  (D929), the dialogs' words and the refusals.
  Dates go through `../../../ui/parseStamp.js`.

## Rules

- The desk reads only what D923 §2 lists, and since D950 part 4's single
  invitation, its offer preview and part 3's lookup: the invitations, the six
  deal lists,
  top deals, one deal's redemptions, the uncapped partner-deals read in
  Contracts, the firm links, one envelope, the Partner Services template, the
  partner due-diligence cases, one member's obligations, the members matching
  an address, and one invitee's answers when the admin asks (that read is
  logged). It adds no `/api/*` client. It never reads the Contracts detail for
  a partner deal or the Agreements union, which hide failures.
- A failed read says what could not be read, with Try again, and never draws
  "No invitations yet" or a zero. After a failed refresh the rows stay only
  under a "Could not refresh" line. A list at its cap says what it covers.
- A value no store holds says "Not recorded"; one stored but not returned by
  any read yet says "Not read here yet"; a record outside the loaded lists
  says "Not in this read".
- Every dialog is a `Lightbox` that says only what the Worker does. A result
  or a refusal sits inside it until Done: no toast, no timer.
- Nothing D923 §3 lists under "Not drawn now" is drawn, except C1–C4, which
  D929 draws from part 4's overview read, and what D950 draws from parts 3
  and 4: the Email column, the CSV, the offer text, the step dates and the
  history. Adjust terms waits for O-TERMS.
- The Invitations tab and one invitation draw the stored stage: since D924 a
  resend keeps it, so Guard I's repair is not applied there (`repair: false`).
  The other tabs keep it until their parts.
