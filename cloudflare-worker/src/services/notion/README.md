# `services/notion/`

A founder's own Notion, read-only, through Notion's hosted MCP server
(D1085, #2405). The member signs in with "Sign in with Notion" through the
generic MCP sign-in (D1080); the connection is an `oauth_mcp` row.

| File | What it is |
|---|---|
| `reads.ts` | The typed reads every Notion part uses, and the only file that opens a Notion MCP session: `searchSources`, `fetchPage` (Markdown, title, URL, last edit and the SHA-256 fingerprint), `listChildren`, `dataSourceSchema` and `queryRows` (`mode: 'rows'` or `'view'`, never SQL). `notionReadsFor` opens them for a member's row, refreshing first when the token is about to expire. |

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
- **What lands, and where,** is `integrations/notionFeeds.ts`, one entry per
  feed, added by the part that builds it.
