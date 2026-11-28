# frontend/test — what the frontend guarantees

<!-- index: none -->

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

## Adding a test

This README lists no files (D6472, #6472). A test file explains itself in its
own header comment: the decision or issue it holds, what went wrong, and what
it guarantees. Adding a test adds its file and nothing else; a table row or a
paragraph here naming one file fails `scripts/check-folder-docs.mjs`. A file
whose name starts with `_` is a helper the tests import, described the same way.
`fixtures/` holds the small synthetic trees and recordings the tests and helpers
read, never real pages or personal data.

## Conventions

- One file per surface or per rule; the header comment says what went wrong and
  why the file exists.
- Assert against code, not comments — several of these tests were first written
  against a doc comment and passed over broken code.
- When a test bans a word, check the file's own comments do not use it.
- Every run imports the JSX/asset loader, `--import ./frontend/test/_deck-loader.mjs`.
- A test that asks a whole-app route question (is this path registered, what
  does its guard admit, does the admin walk reach it) reads
  `readRoutesSource()` from `_routesSource.mjs`, never `App.jsx` alone: since
  D528 a new area's routes live in `frontend/src/routes/` and the helper is
  `App.jsx` plus every module. `fixtures/` holds the small trees such helpers
  are exercised against (`fixtures/routes_modules/`, modules collected by a
  glob, one of them with an `order` and one whose export is misnamed;
  `fixtures/routes_lazy_conflict/`, two sources declaring one lazy
  name for different pages), never real pages.
- `App.jsx` collects its route modules with Vite's `import.meta.glob`
  (#4105); `_importMetaGlob.mjs` expands it for the node loader, so a test that
  renders `App.jsx` sees every module. A test that pins an API module's line
  in the re-export block reads `apiModulesBlock()` from `_apiModulesBlock.mjs`:
  the block is generated into `frontend/src/lib/apiModules.generated.js`, not `api.js`.

## Observable readiness (D5504)

Prefer scoped business clocks and explicit observable outcomes to a fixed count
of event-loop turns. The migration inventory and first changed-test command are
in `documentation/architecture/decisions/D5504.md`; the coordinated future-clock
run remains the integration signal for JavaScript, SQLite and child processes.
