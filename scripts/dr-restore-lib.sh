# shellcheck shell=bash
# shellcheck disable=SC2034 # the globals set here are read by the sourcing script
# ---------------------------------------------------------------------------
# scripts/dr-restore-lib.sh — D5337 (#5337)
#
# The one restore path. Sourced, never run, by the two scripts that restore a
# D1 backup: `dr-drill.sh` (the monthly drill, into a throwaway database) and
# `restore-d1.sh` (the operator's recovery, into a database they name). Before
# D5337 the operator's script imported the whole export in one call, which
# fails on D1's side at production's size (#1007), so a passing drill proved
# nothing about it. Now both fetch, verify, split, import and compare here.
#
#   dr_fetch_primary BUCKET KEY DIR
#       the backup and its manifest (D4558) from R2, to DIR/backup.sql and
#       DIR/manifest.json, manifest first.
#   dr_fetch_independent POINT IDENTITY_FILE DIR
#       a recovery point of the independent encrypted copy (D4558): its
#       manifest and ciphertext from DR_COPY_ENDPOINT / DR_COPY_BUCKET, the
#       ciphertext's sha256 checked, then decrypted by `age` with the owner's
#       identity file to DIR/backup.sql. The identity file is read by `age`
#       only: never copied, never logged. Sets LATEST_KEY.
#   dr_verify BACKUP MANIFEST KEY MAX_AGE_HOURS
#       sha256, size, key, age and last migration against the manifest
#       (scripts/d1-backup-manifest.mjs verify). Sets RECOVERY_POINT,
#       MIGRATION and TABLES from the manifest, and BACKUP_SHA once it passes.
#   dr_import_chunks DB BACKUP MANIFEST DIR
#       the chunked import (D523): scripts/dr-drill-split.mjs cuts the export
#       into schema, data (parents first, foreign-key cycles broken at a
#       nullable back-edge) and post chunks, and each is its own
#       `wrangler d1 execute --remote --file`.
#   dr_compare_counts DB MANIFEST DIR
#       every table's row count in DB against the manifest (D4558).
#
# THE CONTRACT. The caller sets `set -euo pipefail`, defines `log`, sets
# REPO_ROOT, and owns an EXIT trap that removes DIR. A function that fails
# EXITS THE SCRIPT with FAIL_REASON set to a named reason and the drill's exit
# code for that step: 1 the copy is not configured, 2 the backup or the
# import failed, 3 the restored rows differ. Every line printed is a name, a
# count, a size, a hash or a time; backup content and wrangler's own output
# (which can quote a failing statement) are never printed.
# ---------------------------------------------------------------------------

dr_fail() {
  local rc="$1" reason="$2"
  shift 2
  FAIL_REASON="${reason}"
  log "FATAL: $*"
  exit "${rc}"
}

dr_fetch_primary() {
  local bucket="$1" key="$2" dir="$3"
  local manifest_key="${key%.sql}.manifest.json"
  if ! wrangler r2 object get "${bucket}/${manifest_key}" --file "${dir}/manifest.json" --remote; then
    dr_fail 2 manifest_missing "no manifest at r2://${bucket}/${manifest_key}; a backup nothing vouches for is not restored"
  fi
  wrangler r2 object get "${bucket}/${key}" --file "${dir}/backup.sql" --remote
}

dr_fetch_independent() {
  local point="$1" identity="$2" dir="$3" want
  [[ "${point}" =~ ^[A-Za-z0-9_./-]+/(daily|monthly)/[0-9A-Za-z-]+$ ]] || dr_fail 1 point_invalid "the independent copy's recovery point is not a …/daily/<point> or …/monthly/<YYYY-MM> prefix"
  [[ -n "${identity}" && -r "${identity}" ]] || dr_fail 1 key_missing "DR_AGE_IDENTITY_FILE is not a readable file"
  [[ -n "${DR_COPY_ENDPOINT:-}" && -n "${DR_COPY_BUCKET:-}" ]] || dr_fail 1 copy_unconfigured "DR_COPY_ENDPOINT and DR_COPY_BUCKET are required"
  command -v age >/dev/null 2>&1 || dr_fail 1 age_missing "age is not on PATH"
  log "reading the independent recovery point ${point}/"
  _dr_s3get "${point}/manifest.json" "${dir}/manifest.json" || dr_fail 2 manifest_missing "the recovery point has no manifest"
  _dr_s3get "${point}/backup.sql.age" "${dir}/backup.sql.age" || dr_fail 2 ciphertext_missing "the recovery point has no ciphertext"
  want=$(jq -r '.independent_copy.ciphertext_sha256 // empty' "${dir}/manifest.json" 2>/dev/null || true)
  if [[ -z "${want}" || "$(sha256sum "${dir}/backup.sql.age" | cut -d' ' -f1)" != "${want}" ]]; then
    dr_fail 2 ciphertext_mismatch "the ciphertext does not match its manifest"
  fi
  # The plaintext lands in the run's own 0700 directory, and nowhere else.
  if ! (umask 077 && age -d -i "${identity}" -o "${dir}/backup.sql" "${dir}/backup.sql.age" 2>/dev/null); then
    rm -f "${dir}/backup.sql"
    dr_fail 2 decrypt_failed "the copy could not be decrypted with that key"
  fi
  rm -f "${dir}/backup.sql.age"
  LATEST_KEY=$(jq -r '.key // empty' "${dir}/manifest.json" 2>/dev/null || true)
  [[ -n "${LATEST_KEY}" ]] || dr_fail 2 manifest_invalid "the manifest names no backup"
  log "independent copy decrypted: the export of ${LATEST_KEY}"
}

