# Deal page frame

D1152 (#3057, part 4 of #2421): the deal page's frame, drawn to the owner's
"Investor Deal Page" canvas (DL1, DL2, DL14, DL18–DL23, DL24a;
`design/incoming/Investor Deal Page.dc.html`). The page itself is
`../DealRoomPage.jsx`, which keeps the shell and the tabs parts 5 and 6 own
(Diligence, Documents, Terms, Commitment, Invitations, Transfers); the tab
addresses are `../dealPageModel.js` (D1148).

- `dealFrameModel.js` — the pure model every file here and the test share:
  the stage track and its one next action from part 2's `GET
  /api/deals/:id/stage` (`trackOf`), the key strip (`keyStrip`), the terms at
  a glance, what is new in words (`whatsNewOf`), how a failed deal read is
  drawn (`readFailure`), DL22's words (`NO_PERMISSION`), the notes' tags and
  check, and the slots' words.
- `DealFrame.jsx` — the key strip, the stage track with its one next action
  (a list with the action fixed at the foot on a phone), the respond dialog,
  and the states: loading (DL19), unreadable (DL20b), not here, and no
  permission (DL22).
- `DealOverview.jsx` — the investor's Overview (DL1): the scorecard strip's
  slot (DL24a), what is new since you last looked, the terms at a glance, the
  round, your next step and the deck's slot.
- `DealNotes.jsx` — DL14: your firm's notes (part 2's store; only a note's
  author edits or deletes it, each in an in-page dialog), the slot for
  Eadwyn's draft (AUTOFILL #2431), and the deal's activity (`DealActivity`,
  also the founder's and staff's Activity tab).
- `dealVisit.js` — reads `whats-new` once per deal per visit, because each
  read advances the reader's "last looked" marker (D1150).

The rules for adding here: every figure no read holds is "Not recorded" with
its reason, a read that failed is "Unreadable" with Try again and leaves the
rest of the page standing, every change opens an in-page dialog, and colours
come from the axal tokens with a `dark:` counterpart — never a hex value.
