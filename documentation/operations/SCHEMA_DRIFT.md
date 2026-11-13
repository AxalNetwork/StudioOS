# Schema drift: what is checked before a deploy, what is found after it

This runbook covers one question. Can the repository still rebuild the
production D1 schema, and what do we do when the answer is no? It splits the
checks into the ones that run **before** the Worker ships, which can stop a
deploy, and the one that runs **after** it, which can only report. It then
says how a post-deploy finding is escalated and corrected (#4591, audit
finding R2-03).

Related runbooks:

- `DEPLOY.md` covers shipping, the rollback point, and failed migrations.
- `D1_RECOVERY.md` covers what to do when the data, not the schema, is wrong.
- `INCIDENT_RESPONSE.md` covers severities and paging.

No step here is for an agent to run against production. Production DDL,
exports, drops and restores are the owner's, and every command that would
change production is marked **owner only**.

---

## 1. Before a deploy: the checks that can stop it

These run on every pull request (`ci.yml`, `test:drift`), again in the merge
queue in front of `main` (`DEPLOY.md` §1.2.1), and, for the last one, inside
the deploy job itself. A red result here means nothing new reaches
production.

| Check | When | What it guarantees |
| --- | --- | --- |
| `migration-immutability.yml` (`scripts/migration-immutability-gate.mjs`, D269) | PR and every push to `main` | A migration already on `main` is never edited, deleted or renamed. |
| `scripts/check-sql-migrations.mjs` | `test:guards` | No transaction statements in a migration, and no two migrations share a number or UTC-minute stamp (D4106). |
| `scripts/check-migration-declarations.mjs` | `test:guards` | Every table and column a migration declares is present in a freshly provisioned database. |
| `scripts/check-runtime-schema-declared.mjs` (D235) | `test:guards` | Runtime `CREATE … IF NOT EXISTS` cannot create, or take away, an object the fresh build lacks. |
| `scripts/check-runtime-ddl.mjs` (#4568) | `test:guards` | Runtime `ADD COLUMN` cannot grow without a ledger entry. |
| `scripts/check-schema-pair-drift.mjs` | `test:guards` | A table defined twice (migration and runtime) declares the same columns in both places. |
| `scripts/check-sqlite-tables.mjs`, `check-sqlite-columns.mjs`, `check-write-router-columns.mjs` | `test:guards` | The Worker reads and writes only tables and columns that something creates. |
| Clean-rebuild regressions, for example `cloudflare-worker/test/legal_template_research_schema_4591.test.mjs` | `test:drift` | A database built from `schema_baseline.sql` and the migrations alone has the declared objects, with their columns, defaults, unique constraints, foreign keys, index columns and view columns. Checking names alone is not enough. |
| `node scripts/migrate-d1.mjs --audit` | locally, and named in `DEPLOY.md` §2 | Shows which migration files are not safely re-runnable. |
| **Apply pending D1 migrations** (`migrate-d1.mjs --remote`) | the deploy job, before `wrangler deploy` | A migration that fails stops the deploy. The new Worker never starts against an old schema (`DEPLOY.md` §1.1, §4). |

**What these checks cannot see.** All of them compare the repository with
itself, or with a database the repository built. None of them reads
production. A table, index, view or column created on production from
outside the repository is invisible to them: by hand with `wrangler d1
execute`, from the dashboard console, or through the Cloudflare API. A green
pull request says nothing about that. Only the next check can.

---

## 2. After a deploy: drift detection

The `schema-drift` job ("repo can still rebuild production's schema") in
`cloudflare-worker-deploy.yml` runs `scripts/check-baseline-drift.mjs`. It
needs the deploy's Cloudflare credentials, so it cannot run on a pull request
or from a checkout without them. It runs:

- **after** the `deploy` job, and depends on it alone;
- on every push to `main`, so after every production deploy;
- without `continue-on-error`, so a disagreement turns the workflow red.

**What it compares.** It builds `schema_baseline.sql` plus every migration
above `BASELINE_CUTOFF` in SQLite, the engine D1 uses. It then reads
production's `sqlite_master` and reports, in both directions:

- object names (`table:`, `index:`, `view:`, `trigger:`) present on one side
  and absent from the other;
- on every table both sides have, columns and their declared types.

For each object that is on production but missing from the repository, it
prints production's DDL. That DDL is schema only, never rows. Exit code 1 is
a disagreement. Exit code 2 means it could not read production, usually
because of the token.

**What a red result means.** A database built fresh from the repository would
come up different from production. That affects:

- a branch provisioned from the baseline (`DEPLOY.md` §6);
- a hosted preview;
- a restore rehearsal.

**What a red result does not mean:**

- **It is not a gate.** The deploy had already finished when this job ran.
  The Worker that shipped is running, and nothing was held back. A red
  `schema-drift` is evidence about production, found after the fact. It
  did not protect that deployment and cannot have.
- **It is not proof of corruption or data loss.** It compares schemas, not
  rows.
- **It does not name a cause.** Out-of-band DDL, a runtime writer, a missing
  migration and a stale baseline all look the same here. The cause has to
  come from evidence (§3, step 3).

---

## 3. When `schema-drift` is red

Work through these steps in order. Do not re-run the job hoping it goes
green. Do not add an exception for an object, and do not switch the job off
or make it `continue-on-error`. A check that is silenced to get a green build
is how `schema.sql` drifted for four months unnoticed (D60).

1. **Read the job's output.** List each object and column it names, and which
   direction it is in: "on production, absent from the baseline", "in the
   baseline, absent from production", or a column difference. If the exit
   code is 2, the token or the account is the problem, not the schema. Fix
   that, then re-run once.

2. **Set a severity** with `INCIDENT_RESPONSE.md`. When in doubt, classify
   upward.

   | Finding | Default severity |
   | --- | --- |
   | Production has an extra object or column that no code reads, and users are unaffected. | **SEV-3.** A fresh environment would come up wrong. Open an issue the same day. |
   | The baseline has an object or column that production lacks, and the Worker reads it. | **SEV-2.** A live route can fail. Look first at the deploy job's migration step. |
   | An object of unknown origin holds personal data, or the DDL suggests access nobody granted. | **SEV-1.** Treat it as a possible breach. Report it privately as `SECURITY.md` describes, not in a public issue, and start the regulator clock in `INCIDENT_RESPONSE.md`. |

3. **Establish the cause from evidence, or say it is unknown.** Check:

   - The last green and first red `schema-drift` runs bound when it appeared.
     The commits merged in that window show whether any of them carried DDL.
   - `git log -S'<object name>' --all` and an issue/PR search show whether the
     repository ever named the object.
   - Read-only aggregate queries on production (row counts, first and last
     timestamps, never row contents) show when it was first written.

   D1 records no author for DDL, so "created outside the repository, by an
   unknown actor" is a valid conclusion. Record it as such rather than
   guessing.

4. **Write a schema-only reconciliation table in the issue.** One row per
   object, with these columns:

   - the object;
   - production's declaration (from the job output);
   - what in the repository declares it, or "nothing";
   - what code reads or writes it;
   - present-day status, as counts and timestamps only;
   - the proposed action.

   No row contents, no legal draft bodies and no personal data go in the
   issue, the PR, CI or the repository.

5. **Ask the owner whether each object is intended.** Give lettered options,
   as `AGENTS.md` describes. An agent does not decide that an object of
   unknown purpose belongs in the schema, and does not decide to remove one.

6. **Correct it.** There are three cases:

   - **Intended, missing from the repository.** Add one new append-only
     migration, `cloudflare-worker/sql/migrations/YYYYMMDDHHMM_<issue>_<slug>.sql`
     (D4106, D5398), that copies production's DDL with `CREATE … IF NOT EXISTS`.
     Keep every column, default, unique constraint, foreign key, index and
     view definition. Add no house-convention columns, because the file has
     to match production and be a no-op there. Then:
     - add the same definitions to `schema_baseline.sql`;
     - add a clean-rebuild regression that checks the constraints, not just
       the names.

     #4852 is the worked example.
   - **Not intended, present on production.** The owner exports the object
     and drops it, from their own workstation, after recording a Time Travel
     bookmark. The repository does not declare it, and the job stays red
     naming that one object until the drop is done. The owner-only checklist
     for `axal_group_entity_draft_facts` in #4591 is the template:
     bookmark, export outside the repository, confirm the counts and
     dependants, drop, verify, and roll back only by replaying the export.
   - **In the repository, absent from production.** First check whether the
     deploy's migration step failed or was skipped (`DEPLOY.md` §1.1, §4).
     The fix is to apply the pending migration through the runner,
     `d1-migrate.yml` in `apply` mode or the next deploy. Never hand-run its
     SQL, and never delete a ledger row (`DEPLOY.md` §4, "Two rules with no
     exceptions").

7. **Close the loop.** The issue stays open until the next deploy's
   `schema-drift` run is green, and links that run. A local rebuild passing
   is not the same evidence.

---

## 4. Schema changes stay rollback-safe

These rules are why a drift finding never forces a hurried rollback, and why
a rollback never needs a schema change.

- **Rollback reverts the Worker, never D1** (`DEPLOY.md` §3). The Worker one
  version back has to keep working against the migrated schema.
- **Expand, then contract.** Adding a table, a column with a default, an
  index or a view is safe to ship in one deploy, because older code ignores
  what it does not select. Removing or renaming something takes at least two
  deploys:
  1. ship code that no longer reads or writes the old shape;
  2. once no deployable version depends on it, ship the migration that
     removes it.
- **No destructive correction to make the drift job green.** A drop is the
  contract step of that sequence. It needs the owner's decision, an export,
  and a Time Travel bookmark taken first.
- **Migrations are forward-only and immutable once on `main`.** A correction
  is always a new file.

---

## 5. Provisioning and restore evidence

A clean local rebuild, from `schema_baseline.sql` plus the migrations in a
local SQLite, proves the committed artifacts are complete. It is **not** a
hosted provisioning run or a restore, and must not be reported as one.

The hosted rehearsal is `.github/workflows/schema-rehearsal.yml`. The owner
approved it on 2026-11-09. It runs only when someone starts it by hand
(Actions → *Schema rehearsal* → *Run workflow*), because each run creates two
databases. It runs `scripts/schema-rehearsal.mjs`, which:

1. creates an empty EU D1, `studioos-rehearsal-<run>-src`;
2. provisions it through `migrate-d1.mjs --rehearsal` itself: `--bootstrap`,
   then a plain run, then `--dry-run`, which must report nothing pending;
3. compares it with a fresh local build of the same files, using the
   functions `check-baseline-drift.mjs` holds production to;
4. seeds the #4566 synthetic fixtures (`synthetic.invalid` only) and checks
   foreign keys;
5. exports it, creates `studioos-rehearsal-<run>-dst`, and imports the export
   through the D4558 drill's chunked import (`dr-drill-split.mjs`);
6. compares the two: every object's SQL, every table's row count, and foreign
   keys;
7. deletes both databases, pass or fail.

It reads and writes only the two databases it created. Each is reached
through a generated config that declares that one database and nothing else.
The log, step summary and artifact hold counts and verdicts only.

`node scripts/schema-rehearsal.mjs --run <id> --local` runs the same steps
against wrangler's local D1, to prove the script before a hosted run. A local
run is never reported as a hosted one.

| Evidence | Status for #4591 |
| --- | --- |
| Clean local rebuild with constraint-level regression | Done: #4852 (`legal_template_research_schema_4591.test.mjs`). |
| Hosted provisioning from committed artifacts, with synthetic fixtures | The first `schema-rehearsal.yml` run, linked on #4591. |
| Restore rehearsal through the D4558 drill's import path | The same run. |

The rehearsal is not a Time Travel restore, and it reads no production data.
It shows that the repository can build and restore a database. It does not
show that production's own backup restores; that is the monthly
`dr-drill.yml` (`D1_RECOVERY.md` §5).

--- | --- |
| Clean local rebuild with constraint-level regression | Done: #4852 (`legal_template_research_schema_4591.test.mjs`). |
| Hosted preview provisioning from committed artifacts, with synthetic fixtures (`AGENT_EXECUTION_VALIDATION.md`, D4566) | **NOT RUN.** Waits on explicit owner approval. |
| Restore rehearsal through the existing recovery path (`D1_RECOVERY.md`, D4558) | **NOT RUN.** Waits on explicit owner approval. |

When the owner approves, use the existing preview isolation and recovery
procedures. Do not create a second process. Attach the run links to #4591.

---

## 6. The 2026-11-06 finding, as a worked example

- **What was found.** `schema-drift` passed at 14:19Z (run 42232642214) and
  failed at 18:16Z (run 42268890384). It named six production objects that
  nothing in the repository declared:
  - five `legal_template_*` objects;
  - `axal_group_entity_draft_facts`.
- **Cause.** The only commit merged in that window carried no DDL, and no
  branch, issue or PR named the objects. They were created on production from
  outside the repository. Who or what created them is **unknown**: D1 keeps
  no DDL author.
- **Owner's decision (option B).**
  - The five `legal_template_*` objects are intended. They were declared by
    migration `202611071051_declare_legal_template_research.sql` and in the
    baseline, with a clean-rebuild regression (#4852).
  - `axal_group_entity_draft_facts` is not intended. It holds personal data
    and is never declared in the repository.
- **State after deploy run 42384166664.** `schema-drift` names exactly one
  object, `table:axal_group_entity_draft_facts`. It stays red, as it should,
  until the owner completes the export-and-drop checklist in #4591.
