---
name: add-worker-endpoint
description: Add a Worker API route and its frontend client method to StudioOS by the house rules (self-mounting router, narrowest gate, client module under frontend/src/lib/api/, refusal codes, datetime() expiry gates, auth inventory). Use when a task adds or changes a `/api/*` endpoint, a client method that calls one, or when CI fails on hub_freeze_5615, check-refusal-bodies, check-timestamp-comparisons, build-auth-inventory, check-api-drift or a test that reads a route file by path.
---

# Add a Worker endpoint

Most red CI on endpoint PRs comes from house rules, not logic. Three failures to recognise:

- A handler added to a frozen hub such as `routes/advisors.ts`: `frontend/test/hub_freeze_5615.test.mjs` fails with `"<METHOD> <path>" is a new entry in a frozen hub (D5615)`.
- A new refusal code on a page that keeps one sentence per code the Worker sends: for the skills routes, `frontend/test/hq_ai_agents_4739.test.mjs` fails with `skill refusal code <code> has no sentence`.
- A changed expiry gate: `cloudflare-worker/test/expiry_gate_datetime_d124.test.ts` fails with `expected <n> normalised comparisons across the gated files, found <m>`.

This skill is the order of work that avoids those. `CLAUDE.md` § Rules for
new work and `AGENTS.md` § House rules state the rules; they win where this
file disagrees.

## Steps

1. **Read the issue and the canvas.** Know the method, the path, who may call
   it and what it reads or writes before writing code. A route with no store
   behind it answers "Not recorded", never a zero (`AGENTS.md` § House rules,
   Honesty).

