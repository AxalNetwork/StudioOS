// #6481 (D6481-p2): the owner's Ready flow. Ready for review -> full suite and a fresh landing policy report ->
// exactly one queue entry on the verified head, behind the feeder's own default-off switch, with a visible reason
// for every PR that waits.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { eligible, mode, switchFor, triggerAllowed } from '../../scripts/landing-bot/rules.mjs';
import { waitingReason } from '../../scripts/landing-bot/feeder-plan.mjs';
import { applySweep, planSweep, RULES_ISSUE } from '../../scripts/landing-bot/feeder-sweep.mjs';

const head = 'a'.repeat(40);
const moved = 'c'.repeat(40);
const repo = 'AxalNetwork/StudioOS';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

function world() {
  const pr = {
    number: 5, node_id: 'PR_5', state: 'open', draft: true, merged: false, mergeable: true, labels: [],
    head: { sha: head, ref: 'agent/claude/5-x', repo: { full_name: repo } }, base: { ref: 'main', repo: { full_name: repo } },
  };
  const state = {
    pr, fullSuite: false, policyAllows: false, queued: false, prior: false, tier: 'T0',
    rulesIssue: { number: RULES_ISSUE, state: 'closed', state_reason: 'completed' }, rulesReads: 0, reads: 0,
    writes: [], waits: [],
  };
  const groups = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, event: 'merge_group', status: 'completed', conclusion: 'success' }));
  const reader = {
    readRulesIssue: async () => { state.rulesReads++; if (state.rulesIssue instanceof Error) throw state.rulesIssue; return state.rulesIssue; },
    readOrderedList: async () => [{ number: 5, tier: state.tier, modelChanged: false }],
    readMainHealth: async () => ({ mainRuns: [{ event: 'push', head_branch: 'main', created_at: '2026-11-27T10:00:00Z', status: 'completed', conclusion: 'success' }], openAlertTitles: [], recentGroupRuns: groups }),
    readQueueState: async () => ({ freeQueueSlots: 2 }),
    readQueueEntries: async () => [],
    readOwningSlot: async () => 'S34',
    readLandingDecision: async (number) => ({
      mayQueue: state.policyAllows,
      gates: [{ name: 'landing policy T0/T1 for this head', ok: state.policyAllows, detail: state.policyAllows ? 'T0' : 'LANDING_AUTO was false in the report for this head' }],
      pr: { number, head_sha: state.pr.head.sha }, report: { headSha: state.pr.head.sha, tier: state.tier },
    }),
    readCandidate: async (number) => {
      state.reads++;
      const pull = structuredClone(state.pr);
      return {
        pull, files: [{ path: 'documentation/x.md' }], headSha: pull.head.sha, number,
        fullSuitePassed: state.fullSuite, modelRepaired: false, alreadyQueued: state.queued, priorQueueEntry: state.prior,
      };
    },
  };
  const options = {
    reader, repo, event: 'schedule',
    env: { LANDING_BOT_FEEDER_ENABLED: 'true', LANDING_BOT_FEED_PER_SWEEP: '1', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.25' },
    readRemainingDaily: async () => 1,
    enqueue: async (e) => { state.writes.push(e); state.queued = true; return { ...e, status: 'queued' }; },
    onWait: (w) => state.waits.push(w),
  };
  const sweep = async () => applySweep(options, await planSweep(options));
  return { state, options, sweep };
}

test('the feeder has its own switch: LANDING_BOT_ENABLED never reaches it, and it never reaches the other kinds', () => {
  assert.equal(switchFor('feeder'), 'LANDING_BOT_FEEDER_ENABLED');
  for (const kind of ['keeper', 'refresh', 'ejection', 'conflict', 'main-repair', 'red-pr', undefined]) {
    assert.equal(switchFor(kind), 'LANDING_BOT_ENABLED', String(kind));
    assert.equal(mode({ LANDING_BOT_FEEDER_ENABLED: 'true' }, kind), 'off', String(kind));
  }
  assert.equal(mode({ LANDING_BOT_ENABLED: 'true' }, 'feeder'), 'off');
  assert.equal(mode({}, 'feeder'), 'off', 'unset is off');
  for (const v of ['', 'TRUE', '1', 'yes', ' true']) assert.equal(mode({ LANDING_BOT_FEEDER_ENABLED: v }, 'feeder'), 'off', v);
  assert.equal(mode({ LANDING_BOT_FEEDER_ENABLED: 'true' }, 'feeder'), 'all');
  assert.equal(mode({ LANDING_BOT_FEEDER_ENABLED: 'dispatch' }, 'feeder'), 'dispatch');
  assert.equal(triggerAllowed({ LANDING_BOT_ENABLED: 'true' }, { event: 'schedule', kind: 'feeder' }), false);
  assert.equal(triggerAllowed({ LANDING_BOT_FEEDER_ENABLED: 'dispatch' }, { event: 'workflow_dispatch', dispatchPr: 5, prNumber: 5, kind: 'feeder' }), true);
  const pr = { number: 5, state: 'open', labels: [], head: { ref: 'agent/x', repo: { full_name: repo } }, base: { repo: { full_name: repo } } };
  const ctx = { repo, files: [{ path: 'documentation/x.md' }], breakers: { open: false }, event: 'schedule' };
  assert.equal(eligible(pr, { ...ctx, kind: 'feeder', env: { LANDING_BOT_FEEDER_ENABLED: 'true' } }).ok, true);
  assert.match(eligible(pr, { ...ctx, kind: 'feeder', env: { LANDING_BOT_ENABLED: 'true' } }).reasons.join(), /LANDING_BOT_FEEDER_ENABLED mode off/);
  assert.equal(eligible(pr, { ...ctx, kind: 'keeper', env: { LANDING_BOT_FEEDER_ENABLED: 'true' } }).ok, false);
});

