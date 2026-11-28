/**
 * D6476-p7: before the ejection handler re-queues anything it reads the landing policy for the exact head it will
 * name (landPr.decide() through the feeder reader's readLandingDecision()), needs LANDING_AUTO true now and on that
 * head's report, no stalled alert, #5500 done and main still requiring the merge queue. Each refusal is a fixture:
 * nothing is enqueued and the reason is recorded. S34's reproduction (#6476, 2026-11-21): a queue-cleared ejection
 * with green current-head checks and LANDING_AUTO false used to re-queue.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decide as landDecide } from '../../scripts/lib/landPr.mjs';
import { gateRequeue, OWNER_POLICY_GATES, RECOVERY_WINDOW_HOURS, requeuePolicy, RETRY_POLICY_GATES } from '../../scripts/landing-bot/ejection-rules.mjs';
import { sweep } from '../../scripts/landing-bot/ejection.mjs';
import { createGitHubReader } from '../../scripts/landing-bot/feeder-github.mjs';
import { landingDecision } from './_landingDecision_6476.mjs';

const BOT = 'axal-landing-bot[bot]';
const REPO = 'AxalNetwork/StudioOS';
const T = (min) => new Date(Date.parse('2026-11-27T10:00:00Z') + min * 60_000).toISOString();
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const BASE = 'b'.repeat(40);
const ENV = { GITHUB_REPOSITORY: REPO, LANDING_BOT_LOGIN: BOT, LANDING_BOT_ENABLED: 'true', GITHUB_EVENT_NAME: 'schedule',
  LANDING_BOT_DAILY_REQUEUES: '10', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.5', LANDING_AUTO: 'true', GH_TOKEN: 'synthetic-read-token' };
const person = { login: 'synthetic-owner', __typename: 'User' };
const green = (sha) => ({ ok: true, headSha: sha, fullSuitePassed: true, required: { missing: [], pending: [], failing: [] }, detail: 'all green' });
const pending = (sha) => ({ ok: false, headSha: sha, fullSuitePassed: false, required: { missing: [], pending: ['ci'], failing: [] }, detail: 'pending: ci' });

/** A queue-cleared ejection of PR 7 on SHA1: consent valid, mergeable, checks green. Only the policy varies. */
function world() {
  const s = { head: SHA1, labels: [], inQueue: false, comments: [], enqueues: [], writes: [], evidence: green(SHA1), landingReads: [],
    timeline: [
      { __typename: 'AddedToMergeQueueEvent', createdAt: T(0), actor: person },
      { __typename: 'RemovedFromMergeQueueEvent', createdAt: T(5), actor: { login: 'github', __typename: 'Bot' }, reason: 'QUEUE_CLEARED', beforeCommit: { oid: SHA1 } },
    ] };
  const node = () => ({ id: 'PR_7', number: 7, state: 'OPEN', isDraft: false, body: '', isInMergeQueue: s.inQueue, mergeable: 'MERGEABLE',
    headRefName: 'agent/x', headRefOid: s.head, headRepository: { nameWithOwner: REPO }, baseRepository: { nameWithOwner: REPO },
    labels: { nodes: s.labels.map((name) => ({ name })) }, autoMergeRequest: null, timelineItems: { nodes: s.timeline } });
  const gh = {
    graph: async (query) => (/stackEntry/.test(query) ? { nameWithOwner: REPO, pullRequest: { number: 7, headRefOid: s.head, isDraft: false, isInMergeQueue: s.inQueue, autoMergeRequest: null, stack: null, stackEntry: null } } : { pullRequests: { nodes: [node()] } }),
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20')) return { workflow_runs: [{ id: 1, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: T(-30) }] };
      if (p.startsWith('actions/workflows/ci.yml/runs?branch=main&event=push&status=completed')) return { workflow_runs: [{ id: 1, conclusion: 'success' }] };
      if (p.startsWith('actions/workflows/ci.yml/runs?event=merge_group&status=completed')) return { workflow_runs: Array(20).fill({ conclusion: 'success' }) };
      if (p.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: [] };
      if (p.startsWith('actions/runs/1/jobs')) return { jobs: [] };
      if (p.startsWith('issues?state=open')) return [];
      if (p === 'pulls/7/files?per_page=100') return [{ filename: 'frontend/src/a.js' }];
      if (p === 'pulls/7/commits?per_page=100') return [{ sha: SHA1, parents: [{}], author: { login: 'dev' }, committer: { login: 'dev' }, commit: { message: 'work', committer: { date: T(-60) } } }];
      if (p === 'pulls/7') return { number: 7, mergeable: true, head: { sha: s.head } };
      if (p === 'issues/7/comments?per_page=100') return s.comments;
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const app = {
    graph: async (_q, v) => { s.enqueues.push(v.oid); s.inQueue = true; s.timeline.push({ __typename: 'AddedToMergeQueueEvent', createdAt: s.now, actor: { login: BOT, __typename: 'Bot' } }); },
    post: async (p, b) => {
      s.writes.push(['POST', p]);
      if (p === 'issues/7/labels') for (const l of b.labels) if (!s.labels.includes(l)) s.labels.push(l);
      if (p === 'issues/7/comments') s.comments.push({ id: 900, user: { login: BOT, type: 'Bot' }, body: b.body });
    },
    patch: async (p, b) => { s.writes.push(['PATCH', p]); s.comments[0].body = b.body; },
    del: async (p) => { s.writes.push(['DELETE', p]); },
  };
  // `s.landing` is the decision the reader returns for the head asked about; a function, so a test can throw.
  s.landing = (n) => landingDecision(n, s.head);
  const run = async (min, { env = ENV, reader } = {}) => {
    s.now = T(min);
    const landing = reader ? undefined : async (n) => { s.landingReads.push(n); return s.landing(n); };
    return sweep(env, { gh, app, now: Date.parse(T(min)), evidence: async () => s.evidence, landing, reader });
  };
  return { s, run };
}

test('D6476-p7: S34\'s reproduction: green head, LANDING_AUTO false on its report: no re-queue until the policy allows', async () => {
  const { s, run } = world();
  s.landing = (n) => landingDecision(n, s.head, { landingAuto: false });
  await run(10);
  assert.deepEqual([s.enqueues, s.labels], [[], []], 'refused, and it waits: LANDING_AUTO can be switched on');
  assert.match(s.comments[0].body, /Waiting, not labelled: .*landing gate "agents may queue" fails: .*LANDING_AUTO=false/);
  assert.match(s.comments[0].body, /landing gate "landing policy T0\/T1 for this head" fails: LANDING_AUTO is false/);
  // The policy is read again on the next sweep; once it allows this head, the entry is restored exactly once.
  s.landing = (n) => landingDecision(n, s.head);
  await run(20);
  await run(30);
  assert.deepEqual(s.enqueues, [SHA1]);
  assert.deepEqual(s.landingReads, [7, 7], 'read fresh before the one re-queue, not after it');
});

test('D6476-p7: the repository variable LANDING_AUTO must be true now, whatever the head\'s report said', async () => {
  for (const value of [undefined, 'false', 'TRUE']) {
    const { s, run } = world();
    await run(10, { env: { ...ENV, LANDING_AUTO: value } });
    assert.deepEqual(s.enqueues, [], `LANDING_AUTO=${value}`);
    assert.match(s.comments[0].body, /LANDING_AUTO is (unset|"false"|"TRUE"), not true: agents do not land/);
  }
});

test('D6476-p7: each refusal: nothing is enqueued and the reason is recorded; the owner\'s gates hand back at once', async () => {
  for (const [name, setup, action, reason] of [
    ['#5500 not done', { admission: 'open' }, 'wait', /#5500 not done/],
    ['main no longer requires the merge queue', { mergeQueue: false }, 'wait', /no merge_queue rule on main/],
    ['[alert] merge queue stalled is open', { stalled: true }, 'wait', /merge queue stalled is open \(D5604\)/],
    ['the report is for another head', { reportSha: SHA2 }, 'wait', /report is for head 2222222222/],
    ['a required check pending on the policy read', { checks: 'pending' }, 'wait', /pending: ci/],
    ['T2: the owner lands it', { tier: 'T2' }, 'label', /T2: the owner lands it/],
    ['the PR edits landing-policy.yml', { editsPolicy: true }, 'label', /the PR edits \.github\/workflows\/landing-policy\.yml/],
    ['a draft', { draft: true }, 'label', /the pull request is a draft/],
  ]) {
    const { s, run } = world();
    s.landing = (n) => landingDecision(n, s.head, setup);
    await run(10);
    assert.deepEqual(s.enqueues, [], name);
    assert.deepEqual(s.labels, action === 'label' ? ['ejected'] : [], `${name}: ${action}`);
    assert.match(s.comments[0].body, reason, name);
  }
});

test('D6476-p7: an unread decision or one for another head waits; it is never a pass', async () => {
  {
    const { s, run } = world();
    s.landing = () => { throw new Error('GitHub read failed (HTTP 502)'); };
    await run(10);
    assert.deepEqual([s.enqueues, s.labels], [[], []]);
    assert.match(s.comments[0].body, /the landing decision for this head could not be read \(GitHub read failed \(HTTP 502\)\)/);
  }
  {
    const { s, run } = world();
    s.landing = (n) => landingDecision(n, SHA2);
    await run(10);
    assert.deepEqual(s.enqueues, [], 'a decision for a newer head is not a decision for the head the enqueue names');
    assert.match(s.comments[0].body, /read for another head/);
  }
  {
    const { s, run } = world();
    s.landing = (n) => landingDecision(n + 1, s.head);
    await run(10);
    assert.deepEqual(s.enqueues, [], 'a decision for another PR');
  }
  {
    const { s, run } = world();
    s.landing = () => ({ pr: { number: 7, head_sha: SHA1 }, mayQueue: true, gates: [] });
    await run(10);
    assert.deepEqual(s.enqueues, [], 'mayQueue without its gates is not a decision');
  }
  // Past the recovery window a refusal that would wait is handed back instead.
  const late = world();
  late.s.landing = (n) => landingDecision(n, late.s.head, { admission: 'open' });
  await late.run(RECOVERY_WINDOW_HOURS * 60 + 10);
  assert.deepEqual([late.s.enqueues, late.s.labels], [[], ['ejected']]);
  assert.match(late.s.comments[0].body, /#5500 not done.*the owner re-queues it/);
});

test('D6476-p7: the policy is read only when everything else already allows a re-queue', async () => {
  const { s, run } = world();
  s.evidence = pending(SHA1);
  await run(10);
  assert.deepEqual(s.landingReads, [], 'pending checks wait without spending a policy read');
  s.evidence = green(SHA1);
  await run(20);
  assert.deepEqual([s.landingReads, s.enqueues], [[7], [SHA1]]);
});

/** The feeder reader over an in-memory REST API, so the default path (readLandingDecision) runs for real. */
function fakeApi({ landingAuto }) {
  const runs = [
    { id: 401, name: 'ci', head_sha: SHA1, status: 'completed', conclusion: 'success', app: { id: 15368 } },
    { id: 501, name: 'landing policy', head_sha: SHA1, status: 'completed', conclusion: 'success', app: { id: 15368 } },
  ];
  const log = ['  BASE_SHA: ' + BASE, '  HEAD_SHA: ' + SHA1, '  PR_NUMBER: 7', `  LANDING_AUTO: ${landingAuto}`, '  CHECKOUT_OUTCOME: success',
    ' * branch refs/pull/7/head -> FETCH_HEAD'].join('\n');
  const json = (v) => new Response(JSON.stringify(v), { status: 200 });
  const routes = {
    [`/repos/${REPO}/pulls/7`]: { number: 7, state: 'open', merged: false, draft: false, changed_files: 1, base: { ref: 'main' }, head: { sha: SHA1 }, auto_merge: null },
    [`/repos/${REPO}`]: { allow_auto_merge: true, allow_update_branch: true },
    [`/repos/${REPO}/rules/branches/main`]: [{ type: 'merge_queue' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }],
    [`/repos/${REPO}/issues/5500`]: { state: 'closed', state_reason: 'completed' },
    [`/repos/${REPO}/pulls/7/files`]: [{ filename: 'frontend/src/a.js' }],
    [`/repos/${REPO}/commits/${SHA1}/check-runs`]: { total_count: runs.length, check_runs: runs },
    '/search/issues': { incomplete_results: false, total_count: 0, items: [] },
    [`/repos/${REPO}/actions/jobs/501`]: { id: 501, name: 'landing policy', head_sha: SHA1, status: 'completed', conclusion: 'success', run_id: 601 },
    [`/repos/${REPO}/actions/runs/601`]: { id: 601, event: 'pull_request', path: '.github/workflows/landing-policy.yml', head_sha: SHA1,
      repository: { full_name: REPO }, pull_requests: [{ number: 7, head: { sha: SHA1 }, base: { ref: 'main', sha: BASE } }] },
  };
  const fetchImpl = async (href) => {
    const { pathname } = new URL(href);
    if (pathname === `/repos/${REPO}/actions/jobs/501/logs`) return new Response(log, { status: 200 });
    if (Object.hasOwn(routes, pathname)) return json(routes[pathname]);
    return new Response('not found', { status: 404 });
  };
  return createGitHubReader({ repo: REPO, token: 'synthetic-read-token', fetchImpl, botLogin: BOT, classify: async () => ({ tier: 'T1', reasons: [] }) });
}

test('D6476-p7: through the real readLandingDecision(): LANDING_AUTO false in the head\'s policy log refuses; true restores', async () => {
  const refused = world();
  await refused.run(10, { reader: fakeApi({ landingAuto: false }) });
  assert.deepEqual(refused.s.enqueues, [], 'the job log for this head says LANDING_AUTO false');
  assert.match(refused.s.comments[0].body, /landing gate "landing policy T0\/T1 for this head" fails: report unread/);
  const allowed = world();
  await allowed.run(10, { reader: fakeApi({ landingAuto: true }) });
  assert.deepEqual(allowed.s.enqueues, [SHA1], 'the same facts with LANDING_AUTO true on the report restore the entry');
});

test('D6476-p7: every gate landPr.decide() emits is placed on the owner\'s side or the waiting side', () => {
  const names = landDecide({}).gates.map((g) => g.name);
  assert.deepEqual([...names].sort(), [...OWNER_POLICY_GATES, ...RETRY_POLICY_GATES].sort());
  assert.ok(requeuePolicy({ landing: landingDecision(7, SHA1), number: 7, headSha: SHA1, env: ENV }).ok);
  const off = requeuePolicy({ landing: { ...landingDecision(7, SHA1), mayQueue: false }, number: 7, headSha: SHA1, env: ENV });
  assert.deepEqual([off.ok, off.retry], [false, ['the landing decision does not allow queueing']], 'mayQueue false with every gate ok still refuses');
});

test('D6476-p7: gateRequeue() changes only a re-queue', () => {
  const now = Date.parse(T(10));
  const ctx = { removedAt: T(5), now };
  const refuse = { ok: false, owner: [], retry: ['x'] };
  for (const d of [{ action: 'label', reasons: ['a'] }, { action: 'wait', reasons: ['b'] }, { action: 'keeper', reasons: [] }, { action: 'repair', reasons: [] }]) {
    assert.equal(gateRequeue(d, refuse, ctx), d, d.action);
  }
  const requeue = { action: 'requeue', reasons: [] };
  assert.equal(gateRequeue(requeue, { ok: true, owner: [], retry: [] }, ctx), requeue);
  assert.equal(gateRequeue(requeue, refuse, ctx).action, 'wait');
  assert.equal(gateRequeue(requeue, { ok: false, owner: ['y'], retry: [] }, ctx).action, 'label');
  assert.equal(gateRequeue(requeue, undefined, ctx).action, 'wait', 'no policy is a refusal');
  assert.equal(gateRequeue(requeue, refuse, { removedAt: T(5), now: Date.parse(T(5)) + RECOVERY_WINDOW_HOURS * 3_600_000 }).action, 'label');
});
