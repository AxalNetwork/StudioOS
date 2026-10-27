# `services/notion/`

A founder's own Notion, read-only, through Notion's hosted MCP server
(D1085, #2405). The member signs in with "Sign in with Notion" through the
generic MCP sign-in (D1080); the connection is an `oauth_mcp` row.

| File | What it is |
|---|---|
| `reads.ts` | The typed reads every Notion part uses, and the only file that opens a Notion MCP session: `searchSources`, `fetchPage` (Markdown, title, URL, last edit and the SHA-256 fingerprint), `listChildren`, `dataSourceSchema` and `queryRows` (`mode: 'rows'` or `'view'`, never SQL). `notionReadsFor` opens them for a member's row, refreshing first when the token is about to expire. |
| `modules.ts` | The modules Notion may feed (D1086, #2951): each one's section, the source kinds it takes, whether an item lands as a fact or waits as a proposal, and the fields a database may map to, with the store's own value lists. `cleanFieldMap`, `checkAgainstSchema` and `mapRow` check and apply a founder's field map. |
| `sync.ts` | The shared sync (D1086): a founder-pressed read of one section's sources within a request budget, with a KV cursor that the next press resumes from; facts through the module's writer and the `connector_fed_items` ledger (deleted stays deleted, one owner per row); proposals by fingerprint (dismissed stays dismissed, a change re-proposes). `registerFactWriter` and `registerAcceptor` are where parts 3–6 add their modules. |
| `build.ts` | Build's landings (D1088, #2953): Product roadmap's and Prototype / MVP's fact writers (a row → a `roadmap_okrs` item or a must-have, mapped fields only, never a row another connection or the founder's hand owns) Solution design's `design_note` acceptor (one `solution_design_notes` row citing the page), and the look-alike path: a writer's `lookAlike` turns a new row that matches an item into a `fact_link` proposal (migration 644), and `factLinkAcceptor` links the two. Registered at import from `index.ts`. |

## Rules

- **Read-only by the record.** Notion's own grant reads and writes. The record
  (`integrations/mcpProviders.ts`) lists three read tools and no write tool,
  and the session refuses any other name before a request. Never add a write
  tool here: publishing needs its own provider issue (`publish_issue`).
- **Only `reads.ts` opens a session.** A part that needs Notion adds a read
  here and calls it; `notion_connection.test.ts` holds the tree to that.
- **An id is checked before it is sent** (`notionId`): 32 hex digits, with or
  without the UUID dashes. A URL or a path is refused as `bad_id`.
- **Page text is data.** Nothing a page says is followed, fetched or logged.
- **What lands, and where,** is a writer or an acceptor registered with
  `sync.ts` (`registerFactWriter`, `registerAcceptor`), one per module, added
  by the part that builds it. A fact always goes through the ledger; a
  proposal always waits for Accept.
