#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/dr-second-copy.sh — D4558 (#4558): the independent encrypted copy.
#
# The owner's answers (2026-11-07, A on Q1–Q4): each daily D1 export also goes
# to an S3-compatible bucket in an account outside the production Cloudflare
# account, with object lock in compliance mode. It is encrypted HERE, before
# it leaves the runner, with `age` to a public recipient (a repository
# variable; a public key is not a secret). The owner holds the private key
# offline, so nothing in CI can read a copy. Retention is the bucket's: 35
# daily and 12 monthly recovery points under object lock.
#
#   dr-second-copy.sh upload <backup.sql> <manifest.json>
#
#   1. Encrypt the export to DR_AGE_RECIPIENT.
#   2. Write a copy manifest: the export's manifest (counts, hashes, the
#      recovery point; no row content) plus the ciphertext's sha256 and size
#      and the recipient. It is stored beside the ciphertext, never inside it.
#   3. Put both under `<prefix>/daily/<recovery point>/`, keyed by the export's
#      own start time, so a retry of the same export is the same key and a
#      newer export is a new key: nothing older is ever replaced. Every put is
#      conditional (`If-None-Match: *`) and carries the SHA-256 the store
#      checks. `age` encryption is randomized, so a retried step makes other
#      ciphertext for the same export: each object also carries the PLAINTEXT
#      export's sha256 (`export-sha256`), and a key that already exists is
#      accepted only when that matches (this export, copied by an earlier
#      attempt). Anything else fails, and nothing is replaced.
#   4. On the first export of a month, the same pair also goes under
#      `<prefix>/monthly/<YYYY-MM>/`.
#   5. Read the daily ciphertext's metadata back and check its size and sha256.
#
# The credential is the owner's WRITE-ONLY key for that bucket: this script
# calls `s3api put-object` and `s3api head-object` and nothing else. It never
# deletes, lists or reads object content. Every line it prints is a key, a
# size or a hash.
#
# Env:
#   DR_COPY_ENDPOINT     https:// endpoint of the independent store
#   DR_COPY_BUCKET       its bucket
#   DR_COPY_REGION       optional (default `auto`)
#   DR_COPY_PREFIX       optional (default `d1/<database>`)
#   DR_AGE_RECIPIENT     the owner's age public key (age1…)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   the write-only credential
#
# Exit codes: 0 copied (or already copied by an earlier attempt), 1 setup,
# 2 encryption or upload, 3 the stored copy does not match.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { echo "[dr-second-copy] $*"; }
die() { local rc="$1"; shift; log "FATAL: $*"; exit "$rc"; }

