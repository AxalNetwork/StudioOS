# cloudflare-worker/test — what the worker guarantees

`admin_promos_d1271.test.ts` checks all four HQ Super Admin promo gates,
branch refusal even with an elevation row, stale/non-TOTP sessions, the
production cool-off prefix, and successful billing-audited writes over
canonical SQLite tables with Stripe stubbed.

`program_usage_d1156.test.ts` exercises migration 601, count-only branch reports,
newest-wins HQ storage, monthly source counts, partial failures, roles,
throttling and the dated in-use read with synthetic SQLite records.

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

`bank_registry_d1184.test.ts` checks the registry’s audited Mercury association,
masked resolver previews and source add validation over the real migrations,
with all network access refused.

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
D1174 regressions live in the use-of-funds, Raise card/record, financial
integrity and access suites. Synthetic Mercury rows prove accepted mappings,
private owner/session/company scope, missing versus zero, and local read
failure; the provider is forbidden. Cash timing and the shared split reader
are checked against the actual Worker services.

`_engine_schema.mjs` (D757) gives a world whose sessions reach the Validate engine
what it reads: migrations 453, 465 and 487, `queue_jobs`, and the member and venture
columns `writableSession` checks.
`_guard_stub.mjs` (D763) answers Llama Guard's calls on a stubbed `env.AI` and passes
every other call through: the guard fails closed inside `run()`, so a stub that does not
answer it refuses every member run. It answers free, so a test keeps its own run's figures.
`_fake_ai.mjs` (D1511) is the fake Workers AI binding the deck v2 suites run on: recorded
outputs, never a model, and each failure a real binding gives injected on demand (a 429,
error 3040, a timeout, a guard block, bad JSON, over-capacity text, a non-image answer).
`schema_readiness.test.ts` runs the real bootstraps against two recording D1 stubs
and asserts each database gets its own DDL — the half `scripts/check-schema-readiness.mjs`
cannot see, since reading the source tells you a `WeakMap` is there but not that it
is consulted with the binding as its key.
`_codeOnly.mjs` gives a source-scanning test the code without the prose, plus
`callArgs` for reading one call's arguments past the braces a regex chokes on —
an assertion that bans a shape fails on the comment explaining why that shape is
gone, and the argument list of `fetch(url, { headers: { … } })` does not end at
the first `)`.

D1119: `admin_programs_d954.test.ts` also checks part 4's six audit actions,
claim window/kind counts, strategic requests, successful zeroes and independent
failed reads against the migrated SQLite schema.

D1159: `fund_admin_d1159.test.ts` covers named distribution lines without
arithmetic changes, both new Admin acts and their audit, frozen/support/member
refusals, preserved institutional GP scope, and independent booklet queue reads.
Every external fetch is forbidden; no Mercury call reaches a provider.

| File | Guarantee |
| --- | --- |
| `capital_access_d1191.test.ts` | D1191: real-route access, staff summaries, support audit ordering, scoped prospect writes and failure/race outcomes against the canonical schema. |
| `dataroom_deck_sources_d1602.test.ts` | D1602: migrated data-room source permissions, quotes, billed extraction, code readers, citations, stale versions and withdrawal. |
| `dataroom_deck_sources_d1602.mutations.mjs` | D1602: reproducible isolated-loader mutation proof, with passing original controls before and after; source files are never edited. |

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

D1167: `storage_plans_d1167.test.ts` pins the owner's storage table, resolves
effective plans and recorded persona/LP entitlements against canonical SQLite
DDL, and holds the anonymous public plans projection and general catalogue to
the same allowances, with read failures and privacy/read-only counterexamples.

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

D1091: `google_workspace_connection.test.ts` tests consent, file scope, previews and disconnect using `_google_workspace_fake.mjs`; `fed_ownership.test.ts` holds the shared ledger-owner helper; `google_workspace_feeds.test.ts` pins the empty feed registry, audience and eight read fragments. No real Google host is called.

D1144: `pmf_store_d1144.test.ts` exercises migration 598, signed change-only snapshots, scoped module/history/Re-score, checklist confidence and atomic audit/rollback on SQLite. `pmf_engine.test.ts` keeps the shared pure engine and collector contract.

`deal_context_d1150.test.ts` executes migration 600 and real source tables for
derived stages, per-user/firm visit markers and private notes, including audit
rollback, no admin bypass, NDA exclusion and anonymous change metadata.

`deal_workroom_d1153.test.ts` mounts D1153's routes over canonical SQLite DDL and
migration 595: investor-only access, the room's door and one open request, the
round as a count and a total with no other investor named, and a withdrawal that
needs a reason and records it only when it withdrew.

