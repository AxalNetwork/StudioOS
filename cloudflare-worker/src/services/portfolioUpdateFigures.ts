// D1057's reading of the figures a portfolio update carries, kept apart from routes/portfolio_updates.ts
// so the daily attention check (D8993) can read an update's runway without importing the route's graph,
// which reaches member bank data (D752). The route re-exports it; its callers are unchanged.
import { jload } from '../routes/_t13t14t15_helpers';
import { METRIC_KEYS, validMetricUnit } from './updateShare';

/**
 * D1057 (#2927, #2427 finding 4): the figures an update carries, each with its
 * source. A Share an update row stores them in `metrics_json` (D654), keyed
 * by `METRIC_KEYS` (including recorded ARR and net_retention, #6178); part 3's
 * `REPORT_FIGURES` keys report figures the same way. A row from the older KPI
 * form stores bare values in `kpis_json`, which carry no source. A figure
 * nothing recorded stays null with its reason, never 0.
 */
export function updateFigures(u: { kpis_json?: string | null; metrics_json?: string | null }): {
  figures: Array<{ key: string; label: string; value: number | null; unit: string; source: string | null; as_of: string | null; reason: string | null }>;
  kpis: Record<string, unknown>;
} {
  const stored = jload(u.kpis_json ?? null, {});
  const legacy = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  // Read as stored: the save already checked each figure against the period's snapshots (`cleanMetrics`),
  // so a second pass with no verified list would relabel every source "typed".
  const raw = jload(u.metrics_json ?? null, []);
  const figures = (Array.isArray(raw) ? raw : []).flatMap((m: any) => {
    if (!m || typeof m !== 'object' || !(METRIC_KEYS as readonly string[]).includes(String(m.key))) return [];
    if (!validMetricUnit(String(m.key), m.unit)) return [];
    const value = typeof m.value === 'number' && Number.isFinite(m.value) ? m.value : null;
    const source = typeof m.source === 'string' && m.source.trim() ? m.source.trim() : null;
    // A recorded figure with no source is not one the update may show (D654's rule).
    if (value != null && !source) return [];
    return [{
      key: String(m.key), label: String(m.label ?? m.key).slice(0, 60), value,
      unit: ['usd', 'pct', 'count', 'months'].includes(String(m.unit)) ? String(m.unit) : 'count',
      source: value == null ? null : source,
      as_of: value == null ? null : (typeof m.as_of === 'string' ? m.as_of.slice(0, 10) : null),
      reason: value == null ? (typeof m.reason === 'string' && m.reason ? m.reason : 'Not recorded') : null,
    }];
  });
  // `kpis` stays the flat map the pages already read; a sourced figure fills a key the KPI form left empty.
  const kpis: Record<string, unknown> = {};
  for (const f of figures) if (f.value != null) kpis[f.key] = f.value;
  return { figures, kpis: { ...kpis, ...legacy } };
}
