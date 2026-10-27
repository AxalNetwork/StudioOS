/**
 * D1253 (#2428) — the venture scorecard's words and display rules, from the
 * owner's canvas "Venture scorecard" (SC1–SC22): the eleven scopes in their one
 * order, the evidence grades, the band and confidence words, the scope strip's
 * bar rule, and the words of every block no read carries yet. Pure, so
 * `frontend/test/venture_scorecard_d1253.test.mjs` holds each rule.
 *
 * D1257 (#3280, part 4): the reads land. `scopeOf` turns one scope as
 * `/api/venture-scores` returns it into the shape the panel and the strip
 * draw, `panelOf` turns the deal read into one of SC1's and SC15–SC18's
 * states, and `stripOf` does the same for one row of `POST /batch`.
 *
 * THE ENGINE IS THE WORKER'S. Values, coverage and confidence are computed by
 * `ventureScoring` (part 2) and read through `/api/venture-scores` (part 3).
 * Nothing here computes a score: it turns a scope the Worker returns into the
 * words and the bar the canvas draws. Counting the grades a scope's inputs
 * carry (the grade mix) is a count of what the Worker sent, not a score.
 */

/** The eleven scopes, in this order everywhere (#2428 "Scopes and starting weights"). No Overall. */
export const SCOPES = Object.freeze([
  { key: 'team', label: 'Team' },
  { key: 'market', label: 'Market' },
  { key: 'pmf', label: 'Product-market fit' },
  { key: 'technical', label: 'Technical' },
  { key: 'traction', label: 'Traction' },
  { key: 'financial', label: 'Financial' },
  { key: 'risk', label: 'Risk' },
  { key: 'geographic', label: 'Geographic' },
  { key: 'political', label: 'Political and regulatory' },
  { key: 'governance', label: 'Governance' },
  { key: 'legal_ip', label: 'Legal and IP' },
]);
export const SCOPE_LABELS = Object.freeze(SCOPES.map((s) => s.label));

/** Evidence grades: the grade sets confidence, never the value. */
export const GRADES = Object.freeze([
  { key: 'measured', label: 'Measured', factor: 1.0, what: 'A connector fact, or counted from platform records.' },
  { key: 'reviewed', label: 'Reviewed', factor: 0.9, what: 'Set or checked by someone other than the founder.' },
  { key: 'sourced', label: 'Sourced', factor: 0.7, what: 'Typed by the founder with a link, file or citation.' },
  { key: 'stated', label: 'Stated', factor: 0.4, what: 'Typed, with nothing behind it.' },
]);

/** The one Source-to-grade mapping (#2428): PIPE-RAISE's five Source labels and their default grade. */
export const SOURCE_GRADE = Object.freeze({
  connector: 'measured',
  recorded: 'measured',
  signed: 'measured',
  document: 'sourced',
  typed: 'stated',
});

/** Confidence cut-offs. Below Low the scope shows "Not enough recorded" and no number. */
export const CONFIDENCE = Object.freeze([['high', 0.70, 'High'], ['medium', 0.45, 'Medium'], ['low', 0.25, 'Low']]);

/** The Worker's confidence word ('High') as the strip's key ('high'). */
const CONFIDENCE_KEY = Object.freeze({ High: 'high', Medium: 'medium', Low: 'low', high: 'high', medium: 'medium', low: 'low' });

/** The grade mix's five kinds, in the canvas's order: the four grades, then Not recorded. */
export const MIX = Object.freeze([...GRADES.map((g) => ({ key: g.key, label: g.label })), { key: 'not_recorded', label: 'Not recorded' }]);

/** The band of a value; Risk reads as a risk word on the same cut-offs. */
export function bandOf(value, scopeKey) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const level = v >= 70 ? 0 : v >= 40 ? 1 : 2;
  return scopeKey === 'risk' ? ['Low risk', 'Medium risk', 'High risk'][level] : ['Strong', 'Fair', 'Weak'][level];
}

export const NOT_ENOUGH = 'Not enough recorded';
export const NOT_EXPECTED = 'Not expected yet';
export const NOT_YET = 'Not read here yet';
export const NOT_SCORED = 'Not scored yet';
export const UNREADABLE = 'Could not be read';
export const COUNTED = 'Counted, not shown';

