#!/usr/bin/env bash
# Deploy script for Cloudflare Workers + D1 monitoring stack.
# Requires CLOUDFLARE_API_TOKEN with D1 + Workers Scripts edit permissions.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Applying idempotent monitoring schema (tables + indexes)…"
npx wrangler d1 execute studioos-db --file=sql/monitoring.sql --remote

echo "==> Applying activity_logs columns (one-shot; safe to fail on re-run)…"
# Tolerate failure: the ALTERs error with 'duplicate column' if already applied.
APPLIED=$(npx wrangler d1 execute studioos-db --remote \
  --command="SELECT 1 FROM _migrations WHERE name='activity_logs_observability_columns' LIMIT 1;" \
  --json 2>/dev/null | grep -c '"1": 1' || true)
if [ "${APPLIED}" = "0" ]; then
  npx wrangler d1 execute studioos-db --file=sql/monitoring_alter_activity.sql --remote
else
  echo "    activity_logs columns already applied — skipping."
fi

echo "==> Deploying worker to edge…"
npx wrangler deploy

echo "==> Done. Monitoring endpoints live:"
echo "    GET  /api/monitoring/metrics       (admin)"
echo "    GET  /api/monitoring/rate-limits   (admin)"
echo "    GET  /api/monitoring/anomalies     (admin, AI)"
echo "    GET  /api/monitoring/errors        (admin)"
echo "    GET  /api/monitoring/throughput    (admin/partner)"
echo "    POST /api/monitoring/cleanup       (admin, 30-day purge)"
