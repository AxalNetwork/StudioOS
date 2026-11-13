# services/beehiiv

D2407 (#2407 parts 1–3): a founder's own Beehiiv newsletter through Beehiiv's
hosted MCP server (`MCP_PROVIDERS.beehiiv`): reads, and one draft post when the
founder presses Send.

- `mcp.ts` — the two frozen tool lists, from the record: `BEEHIIV_READ_TOOLS`
  and `BEEHIIV_DRAFT_TOOLS` (the one draft tool), and the server URL. Only
  `reads.ts` and `drafts.ts` import it.
- `reads.ts` — READ ONLY: four typed reads (the publications, one
  publication's audience figures, its sent posts and one post's figures).
  `normaliseRate` turns either rate shape into a fraction. It never names the
  draft list or mints a ticket.
- `drafts.ts` — part 3: `renderDraft` and `previewDraft` (the title and
  email-safe HTML a draft is, built with no request) and `createBeehiivDraft`,
  the one call of the draft tool, with a one-time publish ticket and no
  `status`. Only `integrations/providers/beehiiv.ts`'s `publish` imports it,
  and only `publishCore` calls that, inside the founder's confirm.
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
- **Only two files open a Beehiiv session:** `reads.ts` and `drafts.ts`
  (`beehiiv_connection_2407.test.ts` holds the tree to that).
- **A draft, never a post.** The draft tool is called only from `drafts.ts`,
  reached only by the PUBLISH adapter's `publish` after PUBLISH's confirm, and
  never with a `status`. Nothing here publishes, schedules, sends, edits or
  deletes a post (`beehiiv_publish_2407.test.ts`).
