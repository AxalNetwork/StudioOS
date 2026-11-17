/**
 * D6865 (#6865) — the words and shapes of Grow › Feedback's counts, a theme's
 * weight and Close the loop (the #6099 canvas, GR-21, GR-23, GR-26, GR-28),
 * from the Worker's `parts.counts`, `GET /feedback/weight` and
 * `POST /feedback/told`. Pure, so the page and its tests read the same rules:
 * zero, Not recorded and Unreadable never look alike, and no score is drawn.
 */
import { formatMinor } from '../../lib/money.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The tab's three counts, each saying what it counts; null (a failed read) is Unreadable, never zeros. */
export function countsStrip(counts) {
  if (!counts || typeof counts !== 'object') return { state: 'unreadable', line: 'Counts unreadable: the feedback could not be counted. This is not a claim that there is none.' };
  return {
    state: 'ok',
    tiles: [
      { key: 'open', value: Number(counts.open_items) || 0, label: 'open items' },
      { key: 'themes', value: Number(counts.themes) || 0, label: Number(counts.themes) === 1 ? 'theme' : 'themes' },
      { key: 'told', value: Number(counts.shipped_not_told) || 0, label: 'shipped and not yet told' },
    ],
    period: `Across ${plural(Number(counts.items) || 0, 'item', 'items')}: ${counts.period || 'all feedback recorded on this venture'}`,
  };
}

/** Themes ranked by item count (then by name), as GR-21 lists them. */
export function rankThemes(themes) {
  return (Array.isArray(themes) ? themes : []).filter((t) => t && typeof t.theme === 'string')
    .slice().sort((a, b) => (Number(b.feedback) || 0) - (Number(a.feedback) || 0) || a.theme.localeCompare(b.theme));
}

/** Recurring revenue in the window, one line per currency; none recorded is said in words, never "$0". */
export function revenueLines(revenue) {
  const list = Array.isArray(revenue?.by_currency) ? revenue.by_currency : [];
  const days = Number(revenue?.window_days) || 60;
  if (!list.length) return { amounts: [], line: `Not recorded: no recurring revenue on the ledger names the askers’ companies in the last ${days} days` };
  const amounts = list.map((m) => formatMinor(Number(m.cents), String(m.currency).toUpperCase(), { trimWhole: true }) ?? `${m.cents} ${m.currency}`);
  const of = `${Number(revenue.companies_with_revenue) || 0} of ${Number(revenue.companies_named) || 0} askers’ companies`;
  return { amounts, line: `Recurring revenue in the last ${days} days from ${of} · ledger` };
}

/** Who asked, as GR-23 states it. */
export function peopleLine(w) {
  const people = Number(w?.distinct_people) || 0; const unnamed = Number(w?.not_named) || 0;
  return `${plural(people, 'person', 'people')} asked${unnamed ? ` · ${plural(unnamed, 'item names', 'items name')} nobody` : ''}`;
}

const VIA = { email: 'email', call: 'call', message: 'message', in_person: 'in person' };

/** One Close the loop row: its told state in words, and whether it can be chosen. */
export function loopRow(r) {
  if (r?.state === 'told') return { selectable: false, word: 'Told', detail: [r.told_at ? String(r.told_at).slice(0, 10) : null, VIA[r.told_via] ?? r.told_via].filter(Boolean).join(' · ') };
  if (r?.state === 'due') return { selectable: true, word: 'Due', detail: r.has_email ? 'Email recorded' : 'No email recorded' };
  return { selectable: false, word: r?.reason || 'Cannot be told', detail: null };
}

/** The sentence after Mark told: how many, and every row that was not marked, by name. */
export function toldResult(out) {
  const told = Array.isArray(out?.told) ? out.told : [];
  const refused = Array.isArray(out?.refused) ? out.refused : [];
  const noEmail = told.filter((t) => t.no_email).map((t) => t.name || 'Someone');
  const lines = [`Marked ${plural(told.length, 'person', 'people')} told${out?.told_via ? ` (${VIA[out.told_via] ?? out.told_via})` : ''}.`];
  if (noEmail.length) lines.push(`No email recorded for ${noEmail.join(', ')}: tell them another way.`);
  for (const r of refused) lines.push(`${r.name || 'An item'}: ${r.reason}.`);
  return lines;
}

export const TOLD_VIA = Object.entries(VIA).map(([value, label]) => ({ value, label: label[0].toUpperCase() + label.slice(1) }));
