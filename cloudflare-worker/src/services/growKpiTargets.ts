/** Project-scoped targets beside compatible recorded Grow KPI values (#6102). */
import type { Env } from '../types';
import type { KpiRow } from './growKpis';
import { readTarget, type MetricTarget } from '../../../frontend/src/lib/metricTargets.js';

/** Churn can be ledger money or a percentage; only the percentage has a compatible Focus key. */
export function targetKey(row: KpiRow): string | null {
  if (row.id === 'mrr' && (row.unit === 'usd' || row.value == null)) return 'mrr';
  if (row.id === 'paying_accounts' && (row.unit === 'count' || row.value == null)) return 'paying_accounts';
  if (row.id === 'net_burn' && (row.unit === 'usd' || row.value == null)) return 'net_burn';
  if (row.id === 'churn' && row.unit === 'pct') return 'monthly_churn_pct';
  return null;
}

export async function withKpiTargets(env: Env, projectId: number, rows: KpiRow[]) {
  let targets: MetricTarget[] = []; let unreadable = false;
  try {
    const result = await env.DB.prepare('SELECT metric_key, target_value, direction, label, updated_at FROM metric_targets WHERE project_id = ?')
      .bind(projectId).all<MetricTarget>();
    targets = result.results || [];
  } catch { unreadable = true; console.warn('[growKpiTargets] target read failed'); }
  return rows.map((row) => {
    const base = { ...row, target_href: `/grow/focus?project_id=${encodeURIComponent(String(projectId))}` };
    const key = targetKey(row);
    if (!key) return { ...base, target: null, target_state: 'unsupported' };
    const target = targets.find((t) => t.metric_key === key);
    if (unreadable || (target && (!Number.isFinite(target.target_value) || !['up', 'down'].includes(target.direction)))) return { ...base, target: null, target_state: 'unreadable' };
    if (!target) return { ...base, target: null, target_state: 'not_set' };
    return { ...base, target: readTarget(target, { [key]: row.value }), target_state: 'recorded' };
  });
}
