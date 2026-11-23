### Research market observations (#7716, D7716)

No page or canvas is implemented here; the screens are #7718. Every route is
mounted under `/api/research` by `routes/research_observations.ts` and requires
a signed-in user: an observation is a sourced public statistic, not a member's
record. The client module is `frontend/src/lib/api/researchObservations.js`.

| Route | Purpose |
| --- | --- |
| `GET /observations` | The paged list, filtered in SQL by metric, geography, industry code, size band, period range and status; current rows by default, every vintage with `vintages=all`; the coverage state when a metric and a geography are given |
| `GET /observations/metrics` | The metric catalogue (`research_market_metrics`) |
| `GET /observations/export.csv` | The same filters as a CSV; rows of a source whose terms do not allow export are left out and counted; refused past the row cap |
| `GET /observations/:id` | One observation, its source and usage note, the three dates labelled, and its revision chain |

`GET /market-data/export.csv` (D7318) builds its file through the same service,
so the two exports share one header and one export rule.
