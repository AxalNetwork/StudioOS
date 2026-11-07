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

`dr-drill.yml` runs `dr-drill.sh` on the 1st at 06:00 UTC: it reads the latest
backup's key from `heartbeat-d1.json`, creates a throwaway EU database, imports
the backup, counts rows and tables, and deletes the database, on failure too.
Every run writes `drill-d1.json` to the backups bucket, pass or fail, and HQ's
Security page reads it (D263). It **re-implements** the import rather than
calling `restore-d1.sh`, so the two paths can drift; the drill is the one that
runs.

**Until D263 it had never reached the import.** The four runs from June to
September 2026 failed before it: two on unset secrets, one at the preflight,
one with no runner. A run with the secrets set would have failed too, on
`wrangler r2 object list`, which wrangler 4.131 does not have. Read the
Security page, or `drill-d1.json`, for what the last run actually did.

When a run passes, it proves the backup is present, recent and importable. It
does **not** prove the restore lands in the right jurisdiction, and
until D167 it created its throwaway database with no `--jurisdiction`, so it
was quietly exercising the wrong shape every month. The create now carries the
flag, which makes the drill rehearse what a real recovery must do.

**No run has passed yet.** The 2026-11-01 run imported 274 of 276 chunks and
failed at chunk 275 with `SQLITE_CONSTRAINT_FOREIGNKEY` (run 41307767798).

**Since D4558 the drill restores only a backup its manifest vouches for.**
`backup-d1.yml` writes `<key minus .sql>.manifest.json` beside each export,
holding sha256, size, the export's start time, every table's row count and the
last migration. The drill checks the backup against it before creating any
database, and compares every restored table's row count after. A missing or
stale manifest, a mismatch, or a migration the checkout does not know ends the
drill red, with the reason in `drill-d1.json`. A failed chunk now names the
tables it writes. The marker records the recovery point, its age and the
drill's duration: the RPO and RTO the drill actually measured.

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

---

## 7. The independent encrypted copy (D4558)

The owner's answers on #4558 (2026-11-07, A on Q1–Q4) set the targets and the
copy:

- **RPO 24 h**, from the export's real start. **RTO 4 h** for an export
  restore. The drill's marker records both targets, `rpo_met` and `rto_met`,
  and a passing run that misses one pages. A backup more than 30 h old fails
  the drill: the 24 h cadence plus GitHub's scheduling delay.
- **The copy:** an S3-compatible bucket with object lock in compliance mode,
  in an account **outside the production Cloudflare account**.
  `backup-d1.yml` writes to it with a write-only key.
- **The key:** each export is encrypted on the runner with `age` to the
  owner's **public** key. The private key never reaches CI.
- **Retention:** 35 daily and 12 monthly recovery points.

Until the owner finishes step 1 below, `DR_SECOND_COPY_ENABLED` is unset and
nothing is copied.

### 7.1 Owner: provisioning, once

1. **Open the account.** Create a storage account that production's Cloudflare
   account and its API tokens cannot administer: a separate Cloudflare
   account's R2, or another S3-compatible provider. Before choosing, check in
   that provider's current documentation that it supports object lock in
   compliance mode and conditional writes (`If-None-Match`).
2. **Create the bucket** with versioning and object lock on, in compliance
   mode, with a default retention of **35 days**. Add lifecycle rules:
   - expire `d1/*/daily/` objects after 35 days;
   - keep `d1/*/monthly/` 365 days, by setting a 365-day retention on that
     prefix or a rule the provider offers for it.
3. **Make a write-only key** that can only put objects and read their metadata
   (`PutObject`, `HeadObject`) in that bucket. It must not be able to delete,
   list or read object content. Store it as the repository secrets
   `DR_COPY_ACCESS_KEY_ID` and `DR_COPY_SECRET_ACCESS_KEY`.
4. **Make the owner's key, offline:** `age-keygen -o d1-recovery.key`.
   - Keep the file on two offline media in two places, never in the
     repository, a CI secret or the copy's bucket.
   - Put its **public** line (`age1…`) in the repository variable
     `DR_AGE_RECIPIENT`.
5. **Set the repository variables** `DR_COPY_ENDPOINT` (an `https://` origin),
   `DR_COPY_BUCKET` and, if needed, `DR_COPY_REGION`. Then set
   `DR_SECOND_COPY_ENABLED` to `true`.

   From the next run, `backup-d1.yml` puts each export under
   `d1/<db>/daily/<recovery point>/` (`backup.sql.age` and `manifest.json`),
   and the month's first export also under `d1/<db>/monthly/<YYYY-MM>/`. It
   writes `heartbeat-d1-independent.json` to the primary bucket. The monthly
   drill then fails if that heartbeat is missing or older than 30 h.

### 7.2 Owner: rotating or recovering the key

- **Rotate:** make a new key as in 7.1 step 4 and replace `DR_AGE_RECIPIENT`.
  Keep the old private key for as long as copies made with it are retained,
  which is 12 months. Each copy manifest names the recipient it was encrypted
  to.
- **Lost key:** copies made to it cannot be read by anyone, Axal included.
  Make a new key at once. The primary R2 backups and Time Travel are
  unaffected.

### 7.3 Owner: the drill of the independent copy

Run it from a checkout, with the private key on a local disk only for the
run:

```bash
DR_SOURCE=independent \
DR_INDEPENDENT_POINT=d1/studioos-db/daily/2026-11-07T08-12-00Z \
DR_AGE_IDENTITY_FILE=/path/to/d1-recovery.key \
DR_COPY_ENDPOINT=https://… DR_COPY_BUCKET=… \
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
bash scripts/dr-drill.sh
```

- **Credentials:** the `AWS_*` key is a **read** key for that bucket, made for
  the drill and revoked after it. The write-only CI key cannot read.
- **What the drill does:**
  - checks the ciphertext against its manifest;
  - decrypts it;
  - verifies the export against its manifest;
  - restores it into a throwaway EU database, compares every table's row
    count, and deletes the database;
  - writes `drill-d1.json` with `copy: "independent"`.
- **A failure is named in the marker's `reason`:** `decrypt_failed` (the wrong
  key), `ciphertext_mismatch` or `key_missing`. It always happens before any
  database is created.
- The script never prints or copies the key file. Delete it from the disk
  afterwards.
