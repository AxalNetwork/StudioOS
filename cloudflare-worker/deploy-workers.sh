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

echo "==> Applying liquidity schema (one-shot; safe to fail on re-run)…"
npx wrangler d1 execute studioos-db --file=sql/liquidity.sql --remote || true

echo "==> Applying VC fund v2 schema (one-shot; ALTERs fail noisily on re-run)…"
npx wrangler d1 execute studioos-db --file=sql/funds_v2.sql --remote || true

echo "==> Consolidating capital tables (lp_investors → vc_funds + limited_partners)…"
# Phase 1: ALTERs (errors tolerated on re-run — duplicate column).
npx wrangler d1 execute studioos-db --file=sql/consolidate_capital_alters.sql --remote || true

# Phase 2: capital_calls table rebuild. The SQL itself is now fully
# self-recovering — it drops any leftover `capital_calls_new`, rebuilds the
# table to the canonical shape (a no-op on second run since columns already
# match), and uses `INSERT OR IGNORE` for the marker. Always-run is safer
# than a brittle JSON-parsed gate.
echo "    rebuilding capital_calls to relax lp_investor_id NOT NULL (idempotent)…"
npx wrangler d1 execute studioos-db --file=sql/consolidate_capital_rebuild.sql --remote

# Phase 3: data backfill (always run; fully idempotent via NOT EXISTS guards).
npx wrangler d1 execute studioos-db --file=sql/consolidate_capital_backfill.sql --remote

echo "==> Deploying worker to edge…"
npx wrangler deploy

echo "==> Done. Monitoring endpoints live:"
echo "    GET  /api/monitoring/metrics       (admin)"
echo "    GET  /api/monitoring/rate-limits   (admin)"
echo "    GET  /api/monitoring/anomalies     (admin, AI)"
echo "    GET  /api/monitoring/errors        (admin)"
echo "    GET  /api/monitoring/throughput    (admin/partner)"
echo "    POST /api/monitoring/cleanup       (admin, 30-day purge)"
