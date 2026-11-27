# `services/x/` — a founder's own X in Grow (D8815)

Part 3a of #2403. The sign-in, refresh and revoke are `integrations/providers/x.ts` (part 2, D2403) and the shared
client `services/xClient.ts` (part 1, #5290), which HQ's own X posting also uses. This folder reads a founder's X and
lands Grow's figures.

| File | What it holds |
| --- | --- |
| `reads.ts` | The only file that names the founder's Grow reads: the account's counts (`/users/me`) and the founder's own posts (`/users/:id/tweets`), sent through `xApiGet`. Field-by-field parsing; the UNVERIFIED X names are its constants. Each read reserves from the budget first. |
| `budget.ts` | The per-founder monthly read budget (`x_founder_usage`, owner decision 2): reserved before each billed call, refunded for what the call did not use. |
| `growFeeds.ts` | The one venture a connection serves (`x_grow_links`), the sync through `connector_fed_items`, the team-only "From X" module parts, delete, and the disconnect purge. |

## Rules for adding to it

- **Nothing else reads a founder's X for Grow.** A new read goes in `reads.ts` and is reserved from the budget before it is sent. `x_grow_8815.test.ts` holds the tree to that.
- **No billed call without a reservation.** A spent month refuses `x_monthly_cap_reached` before X, the token refresh included.
- **Every landing goes through the ledger.** A row the founder deleted stays deleted through every later sync.
- **Never 0, never a KPI.** A count X did not give is `null` with its reason. Nothing here writes `project_metrics` or `custom_kpi_values`.
- **Counts only in logs.** No figure, handle, post id, post text or token.
- **A new feed is an entry in `integrations/xFeeds.ts`.** The registry and the connector page follow it.
