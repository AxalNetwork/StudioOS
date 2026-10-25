# cloudflare-worker/test — what the worker guarantees

```
node --experimental-strip-types --no-warnings \
     --import ./cloudflare-worker/test/_ts-loader.mjs \
     --test 'cloudflare-worker/test/*.test.ts' 'cloudflare-worker/test/*.test.mjs'
```
Usually you just want `npm run test:drift`, which runs this plus everything else.

`financial_access_2460.test.ts` mounts the financial, revenue and legal routers
over the real SQLite schema. It checks every outside role, residual founder
ids, company boundaries, unchanged models after refused writes, and owner/admin
access. It also pins the separate deal-room partner reader and the recompute
edit gate so future read-only relationships cannot acquire writes accidentally.

Tests run **in process against a real SQLite database** (`node:sqlite`) loaded
from the actual schema or a specific migration file — not against mocks. A
handler that would fail on D1 because of an unknown column fails here too,
which is the whole point: D1 rejects the entire statement, so one bad column
name silently empties a screen in production.

`_ts-loader.mjs` strips types at import; `fixtures/` holds shared rows.
`_baseline.mjs` pulls one table's `CREATE TABLE` out of `schema_baseline.sql` so a
fixture is the schema production has rather than a hand-copy that drifts from it —
three tests had each grown their own copy of that reader, and one of the copies
had already been caught reading a column name production does not use.
`baseline_reader.test.mjs` holds it to what the regex it replaced returned.
`_engine_schema.mjs` (D757) gives a world whose sessions reach the Validate engine
what it reads: migrations 453, 465 and 487, `queue_jobs`, and the member and venture
columns `writableSession` checks.
`_guard_stub.mjs` (D763) answers Llama Guard's calls on a stubbed `env.AI` and passes
every other call through: the guard fails closed inside `run()`, so a stub that does not
answer it refuses every member run. It answers free, so a test keeps its own run's figures.
`schema_readiness.test.ts` runs the real bootstraps against two recording D1 stubs
and asserts each database gets its own DDL — the half `scripts/check-schema-readiness.mjs`
cannot see, since reading the source tells you a `WeakMap` is there but not that it
is consulted with the binding as its key.
`_codeOnly.mjs` gives a source-scanning test the code without the prose, plus
`callArgs` for reading one call's arguments past the braces a regex chokes on —
an assertion that bans a shape fails on the comment explaining why that shape is
gone, and the argument list of `fetch(url, { headers: { … } })` does not end at
the first `)`.

## Conventions

- Build the database from the migration the feature actually ships with, so the
  test and production see the same columns.
- Assert the **response shape**, not just the status. A route that returns a
  bare array where the SPA expects `{ items }` renders nothing and throws
  nothing.
- Cover the deny path. Most bugs worth catching here are a scope that returned
  too much, not a query that returned too little.
- `schema_guards.test.mjs` is the cross-cutting one: it walks the whole worker
  source and asserts repo-wide rules, and it is usually the file to extend when
  a new invariant needs holding.
- **A remote call that never answers is not an error, so no `catch` sees it.**
  `auth_path_bounded.test.mjs` holds the auth path to a deadline on every awaited
  remote call, and runs the rate-limit middleware and the schema bootstrap
  against stubs whose promises never settle. Test a stall, not just a failure:
  the 30s sign-in outage of 2026-09-12 passed every existing test (D74).

D642: `usage_storage_d642.test.ts` exercises caller-only storage aggregates through JWT/Hono and the canonical SQLite schema (including migration 323), covering company independence, unknown sizes, partial failures, precision and recording attribution.

D691: `compliance_events_columns_d691.test.ts` builds the full baseline and every
post-cutoff migration with foreign keys on. It checks Grow obligation writes,
API state mappings, seeded compliance events and calendar reads, and bans SQL
references to the absent migration-034 columns throughout Worker source.

D754: `whatsapp_switch_on_d754.test.ts` holds the two independent chat rollout
switches, authenticated off acknowledgements, hydrated canary membership, Axal’s
own-number guards, WhatsApp media deadlines/expiry and split calling reasons to
real SQLite fixtures with every provider stubbed. Its in-process mutation checks
run the same positive scenarios before restoring ordinary modules.

D755 CR7: `checkout_order_topup_d755.test.ts` reads an owner's pack order in each webhook state, verifies the current account balance and VAT exclusion, rejects other members and failed reads, and leaves ordinary orders unchanged. It also preserves historical receipts when HQ adopts their price, bounds ordinary reads to one purchase lookup, handles absent legacy tables without hiding genuine failures, and covers authentication. It embeds thirteen mutations, with the restored scenario checked before and after each mutant. Providers are forbidden.

D895: `pitch_worker_d895.test.ts` mounts the deck, branding, NDA and pitch-link
record routes over the migrated schema with synthetic data. It covers read-only
admins, advisor denial, admitted cofounders, measured runway, absent versus zero
review scores/counts, owner-plan export branding, live brand-kit selection,
founder/Lab score separation, canonical pairwise NDA state and one activity row
per completed write. `decks.autofill.test.ts` also checks AI-only coverage is zero.

`deck_share_null_limit_d895.test.ts` covers migration 549's data, index, foreign-key
and sequence preservation, nullable fresh/legacy bootstraps, NULL module links,
finite editor caps, concurrent claims and unchanged expiry/revocation/browser guards.

D992: `partner_profile_verdicts_d992.test.ts` holds profile verdict validation,
explicit clearing, omission, audit recipients and route refusals to the full
migrated SQLite schema; it also records the shared plan policy's admin exemption.
