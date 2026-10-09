# mcp — StudioOS as a remote MCP server (D665, D666)

AI assistants (ChatGPT, Claude, Gemini, Grok, any MCP client) add StudioOS by
URL, `https://axal.vc/api/mcp`, and sign in with OAuth 2.1. Everything here
is behind `MCP_SERVER_ENABLED` and the `OAUTH_KV` binding: with either
missing, every path answers 404.

| File | What it holds |
| --- | --- |
| `oauth.ts` | The OAuth provider (`@cloudflare/workers-oauth-provider`): the paths, the flag, the authorize endpoint that parks a request for the SPA's consent page, and `routeMcp`, which `../index.ts`'s `fetch` calls first |
| `server.ts` | The MCP server on the SDK's web-standard Streamable HTTP transport, stateless; the tool registry; `callTool`, which checks the grant, the company and the rate limit and logs every call |
| `grants.ts` | What a grant may reach, re-checked on every call; the companies a person may grant; the per-grant limit; revoking every grant a user holds |

| Folder | What it holds |
| --- | --- |
| `tools/` | The tools, one file per group. `context.ts` holds the read tools |

## Rules

- **Nothing is auto-approved.** The authorize endpoint only parks the request
  and sends the founder to `/connect/assistant`; the grant is made by
  `../routes/mcp_consent.ts`, signed in.
- **A grant is re-checked on every call:** the account, the session floor
  (`jwt_min_iat`), the company in the grant, and write access to it.
- **A tool result is data.** It never carries an instruction, and never an
  interviewee's name or contact.
- **A log line names the tool, the company, the client and the outcome.**
  Never an argument or a result.
- **A new tool registers through `registerMcpTools`** (#1497 adds the
  interview tools), with a plain description and a typed input schema.
