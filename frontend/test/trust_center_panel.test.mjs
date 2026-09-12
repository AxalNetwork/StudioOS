/**
 * Trust Center v2's score panel — the derivations behind every sentence it
 * prints about someone's compliance.
 *
 * These five functions are not formatting helpers. Between them they decide
 * whether a reader is told "nothing needs action from you", whether they are
 * told their score held steady across a month, and which of three verdicts
 * sits under the ring. A wrong branch in any of them is a sentence that
 * misstates a person's legal standing, and none of them is reachable from the
 * page's own tests without rendering React — which is exactly why the rule
 * lives in a pure module.
 *
 * THE TIMEZONE IS SET BEFORE THE IMPORT, deliberately. `monthName` takes a
 * calendar LABEL ('2026-09'), and the trap it exists to avoid only appears
 * west of Greenwich: `new Date('2026-09')` is midnight UTC on the 1st, which
 * renders as AUGUST in Los Angeles. Running this file in UTC would pass
 * against the buggy implementation.
 *
 * Run with:  node --test frontend/test/trust_center_panel.test.mjs
 */
process.env.TZ = 'America/Los_Angeles';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  bandOf, verdictFor, waitingOn, outstandingCounts,
  scoreLine, obligationSummary, deltaNote, monthName,
  NO_HISTORY_NOTE, SCORE_BANDS,
} from '../src/lib/trustCenter.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------------------
// Bands and verdicts

test('the band boundaries are the canvas\'s, on the exact integers', () => {
  // Off-by-one at a boundary is invisible in review and changes the verdict.
  assert.equal(bandOf(100), 'ok');
  assert.equal(bandOf(90), 'ok');
  assert.equal(bandOf(89), 'prog');
  assert.equal(bandOf(60), 'prog');
  assert.equal(bandOf(59), 'bad');
  assert.equal(bandOf(0), 'bad');
});

test('a score that is not a number reads as the worst band, not the best', () => {
  // A failed fetch must not render "Compliant". The safe direction is the
  // one that makes someone look, not the one that reassures them.
  for (const junk of [null, undefined, NaN, 'n/a', {}]) {
    assert.equal(bandOf(junk), 'bad', `${String(junk)} should not be treated as a passing score`);
    assert.equal(verdictFor(junk), 'Not compliant');
  }
});

test('each band has its own verdict word', () => {
  assert.equal(verdictFor(95), 'Compliant');
  assert.equal(verdictFor(75), 'Action needed');
  assert.equal(verdictFor(30), 'Not compliant');
  // Three distinct words — a band that shared another's verdict would make
  // the ring's colour the only thing distinguishing them.
  assert.equal(new Set([verdictFor(95), verdictFor(75), verdictFor(30)]).size, 3);
});

test('the three bands are drawn in the canvas\'s order and cover 0..100', () => {
  assert.deepEqual(SCORE_BANDS.map(b => b.key), ['bad', 'prog', 'ok']);
  assert.deepEqual(SCORE_BANDS.map(b => b.label), ['<60', '60–89', '90+']);
  // Every band key is one `bandOf` can actually return, so exactly one pill
  // lights up for any score.
  for (const s of [0, 59, 60, 89, 90, 100]) {
    const lit = SCORE_BANDS.filter(b => b.key === bandOf(s));
    assert.equal(lit.length, 1, `score ${s} lights ${lit.length} bands`);
  }
});

// ---------------------------------------------------------------------------
// Who is the row waiting on — the split that used to be taken from the pill

test('pending waits on the READER, not on us — the whole reason waitingOn exists', () => {
  // `legal_obligations` has no `not_started`: `pending` IS the untouched
  // state, and POST /obligation/:key/start moves it to `in_review`. The page
  // first split on STATUS_TONE, where `pending` is amber `prog`, and so told
  // a reader with three untouched obligations "3 in progress — nothing needs
  // action from you."
  assert.equal(waitingOn('pending'), 'you');
  assert.equal(waitingOn('in_review'), 'us');

  const untouched = [
    { status: 'pending' }, { status: 'pending' }, { status: 'pending' },
  ];
  const { needs, inProgress } = outstandingCounts(untouched);
  assert.equal(needs, 3);
  assert.equal(inProgress, 0);
  assert.match(scoreLine({ needs, inProgress }), /3 items need action/);
  assert.doesNotMatch(scoreLine({ needs, inProgress }), /nothing needs action from you/,
    'three untouched obligations are being reported as requiring nothing of the reader');
});

test('the worker\'s premise still holds: start() moves pending, it does not clear it', () => {
  // If this transition is ever rewritten so `pending` means "submitted",
  // the classification above is wrong and this test is where you find out.
  const worker = read('cloudflare-worker/src/routes/trust.ts');
  assert.match(worker, /SET status = 'in_review'[\s\S]{0,200}?AND status = 'pending'/,
    "POST /obligation/:key/start no longer reads pending as the untouched state");
});

