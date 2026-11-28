/**
 * D4866 (#4866, Grow v2 GR-10): "Readiness for the next update", read from the same figures the Grow overview
 * draws. Pure, so a plain `node --test` runs it.
 *
 * The rows are the overview read's own figures (`GET /api/cycles/grow/overview`) through D4864's `growKpi`, so a
 * row says exactly what the overview's card says: a current value, Stale with its age, Not recorded with its
 * reason, or Unavailable. Highlights count the read's "What changed" items. Nothing here decides that an update
 * is due or that the record is complete: a figure counts as ready only when it holds a current value.
 */
import { adaptOverview } from '../adapters/index.js';
import { growKpi, sourceLine } from '../growKpiModel.js';

/** `{ state: 'ready', rows, ready, total }` from one overview read; `{ state: 'unavailable' }` when it holds no figures. */
export function readinessRows(raw, { now = Date.now() } = {}) {
  const data = raw && typeof raw === 'object' && Array.isArray(raw.figures) ? adaptOverview('grow', raw) : null;
  if (!data || !Array.isArray(data.figures)) return { state: 'unavailable', rows: [], ready: 0, total: 0 };
  const rows = data.figures.map((fig) => {
    // A reader's view: the desk is not where a figure is fixed, so no recovery action is carried.
    const k = growKpi(fig, { readOnly: true, now });
    const kind = k.state === 'value' ? (k.stale ? 'stale' : 'current') : k.state;
    return { key: String(k.key ?? k.label), label: k.label, value: k.state === 'value' ? k.value : null, kind,
      age: k.stale?.age || null, detail: kind === 'not_recorded' ? k.reason : sourceLine(k) };
  });
  const changes = raw.changes;
  const n = changes?.state === 'ready' && Array.isArray(changes.items) ? changes.items.length : null;
  rows.push({ key: 'highlights', label: 'Highlights', value: n ? `${n} from What changed` : null,
    kind: n == null ? 'unavailable' : n ? 'current' : 'none', age: null,
    detail: n == null ? 'Recent Grow changes could not be read.' : n ? 'Recorded in the last 30 days.' : 'Nothing recorded in the last 30 days.' });
  const figures = rows.filter((r) => r.key !== 'highlights');
  return { state: 'ready', rows, ready: figures.filter((r) => r.kind === 'current').length, total: figures.length };
}
