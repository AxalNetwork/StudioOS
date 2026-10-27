# Scoring pages (D1253, #2428)

The venture scorecard's own pages, from the owner's canvas "Venture scorecard".

| File | Address | Board |
|---|---|---|
| `ScoringMethodPage.jsx` | `/scoring/method` (any signed-in member) | SC11 How scoring works. D1260: names the model in force and cites each scope's inputs from `GET /api/venture-scores/models` |
| `FounderScorecardPage.jsx` | `/raise/scorecard` and `/raise/scorecard/trajectory` (founder, admin) | SC8 Investor scorecard, SC12 Trajectory (D1258) |
| `AdvisorScorecardPage.jsx` | `/practice/scorecards/:projectId` (advisor, when shared) | SC21 Advisor · read only (D1258) |
| `HqScoringPage.jsx` | `/admin/platform/scoring` (HQ only) | SC13 Platform › Scoring |
| `hqScoringModel.js` | — | SC13's words (D1259): version rows, the draft's change cells, licence and edition lines, the list-code parser |

SC13 reads `ventureScoreModelsApi` (D1259): model versions and Publish, and the country index sources and their import. Publish and Import are a Super Admin's; the fairness check still waits on part 3.

The panel and the strip are `../../components/scoring/scorecard/`. The deal page's Scorecard tab is `../DealRoomPage.jsx`.

**Adding to it:** a block with no read says "Not read here yet" with its reason, never a zero. `/scoring` itself stays retired (the owner's 2026-10-20 removal); only `/scoring/method` lives under it.
