# cloudflare-worker/test — what the worker guarantees

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

`_ts-loader.mjs` strips types at import; `fixtures/` holds shared rows.

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
