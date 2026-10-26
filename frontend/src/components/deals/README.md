# frontend/src/components/deals — the deal room's screens (D630)

The Ops canvas's deal-room screens (`design/canvases/integrated/ops-data.js`:
`dr-pipeline`, `dr-header`, `dr-invites`, `dr-transfers`, `sp-references`,
`sy-close`), built into the pages that already serve their addresses:
`/deals` (investor bucket root) and `/deals/:dealId` (`../../pages/DealRoomPage.jsx`).

| File | What it draws |
| --- | --- |
| `dealRoomCopy.js` | Every sentence the screens print, the quota lines, the transfer refusals, and money and time formatting. Pure. |
| `DealFreePlan.jsx` | D1149: DL22b header/key strip and plan card, with no private reads. |
| `dealMoney.js` | Currency-aware amount formatting and the role-specific back destination. |
| `DealRoomKit.jsx` | The four states (loading, empty, Not recorded, Unreadable with "Try again"), status pills and refusals. |
| `DealRoomJoin.jsx` | The quota read (`GET /deals/dealroom/quota`), the quota line and note, and confirmed request/leave through the shared Lightbox (D1237). A refusal stays in the dialog. |
| `DealRoomsPanel.jsx` | `/deals`: live deals and invitation requests (D1237). A name links only when the Worker explicitly returns `can_read: true`; requesting a room alone grants no access. |
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
