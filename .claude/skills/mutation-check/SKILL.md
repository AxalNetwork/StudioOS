---
name: mutation-check
description: Mutation-check the assertions a StudioOS branch adds or changes, as AGENTS.md requires before a PR is ready. Use when a PR adds or edits tests, before writing the PR's Testing section or a READY_FOR_REVIEW STATUS, or when asked whether new tests would catch the bug they guard; it breaks the guarded code one change at a time, runs only that test file, restores the file, and reports "N mutations, N caught, N equivalent (why)".
---

# Mutation check

AGENTS.md § House rules, **Tests**: "Mutation-check every new assertion both
ways." The PR template's Testing section repeats it: "New assertions
mutation-checked both ways." Both ways means:

1. With the code it protects broken, the test **fails**.
2. With the code restored, the same test **passes** again.

A test that still passes with its code broken guards nothing. This skill
finds those tests before a reviewer does, and gives the one line that goes
into STATUS and the PR.

Read `AGENTS.md` § House rules (**Tests**) and § STATUS first. They win where
this file disagrees.

## Before you start

- Work from the repository root of your branch's worktree. `node_modules`
  must exist in the root, `frontend/` and `cloudflare-worker/` (in a scratch
  worktree, link them from a full checkout; see the `verify-before-push`
  skill, step 1).
- Run `node scripts/build-generated.mjs` once. A bare `node --test` does not
  run the `pretest:*` hooks, and Worker and frontend tests do not load
  without `cloudflare-worker/src/routes/_registry.ts` and
  `frontend/src/lib/apiModules.generated.js` (D5612).
- A frontend test that reads the built SPA needs `npm run build` first,
  because `docs/` is not committed (D529).
- Commit your work, or at least know what is uncommitted. The helper below
  restores files from memory, so uncommitted edits survive; a manual
  `git checkout -- <file>` does not.

## Steps

1. **List the tests to check.**
   `git fetch origin main`, then
   `node scripts/mutation-check.mjs list`.
   It prints every test file the branch adds or changes (against the merge
   base with `origin/main`, plus uncommitted and untracked files), the command
   that runs each one alone, and the changed code beside them. `--base <ref>`
   diffs against another ref. The plain-git equivalent is
   `git diff --name-only origin/main...HEAD`.

2. **Choose one mutation per assertion.** For each new or changed
   `assert.*` in those files, find the line of product code it exists to
   protect, and write the smallest change that breaks that behaviour and
   nothing else:
   - drop a guard: the `if` in front of a `refuse(c, 403, …)`
     (`cloudflare-worker/src/util/refusal.ts`) becomes `if (false)`;
   - flip a comparison or boundary: `<` → `<=`, `===` → `!==`;
   - remove a bound parameter, a `WHERE` clause term, a role check, an
     `logAdminAction` call, a `null`-for-"Not recorded" branch;
   - return the wrong shape: an empty list, `0` instead of `null`.
   Break the code, never the test. A mutation that only makes the file fail
   to load proves nothing about the assertion; give it an `expect` (below)
   so the run checks which test failed.

3. **Write the spec** in your scratchpad, not the repository:

   ```json
   [
     { "id": "billed-price",
       "file": "cloudflare-worker/src/services/agents/modelOffers.ts",
       "find": "input_usd_per_million: input == null ? null : billedUnitPrice(input, AI_MARKUP)",
       "replace": "input_usd_per_million: input == null ? null : input",
       "test": "cloudflare-worker/test/agent_model_offers_4545.test.ts",
       "expect": "member-billed" }
   ]
   ```

   That spec is real: it drops the markup from the #4545 price and the
   test `agent model offers expose member-billed input and output token
   prices` catches it.

   - `find` must occur exactly once in `file`; quote more of the line if not.
     `replace` may be `""` to delete it.
   - `expect` (optional) is part of the name of the test that must fail. A
     run that fails only in another test, or only because the file no longer
     loads, is reported as `wrong failure`, not `caught`; node names a load
     failure after the test file's path, and that entry never matches.
     Copy the name as written in the test: `#` and `\` are matched
     unescaped, though TAP prints them as `\#` and `\\`.
   - `equivalent` (optional) is the reason a mutation cannot be caught: the
     behaviour is identical, or another guard covers it. It is counted and
     its reason printed, never hidden. Use it rarely; most survivors mean the
     test needs strengthening. A good reason names what makes it so, for
     example "D1 enforces foreign keys, so every `vercel_*` row cascades with
     the connection's row".
   - `id` is optional (`m1`, `m2`, … otherwise).

