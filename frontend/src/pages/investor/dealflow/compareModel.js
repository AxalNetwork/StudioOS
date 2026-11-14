/**
 * D1241 (#3254, part 5 of #2423) — Compare (DLS8, DLS9): two to four ventures
 * side by side, scope by scope, from SCORING's batch (D1256). A bar's length is
 * the band's rank (Weak, Fair, Strong), never a value; low confidence is drawn
 * apart; a scope without a score is a dash with its word. Each venture keeps
 * one colour, the same in the cards, the chart and the table. The strongest
 * band in a row is weight 800 only when no other venture shares it.
 */
import { SCOPE_KEYS, SCOPE_LABEL, scopeCell } from './flowModel';

/** One colour per venture, in pick order: the swatch, the bar, and their dark-mode pair. */
export const COMPARE_COLOURS = Object.freeze([
  { key: 'violet', swatch: 'bg-violet-600 dark:bg-violet-400', bar: 'bg-violet-600 dark:bg-violet-400', name: 'Violet' },
  { key: 'sky', swatch: 'bg-sky-500 dark:bg-sky-400', bar: 'bg-sky-500 dark:bg-sky-400', name: 'Sky' },
  { key: 'amber', swatch: 'bg-amber-500 dark:bg-amber-400', bar: 'bg-amber-500 dark:bg-amber-400', name: 'Amber' },
  { key: 'teal', swatch: 'bg-teal-600 dark:bg-teal-400', bar: 'bg-teal-600 dark:bg-teal-400', name: 'Teal' },
]);

const RANK = Object.freeze({ Strong: 3, Fair: 2, Weak: 1 });
/** A bar's share of the track: the band's rank over three. */
export const barShare = (band) => (RANK[band] ? RANK[band] / 3 : 0);

/** One scope's cells across the ventures, with the unique strongest marked. */
export function compareRow(ventures, key) {
  const cells = ventures.map((v) => scopeCell(v.scores, key));
  const ranks = cells.map((c) => (c.kind === 'scored' ? RANK[c.band] : 0));
  const top = Math.max(0, ...ranks);
  // Unscored is rank 0; with two or more ventures all unscored, it is a tie, so no one is marked.
  const best = ranks.filter((r) => r === top).length === 1 ? ranks.indexOf(top) : -1;
  return { key, label: SCOPE_LABEL[key], cells: cells.map((c, i) => ({ ...c, best: i === best, low: c.kind === 'scored' && c.confidence === 'Low' })) };
}

export const compareRows = (ventures) => SCOPE_KEYS.map((k) => compareRow(ventures, k));

/**
 * The chart's summary, in counts of scopes only: who has the strongest band
 * on how many scopes, and who has scopes without a score.
 */
export function compareSummary(ventures) {
  const rows = compareRows(ventures);
  const wins = ventures.map((_, i) => rows.filter((r) => r.cells[i].best).length);
  const missing = ventures.map((_, i) => rows.filter((r) => r.cells[i].kind !== 'scored').length);
  const out = [];
  const leaders = ventures.map((v, i) => ({ name: v.name, n: wins[i] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (leaders.length) out.push(`${leaders.map((l) => `${l.name} has the strongest band alone on ${l.n} of ${SCOPE_KEYS.length} scopes`).join('; ')}.`);
  else out.push('No venture has the strongest band alone on any scope.');
  for (const [i, v] of ventures.entries()) {
    if (v.scores.state === 'locked') out.push(`${v.name} has not shared its scorecard.`);
    else if (v.scores.state !== 'ok') out.push(`${v.name}’s scores could not be read here.`);
    else if (missing[i] > 0) out.push(`${v.name} has ${missing[i] === 1 ? 'one scope' : `${missing[i]} scopes`} without a score.`);
  }
  return out.join(' ');
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Export CSV: the table as it reads, bands and words only. */
export function compareCsv(ventures) {
  const lines = [['Scope', ...ventures.map((v) => v.name)]];
  for (const r of compareRows(ventures)) lines.push([r.label, ...r.cells.map((c) => (c.kind === 'scored' && c.confidence ? `${c.word} · ${c.confidence}` : c.word))]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\n');
}
