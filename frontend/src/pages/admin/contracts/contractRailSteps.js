/**
 * D4811 (#4811) part 9 — the Contracts rail's next steps (board CT-07
 * "Eadwyn", CT-90): what needs a person on this page, from the counts the
 * page already read (`GET /api/admin/contracts/stats`, the metric strip's
 * cells). They are drawn in place of the rail's model cards and prices
 * (`ui/RailSteps.jsx`). Each step is a link to the records; nothing here
 * runs a model or acts. Pure: nothing fetches.
 */
import { metricCells } from './contractMetrics';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const RAIL_STEPS_FOOT = 'Eadwyn drafts and analyses. People approve and execute.';
export const RAIL_STEPS_EMPTY = 'Nothing in Contracts is waiting on a person right now.';
export const RAIL_STEPS_UNREADABLE = 'The contract counts could not be read, so what needs attention is unknown.';

/** The link that opens a cell's records, as the desk's own address. */
export function cellHref(drill) {
  if (!drill) return null;
  if (drill.kind === 'tab') return `/admin/contracts?tab=${encodeURIComponent(drill.tab)}`;
  const q = new URLSearchParams({ tab: 'agreements', ...Object.fromEntries(Object.entries(drill.filters || {}).map(([k, v]) => [k, String(v)])) });
  return `/admin/contracts?${q.toString()}`;
}

const WORDS = Object.freeze({
  stalled: (n, cell) => ({ tone: 'act', text: `${plural(n, 'agreement')} ${cell.lines[0] || 'sent long ago'}, not yet executed.`, action: 'Open stalled agreements' }),
  repair: (n) => ({ tone: 'act', text: `${plural(n, 'agreement')} ${n === 1 ? 'needs' : 'need'} data repair.`, action: 'Open repairs' }),
  legal_review: (n) => ({ tone: 'act', text: `${plural(n, 'record')} ${n === 1 ? 'needs' : 'need'} legal review.`, action: 'Open templates' }),
  awaiting: (n) => ({ tone: 'info', text: `${plural(n, 'agreement')} awaiting signature.`, action: 'Open awaiting' }),
  restricted: (n) => ({ tone: 'info', text: `${plural(n, 'restricted record')}: generate, use and publish are off.`, action: 'Open templates' }),
});
const ORDER = ['stalled', 'repair', 'legal_review', 'awaiting', 'restricted'];

/**
 * The rail's `steps` from the page's stats read (`{ loading, error, data, retry }`).
 * A count that is unknown is not a step and never 0; when every count is unknown the rail says so.
 */
export function contractRailSteps(read) {
  const base = { title: 'For Contracts' };
  if (!read || read.loading) return { ...base, state: 'loading' };
  const cells = read.error ? null : metricCells(read.data);
  if (!cells) return { ...base, state: 'unavailable', text: RAIL_STEPS_UNREADABLE, onRetry: read.retry };
  const byKey = Object.fromEntries(cells.map((c) => [c.key, c]));
  const known = ORDER.filter((k) => byKey[k] && byKey[k].value != null);
  if (!known.length) return { ...base, state: 'unavailable', text: RAIL_STEPS_UNREADABLE, onRetry: read.retry };
  const items = known.filter((k) => Number(byKey[k].value) > 0).map((k) => {
    const cell = byKey[k];
    return { key: k, ...WORDS[k](Number(cell.value), cell), to: cellHref(cell.drill) };
  });
  if (!items.length) return { ...base, state: 'empty', text: RAIL_STEPS_EMPTY };
  return { ...base, state: 'ready', items, foot: RAIL_STEPS_FOOT };
}
