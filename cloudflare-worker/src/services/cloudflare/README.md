# `services/cloudflare/`

A member's own Cloudflare, read-only, through Cloudflare's REST API
(D855 §4 row 5, #3733 part 2). It is pattern C, never an MCP server: the owner
chose the REST API on 2026-11-01, because Cloudflare's Workers Builds and
Workers Observability MCP servers are deprecated in favour of the Code Mode
`execute()` server, which this code never calls. The provider and its D848
adapter are `integrations/providers/cloudflare.ts`. **No member can connect
Cloudflare yet:** the sign-in (an OAuth client held to read scopes) and the
directory entry are a later part, made once a live sign-in confirms the
scopes.

| File | What it is |
|---|---|
| `api.ts` | The only file that calls Cloudflare for a member. `cloudflareReads(token)` holds the seven reads: accounts, an account's Workers, a Worker's builds, one build, its log, a Worker's errors and its request count. `checkGrantedScopes` holds a grant to `CLOUDFLARE_READ_SCOPES`. `errorOf` turns a failed answer into a code. |

## Rules

- **Seven reads on fixed paths.** Every call is
  `https://api.cloudflare.com/client/v4/accounts…` with the member's bearer
  token. No tool takes a path, a URL, a method or a query. The three
  Observability calls are POSTs only because Cloudflare's telemetry query
  takes a body, and `errorsQuery` and `requestsQuery` build that body here.
- **Never MCP, never Code Mode.** `cloudflare_api_d855.test.ts` fails if any
  code names `mcp.cloudflare.com` or if `MCP_PROVIDERS` gains a Cloudflare
  record.
- **An identifier is checked before it is sent:**
  - an account or a Worker's tag is 32 lowercase hex;
  - a Worker's name is lowercase letters, digits, `-` and `_`;
  - a build is a UUID.

  Anything else is `bad_id`, and nothing is requested.
- **Named fields only.**
  - A build keeps its id, status, outcome, times, branch, commit, commit
    message and repository. It never keeps its environment variables, build
    command, author or token.
  - An event never keeps its URL.
- **A spent limit is `rate_limited`.** A 429, or Cloudflare's code 971, is the
  five-minute block (D855 §3.9). `retry_after` is the answer's `Retry-After`,
  else 300. Only numeric codes are read, never a message.
