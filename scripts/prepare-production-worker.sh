#!/usr/bin/env bash
# D5501: package and profile the production Worker without publishing it.
set -euo pipefail

candidate=$1
out=$2
if [[ ! "$candidate" =~ ^[0-9a-f]{40}$ ]] || [[ "$(git rev-parse HEAD)" != "$candidate" ]]; then
  echo 'The checkout does not match the trusted release candidate.' >&2
  exit 1
fi
mkdir -p "$out"
printf '%s\n' "$candidate" > "$out/candidate.txt"
(
  cd cloudflare-worker
  WRANGLER_SEND_METRICS=false node node_modules/wrangler/bin/wrangler.js deploy --dry-run \
    --config ../wrangler.toml --env production --var "WORKER_DEPLOY_VERSION:$candidate" \
    --outfile "$out/worker.bundle" 2>&1 | tee "$out/package.log"
)
node scripts/check-worker-startup.mjs "$candidate" "$out/worker.bundle" "$out/startup"
