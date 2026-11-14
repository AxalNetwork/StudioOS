/**
 * `weekClearsFor` — the derivation behind GET /api/spinout-lab/shipped.
 *
 * WHAT IT IS FOR. The Lab intro shows the cohort what other companies have
 * cleared. Nothing records "week 2 cleared": `users.spinout_lab_week` is a
 * cursor that says where a founder is now and forgets how they got there. The
 * milestone rows are the history, so the clear is replayed from them.
 *
 * WHY THE WEEK BOUNDARY IS THE POINT, and why it is tested here rather than
 * trusted to the handler. `week` is already published to anonymous visitors by
 * GET /cohort, so reporting WHEN it turned adds a timestamp to a transition
 * whose state is public. Individual milestone keys are a different class of
 * fact — `section83b_filed`, `founder_stock_issued`, `fundraise_ask_locked`,
 * `investor_intros_secured` and `revenue_proof_added`, tied to a named
 * company, are material corporate and financial statements about a private
 * company, and nothing in the application flow asks a founder's consent to
 * publish them. This function is where that limit lives, so this is where it
 * gets pinned.
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/spinout_week_clears.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MILESTONES, weekClearsFor } from '../src/services/spinoutLabCatalog.ts';

/** A row in the shape the handler feeds in. */
const at = (milestone_key: string, completed_at: string) => ({ milestone_key, completed_at });

const WEEK_1 = [
  'project_created',
  'customer_interview_logged_1',
  'customer_interview_logged_2',
  'customer_interview_logged_3',
];
const WEEK_2 = ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'];
const WEEK_3_ALL = ['scoring_run_completed'];
const WEEK_3_ANY = 'advisor_meeting_booked';
const WEEK_4 = ['incorporation_completed'];

test('no milestones is no clears — not a week 1', () => {
  assert.deepEqual(weekClearsFor([]), []);
});

test('a partial week clears nothing', () => {
  // Three of week 1's four. The founder is working; they have not turned a gate.
  const rows = WEEK_1.slice(0, 3).map((k, i) => at(k, `2026-09-0${i + 1} 10:00:00`));
  assert.deepEqual(weekClearsFor(rows), []);
});

test('the row that completes the requirement is the one that dates the clear', () => {
  // This is the whole derivation: not the first milestone of the week and not
  // "now", but the moment the last requirement landed.
  const rows = WEEK_1.map((k, i) => at(k, `2026-09-0${i + 1} 10:00:00`));
  assert.deepEqual(weekClearsFor(rows), [{ week: 1, cleared_at: '2026-09-04 10:00:00' }]);
});

test('requiredAny is satisfied by one of its options, not all of them', () => {
  // Week 3 is `requiredAll: ['scoring_run_completed']` plus ANY of
  // advisor_meeting_booked / cofounder_request_sent. Demanding both would
  // hold a founder at gate 3 who has met the bar.
  const rows = [
    ...WEEK_1.map((k, i) => at(k, `2026-09-0${i + 1} 09:00:00`)),
    ...WEEK_2.map((k, i) => at(k, `2026-09-1${i} 09:00:00`)),
    ...WEEK_3_ALL.map((k) => at(k, '2026-09-16 09:00:00')),
    at(WEEK_3_ANY, '2026-09-17 09:00:00'),
  ];
  const clears = weekClearsFor(rows);
  assert.deepEqual(clears.map((c) => c.week), [1, 2, 3]);
  assert.equal(clears[2].cleared_at, '2026-09-17 09:00:00');
});

test('weeks clear in order, even when the milestones arrive out of order', () => {
  // A founder can record a week-4 deliverable early. It must not clear gate 4
  // before gates 1–3 have been met — the sequence is the product's promise.
  const rows = [
    ...WEEK_4.map((k) => at(k, '2026-09-02 08:00:00')),
    ...WEEK_1.map((k, i) => at(k, `2026-09-1${i} 08:00:00`)),
  ];
  const clears = weekClearsFor(rows);
  assert.deepEqual(clears.map((c) => c.week), [1],
    'gate 4 cleared before gate 1 — the replay is not ordered');
});

