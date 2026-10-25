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
  Overview's Needs-you row about unattached accounts opens the Firms tab.
- `PartnersInvitations.jsx` — Invitations (PI2): the table under Guards L and
  I, its toolbar, the row menu and the pager.
- `InvitationRecord.jsx` — one invitation (PI3; PI11c on a phone).
- `NewInvitationDialog.jsx` — New invitation (PI4) and its result (PI4d, PI4n).
- `PartnersDeals.jsx` — Deals (PI5; PI11d on a phone): C5 "Terms ending",
  the list on D926's server filters, sort and pages with its exact total, and
  Top deals by redemptions (D951). On a phone: cards, a filter sheet with four
  state groups and an exact "Show [n] deals", and a sort select.
- `DealRecord.jsx` — one deal (PI6), from D928's single read: due diligence
  and its KYB section, each obligation, the history with who terminated, and
  "Signed, deal not activated" with D925's Re-run activation (D951).
- `PartnersReferrals.jsx` — Referrals (PI7) on D928's cross-deal read: the
  four tiles, C4, C6 "Rev-share windows closing" and Every redemption with the
  member's role, paged by the Worker; `?deal=<id>` narrows it to one deal (D951).
- `PartnerDialogs.jsx` — Resend (PI8a), Revoke (PI8b) and Terminate (PI8c),
  which states D928's preview: "[n] members lose the grant this deal gave them".
- `parts.jsx` — the card, pills, stage dots, tiles, read states, copy button,
  row menu, pager and refusal line the tabs share.
- `usePartnerDesk.js` — the reads, each made alone, and `useRead` for a
  record's own reads.
- `useDealsReferrals.js` — D951's server reads for Deals, one deal and
  Referrals, each through `useRead`; a whole redemption set is read page after
  page up to a cap, past which each figure says what it covers.
- `dealsReferralsModel.js` — pure. D951's derivations: the server parameters,
  C5, the phone groups, one deal's blocks, the terminate preview's lines, and
  Referrals' tiles, C6 and rows.
- `partnersDeskModel.js` — pure. Addresses, the words, Guard L (lists that
  stop at their cap), Guard F (sums over the redemptions fan-out), Guard I
  (the stage word and its repair after a resend), the agreement-ready rule,
  tiers and term, each tab's derivations, C1–C4's blocks and their links
  (D929), the dialogs' words and the refusals.
  Dates go through `../../../ui/parseStamp.js`.

## Rules

- Deals, one deal and Referrals read the server's own lists and records
  (D926, D928; D951), so they carry no Guard L or Guard F. The Overview, the
  tab counts and Needs you still read D923 §2's lists until part 4's overview
  read.
- The desk reads only what D923 §2 lists, and D926's and D928's reads: the invitations, the six deal lists,
  top deals, one deal's redemptions, the uncapped partner-deals read in
  Contracts, the firm links, one envelope, the Partner Services template, the
  partner due-diligence cases, one member's obligations, the members matching
  an address, and one invitee's answers when the admin asks (that read is
  logged). Its only client beyond `api.js` is D928's `partnerDealReadsApi`. It never reads the Contracts detail for
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
  D929 draws on these reads until part 4's overview read: no Email column,
  no CSV, no offer text, no Adjust terms, no step dates beyond the record's
  own, no history beyond one line.
