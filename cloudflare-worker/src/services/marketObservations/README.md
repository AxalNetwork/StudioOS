# marketObservations/ — operator observation imports (D7709)

This is distinct from `../market-data.ts` (dashboard quotes) and
`../researchMarketData.ts` (the World Bank adapter). The adapter prepares a
bounded batch; this folder owns the only writes to observations and import receipts.

| File | Role |
| --- | --- |
| `write.ts` | Bounded, bound-SQL appends; prior editions and revision links; run/source receipts with diagnostic classes only. |
| `importers.ts` | Registered adapters and their parameter caps. |
| `eurostatSbs.ts` | D7717: Eurostat structural business statistics (`sbs_sc_ovw`, reference years 2021 on) — enterprises, persons employed and net turnover by NACE Rev. 2 activity, size class and country, into source `eurostat-sbs`. |
| `censusCbp.ts` | D7927: U.S. Census County Business Patterns, national establishments, employees and payroll by NAICS 2017 industry, into source `census-cbp` (disabled). |
| `blsConsumerExpenditure.ts` | D7928: BLS Consumer Expenditure Surveys, mean annual spending per consumer unit for nine categories with the published standard error and CV, into source `bls-ce` (disabled until its terms and table layout are confirmed). |
| `secEdgarFacts.ts` | D7929: SEC EDGAR XBRL company financial facts, one registrant's annual figures for up to four concepts with entity, accession, concept, period, unit, filing date and restatement provenance, into source `sec-edgar-facts` (disabled). Stored under the registrant's CIK, never a geography: a company's revenue is not a market size. |

A source must be enabled. Missing cells store nothing; actual zero is preserved.
Unchanged cells (same value, status and limitations, D7717) and an already-held edition insert nothing. An edition that changes
its value in place is refused rather than silently overwritten or assigned a fake date.
One prior read covers the batch; a bounded postflight read handles concurrent insert races.
Partial provider work is committed with a partial receipt and a retry cursor.
No provider response body is stored. No member refresh endpoint remains.

## Running a bounded Eurostat SBS batch (D7717)

There is no screen. An HQ Super Admin with a fresh TOTP step-up sends one request per batch; nothing runs on a
schedule. Parameters: `from`/`to` (reference years, 2021 or later, at most four years), `indicators` (any of `ENT_NR`,
`EMP_NR`, `NETTUR_MEUR`; all three when omitted), `activities` (one to four NACE Rev. 2 codes as Eurostat publishes
them, e.g. `J62`), `size_classes` (one to four of `TOTAL`, `0-9`, `50-249`, `GE250`) and `geographies` (one to ten
Eurostat codes from `SBS_GEOGRAPHIES`: EU, EFTA and candidate countries, `EL` for Greece, and `EU27_2020`). The cube
(indicators x activities x size classes x geographies x years) must be 40 cells or fewer, or the request is refused
with `sbs_batch_too_large` before any run or provider call. There is no cursor.

```
POST /api/admin/market-observations/imports
{ "importer": "eurostat-sbs", "reason": "First bounded SBS batch for <study>",
  "params": { "from": 2021, "to": 2022, "activities": ["J62"], "size_classes": ["0-9"], "geographies": ["DE", "EL", "EU27_2020"] } }
```

The reply carries the run receipt and `skipped` counts (`missing`, `confidential`, `unknown_geography`,
`aggregate_geography`, `unknown_flag`); `rows_seen` counts every cell of the cube. Read the run afterwards with
`GET /api/admin/market-observations/runs?source=eurostat-sbs&limit=5`.
