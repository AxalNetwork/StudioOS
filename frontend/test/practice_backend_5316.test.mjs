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

const API = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
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

test('a version is marked ready, and unmarked, through the Worker; neither call sends', () => {
  assert.match(API, /markMyAdvisorDeliverableVersionReady: \(id, version\) =>\s*request\(`\/advisors\/me\/deliverables\/\$\{id\}\/versions\/\$\{version\}\/ready`, \{ method: 'POST' \}\)/);
  assert.match(API, /clearMyAdvisorDeliverableVersionReady: \(id, version\) =>\s*request\(`\/advisors\/me\/deliverables\/\$\{id\}\/versions\/\$\{version\}\/ready`, \{ method: 'DELETE' \}\)/);
});
