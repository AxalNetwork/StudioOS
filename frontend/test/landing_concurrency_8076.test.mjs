/**
 * #8076 (D8076): the feeder admits at most one `pr:privileged` PR to the merge queue at a time and at most three PRs
 * per slot; a held candidate is explained in one line; shared-state workflows each declare their concurrency group.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { facts, hold, holdLine, holds, PRIVILEGED_LABEL, SHARED_STATE_GROUPS } from '../../scripts/landing-bot/concurrency.mjs';
import { applySweep, planSweep } from '../../scripts/landing-bot/feeder-sweep.mjs';
import { PER_SLOT_IN_QUEUE, PRIVILEGED_IN_QUEUE } from '../../scripts/landing-bot/rules.mjs';
import { parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';

const ROOT = new URL('../../', import.meta.url);
const q = (number, slot = 'S07', labels = []) => ({ number, slot, labels: labels.map((name) => ({ name })) });
const priv = (number, slot = 'S01') => q(number, slot, [PRIVILEGED_LABEL]);

test('#8076: the limits are one privileged and three per slot', () => {
  assert.equal(PRIVILEGED_IN_QUEUE, 1);
  assert.equal(PER_SLOT_IN_QUEUE, 3);
});

test('#8076: a privileged candidate is held while one is queued, and released when it leaves', () => {
  const h = hold(priv(20), [priv(10), q(11)]);
  assert.equal(h.reason, 'privileged');
  assert.deepEqual(h.blockers, [10]);
  assert.equal(h.line, 'Held from the merge queue: a privileged PR is already queued (#10), and the most is 1. It is admitted once that one leaves the queue.');
  // #10 merged or left: admitted.
  assert.equal(hold(priv(20), [q(11)]), null);
  // A plain PR is never held by a queued privileged one.
  assert.equal(hold(q(21, 'S02'), [priv(10)]), null);
  // The owner may raise the limit.
  assert.equal(hold(priv(20), [priv(10)], { privileged: 2 }), null);
});

test('#8076: a slot at its cap holds the next of that slot, never another slot\'s', () => {
  const queue = [q(1, 'S07'), q(2, 'S07'), q(3, 'S07'), q(4, 'S09')];
  const h = hold(q(5, 'S07'), queue);
  assert.equal(h.reason, 'slot');
  assert.equal(h.slot, 'S07');
  assert.deepEqual(h.blockers, [1, 2, 3]);
  assert.equal(h.line, 'Held from the merge queue: slot S07 already has 3 PRs queued (#1, #2, #3), and the most is 3. It is admitted once one leaves the queue.');
  assert.equal(hold(q(6, 'S09'), queue), null);
  // Two of S07 queued: admitted. One leaves the full queue: admitted.
  assert.equal(hold(q(5, 'S07'), queue.slice(1)), null);
  // Slot spelling is normalised; a label that is not a slot is no slot.
  assert.equal(hold(q(5, 's07'), queue).reason, 'slot');
  assert.deepEqual(facts(q(5, 'slot:S07')), { number: 5, privileged: false, slot: '' });
  // A PR with no slot is never held by the slot cap.
  assert.equal(hold(q(7, ''), [q(1, ''), q(2, ''), q(3, ''), q(4, '')]), null);
});

test('#8076: an unread queue or slot holds, never admits', () => {
  for (const [name, c, queue] of [['queue', q(5), null], ['candidate slot', q(5, null), []], ['an entry\'s slot', q(5), [q(1, null)]]]) {
    const h = hold(c, queue);
    assert.equal(h?.reason, 'unread', name);
    assert.match(h.line, /could not be read, so nothing is admitted until they can/);
  }
});

test('#8076: a sweep counts its own admissions against later candidates', () => {
  const r = holds([q(1), q(2), q(3), q(4), priv(5), priv(6), q(7, 'S09')], []);
  assert.deepEqual(r.admit.map((c) => c.number), [1, 2, 3, 5, 7]);
  assert.deepEqual(r.held.map((h) => [h.number, h.reason]), [[4, 'slot'], [6, 'privileged']]);
  assert.deepEqual(holds([q(1)], null).held.map((h) => h.reason), ['unread']);
});

test('#8076: holdLine says how many when the owner raises the privileged limit', () => {
  assert.equal(holdLine({ reason: 'privileged', blockers: [1, 2] }, { privilegedCap: 2 }),
    'Held from the merge queue: 2 privileged PRs are already queued (#1, #2), and the most is 2. It is admitted once one leaves the queue.');
});

// ── The admission step ────────────────────────────────────────────────────────
const head = 'a'.repeat(40);
const repo = 'AxalNetwork/StudioOS';
function fixture({ queue = [], slots = {}, labels = {} } = {}) {
  const state = { queue, writes: [], held: [] };
  const groups = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, event: 'merge_group', status: 'completed', conclusion: 'success' }));
  const reader = {
    readOrderedList: async () => [8, 5, 7].map((number) => ({ number, tier: 'T1', modelChanged: false })),
    readMainHealth: async () => ({ mainRuns: [{ event: 'push', head_branch: 'main', created_at: '2026-11-22T12:00:00Z', status: 'completed', conclusion: 'success' }], openAlertTitles: [], recentGroupRuns: groups }),
    readQueueState: async () => ({ freeQueueSlots: 5 }),
    readRulesIssue: async () => ({ number: 6480, state: 'closed', state_reason: 'completed' }),
    readQueueEntries: async () => (typeof state.queue === 'function' ? state.queue() : state.queue),
    readOwningSlot: async (pull) => { const s = slots[pull.number] ?? 'S07'; if (s instanceof Error) throw s; return s; },
    readLandingDecision: async (number) => ({ mayQueue: true, pr: { number, head_sha: head }, report: { headSha: head, tier: 'T1' } }),
    readCandidate: async (number) => ({
      pull: {
        number, node_id: `PR_${number}`, state: 'open', draft: false, merged: false, mergeable: true, labels: (labels[number] || []).map((name) => ({ name })),
        head: { sha: head, ref: `agent/f-${number}`, repo: { full_name: repo } }, base: { ref: 'main', repo: { full_name: repo } },
      },
      files: [{ path: 'documentation/sample.md' }], headSha: head, number, fullSuitePassed: true, modelRepaired: false, alreadyQueued: false, priorQueueEntry: false,
    }),
  };
  const options = {
    reader, repo, event: 'schedule', env: { LANDING_BOT_FEEDER_ENABLED: 'true', LANDING_BOT_FEED_PER_SWEEP: '5', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.25' },
    readRemainingDaily: async () => 5,
    enqueue: async (e) => { state.writes.push(e.number); return { ...e, status: 'queued' }; },
    onHold: (h) => state.held.push(h),
  };
  return { state, options };
}

test('#8076: the plan holds a slot at its cap and says why', async () => {
  const { state, options } = fixture({ queue: [q(1), q(2)], slots: { 8: 'S07', 5: 'S07', 7: 'S09' } });
  const plan = await planSweep(options);
  // Two of S07 queued: #8 takes the third place, #5 is held, #7 (S09) goes.
  assert.deepEqual(plan.map((p) => p.number), [8, 7]);
  assert.deepEqual(state.held.map((h) => [h.number, h.reason]), [[5, 'slot']]);
  assert.match(state.held[0].line, /slot S07 already has 3 PRs queued \(#1, #2, #8\)/);
});

test('#8076: apply re-reads the queue before each write, so a hold set since the plan is kept', async () => {
  const { state, options } = fixture({ labels: { 5: [PRIVILEGED_LABEL] }, slots: { 8: 'S01', 5: 'S02', 7: 'S03' } });
  const plan = await planSweep(options);
  assert.deepEqual(plan.map((p) => p.number), [8, 5, 7]);
  // A privileged PR was queued by a person after the plan.
  state.queue = [priv(99, 'S04')];
  const written = await applySweep(options, plan);
  assert.deepEqual(written.map((w) => w.number), [8, 7]);
  assert.deepEqual(state.writes, [8, 7]);
  assert.deepEqual(state.held.map((h) => [h.number, h.reason]), [[5, 'privileged']]);
  // An entry this sweep wrote that the queue read does not show yet still counts, once.
  const second = fixture({ slots: { 8: 'S07', 5: 'S07', 7: 'S07' }, queue: [q(1)] });
  await applySweep(second.options, [8, 5, 7].map((number) => ({ number, expectedHeadOid: head })));
  assert.deepEqual(second.state.writes, [8, 5]);
  assert.deepEqual(second.state.held.map((h) => h.number), [7]);
});

test('#8076: an unreadable queue or slot admits nothing', async () => {
  const broken = fixture({ queue: () => { throw new Error('GraphQL'); } });
  assert.deepEqual(await planSweep(broken.options), []);
  assert.deepEqual(broken.state.held.map((h) => h.reason), ['unread', 'unread', 'unread']);
  const noReader = fixture();
  delete noReader.options.reader.readQueueEntries;
  assert.deepEqual(await planSweep(noReader.options), []);
  const slot = fixture({ slots: { 8: new Error('403'), 5: 'S02', 7: 'S03' } });
  assert.deepEqual((await planSweep(slot.options)).map((p) => p.number), [5, 7]);
});

test('#8076: the reader takes a slot from the PR\'s issue, and refuses an incomplete queue read', () => {
  const src = readFileSync(new URL('scripts/landing-bot/feeder-github.mjs', ROOT), 'utf8');
  assert.match(src, /mergeQueue\(branch: "main"\) \{ entries\(first: 100\) \{ totalCount nodes \{ pullRequest \{ number body labels/);
  assert.match(src, /conn\.nodes\.length !== conn\.totalCount/);
  assert.match(src, /owningSlot\(pull\.body, issue\) \?\? ''/);
  const feeder = readFileSync(new URL('scripts/landing-bot/feeder.mjs', ROOT), 'utf8');
  assert.match(feeder, /const onHold = h => appendFileSync\(env\.GITHUB_STEP_SUMMARY, `PR #\$\{h\.number\} — \$\{h\.line\}\\n`\);/);
});

test('#8076: every shared-state workflow declares its concurrency group, never cancelling a running write', () => {
  assert.ok(SHARED_STATE_GROUPS.length >= 5);
  const groups = new Set();
  for (const w of SHARED_STATE_GROUPS) {
    const text = readFileSync(new URL(w.workflow, ROOT), 'utf8');
    let block;
    if (w.job) {
      const job = parseJobs(text).jobs.find((j) => j.id === w.job);
      assert.ok(job, `${w.workflow}: job ${w.job}`);
      block = /^ {4}concurrency:\n((?: {6}.*\n)+)/m.exec(`${job.lines.join('\n')}\n`)?.[1];
    } else {
      block = /^concurrency:\n((?: {2}.*\n)+)/m.exec(text)?.[1];
    }
    assert.ok(block, `${w.workflow} declares a concurrency group`);
    assert.match(block, new RegExp(`group: ${w.group}\\s*\\n`), `${w.workflow}: group ${w.group}`);
    assert.match(block, /cancel-in-progress: false/, `${w.workflow}: a running write is never cancelled`);
    assert.ok(!groups.has(w.group), `${w.group} is one state's key`);
    groups.add(w.group);
  }
});
