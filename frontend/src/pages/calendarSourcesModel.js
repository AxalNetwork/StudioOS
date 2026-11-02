/**
 * D1484 part 2 (#3978, of #3723) — the CAL4 sources panel, as data. Pure.
 *
 * The panel draws the Worker's `GET /calendar/sources` grouped by family: each
 * source's toggle, its colour (a palette token, or its family's) and its count
 * in the page's range. The count comes from the page read (`GET /calendar/events`),
 * never stored: a source that did not answer shows "—" with why, never 0
 * (D1205's `chipCount`), and a hidden source was not read, so it says so.
 */
import { chipCount } from './calendarViews';

export const SOURCES_PATH = '/calendar/sources';

/** The palette tokens, in the Worker's order (`services/calendar/prefs.ts` COLOURS). */
export const COLOURS = Object.freeze(['violet', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate']);
export const COLOUR_LABELS = Object.freeze({
  violet: 'Violet', blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', orange: 'Orange', red: 'Red', pink: 'Pink', slate: 'Slate',
});

/** Whether an address opens the sources panel. */
export const sourcesOpen = (pathname = '') => String(pathname).replace(/\/+$/, '') === SOURCES_PATH;

const WHY = Object.freeze({
  unreadable: 'Did not answer this time.',
  not_configured: 'Not set up on this server.',
});

/**
 * One source's count for the panel: `{ text, why }`.
 *   - hidden: not read, so no count;
 *   - failed: "—" and its reason;
 *   - otherwise the number in range (0 only when the source answered with nothing);
 *   - the page read itself failed: "—".
 */
export function countOf(key, { shown, items, sources }) {
  if (!shown) return { text: 'Hidden', why: 'Not read while hidden.' };
  if (!Array.isArray(items)) return { text: '—', why: 'The calendar could not be read.' };
  const status = (sources || []).find((s) => s?.kind === key);
  const failed = new Set((sources || []).filter((s) => s && s.ok === false).map((s) => s.kind));
  if (failed.has(key)) return { text: '—', why: WHY[status?.error] || WHY.unreadable };
  const n = chipCount(items, key, failed);
  return { text: String(n), why: null };
}

/**
 * The panel's groups: each family with its sources, in the Worker's order,
 * leaving out a family with none, and any source the page cannot show (`allowed`).
 */
export function groupsOf(read, { allowed = null } = {}) {
  const sources = (read?.sources || []).filter((s) => !allowed || allowed.includes(s.key));
  return (read?.families || [])
    .map((f) => ({ key: f.key, label: f.label, sources: sources.filter((s) => s.family === f.key) }))
    .filter((g) => g.sources.length);
}

/** Each source's colour token by key, for the rail's dots: only the ones set. */
export const coloursOf = (read) => Object.fromEntries((read?.sources || []).filter((s) => s.colour).map((s) => [s.key, s.colour]));

/** A source's row after a write, in the read. */
export const withSource = (read, source) => (read ? { ...read, sources: read.sources.map((s) => (s.key === source.key ? { ...s, ...source } : s)) } : read);
