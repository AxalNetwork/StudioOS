### Research source imports (#7745, D7745)

No page or canvas is implemented here, and no client method. Every route is
mounted under `/api/research-source-imports` by
`routes/research_source_imports.ts`: reads need a Super Admin, writes the
Super Admin write bar, and every route refuses a support session.

| Route | Purpose |
| --- | --- |
| `POST /preview` | Per source new, unchanged, changed and removed for a list of ids and row hashes; writes nothing |
| `GET /runs` | The newest runs, with counts and digests |
| `GET /runs/:uid` | One run: counts, recomputed list digests, chunks held, members (ids and hashes only) |
| `POST /runs` | Open a run under an idempotency key; one open at a time |
| `POST /runs/:uid/chunks` | One chunk of at most 50 records |
| `POST /runs/:uid/seal` | Read back against the expected list: complete, partial or uncertain, naming ids |
| `POST /runs/:uid/reconcile` | Resume a partial run or close a partial or uncertain one |
| `POST /removals` | Remove a record's private fields, one record, or one source |
