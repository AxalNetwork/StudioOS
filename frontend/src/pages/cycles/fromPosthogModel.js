// D1609 (#3731, #2409 part 2) — the words and figures of a module's "From
// PostHog" part, kept apart from the drawing so a test can hold them.
//
// A figure is a number, or a dash with its reason: never 0 for a value that
// was not read. Every PostHog figure says "From PostHog, as of <date>".

export const ROLE_CHIPS = Object.freeze([
  ['active_users', 'Active users'], ['new_users', 'New users'], ['activation', 'Activation'],
  ['retention', 'Retention'], ['conversion', 'Conversion'], ['sessions', 'Sessions'], ['other', 'Other'],
]);
export const TRACK_LINE = 'You decide what this insight measures. Axal VC never guesses it from event names.';
export const NOT_LINKED = 'Choose a PostHog project for this venture to see figures here.';
export const DISCONNECTED = 'PostHog is disconnected. Its figures read Not recorded until it is connected again.';
export const NOT_MINE = 'The member whose PostHog serves this venture tracks its metrics.';
export const NO_METRICS = 'No PostHog metric is tracked for this module yet.';
export const DELETE_LINE = 'It leaves this module and stays deleted when PostHog is synced again. PostHog is not changed.';
export const UNTRACK_LINE = 'Its figures leave Axal VC. A KPI or roadmap item that names it reads Not recorded. PostHog is not changed.';

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** A count with separators, or a percentage to one decimal; null for a value that was not read. */
export function figureText(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (unit === 'pct') return `${Math.round(n * 10) / 10}%`;
  return Math.round(n).toLocaleString('en-US');
}

/** "+8 in 30 days", "−3 points in 30 days"; null when there is nothing to compare. */
export function changeText(change, unit) {
  if (change == null || !Number.isFinite(Number(change))) return null;
  const n = Number(change);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  const abs = Math.abs(n);
  const body = unit === 'pct' ? `${Math.round(abs * 10) / 10} ${abs === 1 ? 'point' : 'points'}` : Math.round(abs).toLocaleString('en-US');
  return `${sign}${body} in 30 days`;
}

/** The source line under a figure. */
export const asOfLine = (asOf) => (day(asOf) ? `From PostHog, as of ${day(asOf)}` : 'From PostHog');

/** One tracked metric as the part draws it: its figure, or its reason. */
export function metricRow(t) {
  const figure = figureText(t?.value, t?.unit);
  return {
    name: t?.name || t?.role_words || 'Tracked insight',
    role: t?.role_words || null,
    figure,
    reason: figure ? null : (t?.reason || 'Not recorded'),
    change: figure ? changeText(t?.change_30d, t?.unit) : null,
    source: figure ? asOfLine(t?.as_of) : null,
  };
}

/** What the part shows first: no link, a broken one, or the module's figures. */
export function partState(data) {
  if (!data?.link?.linked) return 'not_linked';
  if (!data.link.active) return 'disconnected';
  return 'ready';
}

/** A refusal in the Worker's own words, or the fallback; never a provider's text. */
export function refusalOf(e, fallback = 'PostHog could not be read. Try again.') {
  const d = e?.data?.detail;
  return typeof d === 'string' && d.length < 200 ? d : fallback;
}

/** The insights a search matches, by name, kept in the list's order. */
export function matchInsights(list, q) {
  const s = String(q || '').trim().toLowerCase();
  const all = Array.isArray(list) ? list : [];
  return s ? all.filter((i) => String(i?.name || i?.short_id || '').toLowerCase().includes(s)) : all;
}
