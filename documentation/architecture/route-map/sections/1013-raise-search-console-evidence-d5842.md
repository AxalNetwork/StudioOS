### Raise evidence from Search Console, part 1 (#5842, D5842)

No page or canvas is implemented here. Mounted at `/api/cycles/raise` by
`cloudflare-worker/src/routes/raise_search_console_evidence.ts`, beside `cycle_raise.ts`; the client is
`frontend/src/lib/api/raiseSearchConsoleEvidence.js`. Founders of the venture only (the Evidence gate), and
503 `search_console_unavailable` until `GOOGLE_SEARCH_CONSOLE_APPROVED=1`.

| Route | Purpose |
| --- | --- |
| `GET /evidence/search-console/preview?project=&site_url=&week_start=&metric=` | One week's clicks, impressions or weighted CTR for the venture's selected property, as a private candidate with property, window, units, coverage and revisions |
| `GET /evidence/search-console/recheck?project=&source_ref=&snapshot_hash=&revision_key=` | A recorded reference: `current`, `corrected` (original beside revised, re-review), `missing` or `revoked` |

Both read D5840's stored rows only. Neither calls Google, reads a top page or a query, or writes anything.
