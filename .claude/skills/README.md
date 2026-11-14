# .claude/skills — project skills for agent sessions

Each folder is one skill: a `SKILL.md` whose front matter says when to use it,
plus the files it reads. Claude Code loads them for sessions in this repository.

| Skill | For | Code it runs |
|---|---|---|
| `coordinator-audit/` | Session 1's backlog audit: triage, verified notes and labels, closes, new tasks, the weekly delta (D6312) | `scripts/coordinator.mjs`, `scripts/lib/coordinator.mjs`, `coordinator-audit/workflow.js` |
| `land-canvas/` | Committing an owner-approved Claude Design canvas into `design/incoming/` and releasing the issues that waited on it (D6312) | `scripts/land-canvas.mjs` |
| `design-brief/` | Turning a `needs-design` issue into a copy-paste Claude Design prompt grounded in what the platform records (D6312) | none |
| `red-ci-triage/` | A red PR: the digest's verdict, the open `[alert]` issues, the failing test inside a shard such as `suite (worker-2-of-6)` with its local reproduce command, and the red-main rules that apply (D5398, D5604, D5619, #6326) | `scripts/red-ci-triage.mjs`, `scripts/lib/redCiTriage.mjs` |
| `verify-before-push/` | The local checks before a push, in steps that each finish inside one session: generated modules, the root build, `test:guards`, the checks the change needs, the tests that import a changed file, then the `test:drift` parts one per call, with every exit code kept; and the environment failures that are not the PR's (#6326) | `scripts/verify-before-push.mjs`, `scripts/lib/verifyBeforePush.mjs` |
| `task-lifecycle/` | A building slot's task from `state:ready` to DONE: pull, claim (exit 3 leave, exit 4 label fallback recorded in STATUS), renew, STATUS with its label swap, branch, draft PR, blocked with lettered options, owner answers, DONE and release (#6326) | `scripts/task-lifecycle.mjs`, `scripts/lib/taskLifecycle.mjs`, `scripts/claim.mjs` |
| `add-worker-endpoint/` | Adding a Worker `/api/*` route and its client method by the house rules: a self-mounting router, the narrowest gate, a client module under `frontend/src/lib/api/`, refusal codes, `datetime()` expiry gates, the auth inventory and the hub freeze (#6326) | `scripts/add-worker-endpoint.mjs`, `scripts/lib/addWorkerEndpoint.mjs` |
| `build-screen-to-canvas/` | Building a page from a canvas landed in `design/incoming/`: boards to routes and components, every value's source and state, desktop, 390 phone and dark, the screen checks, the route-map row, and the PR's departures table (#6326) | `scripts/build-screen-to-canvas.mjs`, `scripts/lib/buildScreenToCanvas.mjs` |
| `mutation-check/` | Mutation-checking the assertions a branch adds, both ways (AGENTS.md § House rules, **Tests**): break the guarded code one change at a time, run only that test file, restore, rerun; reports `N mutations, N caught, N equivalent (why)` for STATUS and the PR (#6326) | `scripts/mutation-check.mjs`, `scripts/lib/mutationCheck.mjs` |
| `land-pr/` | AGENTS.md task-protocol step 5: whether an agent may queue a green T0/T1 PR (D5605 rows 3 and 6, #5500, the `landing policy` report for the exact head, required checks, merge queue, D5604 stall alert), and the exact `gh pr ready` / `gh pr merge --auto --squash --match-head-commit` commands only when every gate holds; otherwise the owner lands (#6326) | `scripts/land-pr.mjs` |
| `schema-change/` | A D1 schema change by the rules: a migration named by its UTC minute and issue (D4106, D5398), applied files never edited (D269), runtime DDL through `runSchemaBootstrap` (#4568, D5343, D235), timestamp comparisons (D124, D125), triggers only in migrations, and every schema guard before push (#6326) | `scripts/schema-change.mjs`, `scripts/lib/schemaChange.mjs` |

A skill describes how to do a job here; the rules it follows still live in
`AGENTS.md` and `CLAUDE.md`, and win when they disagree. No skill's script merges, approves, pushes,
force-pushes, edits `main` or dispatches a workflow. `land-pr` is the one skill
that can end in an agent queueing its own PR, and only by AGENTS.md task-protocol
step 5: every condition is checked first, and when one fails the owner lands.

A skill describes how to do a job here; the rules it follows still live in
`AGENTS.md` and `CLAUDE.md`, and win when they disagree. A skill never merges,
approves, force-pushes or edits `main`.
