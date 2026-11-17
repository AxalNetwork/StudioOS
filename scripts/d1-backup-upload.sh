#!/usr/bin/env bash
# Upload the primary D1 export with the S3 multipart transfer client.
# R2 uses the API token's ID as the access key ID and the SHA-256 of its
# value as the secret. Both credentials live only in this process tree.
# https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token
set -euo pipefail

if [[ ! "${CLOUDFLARE_ACCOUNT_ID:-}" =~ ^[a-fA-F0-9]{32}$ ]]; then
  echo 'A valid CLOUDFLARE_ACCOUNT_ID is required for the primary R2 endpoint.' >&2
  exit 1
fi
: "${CLOUDFLARE_API_TOKEN:?}" "${BACKUP_BUCKET:?}" "${BACKUP_KEY:?}"
file=${1:?Supply the SQL export to upload}

token_id() {
  printf 'Authorization: Bearer %s\n' "${CLOUDFLARE_API_TOKEN}" |
    curl --fail --silent --max-time 20 --header @- "https://api.cloudflare.com/client/v4/$1/tokens/verify" |
    jq -er 'select(.success == true and .result.status == "active") | .result.id | strings | select(test("^[0-9a-fA-F]{32}$"))'
}

if ! AWS_ACCESS_KEY_ID=$(token_id user) && ! AWS_ACCESS_KEY_ID=$(token_id "accounts/${CLOUDFLARE_ACCOUNT_ID}"); then
  echo 'Cloudflare could not verify an active token for the primary R2 upload.' >&2
  exit 1
fi
AWS_SECRET_ACCESS_KEY=$(printf '%s' "${CLOUDFLARE_API_TOKEN}" | sha256sum | cut -d' ' -f1)
unset CLOUDFLARE_API_TOKEN AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
# The backup workflow verifies the SHA-256 of the complete object on readback.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
exec aws s3 cp "${file}" "s3://${BACKUP_BUCKET}/${BACKUP_KEY}" \
  --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region auto --content-type application/sql --only-show-errors
