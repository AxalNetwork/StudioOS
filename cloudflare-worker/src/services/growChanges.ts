// Builds Grow Overview’s recent changes from project activity, sent updates and metric snapshots.
import type { Figure } from './cycleCards';
import { GROW_MODULES, type Ctx } from './growCycle';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type ChangeLogRow = { id: number; kind: 'write' | 'update'; area: string; details: string | null; recorded_at: string };
type Change = { key: string; at: string; label: string; href: string; source: string; figure?: Pick<Figure, 'unit' | 'delta_30d'> };

function recordedTime(value: string): number {
  return Date.parse(value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, '$1T$2Z'));
}

export async function growChanges(x: Ctx, figures: Figure[], writer: boolean): Promise<{ state: 'ready'; items: Change[] } | { state: 'unreadable' }> {
  try {
    const cutoff = x.now - WINDOW_MS;
    const from = new Date(cutoff).toISOString();
    const to = new Date(x.now).toISOString();
    const types = JSON.stringify(GROW_MODULES.map(({ slug }) => `grow.${slug}`));
    const result = await x.env.DB.prepare(
      `SELECT id, kind, area, details, recorded_at FROM (
        SELECT id, 'write' AS kind, entity_type AS area, details, created_at AS recorded_at
        FROM activity_logs
        WHERE project_id = ? AND entity_type IN (SELECT value FROM json_each(?))
          AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
        UNION ALL
        SELECT id, 'update' AS kind, 'reporting' AS area, NULL AS details, sent_at AS recorded_at
        FROM portfolio_updates
        WHERE project_id = ? AND datetime(sent_at) BETWEEN datetime(?) AND datetime(?)
      ) ORDER BY datetime(recorded_at) DESC, kind, id DESC LIMIT 5`,
    ).bind(x.projectId, types, from, to, x.projectId, from, to).all<ChangeLogRow>();
    const items: Change[] = [];
    for (const row of result.results ?? []) {
      if (row.kind === 'update') {
        items.push({ key: `update:${row.id}`, at: row.recorded_at, label: 'Update sent', source: 'Reporting',
          href: `/grow/reporting?project=${x.projectId}` });
        continue;
      }
      const area = GROW_MODULES.find(({ slug }) => row.area === `grow.${slug}`);
      if (!area) continue;
      items.push({ key: `write:${row.id}`, at: row.recorded_at, label: (writer && row.details) || `${area.name} record changed`,
        href: x.href(area.slug), source: 'Grow activity log' });
    }
    for (const figure of figures) {
      // NRR compares available ledger periods and the roster figure counts
      // recent starts. Neither is necessarily a 30-day like-for-like delta.
      if (figure.key !== 'mrr' && figure.key !== 'customers') continue;
      if (!figure.as_of || !figure.source || !Number.isFinite(figure.delta_30d) || !figure.delta_30d) continue;
      const at = recordedTime(figure.as_of);
      if (!Number.isFinite(at) || at < cutoff || at > x.now) continue;
      items.push({ key: `figure:${figure.key}`, at: figure.as_of, label: figure.label, source: figure.source,
        href: x.href('revenue-and-traction'),
        figure: { unit: figure.unit, delta_30d: figure.delta_30d } });
    }
    items.sort((a, b) => recordedTime(b.at) - recordedTime(a.at));
    return { state: 'ready', items: items.slice(0, 5) };
  } catch {
    return { state: 'unreadable' };
  }
}
