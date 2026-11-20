# marketObservations/ — operator observation imports (D7709)

This is distinct from `../market-data.ts` (dashboard quotes) and
`../researchMarketData.ts` (the World Bank adapter). The adapter prepares a
bounded batch; this folder owns the only writes to observations and import receipts.

| File | Role |
| --- | --- |
| `write.ts` | Bounded, bound-SQL appends; prior editions and revision links; run/source receipts with diagnostic classes only. |
| `importers.ts` | Registered adapters and their parameter caps. |

A source must be enabled. Missing cells store nothing; actual zero is preserved.
Unchanged cells and an already-held edition insert nothing. An edition that changes
its value in place is refused rather than silently overwritten or assigned a fake date.
One prior read covers the batch; a bounded postflight read handles concurrent insert races.
Partial provider work is committed with a partial receipt and a retry cursor.
No provider response body is stored. No member refresh endpoint remains.
