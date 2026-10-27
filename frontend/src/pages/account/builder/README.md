# pages/account/builder — Account › Builder

D1315 (#2418). Builder was Account › Developer. It is a section for every profile,
drawn to four canvases in `design/incoming/`: `Builder Page.dc.html`,
`MCP Services Page.dc.html`, `API Keys Page.dc.html` and `API Usage Page.dc.html`.

| File | What it holds |
|---|---|
| `builderModel.js` | The four pages (MCP and services, API keys, API usage, Activity), the four drawers, every address under `/account/builder`, each page's eyebrow trail and line, the words the rename moved, and `legacyBuilderPath` for `/account/developer…` |
| `BuilderSection.jsx` | The pane: trail, the h2 "Builder", the page line, the phone tabs, the once-per-member moved notice. MCP and services (D1331) draws its cards and the assistant and service drawers as the shared Sheet at 560; the tools card still waits. API keys (D1317), API usage and Activity (D1320) draw their reads. `BuilderHandoff` is the card Connectors keeps |
| `ApiKeysPage.jsx` | D1317 (#2480): API keys at `/keys` and one key's drawer at `/keys/:uid` (APIK1, APIK4, APIK5, APIK8–APIK15): the table, card 2, the states, and the only state slot that holds a secret (from a 201, until Done, close, an address change or unmount) |
| `ApiKeyDialogs.jsx` | D1317: Create, the one-time reveal (the only component that draws a secret, masked after Copy), Rotate, Revoke with the typed name, and Edit name and limit. None has an address |
| `apiKeysModel.js` | D1317: the pure rules: state pills, the preview (prefix and four dots, never more), the create body, the summary, expiry, the limit parser, filters and sorts, the per-key month, every refusal's words |
| `mcpServicesModel.js` | D1331 (#2479): MCP and services' rules — who reads (owner, none, explorer, Super Admin), the endpoint and key rows, an assistant row ("Unrecognised assistant", "No call recorded"), D848's health words and the ten-check strip, the services rows from Connectors' own state words, and the limits from D849's read |
| `McpServicesPage.jsx` | D1331 (#2479): MCPX1, MCPX6–MCPX10, and the service (MCPX3) and assistant (MCPX5) drawers as the shared Sheet over the page (D1317), each card on its own read. The tools card waits for D846's tool read. No connect, disconnect or key action: each links to its own page |
| `apiUsageModel.js` | D1320 (#2481): API usage and Activity as pure rules: the range and the address, the tiles, the day series, the breakdown (top five and Other), the outcome and reason words, who called, each key's and the account's limit, the key alerts D849 sends, a request's AI tokens and what to do, and the two CSVs. Never `group=model` |
| `ApiUsagePage.jsx` | D1320: Builder › API usage (APIU1, APIU2, APIU5, APIU7, APIU9–APIU12): tiles, requests and AI tokens by day, where the AI tokens went, limits and alerts. Each block reads on its own |
| `ActivityPage.jsx` | D1320: Builder › Activity, the request history (APIU3, APIU6) and the request drawer at `/activity/[uid]` (APIU4, APIU12) |
| `usageParts.jsx` | D1320: what both share: the range chips, a tile, the day chart, the outcome pill, a meter, and `useCallers` (keys, assistant connections, companies) |
| `BuilderRedirect.jsx` | The app's half of the move: an old address followed inside the app lands on its new one, with its sub-path, query and hash. The Worker answers a page load with a 308 (`cloudflare-worker/src/services/builderRedirect.ts`) |

**Rule for adding here.** A block draws a Worker read only once that read has landed;
until then it is a `Wait` that names its task. Never sample data. A key's secret is drawn by `RevealDialog` alone, and never logged, stored, reported or put in an address.
