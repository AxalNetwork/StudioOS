/**
 * D6862 (#6862, D6021 V17/V18) — pure rules for Record a decision's evidence
 * table and Eadwyn's read of it: the E-numbered rows for the chosen scope,
 * what counts toward the bar, the coverage sentence, the summary's groups and
 * states, and the text Use as reasoning places. No reads and no JSX.
 *
 * The Worker decides what counts when the decision is recorded; this only
 * draws the table, by the same rule `verdictForm.js`'s `countedEvidence`
 * applies (a source counts once, only this hypothesis's evidence, and an
 * experiment only with an observed result).
 */
import { DECISION_EVIDENCE_BAR } from './verdictForm.js';

const SCOPE = /^h-([1-9][0-9]{0,9})$/;
const STRENGTH = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };
const KIND = { interview: 'Interview', signal: 'Demand signal', metric: 'Metric', experiment: 'Experiment' };

/** The Worker's exclusion reasons, in the canvas's words (`EXCLUSION_WORD` in `records/verdict.ts`). */
export const REASON_WORD = {
  duplicate_source: 'Same source as another link',
  other_hypothesis: 'Evidence for another hypothesis',
  no_observed_result: 'No observed result recorded yet',
};

const evidenceField = (fields) => (Array.isArray(fields) ? fields.find((f) => f?.name === 'evidence') : null);
const forField = (fields) => (Array.isArray(fields) ? fields.find((f) => f?.name === 'for') : null);

/** The scope's word: "H2" for a hypothesis (its option label's code), else "the venture". */
export function scopeWord(fields, values) {
  const m = SCOPE.exec(String(values?.for ?? ''));
  if (!m) return 'the venture';
  const option = (forField(fields)?.options ?? []).find((o) => String(o?.value) === values.for);
  const code = String(option?.label ?? '').split(' · ')[0].trim();
  return code || `H${m[1]}`;
}

/**
 * The evidence offered for the chosen scope, numbered E1… in the order the
 * Worker offers it, each with whether it is checked and what it does toward
 * the bar: `counted`, a reason it does not count, or `not_checked`.
 */
export function offeredRows(fields, values) {
  const m = SCOPE.exec(String(values?.for ?? ''));
  const options = (evidenceField(fields)?.options ?? []).filter((o) => !m || Number(o?.hypothesis_id) === Number(m[1]));
  const checked = new Set(Array.isArray(values?.evidence) ? values.evidence.map(String) : []);
  const firstOfSource = new Map();
  return options.map((o, i) => {
    const n = i + 1;
    const key = String(o.value);
    const on = checked.has(key);
    let toward = 'not_checked';
    let sameAs = null;
    if (on) {
      if (o.observed === false) toward = 'no_observed_result';
      else {
        const source = o.source ? String(o.source) : `link:${key}`;
        if (firstOfSource.has(source)) { toward = 'duplicate_source'; sameAs = firstOfSource.get(source); }
        else { firstOfSource.set(source, n); toward = 'counted'; }
      }
    }
    return {
      n, key, checked: on, toward, sameAs,
      label: String(o.label ?? '').split(' · ')[0] || key,
      detail: String(o.label ?? ''),
      strength: STRENGTH[o.strength] ?? null,
      kind: KIND[o.kind] ?? null,
      date: o.meta ?? null,
      direction: o.direction === 'contradicts' ? 'contradicts' : o.direction === 'supports' ? 'supports' : null,
    };
  });
}

/** What a row does toward the bar, in words; null when it counts. */
export function towardWord(row) {
  if (row.toward === 'counted') return null;
  if (row.toward === 'not_checked') return 'Not checked';
  if (row.toward === 'duplicate_source') return `${REASON_WORD.duplicate_source}${row.sameAs ? ` (E${row.sameAs})` : ''}`;
  return REASON_WORD[row.toward] ?? 'Not counted';
}