_dr_s3get() {
  aws s3api get-object --bucket "${DR_COPY_BUCKET}" --key "$1" "$2" \
    --endpoint-url "${DR_COPY_ENDPOINT}" --region "${DR_COPY_REGION:-auto}" >/dev/null
}

dr_verify() {
  local backup="$1" manifest="$2" key="$3" max_age="$4" verify
  RECOVERY_POINT=$(jq -r '.exported_at // empty' "${manifest}" 2>/dev/null || true)
  MIGRATION=$(jq -r '.migrations.last // empty' "${manifest}" 2>/dev/null || true)
  TABLES=$(jq -r '(.tables | length) // 0' "${manifest}" 2>/dev/null || echo 0)
  [[ "${TABLES}" =~ ^[0-9]+$ ]] || TABLES=0
  log "backup ready: $(wc -c < "${backup}") bytes"
  if ! verify=$(node "${REPO_ROOT}/scripts/d1-backup-manifest.mjs" verify "${backup}" "${manifest}" \
      --key "${key}" --migrations "${REPO_ROOT}/cloudflare-worker/sql/migrations" --max-age-hours "${max_age}"); then
    local reason
    reason=$(printf '%s' "${verify}" | sed -n 's/^reason=//p' | head -1)
    dr_fail 2 "${reason:-verify_failed}" "the backup does not match its manifest: ${reason:-verify_failed}"
  fi
  BACKUP_SHA=$(jq -r '.sha256' "${manifest}")
  log "${verify}"
}

dr_import_chunks() {
  local db="$1" backup="$2" manifest="$3" dir="$4"
  local chunk_bytes="${DR_DRILL_CHUNK_BYTES:-1000000}" summary total n=0
  local file phase stmts size over codes executed
  if ! summary=$(node "${REPO_ROOT}/scripts/dr-drill-split.mjs" "${backup}" "${dir}/chunks" "${chunk_bytes}"); then
    dr_fail 2 split_failed "could not split the backup into import chunks"
  fi
  log "split (chunk budget ${chunk_bytes} bytes): ${summary}"
  total=$(wc -l < "${dir}/chunks/manifest.tsv")
  # The chunk list is read on fd 3 so nothing wrangler reads from stdin eats it.
  while IFS=$'\t' read -r file phase stmts size over <&3; do
    n=$(( n + 1 ))
    log "chunk ${n}/${total} (${phase}): ${stmts} statements, ${size} bytes, ${over} over D1's 100 KB statement limit"
    # wrangler's output is captured, not shown: a D1 error can quote the
    # statement it failed on, which is backup content. Only its error codes
    # and its "Executed N queries" counts are printed.
    if ! wrangler d1 execute "${db}" --remote --file "${file}" > "${dir}/chunk.log" 2>&1; then
      codes=$(grep -oE 'D1_[A-Z_]+|SQLITE_[A-Z_]+|exceeded its memory limit|D1 reset before execute completed|File could not be uploaded|did not upload successfully' "${dir}/chunk.log" | sort -u | paste -sd ' ' - || true)
      log "FATAL: restore failed at chunk ${n}/${total} (${phase}); wrangler's error codes: ${codes:-none recognised (its full output is withheld because it can quote backup SQL)}"
      # Which tables that chunk writes, and their parents: schema names only.
      log "chunk ${n} $(node "${REPO_ROOT}/scripts/d1-backup-manifest.mjs" chunk-tables "${file}" "${manifest}" 2>/dev/null || echo 'tables: unreadable')"
      FAIL_REASON="chunk_${n}_of_${total}"
      exit 2
    fi
    executed=$(grep -oE 'Executed [0-9]+ queries in [0-9.]+ms \([0-9]+ rows read, [0-9]+ rows written\)' "${dir}/chunk.log" | head -1 || true)
    log "chunk ${n}/${total} imported: ${executed:-no count reported}"
  done 3< "${dir}/chunks/manifest.tsv"
  if [[ "${n}" -ne "${total}" || "${n}" -lt 1 ]]; then
    dr_fail 2 chunks_incomplete "imported ${n} of ${total} chunks"
  fi
  log "restore ok: ${n} chunks imported"
}

dr_compare_counts() {
  local db="$1" manifest="$2" dir="$3" sql compare
  # Read 40 tables to a query; a table missing from the restore fails its query.
  # shellcheck disable=SC2016 # JavaScript, not shell
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const q = (n) => `"${n.replace(/"/g, "\"\"")}"`;
    const lit = (n) => `${String.fromCharCode(39)}${n.replace(/\x27/g, "\x27\x27")}${String.fromCharCode(39)}`;
    for (let i = 0; i < m.tables.length; i += 40) {
      console.log(m.tables.slice(i, i + 40).map((t) => `SELECT ${lit(t.name)} AS t, COUNT(*) AS n FROM ${q(t.name)}`).join(" UNION ALL ") + ";");
    }' "${manifest}" > "${dir}/counts.sql"
  : > "${dir}/counts.jsonl"
  while IFS= read -r sql <&4; do
    if ! wrangler d1 execute "${db}" --remote --command "${sql}" --json > "${dir}/count.json" 2>"${dir}/count.err"; then
      dr_fail 3 row_counts_unreadable "a row-count query failed (a table in the manifest is missing from the restore)"
    fi
    jq -c '.[] .results[]' "${dir}/count.json" >> "${dir}/counts.jsonl"
  done 4< "${dir}/counts.sql"
  jq -s '.' "${dir}/counts.jsonl" > "${dir}/counts.json"
  if ! compare=$(node "${REPO_ROOT}/scripts/d1-backup-manifest.mjs" compare "${manifest}" "${dir}/counts.json"); then
    dr_fail 3 row_counts_differ "${compare}"
  fi
  log "${compare}"
}
