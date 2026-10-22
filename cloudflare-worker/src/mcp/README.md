# mcp — StudioOS as a remote MCP server (D665, D666)

AI assistants (ChatGPT, Claude, Gemini, Grok, any MCP client) add StudioOS by
URL, `https://axal.vc/mcp`, and sign in with OAuth 2.1 (D784, #2204: the
server is its own protocol, not under `/api`; `/api/mcp` answers 308 to it).
Everything here
is behind `MCP_SERVER_ENABLED` and the `OAUTH_KV` binding: with either
missing, every path answers 404.

| File | What it holds |
| --- | --- |
| `oauth.ts` | The OAuth provider (`@cloudflare/workers-oauth-provider`): the paths, the flag, the authorize endpoint that parks a request for the SPA's consent page, and `routeMcp`, which `../index.ts`'s `fetch` calls first |
| `server.ts` | The MCP server on the SDK's web-standard Streamable HTTP transport, stateless; the tool registry, listed per member by scope, plan and connection (D846); `callTool` checks the grant, company, plan, connection and rate limit before metering a priced tool through `services/metering.ts` (D844), and logs every call |
| `grants.ts` | What a grant may reach, re-checked on every call; the companies a person may grant; the per-grant limit; revoking every grant a user holds |

| Folder | What it holds |
| --- | --- |
| `tools/` | The tools, one file per group. `context.ts` holds the reads, `interviews.ts` the three interview tools, and `build.ts` and `connections.ts` D846's connector-backed reads |

## Rules

- **Nothing is auto-approved.** The authorize endpoint only parks the request
  and sends the founder to `/connect/assistant`; the grant is made by
  `../routes/mcp_consent.ts`, signed in.
- **A grant is re-checked on every call:** the account, the session floor
  (`jwt_min_iat`), the company in the grant, and the app's Validate read or write rule, according to the tool.
- **A tool result is data.** It never carries an instruction, and never an
  interviewee's name or contact.
- **A log line names the tool, the company, the client and the outcome.**
  Never an argument or a result.
- **A new tool registers through `registerMcpTools`**, with a required scope, plain description and typed input schema. A person can grant only ventures they own. All reads during a tool call use the app's `canReadBoard`; interview writes use `canWrite`. The grant's company numbers are project ids.
- **Consent identifies callbacks** through `assistantIdentity.ts`; a self-declared name never establishes a vendor identity. Full redirect URI and requested scopes are shown.
- **Limits**: register 10/IP/minute, authorize 30/IP/minute; dynamic registrations 7 days; interview submissions 20/client/user/day, atomic in D1; pending session placements 100 and assistant placements 500/user/day.
- **Revocation propagates across edges in about a minute**, because grants use KV.
