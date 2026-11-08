# services/beehiiv

D2407 (#2407 parts 1–2): a founder's own Beehiiv newsletter, read only,
through Beehiiv's hosted MCP server (`MCP_PROVIDERS.beehiiv`).

- `mcp.ts` — the two frozen tool lists, from the record: `BEEHIIV_READ_TOOLS`
  and `BEEHIIV_DRAFT_TOOLS` (the one draft tool #2407 part 3 plans), and the
  server URL. Nothing imports the draft list yet, and the shared session
  refuses a write tool before any request.
- `reads.ts` — the only file that opens a Beehiiv session
  (`beehiiv_connection_2407.test.ts` holds the tree to that). Four typed
  reads: the publications, one publication's audience figures, its sent posts
  and one post's figures. `normaliseRate` turns either rate shape into a
  fraction.
- `grow.ts` — the publication each venture reads (`beehiiv_publication_links`),
  the founder-pressed sync that lands Grow's figures and posts through the
  `connector_fed_items` ledger, the "From Beehiiv" part of Distribution and of
  Revenue and traction, and Accept, Dismiss and Delete.

The rules for adding to this folder:

- **Aggregates only.** No subscriber, email address or segment is read, kept
  or logged. A subscriber tool is never put on the record (decision F1).
- **Never Axal VC's own newsletters.** Nothing here imports
  `services/newsletter*` or names its stores: a Beehiiv reader never becomes
  a `newsletter_subscribers` row, and no Axal audience is offered to Beehiiv.
- **Every tool name is UNVERIFIED** until the first live `tools/list`
  (D2407.md §5). A rename changes the record, its call site in `reads.ts`
  and the test fake together.
- **A missing figure is null with its reason, never 0.** Rates are stored as
  fractions from 0 to 1.
- **Drafts are part 3's.** The draft tool is called only from the PUBLISH
  adapter's `publish`, after PUBLISH's confirm, once #2407 part 3 builds it.
