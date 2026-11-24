# Accounting statement snapshots (D5833)

Read-only balance sheets and profit-and-loss reports from a venture's ledger,
in one shape whichever provider sent them (#5833, part of #5824). The decision
is `documentation/architecture/decisions/D5833.md`.

| File | What it holds |
| --- | --- |
| `contract.ts` | The types, exact amount parsing (no float, no rounding; `value`, `zero`, `absent`, `unreadable`), validation, the revision fingerprint, and which line may support which figure. Pure. |
| `quickbooks.ts` | A QuickBooks Online report to the contract, by the report's own group codes. Pure. |
| `xero.ts` | A Xero report to the contract; basis and currency come from the request. Pure. |
| `quickbooksClient.ts` | The only QuickBooks reader (D5834): GET only, `ProfitAndLoss` and `BalanceSheet` for the bound realm, sandbox and production on separate hosts, refusals by code with no body. |
| `quickbooksSync.ts` | A QuickBooks sync (D5834): the connection binds the realm, the venture and the environment; it fetches, adapts and writes each statement; `last_synced_at` moves only on a complete sync. |
| `store.ts` | The atomic, retry-safe revision writer, the reads and the founder's pins, guarded by project access and the writer's own connection. |

The reads are served by `routes/financial_statements.ts` (D5836): the venture's founder, team and admins only, read only.

Rules for adding to it:

- A new provider is one adapter file that returns a `SnapshotInput`; the store
  and the contract do not change.
- A figure is read from the provider's own total line (`SUPPORT` in
  `contract.ts`), never summed by Axal, never derived across reports. Net cash
  burn comes only from two balance sheets (`cashChange`), never from a net
  loss, and nothing here produces runway.
- Ledger figures are set beside Stripe or Mercury figures (`sideBySide`), never
  added to them.
- A revision and its lines are never updated; a correction is a new revision.

Fixtures are synthetic, under `cloudflare-worker/test/fixtures/accounting/`.
