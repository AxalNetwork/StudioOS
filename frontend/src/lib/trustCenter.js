// The Trust Center score panel's derivations — Trust Center v2's left column.
//
// Pure: no React, no I/O, no imports. A guard test can exercise every branch
// directly, which is the point — three of these five functions decide what a
// reader is TOLD about their compliance, and a wrong branch there is a
// sentence that misstates someone's legal standing.
//
// The canvas is `design/canvases/integrated/Trust Center v2.dc.html`
// (DECISIONS.md T2: v2 supersedes v1). Its own copy is reproduced where it is
// a statement of fact and diverged where it was demo scaffolding — each
// divergence is named below.

/**
 * The trust score: what share of the REQUIRED obligations are settled.
 *
 * Moved here from `components/TrustScoreBadge.jsx`, which still re-exports it
 * so no caller changed. It had to leave the component because the worker now
 * computes the same number — it writes the monthly snapshot, and a history
 * the caller can set is not a history — and a parity test has to run BOTH
 * implementations over the same fixtures. A rule exported from a `.jsx` drags
 * React into any test that imports it, so it could not be the shared side.
 * The worker's copy is `trustScoreOf` in `cloudflare-worker/src/services/trust.ts`
 * and `cloudflare-worker/test/trust_score_parity.test.ts` pins them together.
 *
 * NO REQUIRED OBLIGATIONS SCORES 100, deliberately: nothing is being asked of
 * this role, so nothing is outstanding. Zero would read as total failure for
 * someone who has done nothing wrong.
 */
export function computeTrustScore(obligations = []) {
  const required = obligations.filter(o => o.required);
  if (required.length === 0) return 100;
  const satisfied = required.filter(o => o.status === 'satisfied' || o.status === 'waived').length;
  return Math.round((satisfied / required.length) * 100);
}

/** The three bands the canvas draws under the ring, in its order. */
export const SCORE_BANDS = [
  { key: 'bad', label: '<60' },
  { key: 'prog', label: '60–89' },
  { key: 'ok', label: '90+' },
];

/**
 * Which band a score sits in. The canvas's thresholds exactly:
 * 90+ ok, 60–89 prog, below 60 bad.
 */
export function bandOf(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'bad';
  if (n >= 90) return 'ok';
  if (n >= 60) return 'prog';
  return 'bad';
}

/** The canvas's one-word verdict beside the ring. */
export function verdictFor(score) {
  const b = bandOf(score);
  if (b === 'ok') return 'Compliant';
  if (b === 'prog') return 'Action needed';
  return 'Not compliant';
}

/**
 * The sentence under the verdict.
 *
 * ONE definition of "needs action" and ONE of "open", as the canvas insists:
 * `needs` is blocked + not-started (things waiting on the reader), `open` is
 * that plus in-progress (things not yet done, including ones waiting on
 * someone else). Counting them differently in two places is how a page ends
 * up saying "2 open" above a list of three.
 */
export function scoreLine({ needs, inProgress }) {
  const n = Math.max(0, Number(needs) || 0);
  const p = Math.max(0, Number(inProgress) || 0);
  const open = n + p;
  if (open === 0) return 'Every required obligation is satisfied.';
  if (n === 0) return `${p} in progress — nothing needs action from you.`;
  return `${n} ${n === 1 ? 'item needs' : 'items need'} action, ${open} open in total.`;
}

/**
 * The month-over-month note under the score.
 *
 * THE CANVAS CANNOT BE COPIED HERE, and this is the one place it is wrong
 * rather than merely illustrative. It backs the delta with a literal keyed by
 * role — `PREV_SCORE = { founder:47, investor:58, … }` — and when a role is
 * missing does `prevScore = score`, rendering "Unchanged from last month."
 * An account with no earlier month would then be told its score held steady
 * across a month it did not exist for. That is a plausible zero, and D56/D68
 * says an absence is stated rather than rendered as one.
 *
 * So: no history → `null`, and the panel says why instead of showing a delta.
 * The month IS named, because "last month" is false for a reader who last
 * opened this page in May; the server returns the month it actually found.
 */
export function deltaNote(score, previousScore, previousMonth) {
  if (previousScore == null || previousMonth == null) return null;
  const now = Number(score);
  const was = Number(previousScore);
  if (!Number.isFinite(now) || !Number.isFinite(was)) return null;
  const d = now - was;
  const when = monthName(previousMonth);
  if (d === 0) return { tone: 'neutral', text: `Unchanged since ${when} (${was}).` };
  const sign = d > 0 ? '+' : '';
  return { tone: d > 0 ? 'ok' : 'bad', text: `${sign}${d} since ${when} (was ${was}).` };
}

/**
 * '2026-09' → 'September 2026'. A calendar LABEL formatted as one: split on
 * the hyphen rather than `new Date('2026-09')`, which parses as midnight UTC
 * on the 1st and renders as the PREVIOUS month for every reader west of
 * Greenwich — the same trap `engagementBoard.js` documents for a stored day.
 */
export function monthName(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || ''));
  if (!m) return String(label || '');
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return String(label);
  return `${MONTHS[idx]} ${m[1]}`;
}

/**
 * What the panel says where the delta would go when there is no history.
 * Stated, not blank: a reader who sees nothing cannot tell whether the score
 * held steady or was never recorded before.
 */
export const NO_HISTORY_NOTE = 'First month on record — no comparison yet.';