/** The Worker bands every scope Strong, Fair or Weak; Risk reads them as risk words (a higher value is lower risk). */
const RISK_WORD = Object.freeze({ Strong: 'Low risk', Fair: 'Medium risk', Weak: 'High risk' });
export function bandWord(band, scopeKey) {
  if (!band) return null;
  return scopeKey === 'risk' ? (RISK_WORD[band] || band) : band;
}

/**
 * The strip's bar height when the read carries a band and no number: the
 * deal list's batch sends none (D1256 §1). Each band is drawn at the middle
 * of its range (Strong 70–100 at 85, Fair 40–69 at 55, Weak below 40 at 20),
 * 20px at 100, so a bar never claims a value the reader was not sent.
 */
export const BAND_HEIGHT = Object.freeze({ Strong: 17, Fair: 11, Weak: 4 });

/**
 * One bar of the scope strip, from one scope (`scopeOf`'s shape:
 * `{ key, value, band, confidence: 'high'|'medium'|'low'|null, state, coverage }`).
 * 20px tall at 100; violet opacity is the confidence. "Not enough recorded" is a
 * dashed hairline, "Not expected yet" a muted dot, and a scope that could not
 * be read a hollow mark; none of them is a bar of zero. With no number (the
 * batch's read) the height is the band's (`BAND_HEIGHT`).
 */
export function stripBar(s) {
  if (!s || s.state === 'not_read' || s.state === 'not_scored') return { kind: 'unread' };
  if (s.state === 'unreadable') return { kind: 'unreadable' };
  if (s.state === 'not_expected') return { kind: 'dot' };
  if (s.state === 'not_enough' || !s.confidence) return { kind: 'dashed' };
  const opacity = { high: 1, medium: 0.6, low: 0.3 }[s.confidence] ?? 0.3;
  if (s.value == null) return BAND_HEIGHT[s.band] ? { kind: 'bar', height: BAND_HEIGHT[s.band], opacity } : { kind: 'dashed' };
  const h = Math.max(1, Math.round((Math.min(100, Math.max(0, Number(s.value))) / 100) * 20));
  return { kind: 'bar', height: h, opacity };
}

const coverageText = (c) => {
  if (!c) return '';
  if (c.of) return `${c.present} of ${c.of} inputs`;
  return c.share == null ? '' : `${Math.round(c.share * 100)}% of inputs`;
};

/** A bar read as text on hover and focus: "Team 62, Fair, medium confidence, 5 of 6 inputs". */
export function barText(s) {
  const label = (SCOPES.find((x) => x.key === s?.key) || {}).label || 'Scope';
  if (!s || s.state === 'not_read') return `${label}: ${NOT_YET}`;
  if (s.state === 'not_scored') return `${label}: ${NOT_SCORED}`;
  if (s.state === 'unreadable') return `${label}: ${UNREADABLE}`;
  if (s.state === 'not_expected') return `${label}: ${NOT_EXPECTED}`;
  if (s.state === 'not_enough' || !s.confidence || (s.value == null && !s.band)) return `${label}: ${NOT_ENOUGH}`;
  const cov = coverageText(s.coverage);
  if (s.value == null) return `${label}: ${bandWord(s.band, s.key)}, ${s.confidence} confidence${cov ? `, ${cov}` : ''}`;
  return `${label} ${Math.round(Number(s.value))}, ${bandOf(s.value, s.key)}, ${s.confidence} confidence${cov ? `, ${cov}` : ''}`;
}

export { coverageText };

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const OUT = new Set(['not_applicable', 'not_expected']);

/**
 * One input as the drawer draws it. `kind` is what it shows:
 * `value` (a recorded figure), `counted` (a personal input: a band, never its
 * figure), `missing` (Not recorded, which lowers confidence), `out` (does not
 * apply, or not expected yet) or `unreadable`.
 */
export function inputOf(i) {
  const state = i?.state ?? null;
  const personal = Boolean(i?.personal) && i?.shown === false;
  const kind = personal ? 'counted' : state === 'recorded' ? 'value' : OUT.has(state) ? 'out'
    : state === 'unreadable' ? 'unreadable' : 'missing';
  const grade = typeof i?.grade === 'string' ? i.grade.toLowerCase().replace(/\s+/g, '_') : null;
  return {
    key: String(i?.key ?? ''), label: i?.label || String(i?.key ?? 'Input'), kind, state,
    value: kind === 'value' ? num(i.value) : null,
    band: personal ? (i.band ?? null) : null,
    grade: kind === 'value' && MIX.some((g) => g.key === grade) ? grade : null,
    stale: Boolean(i?.stale), contribution: kind === 'value' ? num(i.contribution) : null,
    weight: num(i?.weight), words: personal ? null : (i?.words || null), reason: i?.reason || null,
    as_of: personal ? null : (i?.as_of || null), group: i?.group || null,
    records: num(i?.source?.rows),
  };
}

