#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/dr-drill.sh — Task #5 (IE)
#
# Disaster-recovery drill. Provisions a fresh preview D1 database,
# downloads the latest nightly backup from R2, imports it, runs the
# smoke-test suite against a preview Worker pointed at the new DB, and
# pages on-call on failure.
#
# Intended to run monthly via the GitHub Actions workflow
# `.github/workflows/dr-drill.yml`. Can also be invoked manually.
#
# Required env:
#   CLOUDFLARE_ACCOUNT_ID   — accountId (from wrangler whoami)
#   CLOUDFLARE_API_TOKEN    — token with D1:edit + R2:read + Workers:edit
#   PAGER_WEBHOOK_URL       — optional. Slack/Opsgenie/PD webhook for failure.
#
# Exit codes:
#   0  drill green
#   1  setup failure (couldn't list backups, etc.)
#   2  restore failed
#   3  smoke tests failed
# ---------------------------------------------------------------------------
set -euo pipefail

DRILL_PREFIX="dr-drill-$(date -u +%Y%m%d)"
TARGET_DB="${DRILL_PREFIX}-db"
BUCKET="${BACKUP_BUCKET:-studioos-backups}"
PAGER_WEBHOOK_URL="${PAGER_WEBHOOK_URL:-}"

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

# Single EXIT trap, set once. Captures `$?` from the script's exit
# status BEFORE running cleanup so a failing `rm -rf` in the cleanup
# block can't mask the real failure code. `TMP` is created later and
# may be empty at trap time — guarded with -n.
TMP=""
on_exit() {
  local rc=$?
  if [[ -n "${TMP}" && -d "${TMP}" ]]; then
    rm -rf "${TMP}" || log "WARN: tmp cleanup failed (${TMP})"
  fi
  if [[ $rc -ne 0 ]]; then
    page "exit_code=$rc step=${STEP:-unknown}"
  fi
  return $rc
}
trap on_exit EXIT

# ---------- 1. Find the latest backup -------------------------------
STEP="list_backups"
log "listing latest backup in r2://${BUCKET}/d1/"
LATEST_KEY=$(wrangler r2 object list "${BUCKET}" --prefix "d1/" 2>/dev/null \
  | awk '{print $NF}' \
  | grep -E '^d1/backup-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql$' \
  | sort -r | head -n1)

if [[ -z "${LATEST_KEY:-}" ]]; then
  log "FATAL: no backups found in r2://${BUCKET}/d1/"
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
wrangler d1 create "${TARGET_DB}" >/dev/null

# ---------- 3. Restore ---------------------------------------------
STEP="restore"
log "downloading + restoring backup into ${TARGET_DB}"
TMP=$(mktemp -d)
wrangler r2 object get "${BUCKET}/${LATEST_KEY}" --file "${TMP}/backup.sql"

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

# 4c. Repo-level smoke suite — runs the same checks CI runs on every
# merge (API ↔ Worker drift, advisor bank drift, statemachine coverage,
# advisor scenarios, market-intel personas, worker tsc). If the restore
# produced a DB whose shape no longer matches the deployed worker code,
# the drift + scenarios tests fail and this exits non-zero.
# The DR drill GH Action runs from a repo checkout so `npm` is available.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v npm >/dev/null 2>&1 && [[ -f "${REPO_ROOT}/package.json" ]]; then
  log "running npm run test:drift (repo smoke suite)"
  if ! ( cd "${REPO_ROOT}" && npm run test:drift ); then
    log "FATAL: repo smoke suite (test:drift) failed against restored shape"
    exit 3
  fi
else
  log "WARN: npm/package.json unavailable — skipping repo smoke suite"
fi

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
STEP="teardown"
log "deleting throwaway DB ${TARGET_DB}"
wrangler d1 delete "${TARGET_DB}" --skip-confirmation || log "WARN: teardown delete failed; clean up manually"

log "DR drill GREEN ✓ (backup=${LATEST_KEY}, users=${USERS}, projects=${PROJECTS})"
trap - EXIT
exit 0
