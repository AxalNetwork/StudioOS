#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/dr-drill.sh — Task #5 (IE)
#
# Disaster-recovery drill. Reads the latest nightly backup's key from the
# export's heartbeat, provisions a throwaway EU D1 database, downloads the
# backup from R2, imports it, smoke-checks the restored rows and tables,
# deletes the throwaway, and pages on-call on failure.
#
# D263 — EVERY EXIT WRITES `drill-d1.json` to the backups bucket (at, outcome,
# duration_s, source, step, exit_code, backup_key, run_id), from the EXIT
# trap, pass or fail. That marker is what HQ's Security page reads
# (services/backup.ts readRestoreDrill). Writing it never changes the
# drill's exit code.
#
# Intended to run monthly via the GitHub Actions workflow
# `.github/workflows/dr-drill.yml`. Can also be invoked manually.
#
# Required env:
#   CLOUDFLARE_ACCOUNT_ID   — accountId (from wrangler whoami)
#   CLOUDFLARE_API_TOKEN    — token with D1:edit + R2:read/write (+ Workers:edit
#                             only if DR_DRILL_PREVIEW=1)
#   PAGER_WEBHOOK_URL       — optional. Slack/Opsgenie/PD webhook for failure.
#   DRILL_SOURCE            — optional. `gha` from the workflow; `manual` otherwise.
#   GITHUB_RUN_ID           — optional. Recorded in the marker when present.
#
# Exit codes:
#   0  drill green
#   1  setup failure (couldn't list backups, etc.)
#   2  restore failed
#   3  smoke tests failed
# ---------------------------------------------------------------------------
set -euo pipefail

DRILL_PREFIX="dr-drill-$(date -u +%Y%m%d%H%M)"
TARGET_DB="${DRILL_PREFIX}-db"
BUCKET="${BACKUP_BUCKET:-studioos-backups}"
PAGER_WEBHOOK_URL="${PAGER_WEBHOOK_URL:-}"
DRILL_SOURCE="${DRILL_SOURCE:-manual}"
STARTED_EPOCH=$(date -u +%s)
STARTED_AT=$(date -u +%FT%TZ)
LATEST_KEY=""
DB_CREATED=0

log() { echo "[dr-drill] $*"; }
page() {
  local msg="$1"
  log "PAGE: $msg"
  if [[ -n "${PAGER_WEBHOOK_URL}" ]]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg t "DR DRILL FAILED: $msg" '{text:$t}')" \
      "${PAGER_WEBHOOK_URL}" >/dev/null || log "pager webhook delivery failed"
  fi
}

# D263 — the marker. Built with `jq -n` so no value is interpolated into
# JSON by hand, and written the way backup-d1.yml writes its heartbeat. A
# failed write is logged and never changes the drill's exit code.
write_marker() {
  local rc="$1" outcome="failed" marker
  [[ "$rc" -eq 0 ]] && outcome="passed"
  marker="$(mktemp)"
  if jq -n \
      --arg at "${STARTED_AT}" \
      --arg outcome "${outcome}" \
      --argjson duration_s "$(( $(date -u +%s) - STARTED_EPOCH ))" \
      --arg source "${DRILL_SOURCE}" \
      --arg step "${STEP:-unknown}" \
      --argjson exit_code "${rc}" \
      --arg backup_key "${LATEST_KEY}" \
      --arg run_id "${GITHUB_RUN_ID:-}" \
      '{at: $at, outcome: $outcome, duration_s: $duration_s, source: $source, step: $step,
        exit_code: $exit_code,
        backup_key: (if $backup_key == "" then null else $backup_key end),
        run_id: (if $run_id == "" then null else $run_id end)}' > "${marker}"; then
    wrangler r2 object put "${BUCKET}/drill-d1.json" --file "${marker}" --content-type application/json --remote \
      || log "WARN: could not write the drill marker (r2://${BUCKET}/drill-d1.json)"
  else
    log "WARN: could not build the drill marker"
  fi
  rm -f "${marker}" || true
}

# Single EXIT trap, set once and never cleared: it runs on success too, which
# is how a passing drill writes its marker. Captures `$?` BEFORE any cleanup so
# a failing `rm -rf` or delete can't mask the real failure code. `TMP` and the
# throwaway database are created later and may not exist at trap time.
TMP=""
on_exit() {
  local rc=$?
  set +e
  if [[ "${DB_CREATED}" -eq 1 ]]; then
    wrangler d1 delete "${TARGET_DB}" --skip-confirmation \
      || log "WARN: could not delete throwaway DB ${TARGET_DB}; clean up manually"
  fi
  if [[ -n "${TMP}" && -d "${TMP}" ]]; then
    rm -rf "${TMP}" || log "WARN: tmp cleanup failed (${TMP})"
  fi
  write_marker "$rc"
  if [[ $rc -ne 0 ]]; then
    page "exit_code=$rc step=${STEP:-unknown}"
  fi
  exit $rc
}
trap on_exit EXIT

