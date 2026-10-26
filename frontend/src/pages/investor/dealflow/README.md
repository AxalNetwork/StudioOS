# Deal flow (D1236, #2423)

The Deals root at `/deals` for an Investor, and Compare at `/deals/compare`, from the owner's canvas "Deal flow" (DLS1–DLS18). For an admin or an Operating Partner, `/deals` is the Studio lens (D1242, #3255, DLS11–DLS12), which replaced the retired `DealsPage`.

The Deals root at `/deals` for an Investor, and Compare at `/deals/compare`, from the owner's canvas "Deal flow" (DLS1–DLS18).

| File | What it is |
|---|---|
| `dealFlowModel.js` | The view and scope switch in the address, compare picks, SCORING's eleven scopes in order, the investor's stages, the round's status words, a row from `GET /api/deals`, and the words of every block no read carries yet |
| `DealFlow.jsx` | The toolbar, the table (DLS2), New for you (DLS6), Compare (DLS8), and the root that puts them over today's zone board |
| `studioLensModel.js` | D1242: the Studio lens's address (Board, Table, Not raising, intake's alone), a row from `GET /api/deals/studio`, the investors line, who set a round to Not raising, each row's menu, the intake notice and the column heads |
| `StudioLens.jsx` | D1242: the Studio lens (DLS11, DLS11b, DLS12): the board on the round's status, the table with Lead partner, Investors and Source, each row's ⋯, the Advance and terms dialogs, and `StudioLensRoute`, which `App.jsx` mounts at `/deals` for an admin or an Operating Partner |
| `StudioParts.jsx` | D1242: the dialogs and panels moved from `DealsPage` as they were: the pass dialog, the terms editor, the draft, Why we passed, the stage funnel and the Stage SLA |

`../../../workspaces/investor/InvestorDealsRoutes.jsx` mounts it: the root renders `DealFlow` with today's bucket board and deal rooms as its Board view, and `/deals/compare` renders `DealCompare`. The zone pages under `../deals/` are unchanged.

**Adding to it:** a move is offered only where the read's `can_move` says the Worker allows it (an admin any round, an Operating Partner only the rounds they lead). A block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A row links to `/deals/:id` only where the investor may read it (`opensDeal`).



**Adding to it:** a block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A row links to `/deals/:id` only where the investor may read it (`opensDeal`).
