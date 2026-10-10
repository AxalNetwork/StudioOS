# mcp/tools — the MCP server's tools

| File | What it holds |
| --- | --- |
| `context.ts` | D666's read tools: `list_companies`, `get_validate_context` (Validate's own module records; interviews only counted) and `get_interview_guide` (questions built by code from the open hypotheses and the strongest pain themes) |

## Rules

- **One file per group of tools,** each exporting an array that
  `../server.ts` registers.
- **A tool that takes a company sets `company: true`,** and the server checks
  it against the grant before the tool runs. A tool never reads a company the
  grant does not cover.

D669: `interviews.ts` adapts the three interview services to the SDK's zod schemas. Every read needs validate:read; every interview tool needs validate:write. All six run through the server's common grant and account gate.
