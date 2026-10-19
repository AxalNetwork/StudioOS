# services/mercury

D710 (#1775). Mercury for fund administration, **read-only**: one connection
per Axal entity (Holdings, Management, the GP, the Fund), which only a Super
Admin adds; an hourly sync of balances and transactions; and matches that
reconcile a bank credit against a capital-call line or a management-fee
period, which a person confirms. Read
[D710](../../../../documentation/architecture/decisions/D710.md) first.

**Nothing here can move money.** `client.ts` is the only file that names
Mercury's API host, and it can only GET an allowlisted read path, with
redirects refused. `mercury_read_only_d710.test.mjs` holds the whole tree to
that.

| File | What it owns |
| --- | --- |
| `client.ts` | The only Mercury caller: GET only, `READ_PATHS` only, `redirect: 'manual'`, a 10-second deadline. An error carries a status and a code, never a body. D713 adds `getTransaction`, one line by id (the path is UNVERIFIED). |
| `parse.ts` | The boundary. It keeps only the named fields a use needs, computes the last four, masks a run of eight or more digits in a memo, and refuses an amount that is not a whole number of cents or not USD. Account and routing numbers and the EIN never leave it. D713 adds `parseTransaction` (one line read by id) and `parseTokenPermission` (a reported permission, UNVERIFIED), and holds the posted, internal and void status lists `match.ts` re-exports. |
| `access.ts` | Who: `requireMercuryReader` (an Admin on HQ) and `requireMercuryCredentialWriter` (the Super Admin, with `super_admin_required` before the write bar). Both refuse a support session and a branch. `auditRead` writes a read's audit row first; the read does not happen without it. `READ_AUDIT_ACTIONS` also holds `capital_attestations_read`, D752's admin read of shared statements, which reads no Mercury. |
| `store.ts` | The entity connections (token as `v1.` ciphertext bound to its row), the check against #1773's registry by entity and last four, and the upserts of accounts, daily balance snapshots and transactions. A changed or cancelled matched line turns its match, and its active Not ours mark (D749), `needs_review`. |
| `sync.ts` | One connection's sync (one run at a time, a watermark, oldest first, at most 2,000 lines a run) and the hourly HQ sweep. A run row holds counts and a code, never a body. |
| `match.ts` | The matchers, a manual pair, confirm (one receipt through `recordReceipt`, `mercury:<id>`), reject, and `collectedFor`. Fund I (found through #1773's `fundPayeeOf`) and #1774's issued or paid fee periods are dependencies. `services/fundFees.ts`'s period read calls `collectedFor`; it is the one importer outside this folder. |
| `notOurs.ts` | D749 (#1838): "Not ours" for a credit no record should claim. `markNotOurs` (the same eligibility as a match, one live match or one live mark per line, checked in the INSERT) and `withdrawNotOurs` (a reason; the row stays). `NOT_OURS_REASONS` holds the reason keys. A note is the Admin's own words and is never logged. |

**Who imports `store.ts`:** only `routes/admin_mercury.ts`, the files in this
folder and `index.ts`'s cron block (D710 decision 11). #1778's personal
connection keeps its own tables (`services/mercuryPersonal.ts`); it uses this
folder's `client.ts` and `parse.ts` only, and reads `mercury_accounts` for
decision 3 alone. An investor's proof-of-capital statements live in
`capital_attestations` (`services/capitalAttestations.ts`, D752, migration
491), which stores the statement and no balance.
