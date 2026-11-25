/**
 * D6007 (#6007, V24): Compare segments, the pure half. Compare is a mode on the Ideal customer profile page
 * (`?compare=1,2,3`, owner option A on D5995), not a route of its own. These functions read and write that
 * parameter, choose the first columns, and turn the Worker's compare read into rows of stored values only:
 * anything unwritten is `null`, which the page draws as Not recorded.
 */

export const COMPARE_PARAM = 'compare';
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;
/** Columns chosen when the page opens Compare with none named: the canvas draws three. */
export const COMPARE_DEFAULT = 3;

const ID = /^[1-9][0-9]{0,9}$/;

/** Is this page in compare mode? Only when the parameter is present (even empty). */
export function inCompare(searchParams) {
  return !!searchParams && typeof searchParams.has === 'function' && searchParams.has(COMPARE_PARAM);
}

/** The segment ids the parameter names: valid ids only, each once, in order, at most four. */
export function compareIds(searchParams) {
  const raw = String(searchParams?.get?.(COMPARE_PARAM) ?? '');
  const out = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (ID.test(id) && !out.includes(id)) out.push(id);
    if (out.length === COMPARE_MAX) break;
  }
  return out;
}

/**
 * The columns to show: the ids named, topped up from the venture's segments (the primary first, then the
 * list's order) until there are `COMPARE_DEFAULT`, but only when fewer than two are named. A record's
 * "Compare segments" names one, so it opens beside the next ones.
 */
export function chosenIds(named, segments) {
  const ids = named.slice(0, COMPARE_MAX);
  if (ids.length >= COMPARE_MIN) return ids;
  const pool = [...(segments || [])].filter((s) => s && s.id != null)
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  for (const s of pool) {
    if (ids.length >= COMPARE_DEFAULT) break;
    const id = String(s.id);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The search string with the compare ids set (or the mode left, when `ids` is null), other params kept. */
export function withCompare(search, ids) {
  const params = new URLSearchParams(search || '');
  if (ids == null) params.delete(COMPARE_PARAM);
  else params.set(COMPARE_PARAM, ids.join(','));
  const s = params.toString().replace(/%2C/g, ',');
  return s ? `?${s}` : '';
}

/** Remove a column; never below two (the page offers no Remove then). */
export function removeId(ids, id) {
  return ids.length <= COMPARE_MIN ? ids : ids.filter((x) => x !== String(id));
}

/** Add a column; never above four, never twice. */
export function addId(ids, id) {
  const s = String(id);
  return ids.length >= COMPARE_MAX || ids.includes(s) || !ID.test(s) ? ids : [...ids, s];
}

const URGENCY = { low: 'Low', medium: 'Medium', high: 'High' };
const EVIDENCE = { anecdote: 'Anecdote', pattern: 'Pattern' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "5 · 4 strong, 1 partial": the held interviews and the fits recorded on them; no computed score. */
export function fitLine(s) {
  if (!s || !Number.isFinite(s.interviews) || s.interviews === 0) return null;
  const parts = [[s.strong, 'strong'], [s.partial, 'partial'], [s.none, 'no fit'], [s.unrecorded, 'not recorded']]
    .filter(([n]) => Number.isFinite(n) && n > 0).map(([n, w]) => `${n} ${w}`);
  return `${plural(s.interviews, 'interview', 'interviews')} · ${parts.join(', ')}`;
}

/**
 * The canvas's rows, each a label and a reader. A reader returns a string, a list, or `null` (Not recorded);
 * Urgency's `null` reads "Not set" and the value source's reads "Needs a source" when a value is promised.
 */
export const COMPARE_ROWS = [
  { key: 'who_they_are', label: 'Who they are', read: (s) => s.steps?.who_they_are ?? null },
  { key: 'context', label: 'Context', read: (s) => s.steps?.context ?? null },
  { key: 'job_to_be_done', label: 'Job to be done', read: (s) => s.steps?.job_to_be_done ?? null },
  { key: 'urgency', label: 'Urgency', read: (s) => URGENCY[s.steps?.urgency] ?? null, empty: 'Not set' },
  { key: 'value_promised', label: 'Value promised', read: (s) => s.steps?.value_promised ?? null },
  { key: 'value_source', label: 'Value source', read: (s) => s.value_source ?? null,
    empty: (s) => (s.steps?.value_promised ? 'Needs a source' : 'Not recorded') },
  { key: 'interviews', label: 'Interviews and fit', read: (s) => fitLine(s), empty: 'No held interview yet' },
  { key: 'evidence', label: 'Evidence', read: (s) => EVIDENCE[s.evidence] ?? null },
  { key: 'themes', label: 'Top pain themes', read: (s) => (s.top_themes?.length ? s.top_themes.map((t) => `${t.title} (${t.mentions})`) : null) },
  { key: 'firmographics', label: 'Firmographics', read: (s) => (s.firmographics?.length ? s.firmographics.map((f) => `${f.label}: ${f.value}`) : null) },
  { key: 'disqualifiers', label: 'Disqualifiers', read: (s) => (s.disqualifiers?.length ? s.disqualifiers : null) },
];

/** One cell: `{ value }` (a string or list) or `{ empty }`, the words for a value that is not recorded. */
export function cellOf(row, segment) {
  const value = row.read(segment);
  if (value != null && !(Array.isArray(value) && value.length === 0)) return { value };
  const empty = typeof row.empty === 'function' ? row.empty(segment) : row.empty || 'Not recorded';
  return { empty };
}
