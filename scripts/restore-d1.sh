#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/restore-d1.sh — Task #5 (IE); D5337 (#5337)
#
# Operator-runnable D1 restore. Imports one nightly backup into a target D1
# database the operator has created and named, through the same verify,
# split, import and compare path the monthly drill runs
# (scripts/dr-restore-lib.sh), so a passing drill is evidence for this script.
#
# READ documentation/operations/D1_RECOVERY.md FIRST. This is the SECOND
# recovery path, not the first: `wrangler d1 time-travel restore` rewinds the
# live database in place to any instant in the last 30 days, loses far less,
# and creates nothing. Use this script only for damage older than that window,
# or for a database that is gone rather than wrong.
#
# THE TARGET (D167). There is no default: the old one, `studioos-db-preview`,
# DOES NOT EXIST in the account. Create the target yourself, EU-resident, and
# pass its name:
#
#     npx wrangler d1 create studioos-db-restore --jurisdiction eu
#
# Production is EU-resident account-side and a jurisdiction is fixed at
# creation. The script refuses, before it imports anything, a target that is
# unnamed, is production (by name or id, read from wrangler.toml), does not
# exist, is not `jurisdiction: eu` per `wrangler d1 info --json`, or is not
# empty. It does NOT truncate: a populated target is refused, never cleared.
#
# THE BACKUP (D4558). Nothing is restored that its manifest does not vouch
# for: sha256, size, key and last migration are checked before the target is
# touched, and every table's row count is compared after the import. Sources:
#
#   r2://<bucket>/<key>       the R2 export and `<key minus .sql>.manifest.json`
#   ./backup-YYYY-MM-DD.sql   a local export, with DR_MANIFEST_FILE or the
#                             `.manifest.json` beside it
#   DR_SOURCE=independent     the independent encrypted copy: the argument is
#                             a recovery point (`d1/<db>/daily/<point>` or
#                             `d1/<db>/monthly/<YYYY-MM>`), read from
#                             DR_COPY_ENDPOINT / DR_COPY_BUCKET with a READ key
#                             in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, its
#                             ciphertext checked and decrypted with the
#                             owner's DR_AGE_IDENTITY_FILE. `age` reads the key
#                             file in place; it is never copied or printed.
#
# The backup, the decrypted plaintext and the import chunks live only in this
# run's 0700 temp directory, removed on every exit. Every line printed is a
# name, a count, a size, a hash or a time; no row is ever printed.
#
# A backup of any age is restorable (DR_MAX_BACKUP_AGE_HOURS, default 9600 h,
# past the 365-day retention): an old export is this path's whole use.
#
# Required env:
#   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1:edit, R2:read)
#   wrangler (Node >= 22), node, jq; and aws + age for DR_SOURCE=independent
#
# Usage:
#   scripts/restore-d1.sh <r2://bucket/key | ./backup.sql | recovery point> <target-db>
#
# Examples:
#   scripts/restore-d1.sh r2://studioos-backups/d1/studioos-db/backup-2026-05-20.sql studioos-db-restore
#   DR_SOURCE=independent DR_AGE_IDENTITY_FILE=/path/to/d1-recovery.key \
#     DR_COPY_ENDPOINT=https://… DR_COPY_BUCKET=… \
#     scripts/restore-d1.sh d1/studioos-db/daily/2026-11-07T08-12-00Z studioos-db-restore
#
# Exit codes (the drill's): 0 restored; 1 refused before any download (usage,
# target, configuration); 2 the backup failed its manifest, or the import
# failed; 3 the restored row counts differ. A non-zero exit prints one
# `reason=<code>` line.
# ---------------------------------------------------------------------------
set -euo pipefail

SOURCE_ARG="${1:-}"
TARGET_DB="${2:-}"
BUCKET="${BACKUP_BUCKET:-studioos-backups}"
SOURCE="${DR_SOURCE:-primary}"
MAX_AGE_HOURS="${DR_MAX_BACKUP_AGE_HOURS:-9600}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL_REASON=""
LATEST_KEY=""
RECOVERY_POINT=""
MIGRATION=""
TABLES=0
BACKUP_SHA=""
TMP=""

