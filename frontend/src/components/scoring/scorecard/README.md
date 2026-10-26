# Venture scorecard (D1253, #2428)

The scope strip and the scorecard panel from the owner's canvas "Venture scorecard" (SC1–SC22), shared by the deal page, the Deal flow table and the founder's page.

| File | What it is |
|---|---|
| `scorecardModel.js` | The eleven scopes in their one order, the evidence grades, the Source-to-grade mapping, the band and risk words, the scope strip's bar rule and bar text, the pages' addresses, and the words of every block no read carries yet |
| `Scorecard.jsx` | `ScopeStrip` (eleven bars, no numbers), `VentureScorecard` (SC1's panel) and `ScorecardWait` |

Mounted by `../../../pages/DealRoomPage.jsx` (the Scorecard tab), `../../../pages/investor/dealflow/DealFlow.jsx` (the table's Scorecard column) and `../../../pages/scoring/` (the method, the founder's page and HQ's).

**Adding to it:** the engine is the Worker's (`ventureScoring`, part 2). Nothing here computes a value or a confidence: it draws what `/api/venture-scores` returns. A scope with no value is "Not enough recorded", "Not expected yet" or "Not read here yet", never a bar or a number of zero.
