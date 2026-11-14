/**
 * D4838 (#5935, boards PP03, PP03b, PP03m) — the rules the Leads zone draws by, as pure functions over the
 * Worker's own `GET /partner/pipeline/leads` payload, so the page and its tests agree on each one.
 *
 *   · A lead is in exactly one fit state: `excluded` (a rule of the firm's rules out the need, no number),
 *     `unscored` (no rule applies, no number), `strong` (80 or above) or `partial` (scored, below 80).
 *   · The reasons come before the score. They are the receipts the Worker sends: a met rule (`hit`) and a missed
 *     one (`miss`). A gap (a rule the firm has not written) is not a reason; it is listed under Why this score?.
 *   · A strip figure prints only over a population. A count the loaded rows cannot settle (a partial read) is
 *     Not recorded with its reason, never a guess and never zero.
 *   · The pass reasons are the Worker's `PASS_REASONS`, in its order.
 */

/** A fit score at or above this is a strong fit: the Worker's own line (`strong_fit_count`). */
export const STRONG_FIT = 80;
/** "Recent" is a lead whose need was posted within this many days. */
export const RECENT_DAYS = 7;

/** `PASS_REASONS` in `routes/partner_pipeline.ts`, in its order, with the canvas's words (PP03b). */
export const PASS_REASONS = [
  ['below_floor', 'Below floor'],
  ['no_capability', 'No capability'],
  ['scope_mismatch', 'Scope mismatch'],
  ['timing', 'Timing'],
  ['price', 'Price'],
  ['other', 'Other'],
];
export const PASS_REASON_LABEL = Object.fromEntries(PASS_REASONS);

/** One lead's fit state. */
export function leadState(row) {
  if (row?.excluded_by) return 'excluded';
  if (row?.score == null) return 'unscored';
  return Number(row.score) >= STRONG_FIT ? 'strong' : 'partial';
}

/** The fit line beside the reasons: words first, and a number only where one exists. */
export function fitLine(row) {
  const state = leadState(row);
  if (state === 'excluded') return { state, text: 'Excluded · no score', score: null };
  if (state === 'unscored') return { state, text: 'Unscored', score: null };
  return { state, text: state === 'strong' ? 'Strong fit' : 'Partial fit', score: Number(row.score) };
}

/** The reasons drawn before the score: met and missed rules, in the Worker's order. */
export function leadReasons(row) {
  return (Array.isArray(row?.receipts) ? row.receipts : [])
    .filter((r) => r && (r.kind === 'hit' || r.kind === 'miss'))
    .map((r) => ({ met: r.kind === 'hit', label: String(r.label) }));
}

/**
 * Why this score? — every receipt, and the arithmetic that turns them into the number. Only a scored lead has
 * one: an exclusion carries the firm's sentence, and an unscored lead the Worker's note.
 */
export function whyThisScore(row) {
  if (leadState(row) === 'excluded' || leadState(row) === 'unscored') return null;
  const receipts = Array.isArray(row.receipts) ? row.receipts : [];
  const met = receipts.filter((r) => r.kind === 'hit').length;
  const missed = receipts.filter((r) => r.kind === 'miss').length;
  const word = { hit: 'Met', miss: 'Missed', gap: 'Not measured' };
  return {
    receipts: receipts.map((r) => ({ kind: r.kind, word: word[r.kind] || 'Not measured', label: String(r.label) })),
    sum: `${met} of ${met + missed} rules measured are met, so the score is ${Number(row.score)}. A rule you have not written is not measured. The match is your words found in the need, not a model.`,
  };
}

/** A predicate for one fit state, for a view to filter by. */
export const inState = (state) => (row) => leadState(row) === state;

/** The Recent view's rows: posted within `RECENT_DAYS`, newest first. */
export function recentFirst(rows) {
  return rows
    .filter((r) => r.days_old != null && Number(r.days_old) <= RECENT_DAYS)
    .sort((a, b) => Number(a.days_old) - Number(b.days_old));
}

/** The first day of `now`'s month, UTC, and its label ("1 Nov"). */
export function periodStart(now) {
  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const label = `1 ${start.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  return { start, label };
}

/**
 * The four tiles (PP03): Open leads, Strong fit, Unscored, Passed this period. Each is `{ label, value, note }`;
 * `value: null` is Not recorded and the note says why. A zero prints only beside the population it counts.
 *
 * `complete` is the paged read's own flag: false when a later page did not load, so a count over the loaded rows
 * would be a count of some of them.
 */
export function leadStrip(d, { now = Date.now() } = {}) {
  const items = Array.isArray(d?.items) ? d.items : [];
  const passed = Array.isArray(d?.passed) ? d.passed : [];
  const open = d?.open_count == null ? null : Number(d.open_count);
  const allLeads = d?.complete !== false && open != null && items.length === open;
  const allPasses = d?.complete !== false && d?.passed_count != null && passed.length === Number(d.passed_count);
  const tiles = [];

  tiles.push(open == null
    ? { label: 'Open leads', value: null, note: 'the count did not come back' }
    : { label: 'Open leads', value: open === 0 ? 'None open' : String(open), note: 'Not bid, not passed' });

  const strong = d?.strong_fit_count;
  if (strong == null) tiles.push({ label: 'Strong fit', value: null, note: 'no rule to score against yet' });
  else if (open === 0) tiles.push({ label: 'Strong fit', value: 'No open leads', note: 'Score ≥ 80' });
  else tiles.push({ label: 'Strong fit', value: String(strong), note: `Score ≥ 80 · of ${open} open` });

  if (open === 0) tiles.push({ label: 'Unscored', value: 'No open leads', note: 'No rule applies' });
  else if (!allLeads) tiles.push({ label: 'Unscored', value: null, note: 'not every open lead loaded' });
  else {
    const n = items.filter((r) => leadState(r) === 'unscored').length;
    tiles.push({ label: 'Unscored', value: String(n), note: `No rule applies · of ${open} open` });
  }

  const { start, label } = periodStart(now);
  const total = d?.passed_count == null ? null : Number(d.passed_count);
  if (total === 0) tiles.push({ label: 'Passed this period', value: 'None yet', note: 'No pass is recorded' });
  else if (!allPasses) tiles.push({ label: 'Passed this period', value: null, note: 'not every pass loaded' });
  else {
    const n = passed.filter((p) => p.passed_at && Date.parse(String(p.passed_at).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(p.passed_at)) ? '' : 'Z')) >= start.getTime()).length;
    tiles.push({ label: 'Passed this period', value: String(n), note: `Since ${label} · ${total} in all` });
  }
  return tiles;
}

/** The sentence when a view holds nothing, with the population it was drawn from. */
export function emptyViewLine(view, total) {
  const what = {
    strong: 'No open lead scores 80 or above.',
    unscored: 'Every open lead has a rule that applies.',
    excluded: 'No open lead is excluded by your rules.',
    recent: `No open lead was posted in the last ${RECENT_DAYS} days.`,
  }[view] || 'No lead is in this view.';
  return `${what} ${total} open in total.`;
}
