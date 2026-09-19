# D1 recovery

`DEPLOY.md` §3 ends on a sentence this runbook exists to finish:

> **Rollback reverts the worker. It does not revert D1.**

So when the thing that is wrong is *data* — a migration that destroyed rows, a
bad bulk write, a deletion nobody meant — rolling the Worker back changes
nothing. This is what to do instead.

**Read the decision first. The two paths are not interchangeable, and the
cheap one is also the safe one.**

---

## 1. Which path

| | **Time Travel** | **The nightly R2 export** |
| --- | --- | --- |
| what it does | restores `studioos-db` **in place** to a point in time | imports a `.sql` file into **a different database** |
| how far back | **30 days**, to any instant | to 02:10 UTC on a backed-up day |
| how much is lost | whatever happened after the chosen instant | **up to 24 hours** |
| creates a database? | **no** | **yes — and see §4** |
| EU residency | **preserved by construction** | **lost unless you pass the flag** |
| reversible? | yes — the pre-restore state is itself a point in time | n/a |

**Use Time Travel unless you cannot.** It is faster, loses less, needs no new
resource, and cannot silently move the data out of the EU. The export path is
for the two cases Time Travel does not cover: damage older than 30 days, and a
database that is gone rather than wrong.

---

## 2. Time Travel

Verified against the wrangler on this repo's lockfile (**4.131.0**) by reading
its own `--help`, not from memory:

```
wrangler d1 time-travel info <database>      # where can I go back to
wrangler d1 time-travel restore <database>   # go there
    --bookmark   <bookmark>
    --timestamp  <unix seconds | RFC3339>    # within the last 30 days
    --json
```

**`<database>` is positional and it is the database being restored.** There is
no target argument: the command acts on that database, in place, remotely.
That single fact is why this path keeps the EU jurisdiction — nothing is
created, so nothing has to be re-requested.

### Do it

1. **Fix the cause first.** A restore against a Worker still writing the bad
   data buys minutes. Roll the Worker back (`DEPLOY.md` §3) or disable the
   path, *then* restore.

2. **Find the instant.** Prefer the last known-good moment over a round number:

   ```
   npx wrangler d1 time-travel info studioos-db --json
   npx wrangler d1 time-travel info studioos-db --timestamp 2026-09-19T11:20:00.000Z --json
   ```

3. **Write down the bookmark you are leaving.** The state you are about to
   discard is itself a point in time, so a restore is undoable — but only if
   you recorded where you were. Take the bookmark for *now* before restoring.

4. **Restore.**

   ```
   npx wrangler d1 time-travel restore studioos-db --timestamp <instant>
   ```

5. **Check the ledger, not just the rows.** A restore moves the schema back
   too. If it lands before a migration that has since been applied, the Worker
   is now ahead of its schema — the failure mode `CLAUDE.md` warns about, from
   the other direction.

   ```
   npx wrangler d1 execute studioos-db --remote --command \
     "SELECT filename, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 5;"
   ```

   Re-run the deploy's migration step if the ledger is short. Migrations are
   forward-only and additive, so re-applying is the normal path.

6. **Smoke it**, then write the timeframe into `INCIDENT_RESPONSE.md`.

---

## 3. The nightly export

`backup-d1.yml` runs `wrangler d1 export` at **02:10 UTC daily** and puts the
file in R2 under `studioos-backups`, keyed per database. `restore-d1.sh` walks
an operator through importing one.

**Two things about that script an operator must know before running it.**

**It does not truncate.** Its own header says so, and it is not a nicety: the
import fails at the first duplicate primary key, so the target has to be empty.
There is no `--force`, and adding one would be worse than the failure.

**Its default target does not exist.** The script defaults to
`studioos-db-preview`, and that database is **not in the account** — the
account holds six D1 databases and it is not one of them. `wrangler.toml` still
carries `database_id = "REPLACE_WITH_PREVIEW_D1_ID"` for it. So the default is
not a safe default; it is a database you must create first, which brings you
to §4.

`INCIDENT_RESPONSE.md`'s RTO row promises *"a one-liner against a
freshly-provisioned preview DB"*. Nothing provisions one. Under time pressure,
create it deliberately — and with the flag.

---

## 4. The hazard: a restore can silently leave the EU

**Production is EU-resident, and that fact lives nowhere in this repository.**
Read from the account: `studioos-db` reports `jurisdiction: eu`. Every other
database in the account reports `null`. `wrangler.toml` contains no
`jurisdiction` key at all, and neither does `restore-d1.sh`.

A jurisdiction is fixed **when a database is created** and cannot be changed
afterwards. So:

```
npx wrangler d1 create studioos-db-restore                      # NOT EU-resident
npx wrangler d1 create studioos-db-restore --jurisdiction eu    # correct
```

Restore into the first and you have recovered the data into the wrong
jurisdiction, with no way to move it — you would have to create a third
database and import again.

**The repo already knows how to do this and does not do it here.**
`branch-provision.yml` passes `--jurisdiction` when it creates a branch
database. `restore-d1.sh` never creates a database, so the flag has nowhere to
live in it — which is exactly why the operator has to supply it, and why it is
written down here.

**Verify after creating, before importing:**

```
npx wrangler d1 info studioos-db-restore --json    # expect "jurisdiction": "eu"
```

---

## 5. What the monthly drill does and does not prove

`dr-drill.yml` runs `dr-drill.sh` on the 1st at 06:00 UTC: it creates a
throwaway database, imports the latest backup, counts rows and tables, and
deletes it. It **re-implements** the import rather than calling
`restore-d1.sh`, so the two paths can drift; the drill is the one that runs.

It proves the backup is present, recent, and importable — a real and useful
thing. It does **not** prove the restore lands in the right jurisdiction, and
until D167 it created its throwaway database with no `--jurisdiction`, so it
was quietly exercising the wrong shape every month. The create now carries the
flag, which makes the drill rehearse what a real recovery must do.

It also does not exercise Time Travel at all — Time Travel needs no backup
file and cannot be drilled against a throwaway database, because it only ever
acts on the real one.

---

## 6. Related

- `DEPLOY.md` §3 — the Worker rollback this runbook is the other half of.
- `DEPLOY.md` §4 — a migration that fails mid-deploy, which is a different
  problem from data that is wrong.
- `INCIDENT_RESPONSE.md` — severity, comms, and the RTO/RPO commitments this
  runbook corrects.
