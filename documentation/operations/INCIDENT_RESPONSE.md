# Axal StudioOS — Incident Response Playbook

Task #5 (IE). This document is the single source of truth for how the
StudioOS team responds to incidents. It is required reading for every
new on-call engineer before their first shift.

> **TL;DR if you are paged right now:** open the [first-10-minute
> checklist](#first-10-minute-checklist), then notify the team in
> `#incidents` on Slack, then file the incident in the admin console
> (`/admin/status`) so customers see a status banner.

---

## Severity Definitions

| Severity | Definition | Examples | Response time | On-call expectations |
|----------|------------|----------|---------------|----------------------|
| **SEV-1** | Site fully down OR customer data loss / leak OR regulator-notifiable event. | D1 corruption, R2 KYC bucket public, JWT secret leaked, GDPR data breach. | **5 min** acknowledge, **1 h** mitigation. | All hands; primary + backup on-call paged. CEO notified. |
| **SEV-2** | Significant feature broken for >25% of users OR financial / contract data wrong but recoverable. | Login broken for one role, deck export 500ing, captable math wrong, Stripe webhook stuck. | **15 min** acknowledge, **4 h** mitigation. | Primary on-call leads; backup as escalation. |
| **SEV-3** | Partial degradation; workaround exists. | One integration provider down, slow query backing dashboards, intermittent 5xx <1%. | **1 h** acknowledge, **next business day** fix. | Primary on-call; handle async. |
| **SEV-4** | Cosmetic / minor; no user impact. | Typo in email, missing tooltip, slow but functional page. | Next business day. | Normal backlog. |

Severity is set by the primary on-call. **When in doubt, classify
upward.** A SEV-2 downgraded to SEV-3 mid-incident is fine; a SEV-3 that
turns out to be SEV-1 will surprise everyone and miss the GDPR clock.

---

## On-Call Rotation

| Week | Primary on-call | Backup |
|------|-----------------|--------|
| Wk N+0 | _operator: populate_ | _operator: populate_ |
| Wk N+1 | _operator: populate_ | _operator: populate_ |
| Wk N+2 | _operator: populate_ | _operator: populate_ |
| Wk N+3 | _operator: populate_ | _operator: populate_ |

- Rotation length: **7 days**, Mon 09:00 UTC handoff.
- Handoff ceremony: 15-min sync, primary briefs backup on any open
  incidents and unresolved alert tuning.
- On-call carries: laptop reachable within 15 min, phone on loud, no
  international travel without arranging coverage.
- Pager backend: **PagerDuty** (`team-studioos-oncall`). Backup channel:
  Slack `#incidents-page` (auto-mention `@oncall`).

---

## Internal Comms

- **Primary channel:** Slack `#incidents`. One thread per incident.
- **Page channel:** Slack `#incidents-page` (for SEV-1/SEV-2 paging
  only; do not chat here).
- **War-room voice:** Google Meet `meet.google.com/axal-incidents` (a
  permanent room; join only during an active incident).
- **Customer status page:** `https://axal.vc/status` — driven from the
  `status_incidents` table (Task #4 ID). Update at least every 30 min
  during a SEV-1 / SEV-2.

Whoever takes the first page becomes **Incident Commander** until they
explicitly hand it over in `#incidents`.

---

## First 10-Minute Checklist

Run this top to bottom. Do not skip steps even if you "already know"
what the cause is.

1. **Acknowledge the page** (PagerDuty button or `@oncall ack` in
   `#incidents-page`). Starts the SLA clock.
2. **Declare in `#incidents`:**
   `:rotating_light: SEV-?  by @me  starting now. Investigating <symptom>.`
3. **Open a war-room thread.** All updates go there — no DMs.
4. **Triage scope:**
   - Run `curl https://axal.vc/api/health` — what bindings are missing?
   - Open `/status` — is the public page already red?
   - Open Cloudflare dashboard → Workers → studioos → Logs.
   - Open Cloudflare dashboard → D1 → studioos-db → Metrics.
5. **Freeze deploys.** Comment "🛑 deploy freeze" in `#engineering`.
   No merges until the IC says otherwise.
6. **Mitigation > diagnosis.** If a deploy in the last 4 h likely
   caused it, **roll back first**, investigate second.
   ```bash
   # Roll back to the previous worker version
   wrangler rollback --message "SEV-? rollback"
   ```
7. **File the customer-facing incident** at `/admin/status` (or via
   `POST /api/public/status/incidents` if the UI is itself broken).
8. **Confirm the page banner is live** at `https://axal.vc/status`.
9. **Set a 30-min checkpoint timer.** Post a status update in
   `#incidents` even if nothing has changed.
10. **Decide regulator clock.** If KYC/PII/financial data is potentially
    exposed, start the [Regulator Timelines](#regulator-notification-timelines)
    process immediately — the 72-hour GDPR clock starts at *awareness*,
    not at *confirmation*.

---

## Customer Communication Templates

### Status update (during active incident)

> **Investigating — <feature>**
> _Posted YYYY-MM-DD HH:MM UTC_
>
> We're investigating reports that <feature> is not working as expected
> for some users. Login, billing, and the rest of StudioOS remain
> available. We'll post our next update by HH:MM UTC.

### Identified

> **Identified — <feature>**
> _Posted YYYY-MM-DD HH:MM UTC_
>
> We've identified the cause of the <feature> outage as <one-sentence
> explanation, no jargon, no blame>. We're working on a fix and will
> update again by HH:MM UTC.

### Resolved

> **Resolved — <feature>**
> _Posted YYYY-MM-DD HH:MM UTC_
>
> <Feature> is fully restored as of HH:MM UTC. The incident lasted
> roughly NN minutes. A full post-mortem will be published within 5
> business days at <link>.

### Post-mortem summary (5 business days later)

Use [`docs/POSTMORTEM_TEMPLATE.md`](docs/POSTMORTEM_TEMPLATE.md). Post
the summary to the changelog (`/changelog`) and email affected
customers.

---

## Regulator Notification Timelines

| Regulator / framework | Trigger | Clock starts at | Deadline | Owner |
|-----------------------|---------|-----------------|----------|-------|
| **GDPR Art. 33** (EU SAs) | Personal data breach likely to result in risk | Awareness | **72 hours** | DPO + IC |
| **GDPR Art. 34** (data subjects) | Breach likely to result in *high* risk | Awareness | "Without undue delay" (≤72h is the safe target) | DPO + Comms |
| **UK GDPR (ICO)** | Same as GDPR Art. 33 | Awareness | **72 hours** | DPO |
| **CCPA / CPRA (CA AG)** | Breach of CA resident PII (>500 residents) | Discovery | "In the most expedient time possible" | DPO + Legal |
| **SEC Reg S-P 248.30(a)(3)** | Breach of customer financial info | Discovery | **30 days** to notify affected customers | CFO + Legal |
| **SEC Item 1.05 8-K** | Material cybersecurity incident (if/when Axal is a registrant) | Determination of materiality | **4 business days** | Legal + CFO |
| **HIPAA** | N/A (we do not handle PHI) | — | — | — |
| **Cloudflare AUP / TOS** | Suspected abuse / TOS violation | Discovery | "Promptly" | Eng IC |
| **Stripe** (financial data) | Cardholder data exposure | Discovery | **24 hours** | Finance |

**Default rule of thumb:** if any of the above might apply, call the
DPO + General Counsel within the first hour. Do not wait for the IC to
finish technical mitigation.

---

## Backups & Recovery

| What | Where | Schedule | Retention | Restore script |
|------|-------|----------|-----------|----------------|
| D1 database | R2 `studioos-backups/d1/<database>/backup-YYYY-MM-DD.sql` (flat `d1/backup-…` before 2026-09-15; `scripts/dr-drill.sh` reads both) | Daily 02:10 UTC (GH Actions) | 365 days, object-lock compliance mode | [`scripts/restore-d1.sh`](scripts/restore-d1.sh), into an empty EU database you create (`D1_RECOVERY.md` §3) |
| KV (`TOKENS`) | R2 `studioos-backups/kv/TOKENS/YYYY-MM-DD.jsonl` | Daily 02:00 UTC (worker cron) | 365 days | manual `wrangler kv:bulk put` |
| R2 contracts | Approved record classes only: append-only snapshots under `studioos-backups/files-recovery/`; optional age-encrypted second copy in the owner-provisioned outside-account bucket (D6653) | Daily 02:30 UTC, gated off until counsel/prefix approval and configuration | Seven years only where the class has a recorded legal retention basis | Primary synthetic drill: `python3 scripts/file-recovery-drill.py`; monthly outside-preview synthetic restore via `file-recovery-independent.py drill`; hourly `[alert] file recovery backup unhealthy` checks failure/freshness. Live restore awaits #6654 suppression-ledger integration |
| R2 KYC | Only counsel-approved record prefixes from #6650; unclassified personal files are excluded | Same gated snapshot job; no live protection claimed before activation | Class-specific legal basis required before seven-year lock | Same verified snapshot path and suppression requirement; no dashboard version restore exists |
| Worker source | Git (origin/main) | Per-commit | Indefinite | `git revert` + `wrangler deploy` |
| R2 publications | `studioos-publications` | Recovery schedule not recorded | Not recorded; no locked-copy approval | No verified recovery path recorded; see [R2 inventory](R2_INVENTORY.json) and #6428 handoff |
| R2 company logos | `studioos-company-logos` | Recovery schedule not recorded | Not recorded | Re-upload an available source asset; no archived restore path recorded; see [R2 inventory](R2_INVENTORY.json) |
| R2 archive logs | `studioos-logs` | Tail-consumer writes; backup schedule not recorded | 2555 days in source configuration; live lifecycle unverified | No independent restore path recorded; see [R2 inventory](R2_INVENTORY.json) |
| Preview file objects | `studioos-files-preview` | Not recorded | Not recorded | Synthetic preview data only; no production recovery claim; see [R2 inventory](R2_INVENTORY.json) |
| Preview publication objects | `studioos-publications-preview` | Not recorded | Not recorded | Synthetic preview data only; see [R2 inventory](R2_INVENTORY.json) |
| Preview logo objects | `studioos-company-logos-preview` | Not recorded | Not recorded | Re-upload synthetic source assets; see [R2 inventory](R2_INVENTORY.json) |

**Operator one-time setup (NOT in code):**

1. Create R2 bucket `studioos-backups` (private, no public access).
2. Enable **object-lock** in **compliance mode** with a default retention
   of **365 days**. Cloudflare dashboard → R2 → bucket → Settings →
   Object Lock.
3. Add a **lifecycle rule**: transition to **Standard-IA** after **30
   days**, delete after **365 days**.
4. **R2 has no object versioning or noncurrent-version restore.** Before
   enabling file snapshots, obtain #6650's prefix registry and counsel's legal
   retention basis for each record class (#6652, decision A). Registry schema:
   `{"version":1,"classes":[{"prefix":"approved-record-prefix/","bucket":"studioos-files","class":"record","locked_copy":"yes","retention_basis":"approved-reference","retention_days":2557}]}`.
   There are no default live prefixes. Keep personal files without a recorded
   basis out of the locked archive. #6651 supplies write-once record keys;
   this scheduled copy cannot recover a revision overwritten or deleted before
   it was captured. RPO is at most the last verified successful snapshot, not
   continuous versioning. Unobserved intermediate writes are not recoverable.
5. After counsel approval, configure an **R2 bucket lock** covering
   `files-recovery/` in `studioos-backups` for **2557 days**, at least seven
   calendar years. This is a prefix lock, not S3 versioning or a claimed
   compliance-mode setting. Inspect with `wrangler r2 bucket lock list
   studioos-backups`; a 365-day D1/KV rule does not satisfy file retention.
   The script checks the actual lock via Cloudflare's control-plane API and
   refuses short, missing, indefinite or longer overlapping retention rules.
   Provide separate private S3 credentials: a read-only source key for
   `studioos-files` and an archive read/write destination key for
   `studioos-backups`. GitHub secrets are `FILE_RECOVERY_SOURCE_ACCESS_KEY_ID`,
   `FILE_RECOVERY_SOURCE_SECRET_ACCESS_KEY`,
   `FILE_RECOVERY_DESTINATION_ACCESS_KEY_ID` and
   `FILE_RECOVERY_DESTINATION_SECRET_ACCESS_KEY`.
   Set `FILE_RECOVERY_REGISTRY` to the reviewed registry file path and enable
   `FILE_RECOVERY_ENABLED=true` only after the operator checks and counsel
   approval. The workflow stays disabled otherwise. No live configuration has
   been changed by this implementation. Live restore applies the D6654 suppression
   ledger first: `python3 scripts/file-recovery.py restore --run-id <snapshot>
   --target <fresh private dir> --d1-database-id <id>` reads every
   `record_suppression_ledger` row through the D1 API before it reads any archive
   object, skips every erased key and refuses a request for one. The synthetic
   drill (`python3 scripts/file-recovery-drill.py`, hosted on preview as the
   `suppression-drill` dispatch mode) proves an object erased after its backup is
   not restored. D6653 adds
   the optional independent copy and the missed-run alert, configured below.
6. Add GitHub Actions secrets:
   - `CLOUDFLARE_API_TOKEN` (D1:edit + R2:read+write + Workers:edit)
   - `CLOUDFLARE_ACCOUNT_ID`
   - `PAGER_WEBHOOK_URL` (Slack/PagerDuty webhook; optional but
     strongly recommended for the DR drill to page on failure).

### Independent file copy and heartbeat (D6653)

Provision the independent bucket and its retention policy outside the production
account, with the same approved record-class/legal-basis limits. Values belong
only in Actions settings. No outside bucket, credential or enable flag is
created by the source change. Keep both file enable flags off until the owner
has verified separation, retention and access policy.

- Production copy: set `FILE_DR_SECOND_COPY_ENABLED=true` only after approval.
  Reuse D1's non-secret naming pattern: `DR_COPY_ENDPOINT`, `DR_COPY_BUCKET`,
  optional `DR_COPY_REGION` (defaults to `auto`), and `DR_AGE_RECIPIENT` (age
  public recipient). Keep the matching private key offline. Provide separate
  `FILE_DR_COPY_ACCESS_KEY_ID` / `FILE_DR_COPY_SECRET_ACCESS_KEY`, restricted
  to conditional writes and metadata HEAD on this file prefix; no content GET,
  listing or deletion. A same-account R2 endpoint is refused. For a different
  S3-compatible provider, the owner must verify account ownership and set
  `FILE_DR_EXTERNAL_ACCOUNT_CONFIRMED=true`; a URL cannot prove that ownership.
- Primary snapshot bytes and manifest are briefly staged in a private runner
  directory, encrypted before leaving that runner, and removed by an always-run
  cleanup step. No plaintext bundle or manifest is uploaded as an Actions
  artifact. A copy completion descriptor is written only after every copied
  object and encrypted manifest has verified checksum/size metadata. A retry
  can accept an existing object only for the same plaintext digest.
- Each run writes an immutable `files-recovery-health/runs/<run>-<attempt>.json`
  and updates `heartbeat-files.json` in the primary backup bucket, outside the
  locked record prefix. Fields are time, outcome, counts, newest source-key
  modification time (null with an explicit reason when unknown), run identity
  and independent-copy status; never member file keys or contents. Failure
  records do not invent zero counts. A partial or enabled-but-unconfigured
  outside copy is a failure. A deliberately disabled optional copy emits a
  clear notice and records `not_configured`.
- Provide `FILE_RECOVERY_HEALTH_ACCESS_KEY_ID` /
  `FILE_RECOVERY_HEALTH_SECRET_ACCESS_KEY` as a separate metadata-only reader
  for the heartbeat keys. The existing hourly GitHub alert path reads that
  marker and the latest completed snapshot workflow. A reported failure or
  heartbeat older than two daily intervals (48 hours) opens one
  `[alert] file recovery backup unhealthy` episode. Repeated unhealthy checks
  do not spam; verified recovery closes the episode. Missing/invalid markers
  raise; an access/network error fails the observer without inferring recovery.
  A failed workflow can still raise when its heartbeat could not be written.

**Synthetic outside-preview proof and monthly drill:** provision a separate
outside-account **preview** bucket, then set `FILE_DR_PREVIEW_ENABLED=true`,
`FILE_DR_PREVIEW_ENDPOINT`, `FILE_DR_PREVIEW_BUCKET`, and optional
`FILE_DR_PREVIEW_REGION`. Use separate preview writer secrets
`FILE_DR_PREVIEW_COPY_ACCESS_KEY_ID` /
`FILE_DR_PREVIEW_COPY_SECRET_ACCESS_KEY`, and preview read-only secrets
`FILE_DR_PREVIEW_RESTORE_ACCESS_KEY_ID` /
`FILE_DR_PREVIEW_RESTORE_SECRET_ACCESS_KEY`. These never grant production
source/archive access. The monthly DR workflow runs the file drill with those
preview settings; the existing D1 drill is unchanged. For acceptance, dispatch
`file-recovery.yml` with `mode=synthetic-proof` on the reviewed branch.

The proof generates an ephemeral age key, copies one fresh synthetic record,
stores a per-run synthetic heartbeat outside the production account, removes
its local source, and restores/decrypts/checks only that fixture from the
outside copy. It cannot select a live member record and never advances the
live backup heartbeat. Retain the run link and its redacted counts/heartbeat
receipt. This is transport recovery evidence, not evidence that live record
classes have been enabled. The D6654 suppression drill is separate: the
`suppression-drill` dispatch mode (`FILE_RECOVERY_PREVIEW_DRILL_ENABLED=true`,
`FILE_RECOVERY_PREVIEW_D1_ID` and a preview-only D1 token in
`FILE_RECOVERY_PREVIEW_D1_TOKEN`) writes one synthetic ledger row to the preview
D1 and shows the restore skipping that object; it refuses the production
database.

| Hosted file proof | Outcome | Heartbeat / restore evidence |
|---|---|---|
| [s39 synthetic preview attempt, 2026-11-18](https://github.com/AxalNetwork/StudioOS/actions/runs/44409361430) | Skipped: preview enablement gate did not admit the job | None; owner preview configuration and a verified run remain required. Configuration metadata was inaccessible (403), so presence is unknown. |

**File recovery verification (#6428):** the synthetic-only drill writes and
checks archive bytes, removes its synthetic source, restores one object and
suppresses another. It does not read production files or establish live backup
coverage. New snapshots use unique immutable keys, condition source GETs on
listed ETags, verify each copied SHA-256 and publish a manifest only after all
copies verify. A failed run cannot masquerade as a completed snapshot. The
archive is private; object contents, keys and credentials stay out of logs.
Operator evidence, approved prefixes and counsel retention decisions remain
prerequisites; this task does not change D1/KV backup behavior.

---

## RTO & RPO Commitments

| Metric | Target | How we hit it |
|--------|--------|---------------|
| **Recovery Time Objective (RTO)** | **4 hours** | Worker rollback is sub-minute. For data, `wrangler d1 time-travel restore` acts on the live database in place — no provisioning step. The backup-file path needs a database created first: **there is no standing preview DB**, contrary to what this row claimed until D167. Create an empty one with `--jurisdiction eu`, then run `scripts/restore-d1.sh <backup> <target>` (`D1_RECOVERY.md` §3). Since D5337 the script runs the monthly drill's own code: it checks the backup against its manifest, imports it in chunks, and compares every table's row count. It also restores from the independent encrypted copy (`DR_SOURCE=independent`). It refuses a target that is production, is not EU-resident or is not empty. The drill's marker records how long that path took (`rto_met`). |
| **Recovery Point Objective (RPO)** | **point-in-time, within 30 days** | **Corrected in D167.** This row read "24 hours (daily backups)", which is the *export cadence*, not the recovery point. D1 Time Travel restores to an instant within the last 30 days, so for damage inside that window the recovery point is the instant you choose. **24 hours is the fallback**, and it applies only where Time Travel cannot: damage older than 30 days, or a database that is gone rather than wrong. Since D4558 (the owner's answer, 2026-11-07) that 24 h is measured from the export's real start, the monthly drill records it against the target with the 4 h RTO, and an independent encrypted copy outside the production account carries the same recovery points (`D1_RECOVERY.md` §7). |
| **Daily export → R2** | 02:10 UTC | `backup-d1.yml` runs `wrangler d1 export` into `studioos-backups`, keyed per database. The monthly DR drill imports the latest one. This is the fallback path above, not the primary one. |
| **WAL streaming** (aspirational) | Not committed | D1 does not expose WAL streaming to customers. Time Travel is the point-in-time capability this row was waiting on, so the gap it describes is narrower than it was — but it is a restore, not a stream, and nothing here replicates continuously. |

**The recovery runbook is [`D1_RECOVERY.md`](D1_RECOVERY.md)**, which also names
the one hazard these targets do not: production is EU-resident account-side,
that fact appears in no config file, and a restore that *creates* a database
without `--jurisdiction eu` silently lands the data outside the EU.

A SEV-1 that exceeds the **4-hour RTO** triggers an automatic
post-mortem with the RTO breach noted as an action item.

---

## Tabletop Exercise Schedule

The team runs a **tabletop drill** quarterly to validate this playbook
against a realistic scenario. Each drill is 60-90 min, run by a
non-on-call team member, scored on RTO/RPO compliance and comms
quality. Findings feed back into this doc.

| Quarter | Scenario theme | Owner |
|---------|----------------|-------|
| Q1 | Database corruption — restore from backup, verify smoke suite green within RTO. | Eng lead |
| Q2 | Credential leak (JWT_SECRET or similar) — rotate, re-issue, customer comms. | Security lead |
| Q3 | Regulator-notifiable PII exposure — full GDPR 72h drill including DPO comms. | DPO |
| Q4 | Vendor outage (Cloudflare degraded) — comms templates, customer triage. | Eng lead |

The **monthly automated DR drill** (`.github/workflows/dr-drill.yml`)
runs on the 1st of every month and is independent of the tabletop
schedule — it validates the restore path, not the human process.

---

## Post-Mortem

Required within **5 business days** of any SEV-1 or SEV-2. Use
[`docs/POSTMORTEM_TEMPLATE.md`](docs/POSTMORTEM_TEMPLATE.md). Blameless.
Published to `/changelog` once approved by the IC and reviewed by one
non-involved engineer.

---

## Change Log

- **2026-05-20** — Initial playbook (Task #5 IE).

R2 retention reference: [Cloudflare bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).
