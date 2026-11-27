# Deal page frame

D1152 (#3057, part 4 of #2421) and D1153 and D1155 (parts 5 and 7): the deal page's frame, drawn to the owner's
"Investor Deal Page" canvas (DL1, DL2, DL14, DL18–DL23, DL24a;
`design/incoming/Investor Deal Page.dc.html`). The page itself is
`../DealRoomPage.jsx`, which keeps the shell and the tabs part 6 owns
(Invitations, Transfers); part 5's working tabs live here since D1153, and part
6's reading tabs since D1154; the tab
addresses are `../dealPageModel.js` (D1148).

- `dealFrameModel.js` — the pure model every file here and the test share:
  the stage track and its one next action from part 2's `GET
  /api/deals/:id/stage` (`trackOf`), and since D4815 part 4 (DE04) the
  header (`headerOf`, `backOf`, `websiteHref`), the investor's progress chip
  (`progressChip`), the one financial strip (`financialStrip`) and Your
  position (`viewerCommitment`, the viewer's own commitment in the selected
  firm only), the terms at a glance, what is new in words (`whatsNewOf`), how a failed deal read is
  drawn (`readFailure`), DL22's words (`NO_PERMISSION`), the notes' tags and
  check, and the slots' words.
- `DealFrame.jsx` — the header's chips, the financial strip, the eight tabs
  with a second row where a tab holds more than one view, the investment
  progress (its one next action is the header's, fixed at the foot on a
  phone), Your position, the respond dialog,
  and the states: loading (DL19), unreadable (DL20b), not here, and no
  permission (DL22).
- `DealOverview.jsx` — the investor's Overview (DL1): the scorecard strip's
  slot (DL24a), what is new since you last looked, the terms at a glance
  less the strip's two, the round (its figures are the strip's) and, since
  D6165, the deck the venture granted you (`DealDeck.jsx`).
- `DealNotes.jsx` — DL14: your firm's notes (part 2's store; only a note's
  author edits or deletes it, each in an in-page dialog), Ask on New note
  (#4046: Eadwyn drafts the words, placed "Not saved" until your Save, then
  recorded against the saved note; the tag is yours), and the deal's
  activity (`DealActivity`, also the founder's and staff's Activity tab).
- `dealVisit.js` — reads `whats-new` once per deal per visit, because each
  read advances the reader's "last looked" marker (D1150).
- `dealWorkModel.js` — D1153's pure model of the working tabs: the case on
  this company, the room's three access states (withheld files a count,
  never a name), proposed terms with their source, your commitment, the round
  as a count and a total, and the withdraw reason's check.
- `DealWorkTabs.jsx` — D1153 (#3058, part 5): Diligence (DL7), Documents and
  data room (DL8, DL9), Terms (DL10) and Commitment and closing (DL11–DL13),
  each change behind an in-page dialog.
- `DealDeck.jsx` and `dealDeckModel.js` — D6165 (#6165): the deck the
  venture granted this investor on this deal (D1587's `GET
  /api/deals/:id/deck`). `DealDeckCard`, on Overview and on Documents, shows
  the title, the version and "frozen as of", the Worker's own sentence when
  nothing is granted, or Unreadable with Try again; Open the deck draws the
  returned slides read-only through the share link's card view
  (`../raise/pitch/DeckCardView.jsx`) in the shared Lightbox. Investors only;
  it writes nothing.
- `DealPaper.jsx` — D6184 (#6184): one envelope on Documents' Deal paper card:
  its signed count, Download once fully signed (the Worker's refusal shown in
  the row), and how to sign, which points to the emailed link and never
  builds one.
- `dealAudienceModel.js` — D1155 (#3060, part 7): DL15's table of who sees
  what (twelve kinds against seven viewers, each with the read that holds it
  and each place today's Worker departs from the canvas, said), `viewerOf`,
  and the staff commitments table's rules: the closing room's status words,
  search, status, sort and pages of 25, the heading that never counts a
  missing amount, who may act on a row, and the IC gate's words.
- `DealDocumentsStaff.jsx` and `dealDocumentsModel.js` — D6186 (#6186): the
  Documents tab for the venture's founder, an Admin and an Operating Partner,
  in place of the legacy list. The founder gets their data room's counts and
  pending access requests, each one click from Raise › Data room; staff get a
  line on how the room opens to them. Every document row says why it cannot
  be opened, since no route serves its text.
- `DealCommitmentsStaff.jsx` — D1155: the Commitment tab for the founder
  (DL16, Match to my Mercury), an Admin (DL17a, Record a wire behind the IC
  gate, and D752's shared proof of funds on HQ) and an Operating Partner
  (DL17b, read only). Never an investor's note.
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

D6177 (#6177): Traction retains its route/export, draws DL18b for a successful unreported history, names Last shared and each chart’s source as-of, and exports the already-read monthly rows to CSV. Gaps stay Not reported and recorded zeroes stay 0. Scorecard/Evidence replacement and the eight-tab frame remain with their own tasks; no source-update URL is guessed.
- `roomFilesQuery.js` — D6185: sort, filter and page only admitted files using raw metadata for ordering; zero and unknown stay distinct.
- `SharedRoomFiles.jsx` — D6185: shared content search whitelisted to the listing, name filter, stable sort/pages and phone file rows; mounted in Documents after the owner-authorized listing handoff.
