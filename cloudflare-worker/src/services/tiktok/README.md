# `services/tiktok/` — a founder's own TikTok in Grow (D5863)

Part 2a of #2401. The sign-in, refresh and revoke are `integrations/tiktokOAuth.ts` and
`integrations/providers/tiktok.ts` (#5291); this folder reads and lands Grow's figures.

| File | What it holds |
| --- | --- |
| `client.ts` | The only file that calls TikTok's Display API: the account's counts (`/v2/user/info/`) and the public videos (`/v2/video/list/`). One host, no redirects, a 10-second deadline, errors as codes, field-by-field parsing. |
| `grow.ts` | The one venture a connection serves (`tiktok_account_links`), the sync through `connector_fed_items`, the "From TikTok" module parts, delete, the "Add TikTok as a channel" proposal (D5864: raised by a sync, accepted through the existing channel writer, dismissed for good), and the disconnect purge. |

## Rules for adding to it

- **Nothing else calls TikTok.** A new read goes in `client.ts`, with its UNVERIFIED names in its constants. `tiktok_grow_5863.test.ts` holds the tree to that.
- **Every landing goes through the ledger.** A row the founder deleted stays deleted through every later sync.
- **Never 0, never a KPI.** A missing count is `null` with its reason. A scope the member did not grant says so. Nothing here writes `project_metrics` or `custom_kpi_values`.
- **Counts only in logs.** No figure, title, token or open_id.
- **A new feed is an entry in `integrations/tiktokFeeds.ts`.** The registry and the connector page follow it.
