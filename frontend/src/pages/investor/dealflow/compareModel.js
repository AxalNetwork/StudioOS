/**
 * D1241 (#3254, part 5 of #2423) — Compare (DLS8, DLS9): two to four ventures
 * side by side, scope by scope, from SCORING's batch (D1256). A bar's length is
 * the band's rank (Weak, Fair, Strong), never a value; low confidence is drawn
 * apart; a scope without a score is a dash with its word. Each venture keeps
 * one colour, the same in the cards, the chart and the table. The strongest
 * band in a row is weight 800 only when no other venture shares it.
 */
import { TRACTION_TILES, dateText, figureText, insightState, tractionView } from '../../deal/dealInsightsModel';
import { SCOPE_KEYS, SCOPE_LABEL, daysWord, fitCell, moneyText, scopeCell, stageWord } from './flowModel';
import { NOT_RECORDED } from '../../../lib/absence';

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

export const COMPARE_TRACTION = TRACTION_TILES;

export function compareTraction(read) {
  if (read === undefined) return { state: 'loading', figures: {} };
  const result = insightState(read === 'failed' ? { status: 'unreadable' } : { data: read });
  if (result.state !== 'open') return { state: result.state, figures: {} };
  const { state, months, series } = tractionView(result.data);
  const period = months.at(-1);
  const figures = Object.fromEntries(TRACTION_TILES.flatMap(tile => {
    const point = series[tile.key]?.at(-1);
    return point?.value != null ? [[tile.key, figureText(point.value, point.unit)]] : [];
  }));
  return { state, period: dateText(period), figures };
}

/** A traction cell in words: the read's state when it has no figure, never blank or 0 for a missing one. */
export function tractionWord(read, key) {
  if (!read || read.state === 'loading') return 'Reading…';
  if (read.state === 'masked') return 'Locked';
  if (read.state === 'unreadable') return 'Unreadable';
  return (key === 'period' ? read.period : read.figures[key]) || 'Not reported';
}

const withNote = (word, note) => (note ? `${word} · ${note}` : word);
const askText = (v) => {
  const m = moneyText(v.ask, v.currency);
  return m ? withNote(m, v.instrument || null) : 'Ask not recorded';
};
const daysText = (v, flowUnknown) => daysWord(v.daysInStage) || (flowUnknown ? 'Unreadable' : v.inFlow ? NOT_RECORDED : 'Not on your deals');
const fitText = (fit) => {
  const c = fitCell(fit);
  if (c.kind === 'scored') return withNote(c.word, c.confidence);
  return c.kind === 'unavailable' ? 'Not shared' : c.word;
};
const scoreText = (c) => (c.kind === 'scored' ? withNote(c.word, c.confidence) : c.kind === 'failed' ? 'Unreadable' : c.word);

/**
 * D6149 (#6149): the comparison table, section by section and row by row, each
 * cell in the words the table shows (absence named: Not recorded, Locked,
 * Unreadable, never blank or 0). The table draws its rows from this list and
 * the CSV writes it, so the two cannot drift. A row with `scope` is a
 * scorecard row; its `scope.cells` carry the bands the table marks.
 */
export function compareSections(ventures, { flowUnknown = false } = {}) {
  const per = (fn) => ventures.map(fn);
  const traction = ventures.map((v) => compareTraction(v.traction));
  const tractionRow = (key, label) => ({ key: `traction-${key}`, label, cells: traction.map((t) => tractionWord(t, key)) });
  return [
    { key: 'case', label: 'Investment case', rows: [
      { key: 'ask', label: 'Ask', cells: per(askText) },
      { key: 'instrument', label: 'Instrument', cells: per((v) => v.instrument || NOT_RECORDED) },
      { key: 'valuation', label: 'Valuation cap', cells: per((v) => moneyText(v.valuation, v.currency) || NOT_RECORDED) },
      { key: 'close', label: 'Close', cells: per((v) => dateText(v.close) || NOT_RECORDED) },
      { key: 'stage', label: 'Your stage', cells: per((v) => (flowUnknown ? 'Unreadable' : stageWord(v.stage))) },
      { key: 'days', label: 'Days in stage', cells: per((v) => daysText(v, flowUnknown)) },
    ] },
    { key: 'scorecard', label: 'Scorecard', rows: compareRows(ventures).map((r) => ({ key: `scope-${r.key}`, label: r.label, scope: r, cells: r.cells.map(scoreText) })) },
    { key: 'fit', label: 'Fit to thesis', rows: [{ key: 'fit', label: 'Fit to my thesis', cells: per((v) => fitText(v.fit)) }] },
    { key: 'traction', label: 'Traction', rows: [tractionRow('period', 'Reporting period'), ...TRACTION_TILES.map((m) => tractionRow(m.key, m.label))] },
    // No comparison read supplies authored material risks (D4815, DX11), so the row says so.
    { key: 'risk', label: 'Risk', rows: [{ key: 'risks', label: 'Material risks', cells: per(() => NOT_RECORDED) }] },
  ];
}

const csvCell = (v) => {
  const s = v == null || v === '' ? NOT_RECORDED : String(v);
  // A cell a spreadsheet would run as a formula is written as text.
  const safe = /^[=+@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Export CSV (D6149): every row the table shows, in its order, under its section, in the table's words. */
export function compareCsv(ventures, { flowUnknown = false } = {}) {
  const lines = [['Section', 'Comparison', ...ventures.map((v) => v.name)]];
  for (const section of compareSections(ventures, { flowUnknown })) {
    for (const row of section.rows) lines.push([section.label, row.label, ...row.cells]);
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\n');
}
