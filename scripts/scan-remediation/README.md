# scripts/scan-remediation — security alerts become slot tasks

`.github/workflows/scan-remediation.yml` runs this folder's `run.mjs` every hour on `main`. It turns each open Code
Scanning, Dependabot and secret-scanning alert into exactly one public `slot:S21` task (D7283, D7899, D8074). It
closes a task only once GitHub reports the alert resolved. It marks a task `sla:breached` after seven days, and on
Mondays it sends a counts-only Slack digest. It writes issues and labels only: never code, a PR or an alert, and
it calls no model.

**Batches (D7259).** `batches.mjs` groups open Code Scanning trackers by scanner, rule and owning subsystem (or a
shared root cause in `ROOT_CAUSE_OVERRIDES`) into one `scan:batch` issue that S21 claims as a unit; `claim.mjs` then
holds each open member tracker too. The public batch shows an opaque id, member tracker numbers and alert links
(`../lib/scanBatchIssue.mjs`); the grouping key stays in the run. Trackers stay one per alert and still close only
when `main`'s scan reports the alert fixed; a batch closes once every member has.

**The rule for adding here.** A new alert source is one entry in `sources.mjs`: its tracker title, its dedup
marker, its alert URL and when GitHub has resolved it. `trackers.mjs` and `run.mjs` take it as they are. A
tracker's public body names the alert number and its published rule, nothing else. Its tests go in this folder,
and `frontend/test/scan_remediation_*.test.mjs` imports them so the frontend suite runs them.

Every file directly in this folder, one row each. The list below is generated, not written:
`node scripts/check-folder-docs.mjs --write` fills it in your working tree from each file's own header comment
(its first line), and `--clean` empties it again. It is never committed, so adding a file never edits this
README (#4104).

<!-- files:begin -->
<!-- files:end -->
