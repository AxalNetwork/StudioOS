# Partner invitations

D923 (#2370): the admin Partner invitations desk, built to the owner's
"Partner invitations" canvas (PI1–PI12,
`design/incoming/Partner Invitations Page.dc.html`). `../PartnerInvitations.jsx`
is the routed page, in `AdminBoardFrame` workspace "Partner invitations", at
`/admin/partner-invitations` (Overview), `/admin/partner-invitations/invitations`,
`/admin/partner-invitations/invitations/:id`, `/admin/partner-invitations/deals`,
`/admin/partner-invitations/deals/:id`, `/admin/partner-invitations/referrals`
and `/admin/partner-invitations/firm-links`. `/admin/partners` redirects to
`/admin/partner-invitations?moved=partners`. It draws the shell: the crumb
"Community › Partner invitations", the moved notice, the header, the literal
tab strip with its counts, then the tab the address names, the record drawn
over its tab, and the dialogs.

- `PartnersOverview.jsx` — Overview (PI1): the two tile rows, Needs you, the
  agreement-not-ready banner (PI9e) and first use (PI9b). Overview's Needs-you
  row is Firm links' only door.
- `PartnersInvitations.jsx` — Invitations (PI2): the table under Guards L and
  I, its toolbar, the row menu and the pager.
- `InvitationRecord.jsx` — one invitation (PI3; PI11c on a phone).
- `NewInvitationDialog.jsx` — New invitation (PI4) and its result (PI4d, PI4n).
- `PartnersDeals.jsx` — Deals (PI5) and Top deals by redemptions.
- `DealRecord.jsx` — one deal (PI6).
- `PartnersReferrals.jsx` — Referrals (PI7), under Guard F; `?deal=<id>`
  narrows it to one deal.
- `FirmLinks.jsx` — Firm links, off the canvas, until #2369 takes it.
- `PartnerDialogs.jsx` — Resend (PI8a), Revoke (PI8b) and Terminate (PI8c).
- `parts.jsx` — the card, pills, stage dots, tiles, read states, copy button,
  row menu, pager and refusal line the tabs share.
- `usePartnerDesk.js` — the reads, each made alone, and `useRead` for a
  record's own reads.
- `partnersDeskModel.js` — pure. Addresses, the words, Guard L (lists that
  stop at their cap), Guard F (sums over the redemptions fan-out), Guard I
  (the stage word and its repair after a resend), the agreement-ready rule,
  tiers and term, each tab's derivations, the dialogs' words and the refusals.
  Dates go through `../../../ui/parseStamp.js`.

## Rules

- The desk reads only what D923 §2 lists: the invitations, the six deal lists,
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
- Nothing D923 §3 lists under "Not drawn now" is drawn: no chart, no Email
  column, no CSV, no offer text, no Adjust terms, no step dates beyond the
  record's own, no history beyond one line.
