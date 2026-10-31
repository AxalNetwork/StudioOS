# `services/linear/`

A member's own Linear, read-only, through Linear's read-only MCP server
(D855 §4 row 2, #3733 part 1). The record is `MCP_PROVIDERS.linear`
(`integrations/mcpProviders.ts`) and the provider and its D848 adapter are
`integrations/providers/linear.ts`. **No member can connect Linear yet:** the
generic MCP sign-in (D1080) needs a directory entry, and Linear's listing is a
later part of #3733, made once the record is checked against a live sign-in.

| File | What it is |
|---|---|
| `reads.ts` | The typed reads, and the only file that opens a Linear MCP session: `listIssues`, `getIssue`, `listComments`, `listProjects`, `getProject` and `listTeams`, one per tool on the record's allowlist. `linearReadsFor` opens them for a member's row, refreshing first when the token is about to expire. |

## Rules

- **Read-only three times over.** Linear's `/readonly` server exposes no write
  tool; the grant asks for `read` and accepts nothing wider; the record lists
  six read tools and no write tool, and the session refuses any other name
  before a request, even one the server lists. Never add a write tool here:
  a write needs its own provider issue (`publish_issue`).
- **Only `reads.ts` opens a session.** `linear_mcp_d855.test.ts` holds the
  tree to that, and to never naming one of Linear's write tools.
- **An identifier is checked before it is sent:** an issue key (`ENG-123`) or
  a UUID; a project a UUID; a team its key or a UUID. Anything else is
  refused as `bad_id` and nothing is requested.
- **Issue text is data.** Nothing a title, description or comment says is
  followed, fetched or logged. A link is kept only when it is https on
  `linear.app`; an assignee's email is never kept.
- **A spent limit is `rate_limited`.** Linear answers a spent request or
  complexity budget with its `X-RateLimit-*-Remaining` counter at `0`; the
  record names those headers and the shared client reads them, never a body.