/** The coverage sentence (V17): counted distinct sources against the bar, and what recording now would keep. */
export function coverage(rows, scope, bar = DECISION_EVIDENCE_BAR) {
  const counted = rows.filter((r) => r.toward === 'counted');
  const kinds = new Map();
  for (const r of counted) if (r.kind) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  const mix = [...kinds].map(([k, n]) => `${n} ${n === 1 ? k.toLowerCase() : `${k.toLowerCase()}s`}`).join(', ');
  const withheld = counted.length < bar;
  return {
    counted: counted.length, bar, withheld,
    lead: `${counted.length} of ${bar}`,
    text: ` distinct sources counted for ${scope}${mix ? ` (${mix})` : ''}. `,
    tail: withheld ? 'A decision recorded now would be kept as Withheld.' : 'A decision recorded now would be given.',
  };
}

/** The summary's three groups, each line with its E-number from the table (a key not in the table is dropped). */
export function summaryGroups(result, rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = { contradicts: [], supports: [], not_counted: [] };
  for (const line of Array.isArray(result?.rows) ? result.rows : []) {
    const row = byKey.get(String(line?.key));
    if (!row || !Object.hasOwn(out, line.group)) continue;
    out[line.group].push({ n: row.n, key: row.key, text: String(line.text ?? ''), reason: line.reason ? REASON_WORD[line.reason] ?? 'Not counted' : null });
  }
  return out;
}

/** Out of date (V18 F): the checked rows in scope differ from those the read ran on. */
export function staleness(result, rows) {
  if (!result || !Array.isArray(result.keys)) return null;
  const ran = new Set(result.keys.map(String));
  const now = rows.filter((r) => r.checked);
  const added = now.filter((r) => !ran.has(r.key));
  const removed = [...ran].filter((k) => !now.some((r) => r.key === k)).length;
  return added.length || removed ? { added, removed } : null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text Use as reasoning and Copy place: the founder edits it in Reasoning. Never a choice. */
export function reasoningText(result, rows, scope) {
  const g = summaryGroups(result, rows);
  const line = (l) => `- E${l.n} ${l.text}${l.reason ? ` (${l.reason})` : ''}`;
  const parts = [];
  if (g.contradicts.length) parts.push(`Contradicts (${plural(g.contradicts.length, 'row', 'rows')}):`, ...g.contradicts.map(line));
  if (g.supports.length) parts.push(`Supports (${plural(g.supports.length, 'row', 'rows')}):`, ...g.supports.map(line));
  if (g.not_counted.length) parts.push('Checked but not counted:', ...g.not_counted.map(line));
  const change = result?.change;
  if (change) {
    parts.push(`What would change this (${scope}):`,
      `- Disproof: ${change.disproof ?? 'Not recorded'}`,
      `- Success bar: ${change.success_bar ?? 'Not recorded'}${change.deadline ? `, by ${change.deadline}` : ''}`);
  }
  return parts.join('\n');
}

/**
 * The task card's state (V18): `none` (G, nothing offered for this scope),
 * `unchecked` (rows offered, none checked), `off` (C), `unavailable` (D),
 * `failed` (E), `reading` (B), `stale` (F), `ready`, or `idle` (A).
 */
export function cardState({ rows, quote, run }) {
  if (!rows.length) return 'none';
  if (run?.status === 'reading') return 'reading';
  if (run?.status === 'failed') return run.code === 'assist_off' ? 'off' : run.unavailable ? 'unavailable' : 'failed';
  if (run?.status === 'ready') return staleness(run.result, rows) ? 'stale' : 'ready';
  if (!rows.some((r) => r.checked)) return 'unchecked';
  if (quote?.ai === false) return quote.reason === 'assist_off' ? 'off' : 'unavailable';
  return 'idle';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Nov" from a stored date or timestamp, or null. */
export function dayMonth(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
}

/** D6862: the recipient's read-only page for one shared decision (`routes/sharedDecisions.jsx`; a placeholder route, Q2 A). */
export const sharedDecisionPath = (decisionId) => `/shared/decisions/${encodeURIComponent(String(decisionId))}`;