test('with only LANDING_BOT_ENABLED set, a sweep reads nothing and queues nothing', async () => {
  const { state, options, sweep } = world();
  Object.assign(state, { fullSuite: true, policyAllows: true });
  state.pr.draft = false;
  options.env = { ...options.env, LANDING_BOT_FEEDER_ENABLED: undefined, LANDING_BOT_ENABLED: 'true' };
  assert.deepEqual(await sweep(), []);
  assert.equal(state.reads, 0);
  assert.deepEqual(state.writes, []);
});

test('Ready -> full suite -> fresh policy -> exactly one queue entry on the verified head', async () => {
  const { state, sweep } = world();
  const lastWait = () => state.waits.at(-1)?.line;
  await sweep();
  assert.match(lastWait(), /^checks: a draft/);
  state.pr.draft = false; // Ready for review: CI's full suite is still running
  await sweep();
  assert.match(lastWait(), /^policy: landing policy T0\/T1 for this head \(LANDING_AUTO was false/);
  state.policyAllows = true; // landing-policy.yml re-ran on ready_for_review
  await sweep();
  assert.match(lastWait(), /^checks: no successful full-suite run/);
  state.fullSuite = true;
  const written = await sweep();
  assert.deepEqual(written.map((w) => [w.number, w.expectedHeadOid, w.pullRequestId]), [[5, head, 'PR_5']]);
  // A duplicate sweep or a stale event cannot add a second entry.
  await sweep();
  assert.match(lastWait(), /^queue: already in the merge queue/);
  assert.equal(state.writes.length, 1);
});

test('a draft return, a new commit, a conflict, an owner hold or queue history each stop admission', async () => {
  const cases = [
    [(s) => { s.pr.draft = true; }, /^checks: a draft/],
    [(s) => { s.pr.mergeable = false; }, /^conflict: the branch conflicts with main/],
    [(s) => { s.pr.mergeable = null; }, /^conflict: GitHub has not computed mergeability/],
    [(s) => { s.pr.labels = [{ name: 'bot:off' }]; }, /^hold: labelled bot:off/],
    [(s) => { s.fullSuite = false; }, /^checks: no successful full-suite run/],
    [(s) => { s.tier = 'T2'; }, /^owner review: tier T2/],
    [(s) => { s.prior = true; }, /^queue: it was in the merge queue before/],
  ];
  for (const [change, line] of cases) {
    const { state, sweep } = world();
    Object.assign(state, { fullSuite: true, policyAllows: true });
    state.pr.draft = false;
    change(state);
    assert.deepEqual(await sweep(), [], String(line));
    assert.deepEqual(state.writes, []);
    // A T2 PR is filtered off the list before any read; every other case says why it waits.
    if (state.tier !== 'T2') assert.match(state.waits.at(-1).line, line);
  }
});

test('a head that moves after the plan is not written, and the summary says so', async () => {
  const { state, options } = world();
  Object.assign(state, { fullSuite: true, policyAllows: true });
  state.pr.draft = false;
  const plan = await planSweep(options);
  assert.deepEqual(plan, [{ number: 5, expectedHeadOid: head }]);
  state.pr.head.sha = moved; // a new commit, still green on paper
  assert.deepEqual(await applySweep(options, plan), []);
  assert.deepEqual(state.writes, []);
  assert.match(state.waits.at(-1).line, /^checks: the head moved after the plan/);
});

test('scheduled admission waits for the landing rules issue; a named dispatch does not', async () => {
  for (const issue of [
    { number: RULES_ISSUE, state: 'open', state_reason: null },
    { number: RULES_ISSUE, state: 'closed', state_reason: 'not_planned' },
    { number: 1, state: 'closed', state_reason: 'completed' },
    new Error('HTTP 502'),
  ]) {
    const { state, sweep } = world();
    Object.assign(state, { fullSuite: true, policyAllows: true, rulesIssue: issue });
    state.pr.draft = false;
    assert.deepEqual(await sweep(), []);
    assert.equal(state.reads, 0);
    assert.match(state.waits.at(-1).line, /^hold: scheduled admission waits for #6480/);
  }
  const { state, options, sweep } = world();
  Object.assign(state, { fullSuite: true, policyAllows: true, rulesIssue: { number: RULES_ISSUE, state: 'open', state_reason: null } });
  state.pr.draft = false;
  Object.assign(options, { event: 'workflow_dispatch', dispatchPr: 5 });
  options.env.LANDING_BOT_FEEDER_ENABLED = 'dispatch';
  assert.deepEqual((await sweep()).map((w) => w.number), [5]);
  assert.equal(state.rulesReads, 0);
});

test('a closed breaker or no free build slot is one visible sweep line', async () => {
  const { state, options, sweep } = world();
  Object.assign(state, { fullSuite: true, policyAllows: true });
  state.pr.draft = false;
  options.reader.readQueueState = async () => ({ freeQueueSlots: 0 });
  assert.deepEqual(await sweep(), []);
  assert.deepEqual(state.waits.at(-1), { number: null, line: 'capacity: the merge queue has no free build slot' });
  options.reader.readQueueState = async () => ({ freeQueueSlots: 2 });
  options.reader.readMainHealth = async () => ({ mainRuns: null, openAlertTitles: [], recentGroupRuns: [] });
  assert.deepEqual(await sweep(), []);
  assert.match(state.waits.at(-1).line, /^hold: main CI could not be read/);
});

test('waitingReason is null only when every positive fact holds', () => {
  const row = () => ({
    pull: { number: 5, state: 'open', draft: false, merged: false, mergeable: true, labels: [], head: { sha: head, repo: { full_name: repo } }, base: { ref: 'main', repo: { full_name: repo } } },
    landing: { mayQueue: true, pr: { number: 5, head_sha: head }, report: { headSha: head, tier: 'T1' } },
    evidence: { number: 5, headSha: head, eligible: true, fullSuitePassed: true, modelRepaired: false, alreadyQueued: false, priorQueueEntry: false },
  });
  assert.equal(waitingReason(row()), null);
  const r1 = row(); r1.landing = { mayQueue: false };
  assert.equal(waitingReason(r1), 'policy: the landing decision could not be read');
  const r2 = row(); r2.evidence.modelRepaired = null;
  assert.match(waitingReason(r2), /^owner review: a model-repaired or unattributed bot commit/);
  const r3 = row(); r3.evidence.eligible = false; r3.evidence.eligibleReasons = ['a breaker is open'];
  assert.equal(waitingReason(r3), 'hold: a breaker is open');
  const r4 = row(); r4.evidence.headSha = moved;
  assert.match(waitingReason(r4), /^checks: the evidence is not for this head/);
  const r5 = row(); r5.landing.report.headSha = moved;
  assert.equal(waitingReason(r5), 'policy: the landing policy report is not for this head');
  const r6 = row(); delete r6.pull.draft; // an unread draft flag is not "ready"
  assert.match(waitingReason(r6), /^checks: a draft/);
});

test('the workflows: the feeder reads only its own switch, one login for plan and recheck; Ready re-runs the policy', () => {
  const feeder = read('.github/workflows/landing-feeder.yml');
  assert.match(feeder, /vars\.LANDING_BOT_FEEDER_ENABLED == 'true' \|\|\n\s+\(github\.event_name == 'workflow_dispatch' && vars\.LANDING_BOT_FEEDER_ENABLED == 'dispatch'\)/);
  assert.doesNotMatch(feeder, /vars\.LANDING_BOT_ENABLED|LANDING_BOT_ENABLED:/);
  const job = feeder.slice(feeder.indexOf('    env:\n'), feeder.indexOf('    steps:\n'));
  assert.match(job, /LANDING_BOT_FEEDER_ENABLED: \$\{\{ vars\.LANDING_BOT_FEEDER_ENABLED \}\}/);
  assert.match(job, /LANDING_BOT_LOGIN: \$\{\{ vars\.LANDING_BOT_LOGIN \}\}/, 'job-wide: the plan and the apply step see the same login');
  assert.equal([...feeder.matchAll(/LANDING_BOT_LOGIN:/g)].length, 1);
  const policy = read('.github/workflows/landing-policy.yml');
  assert.match(policy, /on:\n  pull_request:\n(?:    #.*\n)*    types: \[opened, synchronize, reopened, ready_for_review\]\n    branches: \[main\]\n/);
  assert.match(read('.github/workflows/ci.yml'), /types: \[opened, synchronize, reopened, ready_for_review\]/);
});
