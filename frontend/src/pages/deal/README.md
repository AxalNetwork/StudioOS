# Deal page frame

D1152 (#3057, part 4 of #2421): the deal page's frame, drawn to the owner's
"Investor Deal Page" canvas (DL1, DL2, DL14, DL18–DL23, DL24a;
`design/incoming/Investor Deal Page.dc.html`). The page itself is
`../DealRoomPage.jsx`, which keeps the shell and the tabs part 6 owns
(Invitations, Transfers); part 5's working tabs live here since D1153, and part
6's reading tabs since D1154; the tab
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
- `dealWorkModel.js` — D1153's pure model of the working tabs: the case on
  this company, the room's three access states (withheld files a count,
  never a name), proposed terms with their source, your commitment, the round
  as a count and a total, and the withdraw reason's check.
- `DealWorkTabs.jsx` — D1153 (#3058, part 5): Diligence (DL7), Documents and
  data room (DL8, DL9), Terms (DL10) and Commitment and closing (DL11–DL13),
  each change behind an in-page dialog.
- `dealInsightsModel.js` — D1154's pure model of the reading tabs over
  D1151's reads: masked before the NDA, unreadable, or open block by block;
  each person as they published themselves; coverage as a band per axis,
  never a number; TAM, SAM and SOM with their source or why none; the
  twelve months of shared figures, where a month not reported is a gap and
  never 0; and the slots from sibling canvases (DL24).
- `DealInsightTabs.jsx` — D1154 (#3059, part 6): Team (DL4), Market (DL5)
  and Traction (DL6), with its charts and their tables, and the scorecard
  rows and evidence as slots until SCORING (#3280) and PIPE-RAISE (#3291)
  read them.

The rules for adding here: every figure no read holds is "Not recorded" with
its reason, a read that failed is "Unreadable" with Try again and leaves the
rest of the page standing, every change opens an in-page dialog, and colours
come from the axal tokens with a `dark:` counterpart — never a hex value.
