# Deal flow (D1236, #2423)

The Deals root at `/deals` for an Investor, and Compare at `/deals/compare`, from the owner's canvas "Deal flow" (DLS1–DLS18).

| File | What it is |
|---|---|
| `dealFlowModel.js` | The view and scope switch in the address, compare picks, SCORING's eleven scopes in order, the investor's stages, the round's status words, a row from `GET /api/deals`, and the words of every block no read carries yet |
| `DealFlow.jsx` | The toolbar, the table (DLS2), New for you (DLS6), Compare (DLS8), and the root that puts them over today's zone board |

`../../../workspaces/investor/InvestorDealsRoutes.jsx` mounts it: the root renders `DealFlow` with today's bucket board and deal rooms as its Board view, and `/deals/compare` renders `DealCompare`. The zone pages under `../deals/` are unchanged.

**Adding to it:** a block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A row links to `/deals/:id` only where the investor may read it (`opensDeal`).
