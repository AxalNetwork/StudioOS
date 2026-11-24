### Accounting statements, the venture's reads (#5836 part 1)

No page or canvas is implemented here (the Account accounting detail and Raise › Use of Funds "From your ledger" need a canvas). Mounted at `/api/financial-statements` by `cloudflare-worker/src/routes/financial_statements.ts` over D5833's store; signed in, then the venture's write access, so an advisor or investor gets 404. Client: `frontend/src/lib/api/financialStatements.js`.

| Route | Purpose |
| --- | --- |
| `GET /:projectId` | The latest revision of each statement (`?report=balance_sheet|profit_and_loss`), with its revision count and exact lines |
| `GET /:projectId/revisions/:uid` | One exact revision, superseded or not |
| `GET /:projectId/pins` | The venture's pins, each with its revision and whether it was superseded |

Pin writes and sharing are #5837's. See D5836.
