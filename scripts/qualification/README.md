# `scripts/qualification/` — role qualification

D8688 (#8688). A rerunnable, role-by-role qualification of the five client
roles (Admin, Founder, Investor, Advisor and Operating Partner) and a
pending-review control, run through the real Worker against synthetic
identities, a test-only territory and a second synthetic tenant. It prints a
pass/fail matrix.

| File | What it is |
| --- | --- |
| `role-matrix.mjs` | The command. Runs the scenarios, adds the build ids and prints the matrix as Markdown. It can also write JSON or merge a browser run's 390 px results. Plain `node`, no npm. |

The rules it applies (the target guard, synthetic addresses, build ids, row
results and what may be published) are in `../lib/roleQualification.mjs`. Its
tests are in `../lib/roleQualification.test.mjs`. The scenarios are in
`cloudflare-worker/test/_role_qualification_8688.ts`.
`cloudflare-worker/test/role_qualification_8688.test.ts` runs them on every PR.

## Run it

```
node scripts/build-generated.mjs                 # once, as before any Worker test
node scripts/qualification/role-matrix.mjs       # the matrix, as Markdown, on stdout
node scripts/qualification/role-matrix.mjs --json matrix.json --md matrix.md
node scripts/qualification/role-matrix.mjs --phone phone.json   # merge 390 px browser results
```

It takes about 20 seconds. The exit code is 0 when no row failed, 1 when a row
failed, and 2 when the run was refused or could not start. A row that is only
**incomplete** does not fail the run, for example when a step has no product
route or the 390 px check was not run.

## What one row records

- **Build**: the commit, plus the app (`HEAD:frontend/src`) and Worker
  (`HEAD:cloudflare-worker/src`) source trees as separate ids. Either id is
  marked `+dirty` when the working tree differs from it.
- **Authenticated role**: what the session's own `GET /api/auth/me` returns.
  The **intended role** is the scenario's.
- **Workspace** and **scope**: the synthetic tenant the role acts in, and the
  second tenant it is checked against.
- **Steps**: `start`, `draft`, `reload` and `next_action` come from the issue.
  `scope` is the second-tenant check. Each step is pass, fail or missing, with
  one sentence of evidence.
- **390 px**: not run in this mode, because it has no browser. A browser run
  writes `{ "<row id>": { "result": "pass" | "fail", "evidence": "…" } }` and
  `--phone` merges it. The row ids are `admin`, `founder`, `investor`,
  `advisor`, `partner` and `pending`.
- **Preview only**: always `no` here. Every row runs as the role itself, never
  as an HQ preview. The role previews in #8689 cover navigation only and are
  not counted.
- **Missing steps**: what the product has no route for, or what the issue's
  limits keep out of scope.

Evidence contains no email address, link, bearer value or token-like string.
The command refuses to write a matrix that does.

## The scenarios

| Role | Workspace | Start → draft → reload → next action | Second tenant |
| --- | --- | --- | --- |
| Admin | Branch `qa8688a`, a test territory (`XQ`) | The board lists a local LP applicant → assign it to yourself and save a triage note (In review) → note and assignment history read back → Needs follow-up | Branch `qa8688b` refuses the session (401). HQ licence routes refuse it (403). No HQ account exists for it. |
| Founder | Company A, venture A | Build opens → a Backlog feature linked to an interview pain theme → listed after reload, then resumed → must-have, In Progress | Venture B refuses access (403). Tenant B's evidence cannot be linked (404). |
| Investor | Investor A: LP in one fund, GP of another | An invited deal is New for you → added at Screening with a private note → the note reads back. The funds list marks the LP position `lp` and the managed fund `gp`; the LP portal holds only the LP position → moved to Diligence | Investor B cannot open the deal (403), cannot read the note (404) and lists no fund. |
| Advisor | Advisor A, December cohort | The assigned cohort opens → session-preparation guidance saved as a draft → after reload, listed and resumed at the next version → published in-app | The unassigned cohort refuses access (403). Advisor B cannot reach the draft (404). |
| Operating Partner | Delivery Firm A | The fictional opportunity is an open lead → proposal draft saved → after reload, sent; the synthetic founder accepts; handed to delivery with a first-delivery milestone → milestone done | Firm B cannot reach the engagement or milestones and has no draft. |
| Pending review (control) | none | The member reads its own state as Exploring. Role surfaces refuse it (403). | Lists no fund, deal or venture. |

## The territory, and how the restricted Admin is provisioned

The Admin is the principal of a branch deployment, which is restricted by
construction: the branch has its own database and its own session key, and
every HQ-only route refuses it. The run provisions the branch the same way
production does:

1. The synthetic HQ Super Admin creates a **draft** territory licence through
   `POST /api/admin/licences` and sets its territory through
   `PUT /api/admin/licences/:uid/territories`. It uses user-assigned ISO codes
   (`XQ`, `XZ`), which no real country holds. The run creates no contract, no
   signature and no activation.
2. HQ's push runs in two halves: `assembleLicenceRecord` on HQ and
   `applyLicenceCopy` on the branch. The branch then holds HQ's copy.
3. The branch's one starting account comes from `seed-branch-principal.mjs`'s
   `principalSql`, the statement provisioning uses (D.3).

The run does not exercise HQ's appointment route,
`POST /api/admin/licences/:uid/admins`. That route makes the account an HQ
admin, and an HQ admin's reads are unscoped (`tenancyScope.ts`). See D8688.

## Where it may run (fail closed)

Before seeding, each database passes `assertIsolatedTarget`. The guard refuses
any of the following:

- `ENVIRONMENT` is `production`, unset or unknown. Both `wrangler.toml`'s top
  level and `[env.production]` say `production`.
- The database is production's D1, by name or by the id `wrangler.toml` binds.
- A hosted or `preview` target lacks an `isolated` preflight from
  `check-preview-isolation.mjs` that is under 24 hours old.
- The database already holds an account outside the synthetic domain.

Today the only target is `local`: three migrated SQLite databases inside the
process. No D1, no network and no delivery are involved, and every outside
`fetch` is refused and counted. `--target <name>` is refused with its reasons
until an isolated qualification environment exists (#7147, #7149).
