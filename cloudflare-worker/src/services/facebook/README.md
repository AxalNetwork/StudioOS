# `services/facebook/` — a linked Facebook Page in Grow (D5859)

Part 2a of #2399. The sign-in, the Page list and revoke are `integrations/providers/facebook.ts` (#5292). This folder
reads a linked Page's figures and lands them in Grow.

| File | What it holds |
| --- | --- |
| `insights.ts` | The only reader of Page figures: the follower count and the daily insights, through the provider's `facebookGraph` (one Graph version, the app-secret proof, errors as codes). Field-by-field parsing; the UNVERIFIED Meta names are its constants. |
| `grow.ts` | The one Page each venture names (`facebook_page_links`), the sync through `connector_fed_items`, the "From Facebook" module parts, delete, and the purge that disconnect and the Meta deletion callback run. |

## Rules for adding to it

- **Nothing else reads Page figures.** A new read goes in `insights.ts`, with its UNVERIFIED names in its constants. `facebook_grow_5859.test.ts` holds the tree to that.
- **One Page per venture.** A venture names its Page; the sync never guesses from the company's chosen Pages.
- **Every landing goes through the ledger.** A figure the founder deleted stays deleted through every later sync.
- **Never 0, never a KPI.** A metric Facebook did not return reads "Not recorded". Nothing here writes `project_metrics` or `custom_kpi_values`.
- **No Page token is stored.** Each sync reads it from `/me/accounts` and drops it.
- **Counts only in logs.** No figure, Page name or token.
- **A new feed is an entry in `integrations/facebookFeeds.ts`.** The registry and the connector page follow it.