/** The grades behind a scope's inputs, counted: Not recorded counts the inputs that apply and are missing. */
export function gradeMix(inputs) {
  const out = Object.fromEntries(MIX.map((g) => [g.key, 0]));
  for (const i of inputs || []) {
    if (i.kind === 'missing') out.not_recorded += 1;
    else if (i.kind === 'value' && i.grade) out[i.grade] += 1;
  }
  return out;
}

/** Coverage from the inputs when they are read (recorded of those that apply), else as the Worker sent it. */
function coverageOf(raw, inputs) {
  if (inputs && inputs.length) {
    const applies = inputs.filter((i) => i.kind !== 'out');
    return { present: applies.filter((i) => i.kind === 'value' || (i.kind === 'counted' && i.state === 'recorded')).length, of: applies.length };
  }
  const c = raw?.coverage;
  if (c && typeof c === 'object') return c.applies ? { present: Number(c.present) || 0, of: Number(c.applies) } : null;
  const n = num(c);
  return n == null || raw?.state !== 'scored' ? null : { share: n };
}

const STATES = new Set(['scored', 'not_enough', 'not_expected', 'unreadable']);

/**
 * One scope as `/api/venture-scores` returns it (`{ scope, state, band,
 * confidence_word, value?, coverage?, inputs?, review?, masked? }`), in the
 * shape the panel and the strip draw. A scope the Worker did not send is
 * `not_read`; a value with no confidence word is never drawn as a bar.
 */
export function scopeOf(raw, key = raw?.scope ?? raw?.key) {
  const label = (SCOPES.find((x) => x.key === key) || {}).label || 'Scope';
  if (!raw) return { key, label, state: 'not_read', value: null, band: null, confidence: null, coverage: null, inputs: null, review: null, masked: false };
  // The Worker's `not_read` is a scope it has never stored: on this page it is "Not scored yet".
  const state = raw.state === 'not_read' ? 'not_scored' : STATES.has(raw.state) ? raw.state : 'not_enough';
  const scored = state === 'scored';
  const inputs = Array.isArray(raw.inputs) ? raw.inputs.map(inputOf) : null;
  return {
    key, label, state,
    value: scored ? num(raw.value) : null,
    band: scored ? (raw.band || bandOf(raw.value, 'team')) : null,
    confidence: scored ? (CONFIDENCE_KEY[raw.confidence_word] ?? CONFIDENCE_KEY[raw.confidence] ?? null) : null,
    coverage: coverageOf(raw, inputs),
    inputs, review: raw.review || null, masked: Boolean(raw.masked), reason: raw.reason || null,
    model: raw.model || null, computed_at: raw.computed_at || null,
  };
}

/** Every scope in the one order, from a list the Worker returned in any order. */
export function scopesOf(list) {
  const by = new Map((Array.isArray(list) ? list : []).map((s) => [s?.scope ?? s?.key, s]));
  return SCOPES.map((s) => scopeOf(by.get(s.key), s.key));
}

/**
 * The deal read (`GET /deal/:dealId`) as one of the panel's states:
 * `loading` (SC15), `not_on_deal` and `no_access` (SC17), `not_found`,
 * `unreadable`, `locked` (the founder's switch is off), `masked` (SC18,
 * before the NDA) or `open` (SC1). One scope that could not be read leaves
 * the others standing (SC16): it is listed in `unreadable`.
 */
export function panelOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') {
    const e = read.error || {};
    if (e.status === 403) return { state: e.code === 'not_on_deal' ? 'not_on_deal' : 'no_access' };
    if (e.status === 404) return { state: 'not_found' };
    return { state: 'unreadable' };
  }
  const d = read.data || {};
  if (d.locked) return { state: 'locked', reason: d.reason || 'The founder has not shared this scorecard with investors.' };
  if (!Array.isArray(d.scopes)) return { state: 'unreadable' };
  const scopes = scopesOf(d.scopes);
  const masked = d.nda === false || scopes.some((s) => s.masked);
  const times = scopes.map((s) => s.computed_at).filter(Boolean).sort();
  return {
    state: masked ? 'masked' : 'open', scopes, masked,
    model: d.model || null, computed_at: times.length ? times[times.length - 1] : null,
    masked_reason: d.masked_reason || null, read_only: Boolean(d.read_only), viewer: d.viewer || 'investor',
    unreadable: scopes.filter((s) => s.state === 'unreadable').map((s) => s.key),
    empty: scopes.every((s) => s.state !== 'scored'),
    rests: masked ? null : gradeMix(scopes.flatMap((s) => s.inputs || [])),
  };
}

