# pages/account/builder — Account › Builder

D1315 (#2418). Builder was Account › Developer. It is a section for every profile,
drawn to four canvases in `design/incoming/`: `Builder Page.dc.html`,
`MCP Services Page.dc.html`, `API Keys Page.dc.html` and `API Usage Page.dc.html`.

| File | What it holds |
|---|---|
| `builderModel.js` | The four pages (MCP and services, API keys, API usage, Activity), the four drawers, every address under `/account/builder`, each page's eyebrow trail and line, the words the rename moved, and `legacyBuilderPath` for `/account/developer…` |
| `BuilderSection.jsx` | The pane: trail, the h2 "Builder", the page line, the phone tabs, the once-per-member moved notice, the MCP server card and the connected assistants (today's reads), and a "Not read here yet" block naming the task that builds each other block. `BuilderHandoff` is the card Connectors keeps |
| `mcpServicesModel.js` | #2479: MCP and services' rules — who reads (owner, none, explorer, Super Admin), the endpoint and key rows, an assistant row ("Unrecognised assistant", "No call recorded"), D848's health words and the ten-check strip, the services rows from Connectors' own state words, and the limits from D849's read |
| `McpServicesPage.jsx` | #2479: MCPX1, MCPX6–MCPX10, the service drawer (MCPX3) and the assistant drawer (MCPX5), each card on its own read. The tools card waits for D846's tool read. No connect, disconnect or key action: each links to its own page |
| `BuilderRedirect.jsx` | The app's half of the move: an old address followed inside the app lands on its new one, with its sub-path, query and hash. The Worker answers a page load with a 308 (`cloudflare-worker/src/services/builderRedirect.ts`) |

**Rule for adding here.** A block draws a Worker read only once that read has landed;
until then it is a `Wait` that names its task. Never sample data, and never a key's secret.