D1123 extends admin_lab_operations_d971.test.ts with real SQLite capacity-result tests: cohort scoping, last event, absent vs unreadable, and admin-only reads.

D1176: `use_of_funds_routes_d1176.test.ts` mounts the real Use of funds and financial routers over canonical SQLite DDL. It covers roles/company scope, read-only support, audited initialization, cross-venture ids, Base projection, partial legacy splits and financial reconciliation, legacy-only metadata and concurrent edit conflicts, stale-copy repair errors, orphan milestone deletion, copies, racing deletion and hire audits, zero/missing values, precedence, bounded runway history, founder-only Mercury, partial reads and audit rollback. Providers are stubbed.

`calendar_d1206.test.ts` checks mounted Free-investor reads and subscriptions,
Professional-only IC creation, advisor fallback ownership, partial-source error
codes and safe diagnostics, and Calendly exclusion from both provider copies.
It also checks local-licence scopes, HQ elevation, constant-query populated memberships, private-kind exclusions,
unavailable remote coverage and personal sync/export isolation after a scope
read. `my_events_feed_d1033.test.ts` also verifies Free and lapsed subscriptions
with token ownership, revocation and join-link boundaries intact.
Staff-view audit tests verify both existing stores contain only scope/window
details, repeated views are recorded, and personal/refused/invalid reads create
no staff-view audit entry.
Every provider call is stubbed or refused; all rows are synthetic.

| File | Purpose |
|---|---|
| `raise_evidence_d1263.test.ts` | D1263: source dates/labels, founder decisions, privacy, refresh and atomic evidence trails over real SQLite. |
`kyb_d1231.test.ts` drives migration 616 through Hono/auth and real SQLite:
owner-check explanations, fixed-expiry KYB reconciliation and invalidation,
studio/role/step-up/freeze refusals, masked/audited showings, private Access-gated
R2 streams, rejection purge/retry, atomic audit/upload rollback, source discovery,
imports and licensed studios. Twenty injected route faults run against the same
scenarios before and after restoration. All external fetches are refused.

D1231 follow-up: company member reads reflect expiry and legal edits; company submitter/membership self-review and unsubmitted corporate profiles are covered. Twenty-seven injected faults cover routes, the member status projection and submission-state derivation, each checked before and after restoration.

D1231 concurrency tests cover displayed If-Match tokens, source edits during a request, staff-created cases without false submitters, dismissed imports and collision-safe migration of legacy reviewer assignments/history.

| File | Purpose |
| --- | --- |
| `deal_insights_d1151.test.ts` | Real SQLite tests of D1151 deal access, NDA masks, publication, aggregates and sourced sharing. |
| `messages_retirement_d1345.test.ts` | Phase 1: real mounted 410s and own-LP / own-advisor Email recipient scopes on migrated SQLite. |
D1169: `usage_storage_d1169.test.ts` holds the grown storage read: thirteen member stores, company files counted to the company owner, kinds, companies, the ten largest files, the allowance and its state, and that fund, legal, identity, 83(b) and HQ stores are never read. It and `usage_storage_d642.test.ts` run on `_storage_schema.ts`, which replays the baseline and every later migration once into a template database and copies it for each case. Rows are synthetic.

| File | Purpose |
| --- | --- |
| `session_processing_recovery_3711.test.ts` | No-audio legacy recovery, transcript-hash summary reuse and private stage failure diagnostics for #3711. |
| `stripe_mode_d1433.test.ts` | D1433 (#3703): mode-stamped catalogue, checkout readiness before provider calls, webhook receipts/retries/concurrency and signature timestamp boundaries; mocked Stripe only. |
| `project_deck_hard_delete_3747.test.ts` | #3747: migrated SQLite deck/share/note/image cleanup, venture isolation, 500-object R2 pages, rollback, durable retries and per-sweep schema discovery; synthetic records only. |
| `deck_atomic_save_3748.test.ts` | #3748: migration 713 preserves duplicate deck payloads and enforces unique version/current rows. |
| `work_board_3969.test.ts` | D1614 W1 (#3969): authenticated project-only boards, task fields, moves, close reasons, dependency races, actor events, unavailable reads, migration 762 over legacy rows, the engine's own mount and the readiness hook, over real SQLite. |

D1456 (#4014): the existing record, recovery, bot-control and migration-runner suites cover channel/fact actions, recorded failed steps, creator-only safe bot details and migration 760 replay through the ledger. The engine fixture applies migration 760 from its SQL source.
