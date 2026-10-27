# pages/account/builder — Account › Builder

D1315 (#2418). Builder was Account › Developer. It is a section for every profile,
drawn to four canvases in `design/incoming/`: `Builder Page.dc.html`,
`MCP Services Page.dc.html`, `API Keys Page.dc.html` and `API Usage Page.dc.html`.

| File | What it holds |
|---|---|
| `builderModel.js` | The four pages (MCP and services, API keys, API usage, Activity), the four drawers, every address under `/account/builder`, each page's eyebrow trail and line, the words the rename moved, and `legacyBuilderPath` for `/account/developer…` |
| `BuilderSection.jsx` | The pane: trail, the h2 "Builder", the page line, the phone tabs, the once-per-member moved notice, the MCP server card and the connected assistants (today's reads), and a "Not read here yet" block naming the task that builds each other block. `BuilderHandoff` is the card Connectors keeps |
| `ApiKeysPage.jsx` | D1317 (#2480): API keys at `/keys` and one key's drawer at `/keys/:uid` (APIK1, APIK4, APIK5, APIK8–APIK15): the table, card 2, the states, and the only state slot that holds a secret (from a 201, until Done, close, an address change or unmount) |
| `ApiKeyDialogs.jsx` | D1317: Create, the one-time reveal (the only component that draws a secret, masked after Copy), Rotate, Revoke with the typed name, and Edit name and limit. None has an address |
| `apiKeysModel.js` | D1317: the pure rules: state pills, the preview (prefix and four dots, never more), the create body, the summary, expiry, the limit parser, filters and sorts, the per-key month, every refusal's words |
| `BuilderRedirect.jsx` | The app's half of the move: an old address followed inside the app lands on its new one, with its sub-path, query and hash. The Worker answers a page load with a 308 (`cloudflare-worker/src/services/builderRedirect.ts`) |

**Rule for adding here.** A block draws a Worker read only once that read has landed;
until then it is a `Wait` that names its task. Never sample data. A key's secret is drawn by `RevealDialog` alone, and never logged, stored, reported or put in an address.
