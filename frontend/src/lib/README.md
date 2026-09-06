# frontend/src/lib — non-visual browser code

The API client, formatters and helpers. Nothing here renders.

| File | What it is |
| --- | --- |
| `api.js` | **The only way the SPA talks to the worker.** Every endpoint the frontend uses is a method here. |
| `url.js` | `safeExternalUrl` and link handling — user-supplied URLs pass through it. |
| `seo.js` | `usePageMeta`, for title/description/OG on public routes. |
| `log.js` | `reportError`, the client error channel. |
| `statusOverall.js` | The single roll-up rule for platform health, shared by `/status` and the Help Center. |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | Advisor-side client logic. |
| `brand/` | Brand template content model. |
| `docs/` | Help Center search index. |
| `spinout/` | Spin-Out Lab client logic. |

## The drift rule

**Do not add an `/api/*` method to `api.js` without a matching worker route in
`cloudflare-worker/src/index.ts`.** `npm run test:drift` walks every call site
here, resolves it against the worker's real mount table, and fails the build on
a mismatch. This is the guard that catches "the UI calls an endpoint nobody
built" before it reaches production — which has happened, in both directions.

If a helper appears in two places, put it here once rather than a third time.

**`csvExport.js` — a CSV of the rows a page has already loaded.** It exists
beside `api._downloadCsv`, which asks the worker for the whole table. Most
zone-header "Export" actions do not need that, and twenty worker routes for
twenty zones would be twenty chances for a count on screen to disagree with a
count in a file. What it costs is said on the button: the label reads
"Export this view" and the filename carries the row count, because an export
over a truncated list with no hint of the truncation is how a founder pastes
twenty-five of two hundred rows into an investor update. Its escaping is
`cloudflare-worker/src/services/csv.ts`'s, character for character.
