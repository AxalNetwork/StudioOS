# frontend/src/pages/closing — the closing room and the Closings desk

D1213 (#2424), built to the owner's canvas: `design/incoming/Closing Room Page.dc.html` and `design/incoming/Closing room · Boards.dc.html` (CP1–CP21).

| File | What it is |
|---|---|
| `closingModel.js` | Pure: the addresses, the seven steps, a line's status words and sums, the desk's rows by deadline, and each block's wait. |
| `ClosingRoom.jsx` | One deal's room (`ClosingRoom`), drawn for the founder, an investor, an Operating Partner or an Admin; the founder's room with its deal choice (`FounderClosing`); the wait card (`Wait`). |
| `ClosingsPages.jsx` | Contracts › Closings (`ClosingsDeskPage`) and one closing (`AdminClosingPage`). |

## Where it lives

- `/raise/capital-relationships/closing`: the founder's room, under Capital relationships (`CapRelTool.jsx`; its door is on Commitments).
- `/deals/:dealId/closing`: the room under the deal (`DealRoomPage.jsx`; its door is on Commitment).
- `/admin/contracts/closings` and `/admin/contracts/closings/:dealId`: the Admin's desk and one closing (`App.jsx`; the door is on Contracts).

## The rules for adding here

- **A closing is its deal** until the closings store lands (D1213 part 2). Every block draws a mounted read or says "Not read here yet" with its reason, never a zero.
- **The platform never moves money.** A line reads Received only on the receiving side's evidence; an investor's own proposal is never that evidence.
- **An investor sees their own line and the round's confirmed total only.** No read of another investor's line, the checklist or the transfers is made for them.
