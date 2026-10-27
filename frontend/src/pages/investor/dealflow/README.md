# Deal flow (D1236, #2423)

The Deals root at `/deals` for an Investor, and Compare at `/deals/compare`, from the owner's canvas "Deal flow" (DLS1–DLS18). For an admin or an Operating Partner, `/deals` is the Studio lens (D1242, #3255, DLS11–DLS12), which replaced the retired `DealsPage`.

| File | What it is |
|---|---|
| `dealFlowModel.js` | The view and scope switch in the address, compare picks, SCORING's eleven scopes in order, the investor's stages, the round's status words, a row from `GET /api/deals`, and the words of every block no read carries yet |
| `flowModel.js` | D1240 (#3253): the board's and table's rules over the firm's flow (D1238), the deal list, SCORING's batch (D1256), the fit and saved views (D1239): a score as its band and confidence (never a number), the fit, the rows, the column asks, filters, sort (unscored and locked last), columns, card scopes, and the settings in the address and in a saved view's spec |
| `FlowCells.jsx` | D1240: the cells the board and the table share: a scope, the fit, the ask, days in stage, the owner and the venture's door |
| `FlowBoard.jsx` | D1240: the board on the firm's own stages (DLS1) with drag and Move to, its loading columns (DLS15), and one stage at a time on a phone (DLS18b) |
| `FlowTable.jsx` | D1240: the table (DLS2, DLS2b) with sticky compare and Venture, sortable heads, a ≥ minimum per scope, pages of 25, Add to my deal flow, and its phone cards (DLS18a) |
| `FlowControls.jsx` | D1240: search, the filter chips, the Filters drawer (DLS4), the Sort, Columns and Card scopes popovers (DLS3), Saved views with Save view and Delete (DLS5), and Add to my deal flow's dialog |
| `DealFlow.jsx` | The toolbar, New for you (DLS6), Compare (DLS8), and the root: since D1240 it reads the flow, the deal list, scores, fit, weights and views, and draws the board or the table with the states (DLS13–DLS16), today's zone board kept under the Board view |
| `studioLensModel.js` | D1242: the Studio lens's address (Board, Table, Not raising, intake's alone), a row from `GET /api/deals/studio`, the investors line, who set a round to Not raising, each row's menu, the intake notice and the column heads |
| `StudioLens.jsx` | D1242: the Studio lens (DLS11, DLS11b, DLS12): the board on the round's status, the table with Lead partner, Investors and Source, each row's ⋯, the Advance and terms dialogs, and `StudioLensRoute`, which `App.jsx` mounts at `/deals` for an admin or an Operating Partner |
| `StudioParts.jsx` | D1242: the dialogs and panels moved from `DealsPage` as they were: the pass dialog, the terms editor, the draft, Why we passed, the stage funnel and the Stage SLA |

`../../../workspaces/investor/InvestorDealsRoutes.jsx` mounts it: the root renders `DealFlow` with today's bucket board and deal rooms as its Board view, and `/deals/compare` renders `DealCompare`. The zone pages under `../deals/` are unchanged.

**Adding to it:** a score is drawn as the band and confidence the Worker gave, never a number, and a missing one is a word; a setting lives in the address (`flowModel.settingsHref`) so a link reopens the view. A move is offered only where the read's `can_move` says the Worker allows it (an admin any round, an Operating Partner only the rounds they lead). A block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A row links to `/deals/:id` only where the investor may read it (`opensDeal`).
