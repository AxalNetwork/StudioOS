/**
 * D6033 (#6033, BD25, BD32, BD33, BD34) — the words Solution design's Risks list draws, apart from React.
 *
 * The list is its own read (`GET /cycles/build/risks`, 25 a page); the module read keeps its counts.
 * Severity and state always carry a word and a glyph. An empty owner is "No owner", an empty
 * mitigation "No mitigation recorded", a risk with no feature "Not tied to a feature" (an accepted
 * Build Plan risk writes none), and "Addressed by test" is "Not recorded yet": nothing stores it.
 */
export const RISKS_PER_PAGE = 25;
/** BD32: filters appear once the list holds ten risks. */
export const FILTERS_FROM = 10;

export const SEVERITY = Object.freeze({
  high: { word: 'High', glyph: '▲', tone: 'bad' },
  medium: { word: 'Medium', glyph: '◆', tone: 'warn' },
  low: { word: 'Low', glyph: '▽', tone: 'grey' },
});
export const RISK_STATE = Object.freeze({
  open: { word: 'Open', glyph: '○' },
  mitigating: { word: 'Mitigating', glyph: '◐' },
  closed: { word: 'Closed', glyph: '✓' },
});
export const SEVERITY_ORDER = ['high', 'medium', 'low'];
export const STATE_ORDER = ['open', 'mitigating', 'closed'];

export const EMPTY_TITLE = 'No risks recorded';
export const EMPTY_LINE = 'Name what could stop the MVP, and who watches it.';
export const UNAVAILABLE_TITLE = 'Risks are unavailable';
export const UNAVAILABLE_LINE = 'The risks list could not be read. The counts above and the features still work. Adding a risk still works.';
export const NOT_TIED = 'Not tied to a feature';
export const NO_OWNER = 'No owner';
export const NO_MITIGATION = 'No mitigation recorded';
export const NOT_ADDRESSED = 'Not recorded yet';
export const FROM_PLAN = 'From the Build Plan';
export const OWNER_FIXED = 'Owner and feature can’t be changed after the risk is added yet.';

const said = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A severity or a state as its word and glyph; an unknown value is Not recorded, never a guess. */
export const severityOf = (s) => SEVERITY[s] ?? { word: 'Not recorded', glyph: '○', tone: 'grey' };
export const stateOf = (s) => RISK_STATE[s] ?? { word: 'Not recorded', glyph: '○' };

export function ownerText(row) {
  if (!row?.owner) return NO_OWNER;
  if (row.owner.you) return 'You';
  return said(row.owner.name) ?? 'Unnamed member';
}
export const featureText = (row) => (row?.feature ? said(row.feature.title) ?? 'Unnamed feature' : NOT_TIED);
export const mitigationText = (row) => (said(row?.mitigation) ? `Mitigation · ${said(row.mitigation)}` : NO_MITIGATION);

/** The list head: "7 recorded", with each severity's count. */
export function headCounts(counts) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { recorded: n(counts?.all), bySeverity: SEVERITY_ORDER.map((k) => ({ key: k, ...SEVERITY[k], count: n(counts?.[k]) })) };
}

/** "1–7 of 7 · 25 per page"; "0 of 0" for a filter that matches none. */
export function rangeText({ page = 1, per_page: per = RISKS_PER_PAGE, total = 0 } = {}) {
  if (!total) return `0 of 0 · ${per} per page`;
  const from = (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  return `${from}–${to} of ${total} · ${per} per page`;
}

export const showFilters = (counts) => Number(counts?.all ?? 0) >= FILTERS_FROM;

/** The two chip rows, each option with its count from the read's unfiltered counts. */
export function filterChips(counts) {
  const n = (k) => Number(counts?.[k] ?? 0);
  return [
    { key: 'state', label: 'State', options: [{ value: '', label: 'All', count: n('all') }, ...STATE_ORDER.map((s) => ({ value: s, label: RISK_STATE[s].word, count: n(s) }))] },
    { key: 'feature', label: 'Feature', options: [{ value: '', label: 'All', count: n('all') },
      { value: 'tied', label: 'Tied to a feature', count: n('tied') }, { value: 'untied', label: NOT_TIED, count: n('untied') }] },
  ];
}

/** What a page of the list is: loading, its rows, None (the read worked and found nothing) or Unavailable. */
export function listView(status, data, filter = {}) {
  if (status === 'loading') return { kind: 'loading' };
  if (status !== 'ready' || !data || !Array.isArray(data.rows)) return { kind: 'unavailable' };
  if (!data.rows.length) {
    const filtered = Boolean(filter.state || filter.feature);
    return filtered ? { kind: 'no-match' } : { kind: 'empty' };
  }
  return { kind: 'rows', rows: data.rows };
}

/** Add a risk's body for `POST /risks`; null fields are left out of nothing (the route reads null as none). */
export function addBody(form) {
  const title = said(form?.title);
  if (!title) return { error: 'Name the risk.' };
  if (!SEVERITY[form?.severity]) return { error: 'Choose a severity.' };
  const id = (v) => (/^[1-9]\d*$/.test(String(v ?? '')) ? Number(v) : null);
  return { body: { title, severity: form.severity, owner_user_id: id(form.owner), feature_id: id(form.feature), mitigation: said(form.mitigation) } };
}

/** Edit risk's body for `PATCH /risks/:id`: title, severity, mitigation and state. Owner and feature are read only. */
export function editBody(form, row) {
  const title = said(form?.title);
  if (!title) return { error: 'Name the risk.' };
  if (!SEVERITY[form?.severity]) return { error: 'Choose a severity.' };
  if (!RISK_STATE[form?.state]) return { error: 'Choose a state.' };
  const body = { title, severity: form.severity, state: form.state, mitigation: said(form.mitigation) };
  const same = row && body.title === row.title && body.severity === row.severity && body.state === row.state && body.mitigation === (said(row.mitigation));
  return same ? { error: 'Change something to save.' } : { body };
}

/** A blank Edit form, from the row. */
export const editForm = (row) => ({ title: row?.title ?? '', severity: row?.severity ?? 'medium', state: row?.state ?? 'open', mitigation: row?.mitigation ?? '' });
export const addForm = (featureId = '') => ({ title: '', severity: 'high', owner: '', feature: featureId ? String(featureId) : '', mitigation: '' });
