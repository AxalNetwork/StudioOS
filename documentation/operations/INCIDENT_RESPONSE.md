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
| D1 database | R2 `studioos-backups/d1/backup-YYYY-MM-DD.sql` | Daily 02:10 UTC (GH Actions) | 365 days, object-lock compliance mode | [`scripts/restore-d1.sh`](scripts/restore-d1.sh) |
| KV (`TOKENS`) | R2 `studioos-backups/kv/TOKENS/YYYY-MM-DD.jsonl` | Daily 02:00 UTC (worker cron) | 365 days | manual `wrangler kv:bulk put` |
| R2 contracts | R2 versioning on `studioos-files` | Continuous (versioning) | 7 years (previous versions) | dashboard restore |
| R2 KYC | R2 versioning on `studioos-files` (`kyc/` prefix) | Continuous (versioning) | 7 years (previous versions) | dashboard restore |
| Worker source | Git (origin/main) | Per-commit | Indefinite | `git revert` + `wrangler deploy` |

**Operator one-time setup (NOT in code):**

1. Create R2 bucket `studioos-backups` (private, no public access).
2. Enable **object-lock** in **compliance mode** with a default retention
   of **365 days**. Cloudflare dashboard → R2 → bucket → Settings →
   Object Lock.
3. Add a **lifecycle rule**: transition to **Standard-IA** after **30
   days**, delete after **365 days**.
4. Enable **versioning** on the contracts bucket (`studioos-files`) and
   set a **7-year retention** on noncurrent versions.
5. Add the same versioning + 7-year retention to the KYC sub-prefix
   (currently sharing `studioos-files`; if it's split out later, repeat
   the steps on the new bucket).
6. Add GitHub Actions secrets:
   - `CLOUDFLARE_API_TOKEN` (D1:edit + R2:read+write + Workers:edit)
   - `CLOUDFLARE_ACCOUNT_ID`
   - `PAGER_WEBHOOK_URL` (Slack/PagerDuty webhook; optional but
     strongly recommended for the DR drill to page on failure).

---

## RTO & RPO Commitments

| Metric | Target | How we hit it |
|--------|--------|---------------|
| **Recovery Time Objective (RTO)** | **4 hours** | Single-region R2 + D1; restore script is a one-liner against a freshly-provisioned preview DB; worker rollback is sub-minute. |
| **Recovery Point Objective (RPO)** | **24 hours** (daily backups) | Daily 02:10 UTC `wrangler d1 export` → R2. Monthly DR drill validates the restore path. |
| **WAL streaming** (aspirational) | Not committed | D1 does not currently expose WAL streaming to customers. When it does, we'll cut RPO to 5 min. Tracked in the roadmap. |

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
