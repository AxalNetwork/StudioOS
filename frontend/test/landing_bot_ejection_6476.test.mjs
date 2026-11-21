/** #6476: the queue ejection handler: classes, consent, decisions, and the workflow as text. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classify, consent, decide, keepsConsent, MAX_REQUEUES_PER_DAY } from '../../scripts/landing-bot/ejection-rules.mjs';
import { botRequeues, candidates, normalise, oneLine } from '../../scripts/landing-bot/ejection.mjs';
import { assertWorkflow, parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/landing-bot-ejection.yml', ROOT), 'utf8');
const BOT = 'axal-landing-bot[bot]';
const NOW = Date.parse('2026-11-16T12:00:00Z');
const owner = { login: 'guillaumelauzier', type: 'User' };
const bot = { login: BOT, type: 'Bot' };
const green = { conclusion: 'success', jobs: [{ name: 'build', conclusion: 'success' }] };
const commit = (sha, date, { by = 'someone', message = 'work', parents = 1 } = {}) => ({
  sha: sha.repeat(40).slice(0, 40), parents: Array(parents).fill({}), author: { login: by }, committer: { login: by }, commit: { message, committer: { date } },
});
const keeperMerge = (sha, date) => commit(sha, date, { by: BOT, parents: 2, message: 'Merge main\n\nLanding-Bot-Kind: keeper' });
const queued = (over = {}) => ({ added: [{ at: '2026-11-16T10:00:00Z', actor: owner }], removed: [], commits: [commit('a', '2026-11-16T09:00:00Z')], autoMerge: null, ...over });

test('#6476: each class from its evidence', () => {
  const failRun = { conclusion: 'failure', jobs: [{ name: 'test (frontend)', conclusion: 'failure' }] };
  const cases = [
    [{ reason: 'MERGE_CONFLICT' }, 'conflict'],
    [{ reason: 'CI_TIMEOUT' }, 'timeout'],
    [{ reason: 'MANUAL' }, 'manual'],
    [{ reason: 'QUEUE_CLEARED' }, 'infrastructure'],
    [{ reason: 'FAILED_CHECKS', mainRed: true }, 'infrastructure'],
    [{ reason: 'FAILED_CHECKS', infra: true, main: green }, 'infrastructure'],
    [{ reason: 'FAILED_CHECKS', queueRun: { conclusion: 'cancelled', jobs: [] }, main: green }, 'cascade'],
    [{ reason: 'FAILED_CHECKS', queueRun: { conclusion: 'failure', jobs: [{ name: 'verify merge group ref', conclusion: 'failure' }] }, main: green }, 'cascade'],
    [{ reason: 'FAILED_CHECKS', queueRun: failRun, main: green, failedTests: [{ file: 'a.test.mjs', test: 't' }], flaky: [{ file: 'a.test.mjs', test: 't' }] }, 'flake'],
    // Audit 2026-11-17 (P0): green on its own head and on main, red only in the group, is not a flake.
    [{ reason: 'FAILED_CHECKS', queueRun: failRun, main: green, headRun: { conclusion: 'success' } }, 'incompatible'],
    [{ reason: 'FAILED_CHECKS', queueRun: failRun, main: green, headRun: { conclusion: 'failure' } }, 'own-failure'],
    [{ reason: 'SOMETHING_NEW' }, 'unknown'],
    [{ reason: 'FAILED_CHECKS', record: { class: 'cascade' } }, 'cascade'],
  ];
  for (const [e, want] of cases) assert.equal(classify(e).class, want, JSON.stringify(e));
});

test('#6476: consent: a person queued it and only no-model main merges followed', () => {
  assert.equal(consent(queued(), { botLogin: BOT }).valid, true);
  assert.equal(consent(queued({ commits: [commit('a', '2026-11-16T09:00:00Z'), keeperMerge('b', '2026-11-16T11:00:00Z')] }), { botLogin: BOT }).valid, true);
  const updateBranch = commit('c', '2026-11-16T11:00:00Z', { by: 'web-flow', parents: 2, message: "Merge branch 'main' into agent/x" });
  assert.ok(keepsConsent(updateBranch, BOT));
  // Owner, 2026-11-17: the landing App's own entry is consent; another bot's is not.
  assert.equal(consent(queued({ added: [{ at: '2026-11-16T10:00:00Z', actor: bot }] }), { botLogin: BOT }).source, 'app-queued');
  assert.match(consent(queued({ added: [{ at: '2026-11-16T10:00:00Z', actor: { login: 'renovate[bot]', type: 'Bot' } }] }), { botLogin: BOT }).reason, /another bot's entry is not consent/);
  // A model commit (or any other commit) after consent voids it, even by the bot.
  const model = commit('d', '2026-11-16T11:00:00Z', { by: BOT, message: 'Resolve conflicts\n\nLanding-Bot-Kind: conflict' });
  assert.match(consent(queued({ commits: [commit('a', '2026-11-16T09:00:00Z'), model] }), { botLogin: BOT }).reason, /not a no-model merge/);
  // A manual removal voids it.
  assert.match(consent(queued({ removed: [{ at: '2026-11-16T10:30:00Z', actor: owner, reason: 'MANUAL' }] }), { botLogin: BOT }).reason, /removed it/);
  // An enabled auto-merge by a person counts as a second signal.
  assert.equal(consent({ added: [], removed: [], commits: [], autoMerge: { enabledAt: '2026-11-16T10:00:00Z', enabledBy: owner } }, { botLogin: BOT }).source, 'auto-merge');
});

const ok = (over = {}) => ({
  klass: 'flake', removedAt: new Date(NOW - 10 * 60_000).toISOString(), consent: { valid: true }, checks: 'green', headUnchangedSinceChecks: true,
  eligible: { ok: true, reasons: [] }, breakers: { open: false, reasons: [] }, openAlertTitles: [], requeues: [], pr: 7, now: NOW,
  env: { LANDING_BOT_DAILY_REQUEUES: '10', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.2' },
  queueRuns: Array(20).fill({ conclusion: 'success' }), ...over,
});

test('#6476: what each class does', () => {
  for (const k of ['cascade', 'flake', 'infrastructure']) assert.equal(decide(ok({ klass: k })).action, 'requeue', k);
  assert.equal(decide(ok({ klass: 'conflict' })).action, 'keeper');
  assert.equal(decide(ok({ klass: 'conflict', stillConflicting: false })).action, 'requeue', 'restored once the keeper cleared it');
  assert.deepEqual([decide(ok({ klass: 'own-failure' })).action, decide(ok({ klass: 'own-failure' })).label], ['repair', 'ejected']);
  for (const k of ['manual', 'unknown', 'timeout']) assert.deepEqual([decide(ok({ klass: k })).action, decide(ok({ klass: k })).label], ['label', 'ejected'], k);
  // A flake gets one re-queue and no repair.
  const flake = decide(ok({ klass: 'flake' }));
  assert.equal(flake.action, 'requeue');
  assert.notEqual(flake.action, 'repair');
});

test('#6476: a refusal that needs the owner labels; one that clears on its own waits (S1)', () => {
  const twice = Array(MAX_REQUEUES_PER_DAY).fill({ pr: 7, at: '2026-11-16T11:00:00Z' });
  const handBack = [
    ['no consent', { consent: { valid: false, reason: 'no person queued this PR' } }, /no person queued/],
    ['checks failed', { checks: 'failed' }, /a required check failed/],
    ['not eligible', { eligible: { ok: false, reasons: ['labelled bot:off'] } }, /bot:off/],
  ];
  for (const [name, over, reason] of handBack) {
    const d = decide(ok(over));
    assert.deepEqual([d.action, d.label], ['label', 'ejected'], name);
    assert.match(d.reasons.join('; '), reason, name);
  }
  const waits = [
    ['third re-queue in a day', { requeues: twice }, /2 re-queues of this PR in 24 hours/],
    ['repo-wide cap', { env: { LANDING_BOT_DAILY_REQUEUES: '1', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.2' }, requeues: [{ pr: 99, at: '2026-11-16T01:00:00Z' }] }, /LANDING_BOT_DAILY_REQUEUES: 1 of 1/],
    ['cap unset', { env: { LANDING_BOT_QUEUE_FAIL_BREAKER: '0.2' } }, /0 of 0/],
    ['failure-share breaker', { queueRuns: [...Array(16).fill({ conclusion: 'success' }), ...Array(4).fill({ conclusion: 'failure' })] }, /20% of the last 20/],
    ['breaker unset', { env: { LANDING_BOT_DAILY_REQUEUES: '10' } }, /QUEUE_FAIL_BREAKER is not set/],
    ['red main delays', { breakers: { open: true, reasons: ['main is red: its newest completed CI run is failure'] } }, /main is red/],
    ['queue stalled', { openAlertTitles: ['[alert] merge queue stalled'] }, /merge queue stalled is open/],
    ['head changed since green', { headUnchangedSinceChecks: false }, /head changed since the checks/],
    ['checks pending', { checks: 'pending' }, /still running/],
    ['checks unreadable', { checks: 'unknown' }, /could not be confirmed/],
    ['diff unreadable', { eligible: { ok: false, reasons: ['the diff could not be read'] } }, /diff could not be read/],
  ];
  for (const [name, over, reason] of waits) {
    const d = decide(ok(over));
    assert.equal(d.action, 'wait', name);
    assert.equal(d.label, undefined, `${name}: a wait writes no label`);
    assert.match(d.reasons.join('; '), reason, name);
    // The same condition, on an ejection over a day old, is handed back.
    const late = decide(ok({ ...over, removedAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString() }));
    assert.deepEqual([late.action, late.label], ['label', 'ejected'], `${name}: past the window`);
  }
});

test('#6476: candidates are open, unqueued PRs whose newest queue event is an unhandled removal', () => {
  const node = (n, items, extra = {}) => ({ id: `PR_${n}`, number: n, state: 'OPEN', isInMergeQueue: false, mergeable: 'MERGEABLE', headRefName: 'b', headRefOid: 'f'.repeat(40), headRepository: { nameWithOwner: 'AxalNetwork/StudioOS' }, baseRepository: { nameWithOwner: 'AxalNetwork/StudioOS' }, labels: { nodes: [] }, autoMergeRequest: null, timelineItems: { nodes: items }, ...extra });
  const added = (at, a = { login: 'guillaumelauzier', __typename: 'User' }) => ({ __typename: 'AddedToMergeQueueEvent', createdAt: at, actor: a });
  const removed = (at, reason = 'FAILED_CHECKS') => ({ __typename: 'RemovedFromMergeQueueEvent', createdAt: at, actor: { login: 'github', __typename: 'Bot' }, reason });
  const labeled = (at) => ({ __typename: 'LabeledEvent', createdAt: at, label: { name: 'ejected' } });
  const prs = normalise([
    node(1, [added('2026-11-16T10:00:00Z'), removed('2026-11-16T10:20:00Z')]),
    node(2, [added('2026-11-16T10:00:00Z'), removed('2026-11-16T10:20:00Z'), added('2026-11-16T10:30:00Z')]),
    node(3, [added('2026-11-16T10:00:00Z'), removed('2026-11-16T10:20:00Z'), labeled('2026-11-16T10:25:00Z')]),
    node(4, [added('2026-11-16T10:00:00Z'), removed('2026-11-16T10:20:00Z')], { isInMergeQueue: true }),
    node(5, [added('2026-11-16T09:00:00Z', { login: BOT, __typename: 'Bot' })], { state: 'MERGED' }),
  ]);
  assert.deepEqual(candidates(prs).map((p) => p.number), [1]);
  assert.deepEqual(botRequeues(prs, BOT), [{ pr: 5, at: '2026-11-16T09:00:00Z' }], 'a merged PR\'s bot re-queue still counts');
});

test('#6476: the workflow: no PR or workflow_run trigger, dispatch only with GITHUB_TOKEN, guard passes', () => {
  assert.doesNotMatch(WORKFLOW, /^\s*(?:pull_request|pull_request_target|workflow_run|issue_comment):/m);
  const { jobs } = parseJobs(WORKFLOW);
  const handle = jobs.find((j) => j.id === 'handle');
  const dispatch = jobs.find((j) => j.id === 'dispatch');
  assert.equal(handle.environment, 'landing-bot');
  assert.doesNotMatch(handle.lines.join('\n'), /gh workflow run|actions: write/);
  assert.equal(dispatch.environment, null);
  assert.doesNotMatch(dispatch.lines.join('\n'), /secrets\.|APP_TOKEN/);
  for (const step of jobs.flatMap((j) => j.steps).filter((s) => /\brun:/.test(s))) assert.doesNotMatch(step.slice(step.indexOf('run:')), /\$\{\{/);
  assert.doesNotMatch(WORKFLOW + readFileSync(new URL('scripts/landing-bot/ejection.mjs', ROOT), 'utf8'), /--admin|mergePullRequest|addPullRequestReview|jump/);
  assertWorkflow(new URL('.github/workflows/landing-bot-ejection.yml', ROOT).pathname);
});

test('a value from the API cannot start a second line in GITHUB_OUTPUT or the summary', () => {
  // Mutation checked: oneLine returning its input unchanged fails here.
  assert.equal(oneLine('[1]\nrepair=[999]'), '[1] repair=[999]');
  assert.equal(oneLine('a\r\n\r\nb'), 'a b');
  assert.equal(oneLine(undefined), '');
  assert.equal(oneLine(JSON.stringify([{ pr: 7, note: 'x\ny' }])), '[{"pr":7,"note":"x\\ny"}]', 'JSON keeps its own escapes');
});
