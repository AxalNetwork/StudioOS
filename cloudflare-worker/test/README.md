# cloudflare-worker/test — what the worker guarantees

<!-- index: none -->

```
node --experimental-strip-types --no-warnings \
     --import ./cloudflare-worker/test/_ts-loader.mjs \
     --test 'cloudflare-worker/test/*.test.ts' 'cloudflare-worker/test/*.test.mjs'
```
Usually you just want `npm run test:drift`, which runs this plus everything else.

Tests run **in process against a real SQLite database** (`node:sqlite`) loaded
from the actual schema or a specific migration file — not against mocks. A
handler that would fail on D1 because of an unknown column fails here too,
which is the whole point: D1 rejects the entire statement, so one bad column
name silently empties a screen in production.

## Adding a test

This README lists no files (D6472, #6472). A test file explains itself in its
own header comment: the decision or issue it holds, the routes or services it
mounts, the schema it builds and what it guarantees. Adding a test adds its file
and nothing else; a table row or a paragraph here naming one file fails
`scripts/check-folder-docs.mjs`. A file whose name starts with `_` is a helper
the tests import (a loader, a fixture world, a fake binding), described the same
way. `fixtures/` holds shared synthetic rows and recordings.

## The shared helpers

Every run imports the type-stripping loader, `_ts-loader.mjs`, which also loads
`_schema_budget.mjs` (D8467): a test process may execute two chains' worth of
whole migration files, and each one past that throws, naming the file and the
helper to call instead. A test that needs the migrated schema calls `loadSchema`
from `_schema_once.mjs` (D4133), which builds it once per run, rather than
replaying the files; a test that needs one table's `CREATE TABLE` reads it with
`_baseline.mjs` rather than copying it by hand. `scripts/test-schema-replays.txt`
lists the files that were over the budget when the rule arrived; a file leaves
that list by being fixed. Each helper's header says what it builds.

## Conventions

- Build the database from the migration the feature actually ships with, so the
  test and production see the same columns.
- Assert the **response shape**, not just the status. A route that returns a
  bare array where the SPA expects `{ items }` renders nothing and throws
  nothing.
- Cover the deny path. Most bugs worth catching here are a scope that returned
  too much, not a query that returned too little.
- The cross-cutting file is `schema_guards.test.mjs`: it walks the whole worker
  source and asserts repo-wide rules, and it is usually the file to extend when
  a new invariant needs holding.
- **A remote call that never answers is not an error, so no `catch` sees it.**
  `auth_path_bounded.test.mjs` holds the auth path to a deadline on every awaited
  remote call, and runs the rate-limit middleware and the schema bootstrap
  against stubs whose promises never settle. Test a stall, not just a failure:
  the 30s sign-in outage of 2026-09-12 passed every existing test (D74).
