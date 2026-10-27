# frontend/src/pages/closing — the closing room and the Closings desk

D1213 (#2424), built to the owner's canvas: `design/incoming/Closing Room Page.dc.html` and `design/incoming/Closing room · Boards.dc.html` (CP1–CP21).

| File | What it is |
|---|---|
| `closingModel.js` | Pure: the addresses, the seven steps, a line's status words and sums, the desk's rows by deadline, and each block's wait. |
| `ClosingRoom.jsx` | One deal's room (`ClosingRoom`), drawn for the founder, an investor, an Operating Partner or an Admin; the founder's room with its deal choice (`FounderClosing`); the wait card (`Wait`). |
| `ClosingsPages.jsx` | Contracts › Closings (`ClosingsDeskPage`, CP13 and CP21) and one closing (`AdminClosingPage`, CP14), from the closings store (D1219). |
| `AdminClosing.jsx` | One closing as the Super Admin and as an Admin: figures, lines with route, paper and status, Axal's acts, activity (D1219). |
| `ClosingDialogs.jsx` | Open a closing, Choose the route (CP5), Withdraw a line, Mark Closed, Countersign for Axal (D1219). |
| `PaperDrawer.jsx` | Prepare the paper (CP3) on D1216's staged envelopes: template, fields with their sources, signers in order, Axal last (D1219). |
| `RoutePanels.jsx` | The SPV (CP6, exported for the room), the Axal VC fund card (CP7) and the third-party fund drawer (CP8) (D1219). |
| `ActivityDrawer.jsx` | A closing's activity (CP15): append-only, newest first, by step, as CSV (D1219). |
| `deskModel.js` | Pure: the desk's rows, filters and tiles, line and route words, Axal acts per viewer, the paper's fields, activity steps (D1219). |
| `RecordRoom.jsx` | The room from the closings store, for the founder (CP1), an investor (CP2, CP20) and an Admin under the deal: steps, tiles, lines with route, paper, money and next, reporting after Closed, the investor's Mercury matches, the states (CP16–CP19) (D1218). |
| `RoomDialogs.jsx` | The room's drawers and dialogs: Review and sign (CP4), payment instructions with the warning first (CP9), the receipt drawer (CP10), the cap-table decision (CP11), the investor's match (D1218). All but the match, a centred confirmation, are the shared `Sheet` (D1317). |
| `roomModel.js` | Pure: who acts next on a line, the seven steps and the tiles, the signing order, the evidence, the cap-table view, reporting duties and Mercury matches for one closing (D1218). |

## Where it lives

- `/raise/capital-relationships/closing`: the founder's room, under Capital relationships (`CapRelTool.jsx`; its door is on Commitments).
- `/deals/:dealId/closing`: the room under the deal (`DealRoomPage.jsx`; its door is on Commitment).
- `/admin/contracts/closings` and `/admin/contracts/closings/:dealId`: the Admin's desk and one closing (`App.jsx`; the door is on Contracts).

## The rules for adding here

- **The room reads the deal's closing in the store** (D1218) when the studio team has opened one; until then, and for an Operating Partner, it is the deal's room (D1213). **The admin desk and one closing read the store** (D1215, D1219). Every block draws a mounted read or says "Not read here yet" with its reason, never a zero.
- **An Admin never sees a Super Admin act enabled.** `deskModel.js` `actControl` gives the act's sentence; a Super Admin's live act says it asks for their authenticator code.
- **The platform never moves money.** A line reads Received only on the receiving side's evidence; an investor's own proposal is never that evidence.
- **An investor sees their own line and the round's confirmed total only.** No read of another investor's line, the checklist or the transfers is made for them.