/**
 * One deal's strip from `POST /batch`: the row the Worker returned, or none
 * (a deal the reader may not read is left out and counted): `locked` draws no
 * bar, `unreadable` says so, otherwise the eleven scopes in order.
 */
export function stripOf(item) {
  if (!item) return { state: 'closed' };
  if (item.locked) return { state: 'locked', reason: item.reason || null };
  if (item.unreadable || !Array.isArray(item.scopes)) return { state: 'unreadable' };
  return { state: 'open', scopes: scopesOf(item.scopes) };
}

/** The batch takes at most 200 deal ids a call (D1256 §1). */
export const BATCH_MAX = 200;
export function batches(ids) {
  const uniq = [...new Set((ids || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const out = [];
  for (let i = 0; i < uniq.length; i += BATCH_MAX) out.push(uniq.slice(i, i + BATCH_MAX));
  return out;
}

/** A day the Worker stamped, as "27 Oct 2026, 09:40" (UTC), or null. */
export function stampText(at) {
  if (!at) return null;
  const d = new Date(String(at).includes('T') || String(at).endsWith('Z') ? at : `${String(at).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`;
}

/** Product-market fit's input groups (D1143), as SC22 heads them. */
export const PMF_GROUPS = Object.freeze({ who: 'Who you heard from', problem: 'The problem', claims: 'Claims and experiments', demand: 'Demand and pull' });

/** A review in force beside the computed value, which stays (D1256 §3). */
export function reviewText(r) {
  if (!r) return null;
  const who = r.reviewer || 'A reviewer';
  const adj = Number(r.adjustment) || 0;
  if (adj) return `Reviewed by ${who}: ${adj > 0 ? '+' : '−'}${Math.abs(adj)} points.${r.reason ? ` ${r.reason}` : ''}`;
  return r.note ? `Note from ${who}: ${r.note}` : null;
}

/** The words of the panel's states (SC15–SC18) and the drawer's input lines. */
export const STATE_WORDS = Object.freeze({
  reading: 'Reading…',
  not_on_deal: { title: 'This scorecard opens when this venture is in your deal flow.', line: 'It opens once you are invited to this deal or committed on it.' },
  no_access: { title: 'Scorecards are for investors, founders and studio staff.', line: 'Set up a profile to read scorecards, or to build your own as a founder.' },
  not_found: { title: 'No scorecard for this deal.', line: 'The deal has no venture whose scorecard could be read.' },
  locked: { title: 'Scorecard locked', line: 'The founder decides who sees it. Ask the founders to share it with investors.' },
  masked: { title: 'Sign the NDA with this venture to see inputs.', line: 'Bands and confidence show now. Values, grades and inputs open after you sign.', act: 'Sign NDA' },
  after_nda: ['Each scope’s value and its 0–100 bar', 'Every input with its grade and date', 'The grade mix behind each scope'],
  scope_unreadable: (label) => `${label} could not be read. The other scopes are current.`,
  empty: 'Nothing is recorded yet, so no scope shows a value.',
  missing_input: 'Not recorded · lowers confidence',
  out_input: 'Does not apply here, so it is out of every sum',
  unreadable_input: 'Could not be read · out of the value, and confidence is lower',
});

/** Every scope in order, unread: what the panel and the strip draw before the read lands. */
export const unreadScopes = () => SCOPES.map((s) => ({ key: s.key, state: 'not_read' }));

export const METHOD = '/scoring/method';
export const FOUNDER_PAGE = '/raise/scorecard';
export const HQ_PAGE = '/admin/platform/scoring';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  founder: 'Your own scorecard, every input with its source and grade, and “What investors see” are not read here yet (part 5).',
  sharing: 'Who sees your scorecard is not stored yet. Until it is, no investor sees a score of yours (part 3).',
  trajectory: 'The trajectory across model versions is not stored yet (part 5).',
  weighting: 'Your weighting, the sort it drives on the deal list, is not stored yet (parts 3 and 5).',
  fairness: 'The quarterly fairness check by stage, sector, studio and connector use is not computed yet (part 3).',
});
