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
- A test that asks a whole-app route question (is this path registered, what
  does its guard admit, does the admin walk reach it) reads
  `readRoutesSource()` from `_routesSource.mjs`, never `App.jsx` alone: since
  D528 a new area's routes live in `frontend/src/routes/` and the helper is
  `App.jsx` plus every module. `fixtures/` holds the small trees such helpers
  are exercised against (`fixtures/routes_modules/`, a wired and an unwired
  module; `fixtures/routes_lazy_conflict/`, two sources declaring one lazy
  name for different pages), never real pages.

D696's record contracts live in `record_page_d696.test.mjs` (real rendering,
parent callbacks, safe links and declared actions) and `persona_pdf_d696.test.mjs`
(allowlisted content, dated download and one-page measured bounds).
`_record_d696.mjs` supplies synthetic records and isolated mutation imports.
Each behavioral assertion group runs against the original source, against
changes it must reject, and again against the restored source; no checkout
file is changed by a mutation. No live API or personal data is used.

D695's independent form UI is exercised by `add_lightbox_d695.test.mjs`.
`_form_d695.mjs` supplies a small React DOM/effect harness and isolated source
mutations. The tests drive real inputs, payloads, loaded choices, refusals,
done views, responsive page transitions and modal focus/Escape behavior.
`add_addresses_d695.test.mjs` pins every form's `key` and `cta`, the T, CH
and CK kinds in `initialValues` and `validate` (each legacy form checked
against the rules it had before), the four `/:slug/new` routes and Customer
research's redirect, and the Add link's `state`. The helper resolves an
extensionless or directory import in a mutated source as the loader hook does.
Registry and routing integration cases follow when their dependencies merge.
