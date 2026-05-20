#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/restore-d1.sh — Task #5 (IE)
#
# Operator-runnable D1 restore. Walks the user through importing a
# nightly backup file (`backup-YYYY-MM-DD.sql`) into a target D1
# database. The default target is the `--preview` DB so you can verify
# the restore before flipping prod.
#
# Required env (or interactive prompts):
#   CLOUDFLARE_ACCOUNT_ID   — accountId from `wrangler whoami`
#   CLOUDFLARE_API_TOKEN    — token with D1:edit + R2:read scope
#
# Required Node:
#   wrangler needs Node ≥22. On Replit the default is 20 but a 22 binary
#   is available in the nix store — `export PATH=…/nodejs-22.x.y/bin:$PATH`
#   first. See replit.md ("Migrations" gotcha) for the exact path.
#
# Usage:
#   scripts/restore-d1.sh <backup-file-or-r2-key> [target-db-name]
#
# Examples:
#   scripts/restore-d1.sh ./backup-2026-05-20.sql studioos-db-restore
#   scripts/restore-d1.sh r2://studioos-backups/d1/backup-2026-05-20.sql studioos-db-preview
#
# WARNING: This imports into the TARGET database. It does NOT truncate
# existing tables first — apply against an EMPTY DB (e.g. a freshly
# created --preview DB). Importing into a populated DB will fail at the
# first duplicate primary key.
# ---------------------------------------------------------------------------
set -euo pipefail

BACKUP_ARG="${1:-}"
TARGET_DB="${2:-studioos-db-preview}"
BUCKET="${BACKUP_BUCKET:-studioos-backups}"

if [[ -z "${BACKUP_ARG}" ]]; then
  echo "usage: $0 <backup-file-or-r2-key> [target-db-name]" >&2
  echo "       $0 ./backup-2026-05-20.sql studioos-db-restore" >&2
  echo "       $0 r2://studioos-backups/d1/backup-2026-05-20.sql studioos-db-preview" >&2
  exit 2
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "[restore-d1] wrangler not on PATH. Install with: npm i -g wrangler" >&2
  exit 1
fi

# ---------- Resolve source: local file vs R2 key ---------------------
LOCAL_FILE=""
TMP_DIR=""
cleanup() { [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]] && rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

if [[ "${BACKUP_ARG}" == r2://* ]]; then
  R2_KEY="${BACKUP_ARG#r2://${BUCKET}/}"
  if [[ "${R2_KEY}" == "${BACKUP_ARG}" ]]; then
    echo "[restore-d1] r2:// URL must be of the form r2://${BUCKET}/<key>" >&2
    exit 2
  fi
  TMP_DIR=$(mktemp -d)
  LOCAL_FILE="${TMP_DIR}/$(basename "${R2_KEY}")"
  echo "[restore-d1] downloading r2://${BUCKET}/${R2_KEY} → ${LOCAL_FILE}"
  wrangler r2 object get "${BUCKET}/${R2_KEY}" --file "${LOCAL_FILE}"
else
  LOCAL_FILE="${BACKUP_ARG}"
  if [[ ! -f "${LOCAL_FILE}" ]]; then
    echo "[restore-d1] backup file not found: ${LOCAL_FILE}" >&2
    exit 1
  fi
fi

SIZE_MB=$(du -m "${LOCAL_FILE}" | awk '{print $1}')
echo "[restore-d1] backup file:  ${LOCAL_FILE}  (${SIZE_MB} MB)"
echo "[restore-d1] target DB:    ${TARGET_DB}"
echo ""
echo "About to restore into D1 database '${TARGET_DB}'."
echo "  - This will execute the SQL file against the REMOTE D1."
echo "  - Existing rows with matching primary keys will cause the restore to FAIL."
echo "  - Restore into an empty preview DB if you're not sure."
echo ""
read -rp "Type the exact target DB name to confirm ('${TARGET_DB}'): " CONFIRM
if [[ "${CONFIRM}" != "${TARGET_DB}" ]]; then
  echo "[restore-d1] confirmation mismatch — aborting" >&2
  exit 1
fi

# ---------- Apply ---------------------------------------------------
echo "[restore-d1] importing… this can take 5-30 minutes for a multi-GB backup"
wrangler d1 execute "${TARGET_DB}" --remote --file "${LOCAL_FILE}"

# ---------- Smoke check ---------------------------------------------
echo "[restore-d1] smoke-checking row counts…"
wrangler d1 execute "${TARGET_DB}" --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name LIMIT 20;"

wrangler d1 execute "${TARGET_DB}" --remote --command \
  "SELECT 'users' AS table_name, COUNT(*) AS n FROM users
   UNION ALL SELECT 'projects', COUNT(*) FROM projects
   UNION ALL SELECT 'deals', COUNT(*) FROM deals;"

echo ""
echo "[restore-d1] restore complete."
echo "[restore-d1] next steps:"
echo "  1. Point a preview worker at '${TARGET_DB}' and run the smoke suite."
echo "  2. If green, flip prod by updating wrangler.toml [[d1_databases]] database_id."
echo "  3. File an incident note in INCIDENT_RESPONSE.md with the affected timeframe."