4. **Run it.**
   `node scripts/mutation-check.mjs run --spec <spec.json> --json <out.json>`
   - First it runs each named test file unmutated. If one fails, it stops: a
     failing baseline catches nothing.
   - Then, one mutation at a time: write the mutated file, run only that test
     file with its suite's loader, restore the file byte for byte, and check
     the restore by SHA-256.
   - Last, it runs every test file again on the restored code. They must
     pass: that is the second way.
   - It exits 0 only when every mutation is `caught` or a named
     `equivalent`, the baseline and the after-run pass, and every file was
     restored. `--only id,id` reruns a few; `--timeout <ms>` (default
     300000) caps each run, and a run that hits it is `timeout`, not caught.
     A stopped run is killed with every process it started, so no test
     process keeps running the mutated code.

5. **Fix survivors.** A `survived` mutation means the test does not pin that
   behaviour. Strengthen the assertion (or add one), then rerun with
   `--only <id>`. Do not delete the mutation to make the line green.

6. **Report.** Copy the summary line the run prints into STATUS `tests:` and
   the PR's Testing section, with the test files it covered:

   ```text
   tests: npm run test:drift EXIT=0; mutation check (<test files>): <N> mutations, <N> caught, <N> equivalent (<id>: <why>)
   ```

   The spec above prints `1 mutations, 1 caught, 0 equivalent`. The format
   is fixed: `N mutations, N caught, N equivalent (why)`. With no
   equivalents it ends `0 equivalent`. A decision file
   (`documentation/architecture/decisions/D<n>.md`) that records the tests
   says the same line.

## Which command runs a test file

The helper picks the loader each suite's `package.json` script uses. To run
one by hand:

| Test file | Command (from the root) | Script it mirrors |
|---|---|---|
| `cloudflare-worker/test/*.test.ts`, `*.test.mjs` | `node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test <file>` | `test:worker` |
| `frontend/test/*.test.mjs` | `node --import ./frontend/test/_deck-loader.mjs --test <file>` | `test:frontend` |
| `meeting-bot/test/*.test.ts` | `node --experimental-strip-types --no-warnings --test <file>` | `test:meeting-bot` |
| `merge-control/test/*.test.ts` | `node --experimental-strip-types --no-warnings --import ./merge-control/test/runtime-loader.mjs --test <file>` | `test:merge-control` |
| `scripts/lib/*.test.mjs` | `node --test <file>` | `test:retention` |
| other `scripts/**/*.test.mjs` | `node --test <file>` | none: `scripts/claude-review/review.test.mjs` runs in `.github/workflows/claude-review.yml` |

A guard script under `scripts/check-*.mjs` is checked the same way: mutate
the code it scans for, run the guard, expect a non-zero exit, restore.
The helper does not run guards; do those by hand (below).

## By hand, without the helper

For one mutation at a time, with the file committed first:

1. Edit the code in the working tree.
2. Run the test file with its command above. Expect a failure, and read
   which test failed.
3. `git checkout -- <file>` puts the committed version back. Run the test
   again. Expect a pass. (Do not use `git stash` for this: with the file
   committed there is nothing to stash before the edit, and a later
   `git stash pop` applies an older, unrelated stash instead.)
4. `git status --short` shows nothing you did not mean to change.

## If a run is killed

The helper restores on errors, Ctrl-C (`SIGINT`), `SIGTERM` and `SIGHUP`. A
`kill -9` or a lost container cannot be caught, so before the first mutation
it keeps a backup outside the repository. The next `run` refuses to start
while one exists; `node scripts/mutation-check.mjs restore` puts the files
back and clears it. Then check `git status --short`.

## Rules

- **Never leave the tree modified.** End every session with `git status
  --short` showing only your intended changes. Never commit a mutated file.
- **One mutation at a time.** Two at once can hide each other; when two
  guards cover each other, check each alone (both survive, both
  `equivalent`, each naming the other), then the pair together as one
  mutation where the code allows it.
- **Break the product code, not the test,** and never mutate files under
  `docs/` (built, D529) or a generated module (D5612); the spec refuses
  `docs/`, `node_modules/` and `.git/`.
- **No skipped or disabled tests** (AGENTS.md § House rules, **Tests**). A
  mutation check never adds `.skip` or `.todo` to get a pass.
- **Not a substitute for the suite.** Run `npm run test:drift > drift.log
  2>&1; echo EXIT=$?` (or the parts in `verify-before-push`) as well; the
  mutation check proves the new assertions bite, not that nothing else
  broke.

## What this skill does not do

It does not write tests for you, choose which behaviour needs a test, or run
the whole suite. It never commits, pushes, opens or edits a PR, posts STATUS,
or calls GitHub; you copy its line into STATUS and the PR yourself. It does
not keep mutations as permanent tests. A mutation that must stay checked in
CI is written as a test of its own that mutates a copy, never the tracked
file, as `meeting-bot/test/contract_mutations.test.ts` does. Name it
`*.test.*` so its suite's glob runs it:
`frontend/test/calendar_read_controller_5206.mutations.mjs` does not match
`frontend/test/*.test.mjs`, so `test:frontend` never runs it.
