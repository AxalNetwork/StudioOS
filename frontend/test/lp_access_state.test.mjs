// Guards the LP access-state ladder in lib/spinoutFundModel.js.
//
// This is the security-relevant helper on the LP workspace: it decides whether
// a viewer sees the reporting archive, the LP data room and the allocation
// sliders. The Claude Design export let the VIEWER pick that state from a row
// of buttons; here it is derived from the caller's own rows in
// GET /api/funds/lp-portal, so these cases exist to keep it underivable by the
// client and un-escalatable by a malformed payload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lpAccessState, lpHasReports, lpAllocationOpen, ALLOC_THRESHOLD_K,
} from '../src/lib/spinoutFundModel.js';

const lp = (commitment, lpa_signed = true) => ({
  lp_holdings: [{}],
  performance: [{ commitment, lpa_signed }],
});

test('no LP rows is visitor — nothing gated is unlocked', () => {
  for (const empty of [null, undefined, {}, { lp_holdings: [], performance: [] }]) {
    assert.equal(lpAccessState(empty).state, 'visitor');
  }
  assert.equal(lpHasReports('visitor'), false);
  assert.equal(lpAllocationOpen('visitor'), false);
});

test('an LP row without a countersigned LPA is pending, not approved', () => {
  assert.equal(lpAccessState(lp(0, false)).state, 'pending');
  assert.equal(lpHasReports('pending'), false);
});

test('countersigned LPA with nothing committed is approved and unlocks reports', () => {
  assert.equal(lpAccessState(lp(0, true)).state, 'approved');
  assert.equal(lpHasReports('approved'), true);
  assert.equal(lpAllocationOpen('approved'), false);
});

test('allocation opens only at or above the threshold, compared in dollars', () => {
  const T = ALLOC_THRESHOLD_K * 1000;
  assert.equal(lpAccessState(lp(T)).state, 'voting');
  assert.equal(lpAccessState(lp(T + 0.01)).state, 'voting');
  assert.equal(lpAccessState(lp(T - 1)).state, 'committed');
  assert.equal(lpAllocationOpen('committed'), false);
  assert.equal(lpAllocationOpen('voting'), true);
});

test('display rounding cannot clear the rights threshold', () => {
  // Regression: Math.round(249999/1000) === 250, which would have granted
  // allocation and decision rights to a commitment that is not $250K.
  const near = lpAccessState(lp(249_999));
  assert.equal(near.state, 'committed');
  assert.equal(near.commitmentK, 249, 'floors for display, never overstates');
});

test('commitments sum across multiple LP rows', () => {
  assert.equal(
    lpAccessState({ lp_holdings: [{}, {}], performance: [{ commitment: 150_000 }, { commitment: 100_000 }] }).state,
    'voting',
  );
});

test('malformed or hostile payloads degrade down the ladder, never up', () => {
  // A NUMERIC STRING IS COUNTED, deliberately. D1/JSON round-trips can hand
  // back numerics as strings, and refusing them would UNDERSTATE a real LP's
  // commitment — the same strict-equality trap App.jsx's labRoles() has with
  // `spinout_lab_active === 1`. Safe because the payload is the response of an
  // authenticated endpoint scoped to the caller's own user id, not client input.
  assert.equal(lpAccessState(lp('250000')).state, 'voting');
  // Same shape as the negative case: NaN is discarded, so this is $0 committed.
  assert.equal(lpAccessState(lp(NaN)).state, 'approved');
  assert.equal(lpAccessState(lp(NaN, false)).state, 'pending');
  // Negative amounts are discarded rather than summed, so this LP reads as $0
  // committed. With a signed LPA that is 'approved' — critically NOT
  // 'committed' or 'voting', so no amount of negative data buys allocation.
  assert.equal(lpAccessState(lp(-9e9)).state, 'approved');
  assert.equal(lpAccessState(lp(-9e9, false)).state, 'pending');
  assert.equal(lpAccessState(lp(-9e9)).commitmentK, 0);
  assert.equal(lpAccessState({ lp_holdings: 'nope', performance: 'nope' }).state, 'visitor');
  assert.equal(lpAccessState({ performance: [{ commitment: 1e9 }] }).state, 'voting',
    'performance rows alone still count as holdings — matches the worker DTO');
});

/* ------------------------------------------------ LP applications (#4) */
//
// An applicant AUTHORS their own application row, so the security of the whole
// flow rests on that row granting nothing. These cases exist to keep it that
// way: an application may move a viewer from 'visitor' to 'pending' and no
// further, and 'pending' is rank 0 exactly like 'visitor'.

const app = (status) => ({ status });

test('a pending application moves visitor → pending, and unlocks NOTHING', () => {
  const r = lpAccessState(null, app('pending'));
  assert.equal(r.state, 'pending');
  assert.equal(r.applicationStatus, 'pending');
  assert.equal(lpHasReports(r.state), false, 'no reporting archive');
  assert.equal(lpAllocationOpen(r.state), false, 'no allocation rights');
});

test('an applicant cannot climb the ladder by writing their own status', () => {
  // The POST route hard-codes status='pending', but defence in depth: even a
  // row that claims to be approved must not unlock the archive, because the
  // archive is keyed to a fund holding the applicant does not have.
  for (const claimed of ['approved', 'committed', 'voting', 'admin', 'ADMIN']) {
    const r = lpAccessState(null, app(claimed));
    assert.ok(
      r.state === 'pending' || r.state === 'visitor',
      `status "${claimed}" resolved to ${r.state}`,
    );
    assert.equal(lpHasReports(r.state), false, `status "${claimed}" must not unlock reports`);
    assert.equal(lpAllocationOpen(r.state), false, `status "${claimed}" must not unlock allocation`);
  }
});

test('a declined or withdrawn application returns the viewer to visitor', () => {
  for (const status of ['declined', 'withdrawn']) {
    assert.equal(lpAccessState(null, app(status)).state, 'visitor', status);
  }
});

test('a real holding always outranks an application', () => {
  // Someone with a countersigned LPA whose stale application row still reads
  // 'pending' is an approved LP, not an applicant.
  const r = lpAccessState(lp(0, true), app('pending'));
  assert.equal(r.state, 'approved');
  assert.equal(lpHasReports(r.state), true);

  const voting = lpAccessState(lp(ALLOC_THRESHOLD_K * 1000), app('declined'));
  assert.equal(voting.state, 'voting', 'a declined application cannot demote a committed LP');
});

test('a malformed application is ignored, never promoted', () => {
  for (const bad of [undefined, null, {}, { status: null }, { status: 42 }, 'pending', []]) {
    assert.equal(lpAccessState(null, bad).state, 'visitor', JSON.stringify(bad));
  }
});

test('the no-application call signature still works unchanged', () => {
  // Every existing caller passes one argument.
  assert.equal(lpAccessState(null).state, 'visitor');
  assert.equal(lpAccessState(lp(0, true)).state, 'approved');
});