test('every status the WORKER writes is classified, and settled means settled', () => {
  // Same parse as the contract test's tone check, for the same reason: a
  // vocabulary read off the worker cannot drift away from it.
  const worker = read('cloudflare-worker/src/routes/trust.ts')
    + read('cloudflare-worker/src/services/trust.ts');
  const written = new Set();
  for (const m of worker.matchAll(/status\s*(?:=|:|===|!==)\s*'([a-z_]+)'/g)) written.add(m[1]);
  assert.ok(written.size >= 8, `parsed only ${written.size} statuses out of the worker`);

  // Responses, not row statuses — named so adding to this list is a decision.
  const NOT_A_ROW_STATUS = new Set(['already_active', 'envelope_issued']);

  for (const s of written) {
    if (NOT_A_ROW_STATUS.has(s)) continue;
    const w = waitingOn(s);
    assert.ok(['you', 'us', 'settled'].includes(w), `${s} classified as ${w}`);
  }
  // The two the score counts as done must never be counted as outstanding —
  // a settled row appearing in either count contradicts the ring beside it.
  assert.equal(waitingOn('satisfied'), 'settled');
  assert.equal(waitingOn('waived'), 'settled');
  // And the ones that are plainly not done must never read as settled.
  for (const s of ['expired', 'rejected', 'revoked', 'cancelled', 'unverified']) {
    assert.notEqual(waitingOn(s), 'settled', `${s} is being treated as nothing to do`);
  }
});

test('an unrecognised status errs toward asking the reader to look', () => {
  // A status this file has never heard of is far more likely to be work than
  // to be completion. Silently settling it is the failure that cannot be seen.
  assert.equal(waitingOn('some_future_state'), 'you');
  assert.equal(waitingOn(''), 'you');
  assert.equal(waitingOn(undefined), 'you');
});

test('the counts ignore neither case nor a missing row', () => {
  assert.deepEqual(outstandingCounts(), { needs: 0, inProgress: 0 });
  assert.deepEqual(outstandingCounts([]), { needs: 0, inProgress: 0 });
  assert.deepEqual(outstandingCounts([null, undefined]), { needs: 2, inProgress: 0 });
  assert.deepEqual(
    outstandingCounts([{ status: 'SATISFIED' }, { status: 'In_Review' }, { status: 'Pending' }]),
    { needs: 1, inProgress: 1 },
    'status casing from a legacy row changes the counts',
  );
});

// ---------------------------------------------------------------------------
// The two sentences

test('scoreLine says nothing needs action ONLY when nothing does', () => {
  assert.equal(scoreLine({ needs: 0, inProgress: 0 }), 'Every required obligation is satisfied.');
  assert.equal(scoreLine({ needs: 0, inProgress: 2 }), '2 in progress — nothing needs action from you.');
  assert.equal(scoreLine({ needs: 1, inProgress: 0 }), '1 item needs action, 1 open in total.');
  assert.equal(scoreLine({ needs: 2, inProgress: 3 }), '2 items need action, 5 open in total.');
  // The reassuring branch is unreachable with work outstanding on the reader.
  for (let n = 1; n <= 5; n++) {
    for (let p = 0; p <= 5; p++) {
      assert.doesNotMatch(scoreLine({ needs: n, inProgress: p }), /nothing needs action/,
        `needs=${n} inProgress=${p} told the reader nothing needs action`);
    }
  }
});

test('the two sentences never print the same words in the same frame', () => {
  // They sit inches apart in the two-column Overview. Before
  // `obligationSummary` existed the right column repeated the panel's
  // "every required obligation is satisfied" verbatim.
  for (const [n, p] of [[0, 0], [0, 2], [1, 0], [3, 4]]) {
    const a = scoreLine({ needs: n, inProgress: p });
    const b = obligationSummary({ needs: n, inProgress: p });
    assert.notEqual(a, b, `needs=${n} inProgress=${p} prints the same sentence twice`);
  }
});

test('obligationSummary splits the open work; scoreLine totals it', () => {
  assert.equal(obligationSummary({ needs: 2, inProgress: 3 }), '2 items need action, 3 in progress.');
  assert.equal(obligationSummary({ needs: 1, inProgress: 0 }), '1 item needs action, 0 in progress.');
  assert.equal(obligationSummary({ needs: 0, inProgress: 2 }), '2 in progress — no action needed from you right now.');
  assert.match(obligationSummary({ needs: 0, inProgress: 0 }), /^Nothing outstanding\./);
  for (let n = 1; n <= 4; n++) {
    assert.doesNotMatch(obligationSummary({ needs: n, inProgress: 1 }), /no action needed/,
      `needs=${n} told the reader no action is needed`);
  }
});

