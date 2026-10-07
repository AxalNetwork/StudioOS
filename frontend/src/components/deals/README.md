# frontend/src/components/deals — the deal room's screens (D630)

The Ops canvas's deal-room screens (`design/canvases/integrated/ops-data.js`:
`dr-pipeline`, `dr-header`, `dr-invites`, `dr-transfers`, `sp-references`,
`sy-close`), built into the pages that already serve their addresses:
`/deals` (investor bucket root) and `/deals/:dealId` (`../../pages/DealRoomPage.jsx`).

| File | What it draws |
| --- | --- |
| `dealRoomCopy.js` | Every sentence the screens print, the quota lines, the transfer refusals, and money and time formatting. Pure. |
| `DealRoomKit.jsx` | The four states (loading, empty, Not recorded, Unreadable with "Try again"), status pills and refusals. |
| `DealRoomJoin.jsx` | The quota read (`GET /deals/dealroom/quota`), the quota line, the join note, and Join / Leave. |
| `DealRoomsPanel.jsx` | `/deals`: every live deal with Join or Leave. |
| `DealInvitationsTab.jsx` | The Invitations tab (admin). |
| `DealTransfersTab.jsx` | The Transfers tab and "Record a transfer" (admin, partner). |
| `DealReferencesTab.jsx` | The References tab (admin, investor). |
| `DealSyndicates.jsx` | The company's syndicates, and a syndicate's drawer with its confirmed close. |

## Rules

- Each list component has a pure part (`DealRoomsList`, `InvitationsList`,
  `TransfersView`, `ReferencesView`, `SyndicateDrawer`) that takes its read
  state as props. The tests render that part in each state.
- A failed read draws `Unreadable`, never an empty list or a zero.
- A new sentence goes in `dealRoomCopy.js`, not inline.