log() { echo "[restore-d1] $*"; }

# shellcheck source=scripts/dr-restore-lib.sh
. "${REPO_ROOT}/scripts/dr-restore-lib.sh"

on_exit() {
  local rc=$?
  set +e
  if [[ -n "${TMP}" && -d "${TMP}" ]]; then
    rm -rf "${TMP}" || log "WARN: could not remove the run's temp directory; delete it by hand"
  fi
  if [[ $rc -ne 0 ]]; then
    log "restore NOT done. reason=${FAIL_REASON:-exit_${rc}}"
  fi
  exit $rc
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

refuse() { dr_fail 1 "$@"; }

# ---------- 0. Arguments and the target's name ----------------------
if [[ -z "${SOURCE_ARG}" || -z "${TARGET_DB}" ]]; then
  echo "usage: $0 <r2://${BUCKET}/<key> | ./backup.sql | recovery point> <target-db>" >&2
  echo "       the target is named explicitly; there is no default (D167)" >&2
  refuse target_unnamed "a source and a target database must both be named"
fi
[[ "${SOURCE}" == "primary" || "${SOURCE}" == "independent" ]] || refuse source_invalid "DR_SOURCE is primary or independent"
[[ "${TARGET_DB}" =~ ^[A-Za-z0-9_-]+$ ]] || refuse target_invalid "the target name has characters a D1 name does not"

# Production's names and ids, from the two tables that bind it.
PROD_IDS=$(awk '
  /^\[\[/ { on = ($0 == "[[d1_databases]]" || $0 == "[[env.production.d1_databases]]") }
  on && /^(database_name|database_id)[[:space:]]*=/ { v = $0; sub(/^[^"]*"/, "", v); sub(/".*$/, "", v); print v }
' "${REPO_ROOT}/wrangler.toml" | sort -u)
is_production() { [[ "$1" == "studioos-db" ]] || grep -qxF -- "$1" <<< "${PROD_IDS}"; }
is_production "${TARGET_DB}" && refuse target_is_production "'${TARGET_DB}' is production; restore into a new database and cut over (D1_RECOVERY.md)"

for tool in wrangler node jq; do
  command -v "${tool}" >/dev/null 2>&1 || refuse tool_missing "${tool} is not on PATH"
done

TMP=$(mktemp -d)
chmod 700 "${TMP}"

# ---------- 1. The backup and its manifest --------------------------
BACKUP="${TMP}/backup.sql"
MANIFEST="${TMP}/manifest.json"
if [[ "${SOURCE}" == "independent" ]]; then
  dr_fetch_independent "${SOURCE_ARG}" "${DR_AGE_IDENTITY_FILE:-}" "${TMP}"
elif [[ "${SOURCE_ARG}" == r2://* ]]; then
  LATEST_KEY="${SOURCE_ARG#r2://"${BUCKET}"/}"
  if [[ "${LATEST_KEY}" == "${SOURCE_ARG}" ]] || ! [[ "${LATEST_KEY}" =~ ^d1/([a-z0-9-]+/)?backup-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql$ ]]; then
    refuse source_invalid "an r2:// source is r2://${BUCKET}/d1/<db>/backup-YYYY-MM-DD.sql"
  fi
  log "downloading r2://${BUCKET}/${LATEST_KEY} and its manifest"
  dr_fetch_primary "${BUCKET}" "${LATEST_KEY}" "${TMP}"
else
  [[ -f "${SOURCE_ARG}" ]] || refuse source_missing "the backup file does not exist"
  BACKUP="${SOURCE_ARG}"
  LOCAL_MANIFEST="${DR_MANIFEST_FILE:-${SOURCE_ARG%.sql}.manifest.json}"
  [[ -f "${LOCAL_MANIFEST}" ]] || dr_fail 2 manifest_missing "no manifest beside the backup (set DR_MANIFEST_FILE); a backup nothing vouches for is not restored"
  cp "${LOCAL_MANIFEST}" "${MANIFEST}"
  # A local file has no key of its own: the manifest's binds it by sha256 and size.
  LATEST_KEY=$(jq -r '.key // empty' "${MANIFEST}" 2>/dev/null || true)
  [[ -n "${LATEST_KEY}" ]] || dr_fail 2 manifest_invalid "the manifest names no backup"
fi

dr_verify "${BACKUP}" "${MANIFEST}" "${LATEST_KEY}" "${MAX_AGE_HOURS}"

# ---------- 2. The target: exists, EU, not production, empty --------
if ! wrangler d1 info "${TARGET_DB}" --json > "${TMP}/info.json" 2>"${TMP}/info.err"; then
  refuse target_missing "'${TARGET_DB}' does not exist or cannot be read; create it with: npx wrangler d1 create ${TARGET_DB} --jurisdiction eu"
fi
TARGET_UUID=$(jq -r '(if type == "array" then .[0] else . end) | .uuid // empty' "${TMP}/info.json" 2>/dev/null || true)
[[ -n "${TARGET_UUID}" ]] && is_production "${TARGET_UUID}" && refuse target_is_production "'${TARGET_DB}' has production's database id"
JURISDICTION=$(jq -r '(if type == "array" then .[0] else . end) | .jurisdiction // empty' "${TMP}/info.json" 2>/dev/null || true)
if [[ "${JURISDICTION}" != "eu" ]]; then
  refuse target_not_eu "'${TARGET_DB}' reports jurisdiction '${JURISDICTION:-none}', not eu; a jurisdiction is fixed at creation, so create a new database with --jurisdiction eu (D167)"
fi
EMPTY_SQL="SELECT name FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite%' AND substr(name, 1, 4) <> '_cf_';"
if ! wrangler d1 execute "${TARGET_DB}" --remote --command "${EMPTY_SQL}" --json > "${TMP}/objects.json" 2>"${TMP}/objects.err"; then
  refuse target_unreadable "could not list '${TARGET_DB}''s schema"
fi
OBJECTS=$(jq '[.[] .results[]?] | length' "${TMP}/objects.json" 2>/dev/null || echo unreadable)
[[ "${OBJECTS}" == "0" ]] || refuse target_not_empty "'${TARGET_DB}' holds ${OBJECTS} schema objects; restore only into an empty database (nothing is truncated)"
log "target ${TARGET_DB}: exists, jurisdiction eu, empty"

# ---------- 3. Confirm ----------------------------------------------
log "about to restore ${LATEST_KEY} (recovery point ${RECOVERY_POINT:-unknown}, ${TABLES} tables, migration ${MIGRATION:-none recorded}) into '${TARGET_DB}'"
read -rp "Type the exact target DB name to confirm ('${TARGET_DB}'): " CONFIRM || CONFIRM=""
[[ "${CONFIRM}" == "${TARGET_DB}" ]] || refuse confirmation_mismatch "confirmation did not match the target name"

# ---------- 4. Import, then compare ---------------------------------
log "importing in chunks; a multi-GB export takes a while"
dr_import_chunks "${TARGET_DB}" "${BACKUP}" "${MANIFEST}" "${TMP}"
dr_compare_counts "${TARGET_DB}" "${MANIFEST}" "${TMP}"

log "restore complete: ${LATEST_KEY} (sha256 ${BACKUP_SHA}) into ${TARGET_DB}"
log "next steps:"
log "  1. Point a preview worker at '${TARGET_DB}' and run the smoke suite."
log "  2. If green, flip production by setting database_id in wrangler.toml's [[d1_databases]] and [[env.production.d1_databases]]."
log "  3. Write the affected timeframe into documentation/operations/INCIDENT_RESPONSE.md."
