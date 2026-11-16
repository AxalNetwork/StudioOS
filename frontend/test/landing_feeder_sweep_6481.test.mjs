import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySweep, planSweep } from '../../scripts/landing-bot/feeder-sweep.mjs';

const head = 'a'.repeat(40);
const repo = 'AxalNetwork/StudioOS';
const main = { event: 'push', head_branch: 'main', created_at: '2026-11-15T12:00:00Z', status: 'completed', conclusion: 'success' };

function fixture() {
  const state = {
    sha: new Map(), gates: new Map(), main: { ...main }, freeSlots: 3, remaining: 3, ordered: [8, 5, 7],
    groups: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, event: 'merge_group', status: 'completed', conclusion: 'success' })),
    reads: [], writes: [], budgetReads: 0, listOverrides: new Map(),
  };
  const env = { LANDING_BOT_ENABLED: 'true', LANDING_BOT_FEED_PER_SWEEP: '3', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.25' };
  const reader = {
    readOrderedList: async () => state.ordered.map(number => ({ number, tier: 'T1', modelChanged: false, ...state.listOverrides.get(number) })),
    readMainHealth: async () => ({ mainRuns: [state.main], openAlertTitles: [], recentGroupRuns: state.groups }),
    readQueueState: async () => ({ freeQueueSlots: state.freeSlots }),
    readLandingDecision: async number => {
      const sha = state.sha.get(number) ?? head;
      return { mayQueue: state.gates.get(number) ?? true, pr: { number, head_sha: sha }, report: { headSha: sha, tier: 'T1' } };
    },
    readCandidate: async number => {
      state.reads.push(number);
      const sha = state.sha.get(number) ?? head;
      return {
        pull: {
          number, node_id: `PR_${number}`, state: 'open', draft: false, merged: false, mergeable: true, labels: [],
          head: { sha, ref: `agent/feature-${number}`, repo: { full_name: repo } },
          base: { ref: 'main', repo: { full_name: repo } },
        },
        files: [{ path: 'documentation/sample.md' }], headSha: sha, number,
        fullSuitePassed: true, modelRepaired: false, alreadyQueued: false, priorQueueEntry: false,
      };
    },
  };
  const enqueue = async entry => { state.writes.push(entry); return { ...entry, status: 'queued' }; };
  const readRemainingDaily = async () => { state.budgetReads++; return state.remaining; };
  return { state, options: { reader, env, repo, event: 'schedule', readRemainingDaily, enqueue } };
}

test('named dispatch reads and writes only the selected PR in either enabled mode', async () => {
  for (const mode of ['dispatch', 'true']) {
    const { state, options } = fixture();
    Object.assign(options, { event: 'workflow_dispatch', dispatchPr: 5 });
    options.env.LANDING_BOT_ENABLED = mode;
    const plan = await planSweep(options);
    assert.deepEqual(plan, [{ number: 5, expectedHeadOid: head }]);
    assert.equal(state.writes.length, 0);
    await applySweep(options, [...plan, { number: 8, expectedHeadOid: head, pullRequestId: 'untrusted' }]);
    assert.deepEqual(state.reads, [5, 5]);
    assert.deepEqual(state.writes, [{ number: 5, pullRequestId: 'PR_5', expectedHeadOid: head }]);
  }
});

test('scheduled runs require all-trigger mode; unsupported events cannot build or apply a plan', async () => {
  const { state, options } = fixture();
  for (const [mode, event] of [['off', 'schedule'], ['dispatch', 'schedule'], ['true', 'pull_request'], ['true', 'workflow_dispatch']]) {
    options.env.LANDING_BOT_ENABLED = mode;
    options.event = event;
    assert.deepEqual(await planSweep(options), []);
    assert.deepEqual(await applySweep(options, [{ number: 5, expectedHeadOid: head }]), []);
  }
  assert.deepEqual(state.reads, []);
  assert.deepEqual(state.writes, []);
});

test('revalidates the exact head, landing gates and current list order before each write', async () => {
  const { state, options } = fixture();
  const plan = await planSweep(options);
  assert.deepEqual(plan.map(p => p.number), [8, 5, 7]);
  state.ordered = [7, 8, 5];
  state.sha.set(7, 'b'.repeat(40));
  state.gates.set(8, false);
  await applySweep(options, plan);
  assert.deepEqual(state.writes.map(p => p.number), [5]);
});

test('a fixed failure threshold, unreadable recent history, or a red main stop queueing', async () => {
  const { state, options } = fixture();
  const plan = await planSweep(options);
  for (let i = 0; i < 5; i++) state.groups[i].conclusion = 'failure';
  assert.deepEqual(await applySweep(options, plan), [], 'the threshold is strict');
  for (const run of state.groups) run.conclusion = 'success';
  state.main.conclusion = 'failure';
  assert.deepEqual(await planSweep(options), []);
  state.main.conclusion = 'success';
  state.groups.pop();
  assert.deepEqual(await planSweep(options), []);
  assert.deepEqual(state.writes, []);
});

test('lost headroom bounds a sweep even when GitHub has yet to count its own writes', async () => {
  for (const dimension of ['freeSlots', 'remaining']) {
    const { state, options } = fixture();
    const plan = await planSweep(options);
    state[dimension] = 1;
    await applySweep(options, plan);
    assert.deepEqual(state.writes.map(p => p.number), [8], dimension);
  }
});

test('stops immediately on an unconfirmed or refused mutation or transport failure', async () => {
  for (const status of ['unconfirmed', 'refused', 'transport']) {
    const { state, options } = fixture();
    const plan = await planSweep(options);
    options.enqueue = async entry => {
      state.writes.push(entry);
      if (status === 'transport') throw new Error('transport failure');
      return { ...entry, status };
    };
    await assert.rejects(applySweep(options, plan), /sweep stopped|transport failure/);
    assert.deepEqual(state.writes.map(p => p.number), [8]);
  }
});

test('skips owner-only list entries, and never scans the daily ledger when no entry qualifies', async () => {
  const { state, options } = fixture();
  state.listOverrides.set(8, { tier: 'T2' });
  state.listOverrides.set(5, { modelChanged: true });
  state.gates.set(7, false);
  assert.deepEqual(await planSweep(options), []);
  assert.deepEqual(state.reads, [7]);
  assert.equal(state.budgetReads, 0);
  state.listOverrides.clear();
  state.gates.clear();
  const plan = await planSweep(options);
  assert.equal(state.budgetReads, 1);
  await applySweep(options, plan);
  assert.equal(state.budgetReads, 2, 'one ledger read per serialized phase');
});