2. **Route file.** Put a new router in its own file,
   `cloudflare-worker/src/routes/<name>.ts`. A new handler for an area that
   already has a file goes in that file. The exception is a frozen hub (step 3).
   - Open the file with a `/** */` header comment. Its first sentence says what
     the file serves and names the issue or decision, as
     `routes/deck_access.ts` does. `node scripts/check-folder-docs.mjs` fails a
     file in `routes/` with no header (#4104). Write nothing in
     `routes/README.md`: its file list is generated and never committed.
   - End the file with a `mount` export (#4105,
     `cloudflare-worker/src/util/routeRegistry.ts`):
     ```ts
     import type { RouteMount } from '../util/routeRegistry';
     export const mount: RouteMount = { path: '/api/widgets', router: widgets };
     ```
     If an existing router on the same prefix has a catch-all such as `GET /:id`
     that would take your path, mount ahead of it:
     `before: [decks]`, importing that router (as `deck_access.ts` does). A
     module may not name a router whose file imports it back; the Worker then
     fails to start.
   - Never add an `app.route(...)` line or an import to
     `cloudflare-worker/src/index.ts`. Middleware for your router goes on your
     router.

3. **Frozen hubs (D5615).** Five files take no new entry:
   `frontend/src/lib/api.js`, `frontend/src/App.jsx`,
   `frontend/src/pages/cycles/CycleRoute.jsx`, `cloudflare-worker/src/index.ts`
   and `cloudflare-worker/src/routes/advisors.ts`. `scripts/hub-freeze.json`
   lists what each held, and the hub freeze test fails on any new name.
   `documentation/architecture/HUBS.md` says where each new entry goes. For
   advisors, a new area is `routes/advisors_<area>.ts` with
   `mount = [{ path: '/api/advisors', router, before: [advisorsRoutes] }, { path: '/api/mentors', router, before: [advisorsRoutes] }]`.
   It is not behind `advisors.ts`'s store guard, so it sets up its own stores.
   Never add a name to `hub-freeze.json` to let an entry in.

4. **Gate.** Use the narrowest gate that needs the data (`AGENTS.md` § House
   rules, Security). These are exported from `cloudflare-worker/src/auth.ts`,
   from weakest to strongest:
   - `getCurrentUser`: optional sign-in.
   - `requireAuth`, `requireApprovedKyc`, `requireStepUp`, `requireFactor`: signed in.
   - `requireAdmin`, or `requireRole` with `'admin'`: admin.
   - `requireHqAdmin`, `requireHqAuthoring`: HQ.
   - `requireSuperAdmin`, `requireSuperAdminWriteBar`: Super Admin.

   Another admin's data belongs to the Super Admin. A route that names a record
   (`:id`, `:uid`) also needs an ownership check that scopes the record to the
   caller, such as `canAccessProject` or `canAccessFounderResource`; the full
   list is `EVIDENCE_TOKENS` in `scripts/lib/authInventory.mjs`. A write on
   someone else's behalf records the actor with `logAdminAction`
   (`services/adminAudit.ts`) or `activity_logs`.

   `node scripts/build-auth-inventory.mjs --check` (#4570) fails when a route
   needs review and has no ledger entry under
   `scripts/baselines/auth-inventory/`. A route needs review when it has no
   gate, only an optional sign-in, a forward to another router, or names a
   record without an ownership check. Fix the gate first. Add an entry only
   when the route is meant to be like that:
   - `state: "public_by_design"` needs a `note`.
   - `state: "verified"` needs a `test` file that proves the gate.

   An entry that no longer matches a flagged route also fails.

5. **SQL.** Bind everything from the request with `?`. Never put `${…}` into
   `DB.prepare(` text. `node scripts/check-sql-prepare.mjs` fails on any new
   interpolation. Use `--write` only for a provably safe value (a placeholder
   list, a column allow-list) and say why in the PR. `sql.unsafe(` has its own
   reviewed allowlist in `scripts/check-sql-unsafe.mjs`; do not add to it. A
   schema change is a new migration,
   `cloudflare-worker/sql/migrations/YYYYMMDDHHMM_<issue>_<slug>.sql`
   (D4106, D5398), checked by `node scripts/check-sql-migrations.mjs`.

6. **Timestamps (D124, D125).** SQLite compares timestamps as text, so wrap
   the stored column:
   `datetime(expires_at) > datetime('now')`. Wrapping only the right-hand side
   fixes nothing. Never compare `CURRENT_TIMESTAMP`. Against a bound clock,
   wrap both sides: `datetime(scheduled_for) <= datetime(?)`.
   `node scripts/check-timestamp-comparisons.mjs` checks these columns:
   `expires_at`, `valid_until`, `confirm_expires_at`, `starts_at`,
   `start_at`, `respond_by`, `due_at`, `occurred_at`, `attempted_at` and
   `scheduled_for`. A new clock column joins that list in the same commit
   that creates it. `cloudflare-worker/test/expiry_gate_datetime_d124.test.ts`
   pins how many `datetime(expires_at|valid_until)` comparisons ten gate files
   hold: `auth.ts`, `auth_passkey.ts`, `advisor_grants.ts`,
   `advisors_engagements.ts`, `data_room.ts`, `research.ts`,
   `market_intel.ts`, `research_client_prep.ts`, `services/trust.ts` and
   `services/dealAccess.ts`. If you add or remove one there, change the number
   and its comment in the same commit.

7. **Refusals (D278).** In a refusal body, `error` is a code (lower-case words
   joined by underscores), and `message` and `detail` are a sentence you
   wrote. Build it with
   `refuse(c, status, { code, message, raw })` or `refusalBody(...)` from
   `cloudflare-worker/src/util/refusal.ts`. The raw exception or provider text
   goes in `raw`, which is logged and never sent to a member.
   - `node scripts/check-refusal-bodies.mjs` fails when a `message`, `detail`
     or `error` key takes `e.message`, `String(e)` or `.text()`.
   - `node scripts/check-api-drift.mjs` fails on a `c.json({...}, >=400)` with
     none of `error`, `detail` or `message`.
   - Some pages keep a sentence for each code their routes send, and their
     tests read the route file to collect the codes (#5802). Step 10 finds
     those tests. Add the sentence for each new code to the page's table in
     the same PR.

8. **Comments about Cloudflare Access.** Do not write that your route sits
   behind Cloudflare Access. Only the two KYC document routes do.
   `node scripts/check-access-comments.mjs` fails on any comment that mentions
   Access unless `scripts/access-comment-allowlist.json` vouches for it.

9. **Client method.**
   - A method for a domain that already has a module goes in that module under
     `frontend/src/lib/api/`.
   - A new domain is a new module there (D527). Open it with a header comment,
     import `request` from `'../api.js'`, and call `request` only inside method
     bodies. The path omits `/api`; `request` adds it:
     ```js
     export const widgetsApi = { list: () => request('/widgets') };
     ```
   - Pick export names that `api.js` does not use. Under `export *`, a name
     that `api.js` declares wins, and your export is silently hidden.
   - Do not edit `api.js` (#4105).
   - Never commit a generated module (D5612): `routes/_registry.ts`,
     `frontend/src/lib/apiModules.generated.js` and
     `services/agents/skillLibrary.generated.ts`.
     `node scripts/build-generated.mjs` writes them. Run it before a bare `tsc`
     or `node --test`.
   - Every `request()` path must match a mounted Worker route by method and
     path. `node scripts/check-api-drift.mjs` checks this.
   - A new screen area is `frontend/src/routes/<area>.jsx`, which `App.jsx`
     picks up without an edit.

10. **Preflight.** Run `node scripts/add-worker-endpoint.mjs` from the
    worktree root. It reads the diff against the merge base with
    `origin/main`, plus uncommitted and untracked files (`--base <ref>` for
    another base). `--files a,b` checks only those paths: a file git already
    tracks is read as changed (only its lines added since the merge base
    count, and the new-route and new-module rules do not apply), and an
    untracked file is read as new. So naming a legacy router that `index.ts`
    mounts by hand does not ask for a `mount` export; never add one to such a
    router, which would mount it twice. It reports the following:
    - `fail`: a generated module that git tracks; a new hub entry (the real
      `hubFreeze.mjs` rules); an added `app.route(`; a new route with no
      header or no `mount`; a new client module with no header or with an
      export that `api.js` already declares.
    - `warn`: an added `error: '<a sentence>'`; a new route with no gate the
      auth inventory can see; a mount outside `/api/`; an edit to a hub.
    - The tests that name each changed file by path, directly or through a
      shared helper in `frontend/test/_*.mjs` or `cloudflare-worker/test/_*`
      that they import (marked `via <helper>`; `_advisorRoutesSource.mjs`
      reads `advisors.ts` and every `advisors_*.ts` it imports). These tests
      pin the file's contents, so read each one. The list is found by text:
      a test that builds a path at run time some other way is not on it, so
      also search the tests for the route's own path (`/api/...`).
    - The guards and tests to run, in order.

    Add `--run` to run them and print each exit code. It exits 1 on a `fail` or
    a failed command. It does not read GitHub, write files, commit or push.

11. **Checks before the PR.** If you did not use `--run`, run these yourself:
    ```
    node scripts/build-generated.mjs
    node scripts/build-generated.mjs --check
    node scripts/check-api-drift.mjs
    node scripts/check-refusal-bodies.mjs
    node scripts/check-sql-prepare.mjs
    node scripts/check-sql-unsafe.mjs
    node scripts/check-timestamp-comparisons.mjs
    node scripts/check-access-comments.mjs
    node scripts/build-auth-inventory.mjs --check
    node scripts/check-folder-docs.mjs
    node scripts/build-route-map.mjs --check
    node scripts/check-decision-ids.mjs
    node scripts/check-unused-imports.mjs
    node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hub_freeze_5615.test.mjs
    node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/route_registry_4105.test.ts
    ```
    Also run the tests the preflight names, `npm run test:types`, and your own
    new tests. A migration adds `check-sql-migrations`, `check-sqlite-tables`,
    `check-sqlite-columns` and `check-schema-pair-drift`. A change under
    `services/advisor/` adds `check-advisor-bank-drift` (which runs
    `check-write-router-coverage`) and `check-write-router-columns`. Those
    guards and the ones in the list above are all in `npm run test:guards`,
    except `build-generated.mjs`, which the `pretest` hooks and each CI job
    run.

    Mutation-check every new assertion both ways (`AGENTS.md` § House rules,
    Tests). Run the full suite with the `verify-before-push` skill.

12. **Docs in the same PR.**
    - Decision file: `documentation/architecture/decisions/D<issue>.md`,
      headed `## D<issue> — <title> (#<issue>)`. Part `k` of a multi-part
      issue writes `decisions/D<issue>-p<k>.md`, headed
      `## D<issue> part <k> — <title> (#<issue>)`, beside `D<issue>.md`, and
      never edits `D<issue>.md` (`AGENTS.md` § House rules, Decisions).
      `node scripts/check-decision-ids.mjs` checks both headings and fails a
      part file whose `D<issue>.md` is not in the folder.
    - Route map (D4102): if the route backs a canvas, add your file to the
      Worker column of that canvas's own row file under
      `documentation/architecture/route-map/canvases/part-N/`. Edit only that
      file. A route with no canvas gets a section file under
      `route-map/sections/`, as `0999-grow-campaign-store-d4447.md` does.
    - Never commit `PROFILE_ROUTING.md`, `PAGE_INVENTORY.md`, `docs/` or
      `documentation/architecture/AUTH_INVENTORY.json`.

## What this skill does not do

- It does not design the route or decide who may call it. The issue and its
  owner answers do. When the narrowest gate is unclear, ask on the issue.
- It does not apply migrations to production D1 or deploy.
- It does not claim, label or open the PR. See `AGENTS.md` § Task protocol
  and the `task-lifecycle` skill.
- It does not run the full suite. See `verify-before-push`.
- It does not repair a red main. See `AGENTS.md` § "Red main and a backed-up
  queue" (D5398).
- The preflight is a heuristic. It reads text, not types or bindings, and a
  clean report is not a passing CI. The guards and tests in step 11 decide.
