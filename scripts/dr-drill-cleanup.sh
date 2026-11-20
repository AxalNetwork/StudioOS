#!/usr/bin/env bash
# D7917: cancellation fallback; delete only the database recorded for this exact Actions run/attempt.
set -euo pipefail
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid cleanup run identity' >&2; exit 1; }
[[ -n "${DR_DRILL_DB_FILE:-}" ]] || { echo 'Missing drill ownership file path' >&2; exit 1; }
[[ -e "${DR_DRILL_DB_FILE}" ]] || exit 0
[[ -f "${DR_DRILL_DB_FILE}" && ! -L "${DR_DRILL_DB_FILE}" ]] || exit 1
target=$(cat "${DR_DRILL_DB_FILE}")
[[ "$target" =~ ^dr-drill-[0-9]{12}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-db$ ]] || { echo 'Refusing unowned drill database' >&2; exit 1; }
wrangler d1 delete "$target" --skip-confirmation
rm -f "${DR_DRILL_DB_FILE}"