# ---------- 1. Find the latest backup -------------------------------
STEP="find_backup"
# D263 — THE KEY COMES FROM THE EXPORT'S OWN HEARTBEAT. This used to run
# `wrangler r2 object list`, a subcommand wrangler 4.131 does not have (only
# get, put and delete are registered), and it threw wrangler's error away with
# `2>/dev/null`; `set -e` then ended the script at the assignment, so the
# empty-target check below was unreachable. backup-d1.yml writes the key it
# just uploaded into heartbeat-d1.json, so that is where the drill reads it.
log "reading the latest backup key from r2://${BUCKET}/heartbeat-d1.json"
if ! HEARTBEAT=$(wrangler r2 object get "${BUCKET}/heartbeat-d1.json" --remote --pipe); then
  log "FATAL: could not read r2://${BUCKET}/heartbeat-d1.json"
  exit 1
fi
LATEST_KEY=$(printf '%s' "${HEARTBEAT}" | jq -r '.key // empty' 2>&1) || LATEST_KEY=""

if [[ -z "${LATEST_KEY:-}" ]]; then
  log "FATAL: the heartbeat names no backup key"
  exit 1
fi
if ! [[ "${LATEST_KEY}" =~ ^d1/(studioos-db/)?backup-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql$ ]]; then
  log "FATAL: the heartbeat's key is not a D1 backup key: ${LATEST_KEY}"
  LATEST_KEY=""
  exit 1
fi
log "latest backup: ${LATEST_KEY}"

