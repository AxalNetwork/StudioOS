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
 * WHO IS THIS OBLIGATION WAITING ON? — `'you'`, `'us'`, or `'settled'`.
 *
 * NOT the same question as the status pill's colour, and conflating the two
 * produces a sentence that is actively false. `STATUS_TONE` gives `pending`
 * the amber `prog` tone, which is right for a pill (amber = wants attention);
 * reading that tone as "in progress" makes `scoreLine` say "3 in progress —
 * nothing needs action from you" to someone whose three obligations are
 * untouched and waiting on them alone.
 *
 * The canvas cannot be followed here either, and for a findable reason: it
 * splits on its own `toneOf` because its fixtures carry BOTH `'Pending'` and
 * `'Not started'` as separate statuses, so neutral-means-not-started holds in
 * its vocabulary. `legal_obligations` has no `not_started`. Its untouched
 * state IS `pending` — `POST /obligation/:key/start` transitions
 * `pending → in_review` (routes/trust.ts) — so the canvas's 'Not started' is
 * our `pending`, and its 'Pending' is our `in_review`.
 *
 * Unknown statuses answer `'you'`. Telling someone nothing is required of
 * them when something is, is the harmful direction; the reverse merely asks
 * them to look.
 */
export function waitingOn(status) {
  const s = String(status || '').toLowerCase();
  // Settled — nothing outstanding on either side.
  if (['satisfied', 'waived', 'signed', 'active', 'verified'].includes(s)) return 'settled';
  // Moving without the reader: under review, or awaiting a counterparty.
  if (['in_review', 'self_attested', 'partially_signed'].includes(s)) return 'us';
  // Everything else is on the reader: pending, expired, rejected, revoked,
  // cancelled, unverified, not_started — and anything unrecognised.
  return 'you';
}

/**
 * The two counts every sentence on the Overview is built from, derived once.
 *
 * The canvas's own instruction, kept: ONE definition of "needs action" and
 * ONE of "in progress", shared by the score panel and the obligations header.
 * Counting them separately in two places is how a page ends up saying
 * "2 open" above a list of three.
 */
export function outstandingCounts(obligations = []) {
  let needs = 0;
  let inProgress = 0;
  for (const o of obligations) {
    const w = waitingOn(o?.status);
    if (w === 'you') needs += 1;
    else if (w === 'us') inProgress += 1;
  }
  return { needs, inProgress };
}

/**
 * The sentence under the verdict.
 *
 * `needs` is what waits on the reader, `open` is that plus what is moving
 * without them — both from `outstandingCounts`, never re-derived here.
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
 * The canvas's SECOND sentence — the one above the obligations list.
 *
 * Deliberately different content from `scoreLine`, and from the same two
 * counts: the panel says how much is open in total, this says how the open
 * work splits. Before this existed the right-hand column repeated
 * "every required obligation is satisfied" verbatim beside the panel saying
 * it, and pointed at a badge ("Hover the score for details") that the v2
 * layout had already moved out of that column.
 *
 * The canvas's clear-state sentence closes "Statuses refresh automatically
 * from Settings and signed envelopes", and that claim is kept because it is
 * backed: `resyncKycKyb` reconciles `legal_obligations` against
 * `users.kyc_status` and `corporate_profiles.kyb_status`, and envelope
 * completion flips the NDA row. Its "Resolve identity items in Settings"
 * is dropped — true only when the open items are identity items, which this
 * function cannot know.
 */
export function obligationSummary({ needs, inProgress }) {
  const n = Math.max(0, Number(needs) || 0);
  const p = Math.max(0, Number(inProgress) || 0);
  if (n + p === 0) {
    return 'Nothing outstanding. Statuses refresh automatically from your account settings and signed envelopes.';
  }
  if (n === 0) return `${p} in progress — no action needed from you right now.`;
  return `${n} ${n === 1 ? 'item needs' : 'items need'} action, ${p} in progress.`;
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
