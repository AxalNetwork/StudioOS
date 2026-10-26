# Scoring pages (D1253, #2428)

The venture scorecard's own pages, from the owner's canvas "Venture scorecard".

| File | Address | Board |
|---|---|---|
| `ScoringMethodPage.jsx` | `/scoring/method` (any signed-in member) | SC11 How scoring works |
| `FounderScorecardPage.jsx` | `/raise/scorecard` (founder, admin) | SC8 Investor scorecard |
| `HqScoringPage.jsx` | `/admin/platform/scoring` (HQ only) | SC13 Platform › Scoring |

The panel and the strip are `../../components/scoring/scorecard/`. The deal page's Scorecard tab is `../DealRoomPage.jsx`.

**Adding to it:** a block with no read says "Not read here yet" with its reason, never a zero. `/scoring` itself stays retired (the owner's 2026-10-20 removal); only `/scoring/method` lives under it.
