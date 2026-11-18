/**
 * D7171 part 2 (#7171, canvas D7036, boards RMD-01, RMD-08, RMD-11, RMD-13) —
 * the Markets header's three ops: Export view, New market research and Edit
 * thesis.
 *
 * EXPORT VIEW WRITES THE VIEW, NOT THE PAGE. The directory shows 25 markets a
 * page, and the Worker answers at most 100 a read. The file is every market the
 * view's search, filters, thesis switch and sort leave: it pages
 * `GET /api/research/markets` with the exact request the page made (offset 0,
 * 100 at a time) until the Worker's `total` is reached, in the view's order.
 * A view larger than `EXPORT_MAX` is refused with a sentence, never cut short.
 * A value no source holds is written "Not recorded", never a blank or a zero.
 *
 * NEW MARKET RESEARCH opens My Research's existing New research form
 * (`?new=1&question=`, D5157) with the market named: the open row's market, or
 * the search when no row is open. It creates nothing by itself.
 *
 * EDIT THESIS opens Settings › My thesis, where the investor profile's thesis is
 * edited (the same place the thesis section links to).
 */
import { exportView } from '../../lib/csvExport';
import { thesisMatch } from './marketDirectoryQuery.js';

/** Rows per Worker read while exporting (the Worker's MAX_LIMIT). */
export const EXPORT_PAGE = 100;
/** The most markets one file holds; a larger view is refused, never cut short. */
export const EXPORT_MAX = 5000;

export const THESIS_EDIT = '/account/security-privacy#my-thesis';
const NR = 'Not recorded';

/** `/research/projects?new=1&question=…` — the New research form, the market named. */
export function newMarketResearchHref(question) {
  const q = String(question || '').trim().slice(0, 1000);
  return `/research/projects?new=1${q ? `&question=${encodeURIComponent(q)}` : ''}`;
}

/** What New market research names: the open row's market, else the search, else nothing. */
export function researchSubject(view, items = []) {
  const open = view?.open ? (items || []).find((m) => m?.slug === view.open) : null;
  return open?.name || view?.q || '';
}

const DAY = 86_400_000;
const utc = (d) => {
  const k = String(d || '').replace(' ', 'T');
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(k) || !k.includes('T') ? k : `${k}Z`);
  return Number.isFinite(ms) ? ms : null;
};

/** The file's columns: the table's five, the source kinds apart, and the thesis when the reader has one. */
export function marketCsvHeader(thesis = null) {
  return [
    'Market', 'Tracked sector', 'Taxonomy company count (not market size)', 'Countries represented',
    'Distinct sources', 'Sector-level sources', 'Sources naming the market', 'Latest source', 'Latest source age (days)',
    ...(thesis ? ['Your thesis'] : []),
  ];
}

/** One market → its cells under `marketCsvHeader(thesis)`. */
export function marketCsvRow(m, readAt, thesis = null) {
  const recorded = (f) => f?.status === 'recorded';
  const countries = recorded(m?.countries) ? m.countries.value.map((c) => `${c.code} ${c.count}`).join('; ') : NR;
  const sourced = recorded(m?.source_count);
  const newest = recorded(m?.newest_source_at) ? m.newest_source_at.value : null;
  const a = utc(newest); const b = utc(readAt);
  const age = a == null || b == null ? NR : Math.max(0, Math.floor((b - a) / DAY));
  const row = [
    m?.name ?? NR,
    m?.mi_sector || 'Not mapped yet',
    m?.supplied_count ?? NR,
    countries,
    sourced ? m.source_count.value : NR,
    sourced ? (m.sources_by_kind?.market_intel?.count ?? NR) : NR,
    sourced ? (m.sources_by_kind?.signal_evidence?.count ?? NR) : NR,
    newest ? String(newest).slice(0, 10) : NR,
    newest ? age : NR,
  ];
  if (thesis) {
    const t = thesisMatch(m, thesis);
    row.push(t.kind === 'match' ? `Matches via ${t.through.join(', ')}` : (t.kind === 'no_sector' ? 'No tracked sector' : 'Not a thesis sector'));
  }
  return row;
}

/**
 * Every market the request answers, in its order: offset 0, `EXPORT_PAGE` a
 * read, until the Worker's total. Throws `{ code: 'too_many' }` past `max`.
 */
export async function readWholeView(list, request, { page = EXPORT_PAGE, max = EXPORT_MAX } = {}) {
  const base = { ...(request || {}), limit: page, offset: undefined };
  const items = [];
  let total = null;
  let readAt = null;
  for (let offset = 0; total == null || offset < total; offset += page) {
    const res = await list({ ...base, offset: offset || undefined });
    if (total == null) {
      total = Number(res?.total) || 0;
      readAt = res?.read_at || null;
      if (total > max) throw Object.assign(new Error('too_many'), { code: 'too_many', total });
    }
    const got = res?.items || [];
    items.push(...got);
    if (!got.length) break;
  }
  return { items: items.slice(0, total ?? items.length), total: total ?? 0, readAt };
}

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * The op's state from the directory's read (`{ status, data, request }`):
 * live only once the read is in and holds a market.
 */
export function exportControl(read) {
  if (!read || read.status === 'loading' || read.status === 'idle') {
    return { disabled: true, title: 'The markets are still loading.' };
  }
  if (read.status !== 'ready' || !read.data) {
    return { disabled: true, title: 'The markets could not be read, so there is nothing to write.' };
  }
  const total = Number(read.data.total) || 0;
  if (!total) return { disabled: true, title: 'No market is in this view.' };
  return { disabled: false, total, title: `Writes the ${fmt(total)} ${total === 1 ? 'market' : 'markets'} this view holds, every page, as CSV.` };
}

/**
 * Run the export: read the whole view, write the file. Returns the note the
 * page shows, `{ ok, text }`. `save` is `exportView` (injected for tests).
 */
export async function runViewExport(read, { list, save = exportView } = {}) {
  let whole;
  try {
    whole = await readWholeView(list, read.request);
  } catch (e) {
    if (e?.code === 'too_many') {
      return { ok: false, text: `This view holds ${fmt(e.total)} markets, more than one file takes (${fmt(EXPORT_MAX)}). Narrow it with search or filters, then export.` };
    }
    return { ok: false, text: 'The markets could not be read for the file, so nothing was written. Try again.' };
  }
  const thesis = read.thesis || null;
  const rows = whole.items.map((m) => marketCsvRow(m, whole.readAt, thesis));
  let ok = false;
  try { ok = rows.length ? save({ scope: null, zone: 'markets-view', header: marketCsvHeader(thesis), rows }) !== false : false; } catch { ok = false; }
  if (!ok) return { ok: false, text: rows.length ? 'The file could not be written.' : 'No market is in this view.' };
  return { ok: true, text: `Downloaded ${fmt(rows.length)} ${rows.length === 1 ? 'market' : 'markets'}: every market this view holds.` };
}
