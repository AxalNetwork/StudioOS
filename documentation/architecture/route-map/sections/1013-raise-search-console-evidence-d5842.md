### Raise evidence from Search Console (#5842, D5842, D5842-p2)

No page or canvas is implemented here. Mounted at `/api/cycles/raise` by
`cloudflare-worker/src/routes/raise_search_console_evidence.ts`, beside `cycle_raise.ts`; the client is
`frontend/src/lib/api/raiseSearchConsoleEvidence.js`. Founders of the venture only (the Evidence gate), and
503 `search_console_unavailable` until `GOOGLE_SEARCH_CONSOLE_APPROVED=1`.

| Route | Purpose |
| --- | --- |
| `GET /evidence/search-console/preview?project=&site_url=&week_start=&metric=` | One week's clicks, impressions or weighted CTR for the venture's selected property, as a private candidate with property, window, units, coverage and revisions |
| `GET /evidence/search-console/recheck?project=&source_ref=&snapshot_hash=&revision_key=` | A recorded reference: `current`, `corrected` (original beside revised, re-review), `missing` or `revoked` |
| `GET /evidence/search-console/selections?project=` | Part 2: every pinned aggregate with what it kept and where its source stands now |
| `POST /evidence/search-console/selections?project=` | Part 2: pin the previewed aggregate to one organic-search claim, as a Private item (`raise_search_console_selections`) |
| `POST /evidence/search-console/selections/:uid/review?project=` | Part 2: re-review a corrected week as a new Private item |
| `POST /evidence/search-console/selections/:uid/withdraw?project=` | Part 2: withdraw it from every claim and shared view |

All read D5840's stored rows only. None calls Google or reads a top page or a query. Sharing beyond Private is the
existing `PATCH /evidence/items/:id` on `cycle_raise.ts`.