test('one timestamp can close several weeks at once', () => {
  // A backfill lands a whole history with the same completed_at. Testing the
  // week bar once per row rather than draining would report only the first.
  const all = [...WEEK_1, ...WEEK_2, ...WEEK_3_ALL, WEEK_3_ANY, ...WEEK_4];
  const rows = all.map((k) => at(k, '2026-09-29 00:00:00'));
  const clears = weekClearsFor(rows);
  assert.deepEqual(clears.map((c) => c.week), [1, 2, 3, 4]);
  for (const c of clears) assert.equal(c.cleared_at, '2026-09-29 00:00:00');
});

test('ONE ROW can close four gates, when the last thing done is the earliest thing owed', () => {
  // THE CASE THAT MAKES THE DRAIN A LOOP RATHER THAN A TEST.
  //
  // Milestones auto-complete from real product actions, so a founder can do
  // week 2, 3 and 4 work while one week-1 interview is still unlogged. None of
  // it clears anything: weeks close in order, and gate 1 is not met. The
  // moment that last interview lands, all four bars are satisfied at once and
  // one row has to emit four clears.
  //
  // The previous version of this test used twelve same-timestamp rows, which
  // an `if` passes just as well as a `while` — twelve rows can close four
  // weeks one apiece and produce identical output. A mutation swapping the
  // loop for a single `if` survived it. This shape cannot be satisfied that
  // way: there is exactly one row left to close four gates.
  const rows = [
    ...WEEK_2.map((k, i) => at(k, `2026-09-0${i + 1} 08:00:00`)),
    ...WEEK_3_ALL.map((k) => at(k, '2026-09-05 08:00:00')),
    at(WEEK_3_ANY, '2026-09-06 08:00:00'),
    ...WEEK_4.map((k) => at(k, '2026-09-07 08:00:00')),
    ...WEEK_1.slice(0, 3).map((k, i) => at(k, `2026-09-0${i + 1} 07:00:00`)),
    at(WEEK_1[3], '2026-09-20 12:00:00'), // the last thing owed
  ];
  const clears = weekClearsFor(rows);
  assert.deepEqual(clears.map((c) => c.week), [1, 2, 3, 4],
    'a single row did not drain every week it satisfied');
  for (const c of clears) {
    assert.equal(c.cleared_at, '2026-09-20 12:00:00',
      'every gate turned on the row that completed week 1, so they share its timestamp');
  }
});

test('the caller’s row order does not decide the answer', () => {
  // The handler's SQL LEFT JOINs projects, which can reorder ties. The
  // function sorts by completed_at itself rather than trusting ORDER BY.
  const forward = WEEK_1.map((k, i) => at(k, `2026-09-0${i + 1} 10:00:00`));
  const backward = [...forward].reverse();
  assert.deepEqual(weekClearsFor(backward), weekClearsFor(forward));
});

test('a null or blank timestamp cannot fake a clear', () => {
  const rows = [...WEEK_1.map((k) => at(k, '')), { milestone_key: '', completed_at: null }];
  const clears = weekClearsFor(rows as Array<{ milestone_key: string; completed_at: string | null }>);
  // The requirement IS met, so a clear is right — but with an empty timestamp,
  // which the handler then drops because it cannot place it in the window.
  assert.deepEqual(clears, [{ week: 1, cleared_at: '' }]);
});

test('no clear is ever reported for a week the catalog does not define', () => {
  // A fifth gate would be a claim about a programme that runs four.
  const all = [...WEEK_1, ...WEEK_2, ...WEEK_3_ALL, WEEK_3_ANY, ...WEEK_4];
  const clears = weekClearsFor(all.map((k, i) => at(k, `2026-09-${String(i + 1).padStart(2, '0')} 07:00:00`)));
  assert.equal(clears.length, MILESTONES.length);
  for (const c of clears) {
    assert.ok(MILESTONES.some((m) => m.week === c.week), `week ${c.week} is not in the catalog`);
  }
});

test('optional deliverables do not clear a gate on their own', () => {
  // OPTIONAL_MILESTONES are recorded like gating ones and surfaced on the
  // checklist, but weekMet ignores them. A founder who logs five interviews
  // and nothing else has not turned gate 1.
  const rows = [
    at('customer_interview_logged_4', '2026-09-01 10:00:00'),
    at('customer_interview_logged_5', '2026-09-02 10:00:00'),
    at('market_sizing_completed', '2026-09-03 10:00:00'),
    at('icp_defined', '2026-09-04 10:00:00'),
  ];
  assert.deepEqual(weekClearsFor(rows), []);
});
