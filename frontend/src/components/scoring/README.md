# components/scoring — the scoring engine's UI

Composed by the Spin-Out Lab scoring surface (`frontend/src/pages/SpinoutLabScoringPage.jsx`).
The partner and investor Scoring Engine page (`/scoring`) that also composed it
was removed on the owner's instruction (2026-10-20).

| File | What it is |
| --- | --- |
| `RadarChart.jsx` | The dimension radar. |
| `DimensionRow.jsx` / `DimensionDrawer.jsx` | A dimension in the list, and its detail. |
| `BenchmarkBars.jsx` | This venture against the cohort. |
| `TrajectoryChart.jsx` | Score over time. |
| `WeakPointList.jsx` | Lowest dimensions, ranked. |
| `TeamCoveragePanel.jsx` | Which dimensions the team actually covers. |
| `ExportReportModal.jsx` | Report export. |
| `dimIcons.js` | Icon per dimension. |
| `useCountUp.js` | The number animation. |

Every score comes from the worker. A dimension the venture has not answered for
is **not scored zero** — it reads as unscored, because a zero is a judgement and
an absence is not.