[[ "${1:-}" == "upload" && $# -eq 3 ]] || die 1 "usage: dr-second-copy.sh upload <backup.sql> <manifest.json>"
SQL="$2"; MANIFEST="$3"
[[ -f "${SQL}" && -f "${MANIFEST}" ]] || die 1 "the export or its manifest is missing"

ENDPOINT="${DR_COPY_ENDPOINT:-}"; BUCKET="${DR_COPY_BUCKET:-}"; REGION="${DR_COPY_REGION:-auto}"
RECIPIENT="${DR_AGE_RECIPIENT:-}"
MISSING=()
[[ "${ENDPOINT}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || MISSING+=("DR_COPY_ENDPOINT (an https:// origin)")
[[ "${BUCKET}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || MISSING+=("DR_COPY_BUCKET")
[[ "${RECIPIENT}" =~ ^age1[0-9a-z]{58}$ ]] || MISSING+=("DR_AGE_RECIPIENT (an age1… public key)")
[[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || MISSING+=("the write-only credential")
[[ ${#MISSING[@]} -eq 0 ]] || die 1 "the independent copy is enabled but not configured: ${MISSING[*]}"

POINT=$(jq -r '.exported_at // empty' "${MANIFEST}")
EXPORT_SHA=$(jq -r '.sha256 // empty' "${MANIFEST}")
[[ "${EXPORT_SHA}" =~ ^[0-9a-f]{64}$ && "$(sha256sum "${SQL}" | cut -d' ' -f1)" == "${EXPORT_SHA}" ]] \
  || die 1 "the export does not match its manifest's sha256"
DB=$(jq -r '.database // empty' "${MANIFEST}")
[[ "${POINT}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ && "${DB}" =~ ^[a-z0-9_-]+$ ]] \
  || die 1 "the manifest names no recovery point or database"
PREFIX="${DR_COPY_PREFIX:-d1/${DB}}"
STAMP="${POINT//:/-}"
MONTH="${POINT:0:7}"

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

# 1. Encrypt before anything leaves the runner.
age -r "${RECIPIENT}" -o "${TMP}/backup.sql.age" "${SQL}" || die 2 "encryption failed"
CT_SHA=$(sha256sum "${TMP}/backup.sql.age" | cut -d' ' -f1)
CT_B64=$(openssl dgst -sha256 -binary "${TMP}/backup.sql.age" | base64)
CT_SIZE=$(stat -c%s "${TMP}/backup.sql.age")

# 2. The copy manifest.
jq --arg sha "${CT_SHA}" --argjson size "${CT_SIZE}" --arg recipient "${RECIPIENT}" \
  '. + {independent_copy: {encryption: "age", recipient: $recipient, ciphertext_sha256: $sha, ciphertext_size_bytes: $size}}' \
  "${MANIFEST}" > "${TMP}/manifest.json"
MF_SHA=$(sha256sum "${TMP}/manifest.json" | cut -d' ' -f1)
MF_B64=$(openssl dgst -sha256 -binary "${TMP}/manifest.json" | base64)

s3() { aws s3api "$@" --endpoint-url "${ENDPOINT}" --region "${REGION}"; }

# One conditional, checksummed put. An existing key is fine only when it holds
# this same export (a retried attempt); anything else is never replaced.
ALREADY=0
put_once() {
  local key="$1" file="$2" sha="$3" b64="$4" type="$5"
  if s3 put-object --bucket "${BUCKET}" --key "${key}" --body "${file}" --content-type "${type}" \
       --if-none-match '*' --checksum-algorithm SHA256 --checksum-sha256 "${b64}" \
       --metadata "sha256=${sha},export-sha256=${EXPORT_SHA}" > "${TMP}/put.json" 2> "${TMP}/put.err"; then
    log "stored ${key} ($(stat -c%s "${file}") bytes, sha256 ${sha})"
    return 0
  fi
  if grep -qE 'PreconditionFailed|\(412\)' "${TMP}/put.err"; then
    local have
    have=$(s3 head-object --bucket "${BUCKET}" --key "${key}" 2>/dev/null | jq -r '.Metadata["export-sha256"] // empty' || true)
    if [[ "${have}" == "${EXPORT_SHA}" ]]; then log "already stored ${key} for this export: an earlier attempt"; ALREADY=1; return 0; fi
    die 3 "${key} already holds different bytes; nothing was replaced"
  fi
  die 2 "the put of ${key} failed: $(grep -oE 'An error occurred \([A-Za-z]+\)' "${TMP}/put.err" | head -1 || echo 'no error code')"
}

# 3. The daily recovery point.
DAILY="${PREFIX}/daily/${STAMP}"
put_once "${DAILY}/backup.sql.age" "${TMP}/backup.sql.age" "${CT_SHA}" "${CT_B64}" application/octet-stream
put_once "${DAILY}/manifest.json" "${TMP}/manifest.json" "${MF_SHA}" "${MF_B64}" application/json

# 4. The month's first recovery point, kept 12 months.
MONTHLY="${PREFIX}/monthly/${MONTH}"
if s3 head-object --bucket "${BUCKET}" --key "${MONTHLY}/manifest.json" > /dev/null 2>&1; then
  log "this month's point is already kept under ${MONTHLY}/"
else
  put_once "${MONTHLY}/backup.sql.age" "${TMP}/backup.sql.age" "${CT_SHA}" "${CT_B64}" application/octet-stream
  put_once "${MONTHLY}/manifest.json" "${TMP}/manifest.json" "${MF_SHA}" "${MF_B64}" application/json
fi

# 5. Read back what the store holds.
HEAD=$(s3 head-object --bucket "${BUCKET}" --key "${DAILY}/backup.sql.age") || die 3 "the stored copy cannot be read back"
if [[ "${ALREADY}" -eq 1 ]]; then
  [[ "$(jq -r '.Metadata["export-sha256"] // empty' <<< "${HEAD}")" == "${EXPORT_SHA}" ]] || die 3 "the stored copy is of another export"
else
  [[ "$(jq -r '.ContentLength' <<< "${HEAD}")" == "${CT_SIZE}" && "$(jq -r '.Metadata.sha256 // empty' <<< "${HEAD}")" == "${CT_SHA}" ]] \
    || die 3 "the stored copy's size or sha256 differs from what was sent"
fi
log "independent copy verified: ${DAILY}/ ($(jq -r '.ContentLength' <<< "${HEAD}") bytes, sha256 $(jq -r '.Metadata.sha256 // empty' <<< "${HEAD}"))"
# The last line is the recovery point's prefix, for the heartbeat.
printf '%s\n' "${DAILY}"
