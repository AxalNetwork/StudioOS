# frontend/test — what the frontend guarantees

```
node --import ./frontend/test/_deck-loader.mjs --test 'frontend/test/*.test.mjs'
```
or, more usefully, `npm run test:drift`, which runs these plus the worker
tests, the schema guards, `tsc`, and the dark-mode check.

These are **not** browser tests. There is no DOM here. They read source files
and assert things about them — which sounds odd until you see what class of bug
it catches:

- a page calls `api.getAdvisorSlots()` and the real method is `listAdvisorSlots`
  → renders empty inside a `catch`, silently, forever;
- an endpoint returns a bare array and the page reads `.items` → the pane looks
  fine and shows nothing;
- a surface renders a company, an advisor or a fund figure that no table holds.

None of those throw. All of them ship. So the tests here assert the *wiring*:
that a method exists on both sides, that a component is mounted and not merely
defined, that a page reads the shape the worker actually returns, and that a
number on screen traces back to a column.

## Conventions

- One file per surface or per rule; the header comment says what went wrong and
  why the file exists.
- Assert against code, not comments — several of these tests were first written
  against a doc comment and passed over broken code.
- When a test bans a word, check the file's own comments do not use it.
- `_deck-loader.mjs` is the JSX/asset loader; every run needs `--import` on it.
