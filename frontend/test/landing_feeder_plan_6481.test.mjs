import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LABELS } from '../../scripts/landing-bot/rules.mjs';
import { selectQueueEntries } from '../../scripts/landing-bot/feeder-plan.mjs';

const head = 'a'.repeat(40);
const otherHead = 'b'.repeat(40);
const capacity = { perSweep: 5, remainingDaily: 5, freeQueueSlots: 5 };
const repo = { full_name: 'AxalNetwork/StudioOS' };

function candidate(number = 1, sha = head) {
  return {
    pull: {
      number, head: { sha, repo }, base: { ref: 'main', repo }, labels: [], state: 'open',
      draft: false, merged: false, mergeable: true,
    },
    landing: { mayQueue: true, pr: { number, head_sha: sha }, report: { headSha: sha, tier: 'T0' } },
    evidence: {
      number, headSha: sha, eligible: true, fullSuitePassed: true,
      modelRepaired: false, alreadyQueued: false, priorQueueEntry: false,
    },
  };
}

test('preserves landing-list order and pins each selected commit', () => {
  const second = candidate(12, otherHead);
  second.landing.report.tier = 'T1';
  assert.deepEqual(selectQueueEntries([candidate(18), second, candidate(18)], capacity), [
    { number: 18, expectedHeadOid: head }, { number: 12, expectedHeadOid: otherHead },
  ]);
});

test('refuses an ineligible PR even when all other evidence is green', () => {
  const cases = [
    row => { row.pull.state = 'closed'; }, row => { row.pull.draft = true; },
    row => { row.pull.merged = true; }, row => { row.pull.mergeable = null; },
    row => { row.pull.mergeable = false; }, row => { row.pull.base.ref = 'preview'; },
    row => { row.pull.head.repo = { full_name: 'fork/StudioOS' }; },
    row => { row.landing.mayQueue = false; }, row => { row.landing.pr.number++; },
    row => { row.landing.pr.head_sha = otherHead; }, row => { row.landing.report.headSha = otherHead; },
    row => { row.landing.report.tier = 'T2'; }, row => { row.pull.labels = null; },
    row => { row.pull.labels = [{}]; }, row => { row.evidence.number++; },
    row => { row.evidence.headSha = otherHead; }, row => { row.evidence.eligible = false; },
    row => { row.evidence.fullSuitePassed = false; }, row => { row.evidence.modelRepaired = true; },
    row => { row.evidence.alreadyQueued = true; }, row => { row.evidence.priorQueueEntry = true; },
  ];
  for (const change of cases) {
    const row = candidate();
    change(row);
    assert.deepEqual(selectQueueEntries([row], capacity), [], String(change));
  }
  for (const name of [LABELS.off, LABELS.resolved, LABELS.mainRepair, 'BOT:OFF']) {
    const row = candidate();
    row.pull.labels = [{ name }];
    assert.deepEqual(selectQueueEntries([row], capacity), [], name);
  }
});

test('unknown evidence never counts as approval', () => {
  for (const key of Object.keys(candidate().evidence)) {
    const row = candidate();
    delete row.evidence[key];
    assert.deepEqual(selectQueueEntries([row], capacity), [], key);
  }
  assert.deepEqual(selectQueueEntries([null, {}, candidate(2, 'short')], capacity), []);
});

test('different heads or inconsistent eligibility for a duplicate PR skip that PR', () => {
  const red = candidate(1);
  red.landing.mayQueue = false;
  for (const row of [red, candidate(1, otherHead)]) {
    for (const candidates of [[row, candidate(), candidate(2)], [candidate(), candidate(2), row, candidate()]]) {
      assert.deepEqual(selectQueueEntries(candidates, capacity), [{ number: 2, expectedHeadOid: head }]);
    }
  }
});

test('honors every cap and fails closed on unknown, exhausted, or invalid capacity', () => {
  const rows = [candidate(5), candidate(6), candidate(7)];
  for (const field of Object.keys(capacity)) {
    assert.deepEqual(selectQueueEntries(rows, { ...capacity, [field]: 1 }), [{ number: 5, expectedHeadOid: head }]);
    for (const value of [0, -1, 2.5, Infinity, undefined, '5']) {
      assert.deepEqual(selectQueueEntries(rows, { ...capacity, [field]: value }), []);
    }
  }
  assert.deepEqual(selectQueueEntries(rows, null), []);
  assert.deepEqual(selectQueueEntries(null, capacity), []);
});
