### Research source mappings (#7746, D7746)

No page or canvas is implemented here, and no client method. Every route is
mounted under `/api/research-source-imports` by
`routes/research_source_mappings.ts`, behind #7745's imported gate: reads need
a Super Admin, writes the Super Admin write bar, and every route refuses a
support session.

| Route | Purpose |
| --- | --- |
| `GET /mappings` | Staged records by source, kind, decision, outcome and flag, paged; ids, codes, candidate count and the name label |
| `GET /mappings/report` | The five-outcome reconciliation: a counts-only summary per source and kind, the manifest counts, then per-record lines |
| `POST /mappings/record` | One record in full with candidates and history; writes one audit row naming the record id |
| `POST /mappings/decide` | Decide one record |
| `POST /mappings/bulk/preview` | Check a list of decisions and answer its digest; writes nothing |
| `POST /mappings/bulk/apply` | Apply a previewed list in one batch; refused if a named record changed |
