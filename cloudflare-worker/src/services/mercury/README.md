# services/mercury

D710 (#1775). Mercury for fund administration, **read-only**: one connection
per Axal entity (Holdings, Management, the GP, the Fund), which only a Super
Admin adds; an hourly sync of balances and transactions; and matches that
reconcile a bank credit against a capital-call line or a management-fee
period, which a person confirms. Read
[D710](../../../../documentation/architecture/decisions/D710.md) first.

**Nothing here can move money.** `client.ts` is the only file that names
Mercury's API host (D840's `mcp.ts` names its MCP host, and calls only `MERCURY_READ_TOOLS`), and it can only GET an allowlisted read path, with
redirects refused. `mercury_read_only_d710.test.mjs` holds the whole tree to
that.

| File | What it owns |
| --- | --- |
| `client.ts` | The only Mercury caller: GET only, `READ_PATHS` only, `redirect: 'manual'`, a 10-second deadline. An error carries a status and a code, never a body. D713 adds `getTransaction`, one line by id (the path is UNVERIFIED). |
| `parse.ts` | The boundary. It keeps only the named fields a use needs, computes the last four, masks a run of eight or more digits in a memo, and refuses an amount that is not a whole number of cents or not USD. Account and routing numbers and the EIN never leave it. D713 adds `parseTransaction` (one line read by id) and `parseTokenPermission` (a reported permission, UNVERIFIED), and holds the posted, internal and void status lists `match.ts` re-exports. D752 (#1889): it also keeps a transaction's category when Mercury gives one (UNVERIFIED). |
| `access.ts` | Who: `requireMercuryReader` (an Admin on HQ) and `requireMercuryCredentialWriter` (the Super Admin, with `super_admin_required` before the write bar). Both refuse a support session and a branch. `auditRead` writes a read's audit row first; the read does not happen without it. `READ_AUDIT_ACTIONS` also holds `capital_attestations_read`, D752's admin read of shared statements, which reads no Mercury. |
| `store.ts` | The entity connections (token as `v1.` ciphertext bound to its row), the check against #1773's registry by entity and last four, and the upserts of accounts, daily balance snapshots and transactions. A changed or cancelled matched line turns its match, and its active Not ours mark (D749), `needs_review`. |
| `sync.ts` | One connection's sync (one run at a time, a watermark, oldest first, at most 2,000 lines a run) and the hourly HQ sweep. A run row holds counts and a code, never a body. |
| `match.ts` | The matchers, a manual pair, confirm (one receipt through `recordReceipt`, `mercury:<id>`), reject, and `collectedFor`. Fund I (found through #1773's `fundPayeeOf`) and #1774's issued or paid fee periods are dependencies. `cloudflare-worker/src/services/fundFees.ts`'s period read calls `collectedFor`; it is the one importer outside this folder. |
| `notOurs.ts` | D749 (#1838): "Not ours" for a credit no record should claim. `markNotOurs` (the same eligibility as a match, one live match or one live mark per line, checked in the INSERT) and `withdrawNotOurs` (a reason; the row stays). `NOT_OURS_REASONS` holds the reason keys. A note is the Admin's own words and is never logged. |
| `mcp.ts` | D840 (#2346): the Worker as an MCP client of Mercury's hosted server (`https://mcp.mercury.com/mcp`, Streamable HTTP). `initialize`, the session id, `tools/list`, `tools/call`; a 10-second deadline per POST and a request budget per session; redirects refused. `MERCURY_READ_TOOLS` is the frozen list of tools it may call: a name off the list, or one the server does not offer, is refused before any request. Errors keep D710's `MercuryClientError` words. Only `reads.ts` imports it. |
| `reads.ts` | D840: the typed reads, the interface D840's parts use. `openMercuryReads` gives one function per allowlisted tool, parsed and typed (no account or routing number, EIN, email, address or link). `MercuryBankReader` is what D713's and D752's feeds read, the same on both paths: `tokenBankReader` (a pasted token, through `client.ts`) and `mcpBankReader` (a sign-in, through `mcp.ts`). |

**Who imports `store.ts`:** only `cloudflare-worker/src/routes/admin_mercury.ts`, the files in this
folder and `index.ts`'s cron block (D710 decision 11). #1778's personal
connection keeps its own tables (`cloudflare-worker/src/services/mercuryPersonal.ts`); it uses this
folder's `client.ts` and `parse.ts` only, and reads `mercury_accounts` for
decision 3 alone. An investor's proof-of-capital statements live in
`capital_attestations` (`cloudflare-worker/src/services/capitalAttestations.ts`, D752, migration
491), which stores the statement and no balance.