# Backup freshness check — RPO is 24h.
BACKUP_DATE=$(echo "${LATEST_KEY}" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
AGE_DAYS=$(( ( $(date -u +%s) - $(date -u -d "${BACKUP_DATE}" +%s) ) / 86400 ))
if [[ "${AGE_DAYS}" -gt 1 ]]; then
  log "WARN: latest backup is ${AGE_DAYS} days old — RPO breach"
  page "rpo_breach age_days=${AGE_DAYS}"
fi

# ---------- 2. Provision throwaway DB -------------------------------
STEP="create_db"
log "creating throwaway DB ${TARGET_DB}"
# --jurisdiction eu IS LOAD-BEARING, and its absence is what D167 found.
# Production (`studioos-db`) is EU-resident account-side; a jurisdiction is
# fixed at creation and cannot be changed after. Drilling the restore into a
# database created without the flag proved the backup was importable while
# rehearsing a shape that, followed for real, would land production data
# outside the EU. branch-provision.yml already passes this flag when it
# creates a branch database; the drill now does too.
wrangler d1 create "${TARGET_DB}" --jurisdiction eu >/dev/null
DB_CREATED=1

# ---------- 3. Restore ---------------------------------------------
STEP="restore"
log "downloading + restoring backup into ${TARGET_DB}"
TMP=$(mktemp -d)
wrangler r2 object get "${BUCKET}/${LATEST_KEY}" --file "${TMP}/backup.sql" --remote

if ! wrangler d1 execute "${TARGET_DB}" --remote --file "${TMP}/backup.sql"; then
  log "FATAL: restore failed"
  exit 2
fi

# ---------- 4. Smoke test ------------------------------------------
STEP="smoke"
log "running smoke checks against restored DB"

# 4a. Row-count smoke — every backup must have these tables non-empty.
# This catches catastrophic data loss (empty restore, wrong DB).
SMOKE_SQL="SELECT
  (SELECT COUNT(*) FROM users)    AS users,
  (SELECT COUNT(*) FROM projects) AS projects;"
SMOKE_OUT=$(wrangler d1 execute "${TARGET_DB}" --remote --command "${SMOKE_SQL}" --json)
USERS=$(echo "${SMOKE_OUT}" | jq -r '.[] .results[0].users // 0')
PROJECTS=$(echo "${SMOKE_OUT}" | jq -r '.[] .results[0].projects // 0')
log "smoke counts: users=${USERS} projects=${PROJECTS}"

if [[ "${USERS}" -lt 1 ]]; then
  log "FATAL: restored DB has zero users"
  exit 3
fi

# 4b. Schema integrity smoke — every required table is present. If
# `wrangler d1 export` truncated mid-stream this is where it shows up.
REQUIRED_TABLES=(users projects deals score_snapshots activity_logs documents)
TABLE_SQL="SELECT name FROM sqlite_master WHERE type='table';"
TABLES_OUT=$(wrangler d1 execute "${TARGET_DB}" --remote --command "${TABLE_SQL}" --json)
for t in "${REQUIRED_TABLES[@]}"; do
  if ! echo "${TABLES_OUT}" | jq -e --arg t "$t" '.[] .results[] | select(.name==$t)' >/dev/null; then
    log "FATAL: restored DB missing required table: $t"
    exit 3
  fi
done
log "schema smoke ok (${#REQUIRED_TABLES[@]} required tables present)"

# 4c. (removed, D263) This ran `npm run test:drift` from the checkout. That
# suite never touches the restored database, the workflow never ran `npm ci`
# for it, and it re-ran every repo test on each drill. What proves the restore
# is 4a and 4b above, against the restored database itself.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 4d. Preview-worker validation against restored DB.
# True environment validation per spec: deploy the worker to a fresh
# preview env bound to the throwaway D1, then HTTP-smoke `/api/health`
# against the public preview URL. Catches endpoint-level regressions
# the SQL/repo smokes cannot (cold-start failures, binding mismatch,
# route registration drift). Gated on DR_DRILL_PREVIEW=1 so local /
# operator-manual runs of this script can skip the heavy deploy step;
# the monthly GH Actions workflow sets it.
if [[ "${DR_DRILL_PREVIEW:-0}" == "1" ]]; then
  STEP="preview_deploy"
  PREVIEW_NAME="studioos-drdrill-$(date -u +%Y%m%d%H%M)"
  TOML="${REPO_ROOT}/wrangler.toml"
  TOML_BAK="${TMP}/wrangler.toml.bak"
  cp "${TOML}" "${TOML_BAK}"
  # Resolve throwaway DB id (wrangler reports it on create; re-derive
  # here so this section can also run against an externally-restored DB).
  DB_INFO=$(wrangler d1 info "${TARGET_DB}" --json)
  DB_UUID=$(echo "${DB_INFO}" | jq -r '.uuid // .[0].uuid // empty')
  if [[ -z "${DB_UUID}" ]]; then
    log "FATAL: could not resolve throwaway D1 uuid"
    exit 3
  fi
  log "binding preview worker to ${TARGET_DB} (${DB_UUID})"
  # Rewrite preview env's D1 id + worker name to point at the throwaway.
  # `sed -i` portability: works on GNU sed (the GH Actions ubuntu runner).
  sed -i "s/REPLACE_WITH_PREVIEW_D1_ID/${DB_UUID}/" "${TOML}"
  sed -i "s/^name = \"studioos-preview\"$/name = \"${PREVIEW_NAME}\"/" "${TOML}"

  log "deploying preview worker ${PREVIEW_NAME}"
  if ! ( cd "${REPO_ROOT}/cloudflare-worker" && wrangler deploy --env preview ); then
    cp "${TOML_BAK}" "${TOML}"
    log "FATAL: preview deploy failed"
    exit 3
  fi

  STEP="preview_smoke"
  PREVIEW_URL="https://${PREVIEW_NAME}.workers.dev/api/health"
  log "HTTP-smoke ${PREVIEW_URL}"
  HTTP_OK=0
  for i in 1 2 3 4 5; do
    if curl -fsS --max-time 10 "${PREVIEW_URL}" >/dev/null; then
      HTTP_OK=1; break
    fi
    log "smoke attempt ${i} failed; retrying in 5s"
    sleep 5
  done

  STEP="preview_teardown"
  log "tearing down preview worker ${PREVIEW_NAME}"
  ( cd "${REPO_ROOT}/cloudflare-worker" && wrangler delete --env preview --name "${PREVIEW_NAME}" 2>/dev/null ) \
    || log "WARN: preview worker delete failed; clean up manually"
  cp "${TOML_BAK}" "${TOML}"

  if [[ "${HTTP_OK}" -ne 1 ]]; then
    log "FATAL: preview /api/health smoke failed after 5 retries"
    exit 3
  fi
  log "preview HTTP smoke ok"
else
  log "DR_DRILL_PREVIEW!=1 — skipping preview-worker HTTP smoke (operator opt-out)"
fi

# ---------- 5. Teardown --------------------------------------------
# The EXIT trap deletes the throwaway database and writes the marker, on this
# path and on every failure path alike.
STEP="teardown"
log "DR drill GREEN ✓ (backup=${LATEST_KEY}, users=${USERS}, projects=${PROJECTS})"
exit 0
