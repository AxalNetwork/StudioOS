/**
 * #5316 (D5316) — the three Practice v2 facts the Worker now stores, as the
 * frontend reads them: an engagement's end reason, a deliverable version's
 * "ready to send" mark, and a booking included in an engagement. Each reads
 * what is recorded and never infers it for an older row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { END_REASON_LABEL, endReasonLabel } from '../src/pages/advisor/practice/engagementBoard.js';
import { BILLING_STATE, earningsCards, pricedBasis } from '../src/pages/advisor/practice/earningsLedger.js';

const API = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
const SESSIONS = readFileSync(new URL('../src/pages/advisor/practice/SessionsZone.jsx', import.meta.url), 'utf8');
const ENGAGEMENTS = readFileSync(new URL('../src/pages/advisor/practice/EngagementsZone.jsx', import.meta.url), 'utf8');

test('an ended engagement reads its recorded reason, and "Not recorded" when none was stored', () => {
  assert.equal(endReasonLabel({ outcome: 'ended', end_reason: 'did_not_renew' }), 'Did not renew');
  assert.equal(endReasonLabel({ outcome: 'ended', end_reason: 'other' }), 'Ended for another reason');
  assert.equal(endReasonLabel({ outcome: 'ended', end_reason: null }), 'Not recorded');
  assert.equal(endReasonLabel({ outcome: 'ended' }), 'Not recorded', 'an old row without the field');
  assert.equal(endReasonLabel({ outcome: 'ended', end_reason: 'hired_in_house' }), 'Not recorded', 'an unknown value is not guessed at');
  assert.equal(endReasonLabel({ outcome: 'renewed', end_reason: null }), null, 'only an ending has a reason');
  assert.equal(endReasonLabel({ outcome: 'active' }), null);
  assert.deepEqual(Object.keys(END_REASON_LABEL), ['did_not_renew', 'other']);
});

test('ending an engagement on the board sends the reason the Worker requires', () => {
  assert.match(API, /recordMyAdvisorEngagementRenewal: \(id, data\) =>\s*request\(`\/advisors\/me\/engagements\/\$\{id\}\/renewal`/);
  assert.match(ENGAGEMENTS, /decision\.decision === 'ended' \? \{ end_reason: decision\.end_reason \} : \{\}/);
  // The form refuses to send an ending with no reason rather than collecting a 400.
  assert.match(ENGAGEMENTS, /decision\.decision === 'ended' && !END_REASON_LABEL\[decision\.end_reason\]/);
  assert.match(ENGAGEMENTS, /data-testid="end-reason-select"/);
});

test('the Earnings provenance line names included sessions, and only when there are some', () => {
  assert.equal(pricedBasis({ priced_sessions: 12, unpriced_sessions: 1, included_sessions: 0 }),
    'From 12 priced sessions · 1 session has no recorded price.');
  assert.equal(pricedBasis({ priced_sessions: 12, unpriced_sessions: 1, included_sessions: 2 }),
    'From 12 priced sessions · 1 session has no recorded price · 2 sessions included in an engagement, not billed.');
  assert.equal(pricedBasis({ priced_sessions: 3, unpriced_sessions: 0, included_sessions: 1 }),
    'From 3 priced sessions · 1 session included in an engagement, not billed.');
  assert.equal(pricedBasis({ priced_sessions: 3 }), 'From 3 priced sessions.', 'an older response without the field');
  assert.deepEqual(BILLING_STATE.included, { label: 'Included', tone: 'neutral', mark: '◇' });
  // The Recorded billed card carries that line; no card is drawn for included money, because there is none.
  const cards = earningsCards({
    totals: { gross_cents: 1000, cut_cents: 100, priced_sessions: 1, unpriced_sessions: 0, included_sessions: 1 },
    states: { billed: { gross_cents: 1000, sessions: 1 }, collected: { gross_cents: 0, sessions: 0 }, written_off: { sessions: 0 }, included: { sessions: 1 }, paid_out_cents: 0, paid_out_count: 0 },
  });
  assert.match(cards.find((c) => c.key === 'billed').basis, /1 session included in an engagement, not billed/);
  assert.equal(cards.find((c) => c.key === 'outstanding').cents, 1000);
});

test('Sessions does not count an included session as unpriced, and the API says how to record one', () => {
  assert.match(SESSIONS, /b\.amount_cents == null && b\.billing_state !== 'included'/);
  assert.match(SESSIONS, /included: 'Included'/);
  assert.match(API, /`billing_state: 'included'` \(with an optional `engagement_id`\)/);
});

test('a version is marked ready, and unmarked, through the Worker; neither call sends', () => {
  assert.match(API, /markMyAdvisorDeliverableVersionReady: \(id, version\) =>\s*request\(`\/advisors\/me\/deliverables\/\$\{id\}\/versions\/\$\{version\}\/ready`, \{ method: 'POST' \}\)/);
  assert.match(API, /clearMyAdvisorDeliverableVersionReady: \(id, version\) =>\s*request\(`\/advisors\/me\/deliverables\/\$\{id\}\/versions\/\$\{version\}\/ready`, \{ method: 'DELETE' \}\)/);
});
