# pages/account/builder — Account › Builder

D1315 (#2418). Builder was Account › Developer. It is a section for every profile,
drawn to four canvases in `design/incoming/`: `Builder Page.dc.html`,
`MCP Services Page.dc.html`, `API Keys Page.dc.html` and `API Usage Page.dc.html`.

| File | What it holds |
|---|---|
| `builderModel.js` | The four pages (MCP and services, API keys, API usage, Activity), the four drawers, every address under `/account/builder`, each page's eyebrow trail and line, the words the rename moved, and `legacyBuilderPath` for `/account/developer…` |
| `BuilderSection.jsx` | The pane: trail, the h2 "Builder", the page line, the phone tabs, the once-per-member moved notice, the MCP server card and the connected assistants (today's reads), and a "Not read here yet" block naming the task that builds each other block. `BuilderHandoff` is the card Connectors keeps |
| `apiUsageModel.js` | D1320 (#2481): API usage and Activity as pure rules: the range and the address, the tiles, the day series, the breakdown (top five and Other), the outcome and reason words, who called, each key's and the account's limit, the key alerts D849 sends, a request's AI tokens and what to do, and the two CSVs. Never `group=model` |
| `ApiUsagePage.jsx` | D1320: Builder › API usage (APIU1, APIU2, APIU5, APIU7, APIU9–APIU12): tiles, requests and AI tokens by day, where the AI tokens went, limits and alerts. Each block reads on its own |
| `ActivityPage.jsx` | D1320: Builder › Activity, the request history (APIU3, APIU6) and the request drawer at `/activity/[uid]` (APIU4, APIU12) |
| `usageParts.jsx` | D1320: what both share: the range chips, a tile, the day chart, the outcome pill, a meter, and `useCallers` (keys, assistant connections, companies) |
| `BuilderRedirect.jsx` | The app's half of the move: an old address followed inside the app lands on its new one, with its sub-path, query and hash. The Worker answers a page load with a 308 (`cloudflare-worker/src/services/builderRedirect.ts`) |

**Rule for adding here.** A block draws a Worker read only once that read has landed;
until then it is a `Wait` that names its task. Never sample data, and never a key's secret.
