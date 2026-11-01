# services/posthog

D1385 (#3731, #2409): a founder's own PostHog, read only, through PostHog's
hosted MCP server.

- `reads.ts` — the only file that opens a PostHog MCP session
  (`posthog_connection.test.ts` holds the tree to that). One typed read per
  tool on `MCP_PROVIDERS.posthog.read_tools`, 19 in all: organisations and
  projects, saved insights and their results, trends, funnel, retention and
  lifecycle queries of their own kind only, the web overview, experiments,
  surveys and their answers, and feature flags.
- `deckFacts.ts` — D1601 (#3880): what a pitch deck reads from a venture's
  PostHog: its linked project (`posthogDeckLink`, the connection active and
  switched on for the venture's company) and the facts #3731's feeds store
  for it. No feed stores one yet, so `posthogDeckFacts` is empty and
  `posthogWauWeekly` null, and the deck says "not recorded". It never calls
  PostHog.

The rules for adding to this folder:

- **Read only.** Every request carries the record's
  `x-posthog-read-only: true` and `x-posthog-mcp-mode: tools`; a tool off
  the record is refused before any request. No person list, no `exec`, no
  SQL or HogQL is ever on the record or called here.
- **One project.** A venture's linked project is pinned with the
  connection's own `x-posthog-project-id` header, digits only.
- **No person leaves this folder.** Every answer goes through `scrub`:
  `distinct_id`, `session_id`, person and actor fields, emails and IP
  addresses are dropped at any depth before anything is returned.
- **Ids and queries are checked before they are sent.** A bad id is
  `bad_id`, a query of another kind or one carrying HogQL is `bad_query`,
  and nothing is requested.
- **Nothing is logged** but codes and counts.

PostHog parts 2–6 (#3731) add their stores and feeds beside this file and
read PostHog through `reads.ts` alone.