test('the clear-state claim about automatic refresh is one the worker backs', () => {
  // "Statuses refresh automatically from your account settings and signed
  // envelopes" is a factual claim about the system, printed to someone
  // deciding whether they still have work to do.
  assert.match(obligationSummary({ needs: 0, inProgress: 0 }), /refresh automatically/);
  const svc = read('cloudflare-worker/src/services/trust.ts');
  assert.match(svc, /export async function resyncKycKyb/,
    'nothing reconciles obligations from account settings any more — the sentence is now false');
  assert.match(svc, /u\.kyc_status/, 'the resync no longer reads the account KYC status');
  assert.match(svc, /cp\.kyb_status/, 'the resync no longer reads the company KYB status');
  assert.match(read('cloudflare-worker/src/index.ts'), /resyncKycKyb\(env\)/,
    'the resync is never invoked, so nothing refreshes automatically');
});

test('neither sentence can be talked into a negative count', () => {
  // Both take numbers from a caller. A negative slipping through would print
  // "-1 items need action".
  assert.doesNotMatch(scoreLine({ needs: -3, inProgress: -2 }), /-/);
  assert.doesNotMatch(obligationSummary({ needs: -3, inProgress: -2 }), /-/);
  assert.equal(scoreLine({ needs: 'x', inProgress: null }), 'Every required obligation is satisfied.');
});

// ---------------------------------------------------------------------------
// The delta — the part that can lie

test('no history yields no delta, and the panel has a sentence for that', () => {
  // The canvas backs this with a per-role literal and falls back to
  // "Unchanged from last month", which would tell a brand-new account its
  // score held steady across a month it did not exist for. D56/D68: an
  // absence is stated, not rendered as a plausible zero.
  assert.equal(deltaNote(80, null, null), null);
  assert.equal(deltaNote(80, null, '2026-08'), null);
  assert.equal(deltaNote(80, 70, null), null);
  assert.equal(deltaNote(80, undefined, undefined), null);
  assert.ok(NO_HISTORY_NOTE.length > 10, 'the no-history case must say something');
  assert.doesNotMatch(NO_HISTORY_NOTE, /unchanged|steady|same/i,
    'the no-history note claims the score held steady');
});

test('a zero previous score is a real history, not a missing one', () => {
  // `previousScore == null` is the absence test precisely so that 0 — a
  // genuine, terrible, recorded score — still produces a delta.
  const d = deltaNote(40, 0, '2026-08');
  assert.ok(d, 'a recorded score of 0 was mistaken for no history at all');
  assert.equal(d.tone, 'ok');
  assert.match(d.text, /\+40 since August 2026 \(was 0\)\./);
});

test('the delta names the month, and its sign and tone agree', () => {
  assert.deepEqual(deltaNote(90, 70, '2026-08'),
    { tone: 'ok', text: '+20 since August 2026 (was 70).' });
  assert.deepEqual(deltaNote(50, 70, '2026-05'),
    { tone: 'bad', text: '-20 since May 2026 (was 70).' });
  assert.deepEqual(deltaNote(70, 70, '2026-01'),
    { tone: 'neutral', text: 'Unchanged since January 2026 (70).' });
  // A drop is never tinted as progress and vice versa.
  for (const [now, was] of [[100, 1], [61, 60]]) {
    assert.equal(deltaNote(now, was, '2026-08').tone, 'ok');
  }
  for (const [now, was] of [[1, 100], [59, 60]]) {
    assert.equal(deltaNote(now, was, '2026-08').tone, 'bad');
  }
});

test('the month is NAMED, because "last month" is false for an absent reader', () => {
  // The server returns the month it actually found, which may be five months
  // back. Every delta must carry it.
  for (const m of ['2026-01', '2025-12', '2026-06']) {
    assert.match(deltaNote(80, 70, m).text, new RegExp(monthName(m).replace(' ', '\\s')));
  }
  assert.doesNotMatch(deltaNote(80, 70, '2026-01').text, /last month/i);
});

test('a non-numeric score or previous score produces no delta at all', () => {
  assert.equal(deltaNote('n/a', 70, '2026-08'), null);
  assert.equal(deltaNote(80, 'n/a', '2026-08'), null);
});

// ---------------------------------------------------------------------------
// monthName — running in America/Los_Angeles, per the header

test('a calendar label is formatted as a label, not parsed as an instant', () => {
  // THE ASSERTION THE TIMEZONE AT THE TOP OF THIS FILE EXISTS FOR. In
  // Los Angeles `new Date('2026-09')` is 31 August, so an implementation that
  // parses the label renders every month as the previous one.
  assert.equal(new Date('2026-09').getMonth(), 7,
    'the process is not running west of Greenwich — this test proves nothing here');
  assert.equal(monthName('2026-09'), 'September 2026');
  assert.equal(monthName('2026-01'), 'January 2026');
  assert.equal(monthName('2026-12'), 'December 2026');
  assert.equal(monthName('2025-03'), 'March 2025');
});

test('a label monthName cannot read comes back unchanged, not as a wrong month', () => {
  assert.equal(monthName('2026-13'), '2026-13');
  assert.equal(monthName('2026-00'), '2026-00');
  assert.equal(monthName('September'), 'September');
  assert.equal(monthName(''), '');
  assert.equal(monthName(null), '');
  assert.equal(monthName('2026-09-04'), '2026-09-04');
});
