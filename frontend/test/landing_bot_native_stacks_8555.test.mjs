/**
 * #8555 (D8555): a native GitHub stack's layers, and any PR whose membership cannot be read, are held before every
 * individual keeper, resolver, refresh, feeder and ejection action. The real entry points run against in-memory
 * GitHub fakes that record every write; the stack read is GitHub's GraphQL `stack` / `stackEntry` pair.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classify, gateLandingDecisions, guardEnqueue, MEMBER, ORDINARY, readMembership, STACK_QUERY, stackGuard, UNKNOWN,
} from '../../scripts/landing-bot/stack-membership.mjs';
import { applyStage as keeperApply, planStage as keeperPlan } from '../../scripts/landing-bot/keeper.mjs';
import { applyStage as resolverApply, planStage as resolverPlan } from '../../scripts/landing-bot/resolve.mjs';
import { applyStage as refreshApply } from '../../scripts/landing-bot/refresh.mjs';
import { sweep as ejectionSweep } from '../../scripts/landing-bot/ejection.mjs';
import { applySweep, planSweep } from '../../scripts/landing-bot/feeder-sweep.mjs';

const REPO = 'AxalNetwork/StudioOS';
const BOT = 'axal-landing-bot[bot]';
const NOW = Date.parse('2026-11-27T12:00:00Z');
const T = (min) => new Date(NOW + min * 60_000).toISOString();
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ROOT = new URL('../../', import.meta.url);

// ---- GitHub's answers to STACK_QUERY ------------------------------------------------------------------------------
const pull = (number, head, extra = {}) => ({ number, headRefOid: head, isDraft: false, state: 'OPEN', isInMergeQueue: false, autoMergeRequest: null, ...extra });
const ordinary = (number, head = A, extra) => ({ nameWithOwner: REPO, pullRequest: { ...pull(number, head, extra), stack: null, stackEntry: null } });
const member = (number, head = A, { position = 1, size = 3, stackNo = 4, ...extra } = {}) => ({
  nameWithOwner: REPO,
  pullRequest: { ...pull(number, head, extra), stack: { number: stackNo, size, baseRefName: 'main' }, stackEntry: { position, pullRequest: { number }, stack: { number: stackNo } } },
});
const LAYERS = {
  bottom: (n, h) => member(n, h, { position: 1 }),
  upper: (n, h) => member(n, h, { position: 2 }),
  draft: (n, h) => member(n, h, { position: 3, isDraft: true }),
};
const missingFields = (n, h = A) => ({ nameWithOwner: REPO, pullRequest: pull(n, h) });
const UNREADABLE = {
  failed: () => { throw new Error('GitHub POST failed (HTTP 502)'); },
  'GraphQL error': () => { throw new Error('incomplete GraphQL result'); },
  'fields absent': (n, h) => missingFields(n, h),
  'stackEntry absent': (n, h) => ({ nameWithOwner: REPO, pullRequest: { ...pull(n, h), stack: null } }),
  'stack only': (n, h) => ({ nameWithOwner: REPO, pullRequest: { ...pull(n, h), stack: { number: 4, size: 2 }, stackEntry: null } }),
  'entry only': (n, h) => ({ nameWithOwner: REPO, pullRequest: { ...pull(n, h), stack: null, stackEntry: { position: 1, pullRequest: { number: n }, stack: { number: 4 } } } }),
  'no pull request': () => ({ nameWithOwner: REPO, pullRequest: null }),
};
// Adversarial: an answer that is well formed but is not about this repository, this PR or this stack.
const MISMATCH = {
  'another repository': (n, h) => ({ ...ordinary(n, h), nameWithOwner: 'evil/StudioOS' }),
  'unnamed repository': (n, h) => { const o = ordinary(n, h); delete o.nameWithOwner; return o; },
  'another PR': (n, h) => ordinary(n + 1, h),
  'entry for another PR': (n, h) => { const m = member(n, h); m.pullRequest.stackEntry.pullRequest.number = n + 1; return m; },
  'entry in another stack': (n, h) => { const m = member(n, h); m.pullRequest.stackEntry.stack.number = 99; return m; },
  'position past the size': (n, h) => member(n, h, { position: 4, size: 3 }),
  'unreadable head': (n) => ordinary(n, 'not-a-sha'),
};

/** A graph() answering STACK_QUERY from `answer(number, head)` and anything else from `other`; records each read. */
function stackGraph(answer, { head = () => A, other, reads = [] } = {}) {
  return async (q, v) => {
    if (q === STACK_QUERY) { reads.push(v.number); return answer(v.number, head(v.number)); }
    if (other) return other(q, v);
    throw new Error('unexpected GraphQL query');
  };
}

// Every GitHub write the bot could make, by kind: what the acceptance counts as zero.
const FORBIDDEN = /update-branch|merge-async|auto-merge|dequeue|enqueuePullRequest|PullRequestAutoMerge|mutation/i;
function recorder() {
  const calls = [];
  const rec = (verb) => async (path, body) => { calls.push([verb, String(path), body]); return verb === 'get' ? [] : {}; };
  return { calls, app: { get: rec('get'), post: rec('post'), patch: rec('patch'), put: rec('put'), del: rec('del'), graph: async (q, v) => { calls.push(['graph', q, v]); return {}; } } };
}
const writes = (calls) => calls.filter(([verb]) => verb !== 'get');
const greenMain = { workflow_runs: [{ id: 1, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: T(-30) }] };

// ---- the adapter ------------------------------------------------------------------------------------------------
test('#8555: only an answer that serves both fields as null for this repository and PR is ordinary', () => {
  const o = classify(ordinary(12), { repo: REPO, number: 12 });
  assert.equal(o.status, ORDINARY);
  assert.equal(o.head, A);
  assert.deepEqual(o.evidence, { stack: null, stackEntry: null });
  for (const [layer, make] of Object.entries(LAYERS)) {
    const m = classify(make(12, A), { repo: REPO, number: 12 });
    assert.equal(m.status, MEMBER, layer);
    assert.equal(m.layer, layer === 'bottom' ? 'bottom' : 'upper', layer);
    assert.equal(m.stack.number, 4);
  }
  assert.equal(classify(LAYERS.draft(12, A), { repo: REPO, number: 12 }).draft, true);
  for (const [name, make] of Object.entries({ ...UNREADABLE, ...MISMATCH })) {
    let answer;
    try { answer = make(12, A); } catch { answer = null; }
    const r = classify(answer, { repo: REPO, number: 12 });
    assert.equal(r.status, UNKNOWN, name);
    assert.ok(r.reason && r.reason.length <= 160 && !/[\r\n]/.test(r.reason), `${name}: a bounded one-line reason`);
  }
  // A case-only difference in the repository name is the same repository.
  assert.equal(classify({ ...ordinary(12), nameWithOwner: 'axalnetwork/studioos' }, { repo: REPO, number: 12 }).status, ORDINARY);
  // The caller's own identity must be valid before anything is read.
  assert.equal(classify(ordinary(12), { repo: 'not a repo', number: 12 }).status, UNKNOWN);
  assert.equal(classify(ordinary(12), { repo: REPO, number: 0 }).status, UNKNOWN);
});

test('#8555: a failed read never throws, never reads as ordinary, and its reason is bounded and has no token', async () => {
  const long = `Bearer ghs_secret ${'x'.repeat(500)}\nsecond line`;
  const r = await readMembership(async () => { throw new Error(long); }, { repo: REPO, number: 5 });
  assert.equal(r.status, UNKNOWN);
  assert.ok(r.reason.length <= 160);
  assert.doesNotMatch(r.reason, /ghs_secret|\n/);
  assert.equal((await readMembership(undefined, { repo: REPO, number: 5 })).status, UNKNOWN);
  let called = 0;
  assert.equal((await readMembership(async () => { called++; return ordinary(5); }, { repo: '../x', number: 5 })).status, UNKNOWN);
  assert.equal(called, 0, 'an invalid identity is not read at all');
  const reads = [];
  await readMembership(stackGraph((n) => ordinary(n), { reads }), { repo: REPO, number: 5 });
  assert.deepEqual(reads, [5], 'one read per call');
});

test('#8555: the guard proceeds only for an ordinary PR at the expected head', async () => {
  const g = (answer, expectedHead) => stackGuard({ graph: stackGraph(answer), repo: REPO, number: 9, expectedHead, boundary: 'a test write' });
  assert.equal((await g((n) => ordinary(n), A)).hold, false);
  assert.equal((await g((n) => ordinary(n), undefined)).hold, false, 'without a pinned head, membership alone decides');
  const moved = await g((n) => ordinary(n, B), A);
  assert.equal(moved.disposition, 'held-head-moved');
  assert.match(moved.line, /head moved since the plan/);
  assert.equal((await g((n) => ordinary(n), 'unread')).hold, true, 'an unreadable expected head holds');
  assert.equal((await g((n) => member(n), A)).disposition, 'held-member');
  assert.equal((await g((n) => member(n, A, { isInMergeQueue: true, autoMergeRequest: { enabledAt: T(-5) } }), A)).disposition, 'held-queued-member');
  assert.equal((await g(UNREADABLE.failed, A)).disposition, 'held-unknown');
  assert.match((await g((n) => member(n, A, { position: 2 }), A)).line, /#9 held before a test write: upper layer of native stack #4, layer 2 of 3/);
});

// ---- branch keeper ----------------------------------------------------------------------------------------------
function keeperWorld(answer, { restHead = A } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'keeper-8555-'));
  const env = { GITHUB_REPOSITORY: REPO, LANDING_BOT_ENABLED: 'true', GITHUB_EVENT_NAME: 'schedule', LANDING_BOT_LOGIN: BOT, RUNNER_TEMP: tmp,
    GITHUB_RUN_ID: '41', GITHUB_RUN_ATTEMPT: '1', LANDING_BOT_KEEPER_PER_SWEEP: '5', LANDING_BOT_DAILY_PUSHES: '10' };
  const reads = [];
  const prNode = (number) => ({
    number, isDraft: false, body: '', mergeable: 'CONFLICTING', isInMergeQueue: false, updatedAt: T(-120), headRefName: `agent/x-${number}`, headRefOid: A,
    headRepository: { nameWithOwner: REPO }, baseRepository: { nameWithOwner: REPO }, labels: { nodes: [] },
    commits: { nodes: [{ commit: { committedDate: T(-120) } }] }, timelineItems: { nodes: [] },
  });
  const gh = {
    graph: stackGraph(answer, { reads, other: async () => ({ pullRequests: { pageInfo: { hasNextPage: false }, nodes: [11, 12, 13].map(prNode) } }) }),
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs')) return greenMain;
      if (p.startsWith('issues?state=open') || /\/(files|commits|comments)\?/.test(p)) return [];
      if (p.startsWith('actions/workflows/landing-bot-keeper.yml/runs')) return { workflow_runs: [] };
      const m = /^pulls\/(\d+)$/.exec(p);
      if (m) return { number: Number(m[1]), state: 'open', labels: [], head: { sha: restHead, ref: `agent/x-${m[1]}` } };
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const { calls, app } = recorder();
  const plan = (act) => writeFileSync(join(tmp, 'keeper-plan.json'), JSON.stringify({ day: '2026-11-27', act }));
  return { env, gh, app, calls, reads, plan, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

test('#8555 keeper: the plan keeps ordinary PRs and drops members and unknowns before reserving a push', async () => {
  const kinds = { 11: ordinary, 12: LAYERS.bottom, 13: UNREADABLE['fields absent'] };
  const w = keeperWorld((n, h) => kinds[n](n, h));
  try {
    const out = await keeperPlan(w.env, { gh: w.gh, now: NOW });
    assert.deepEqual(out.act.map((p) => p.number), [11], 'an ordinary PR is still planned (ordinary behaviour kept)');
    const written = JSON.parse(readFileSync(join(w.env.RUNNER_TEMP, 'keeper-plan.json'), 'utf8'));
    assert.deepEqual(written.act.map((p) => p.number), [11], 'the reservation counts only the ordinary PR');
  } finally { w.done(); }
});

test('#8555 keeper: apply pushes, updates, labels and dispatches nothing for a member, an unknown or a moved head', async () => {
  const cases = { ...LAYERS, ...UNREADABLE, ...MISMATCH, 'joined after the plan': LAYERS.upper, 'moved between reads': (n) => ordinary(n, B) };
  for (const [name, answer] of Object.entries(cases)) {
    const w = keeperWorld(answer);
    try {
      w.plan([{ number: 12, sha: A, ref: 'agent/x-12', attempt: 1 }]);
      const r = await keeperApply(w.env, { gh: w.gh, app: w.app });
      assert.deepEqual(r.dispatch, [], `${name}: no resolver dispatch`);
      assert.deepEqual(writes(w.calls), [], `${name}: no push, update-branch, label or comment`);
      assert.deepEqual(w.reads, [12], `${name}: membership re-read at apply`);
    } finally { w.done(); }
  }
});

test('#8555 keeper: a queued member gets a recorded disposition and no queue or auto-merge call', async () => {
  const w = keeperWorld((n, h) => member(n, h, { position: 2, isInMergeQueue: true, autoMergeRequest: { enabledAt: T(-10) } }));
  const lines = [];
  const prev = process.env.GITHUB_STEP_SUMMARY;
  const file = join(w.env.RUNNER_TEMP, 'summary.md');
  process.env.GITHUB_STEP_SUMMARY = file;
  try {
    w.plan([{ number: 12, sha: A, ref: 'agent/x-12', attempt: 1 }]);
    await keeperApply(w.env, { gh: w.gh, app: w.app });
    lines.push(...readFileSync(file, 'utf8').split('\n'));
    assert.ok(lines.some((l) => /#12 held before the keeper merge and push: upper layer .*in the merge queue: its entry, order and auto-merge are left as they are/.test(l)), lines.join('\n'));
    assert.deepEqual(w.calls.filter(([, p]) => FORBIDDEN.test(p)), []);
    assert.deepEqual(writes(w.calls), []);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = prev;
    w.done();
  }
});

// ---- conflict resolver ------------------------------------------------------------------------------------------
function resolverWorld(answer, { restHead = A } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'resolver-8555-'));
  mkdirSync(join(tmp, 'plan'));
  const env = { GITHUB_REPOSITORY: REPO, LANDING_BOT_ENABLED: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', LANDING_BOT_LOGIN: BOT, RUNNER_TEMP: tmp,
    PLAN_DIR: join(tmp, 'plan'), PATCH_DIR: join(tmp, 'patch'), RESOLVE_PR: '21', GITHUB_RUN_ID: '51', GITHUB_RUN_ATTEMPT: '1', MODEL_OUTCOME: 'passed' };
  const reads = [];
  const gh = {
    graph: stackGraph(answer, { reads }),
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs')) return greenMain;
      if (p.startsWith('actions/workflows/landing-bot-conflict.yml/runs')) return { workflow_runs: [] };
      if (p.startsWith('issues?state=open') || /\/(files|commits|comments)\?/.test(p)) return [];
      if (p === 'pulls/21') return { number: 21, title: 't', body: '', state: 'open', labels: [], mergeable: false, head: { sha: restHead, ref: 'agent/x-21', repo: { full_name: REPO } }, base: { repo: { full_name: REPO } } };
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const { calls, app } = recorder();
  const clones = [];
  const clone = (...args) => { clones.push(args); throw new Error('CLONED: the model or push path was reached'); };
  const pushes = [];
  const pushImpl = (...args) => { pushes.push(args); return true; };
  const plan = (p) => writeFileSync(join(tmp, 'plan', 'plan.json'), JSON.stringify({ pr: 21, head: A, ref: 'agent/x-21', main: B, files: ['a.js'], day: '2026-11-27', reasons: [], ...p }));
  return { env, gh, app, calls, reads, clone, clones, pushImpl, pushes, plan, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

test('#8555 resolver: the plan never prepares a model task for a member, an unknown or a mismatched answer', async () => {
  for (const [name, answer] of Object.entries({ ...LAYERS, ...UNREADABLE, ...MISMATCH })) {
    const w = resolverWorld(answer);
    try {
      const p = await resolverPlan(w.env, { gh: w.gh, now: NOW, clone: w.clone });
      assert.equal(p.decision, 'skip', name);
      assert.match(p.reasons.join(), /#21 held before the conflict resolver/, name);
      assert.equal(p.task, undefined, `${name}: no model task`);
      assert.deepEqual(w.clones, [], `${name}: nothing cloned`);
      assert.deepEqual(writes(w.calls), [], name);
    } finally { w.done(); }
  }
  const w = resolverWorld((n, h) => ordinary(n, h));
  try {
    const p = await resolverPlan(w.env, { gh: w.gh, now: NOW, clone: w.clone }).catch((e) => ({ reasons: [String(e.message)] }));
    assert.doesNotMatch(String(p.reasons), /held before/, 'an ordinary PR goes on to the existing rules');
  } finally { w.done(); }
});

test('#8555 resolver: apply re-reads before the push; joining a stack or a moved head after the plan pushes nothing', async () => {
  const cases = { 'joined a stack after the plan': LAYERS.bottom, 'draft layer': LAYERS.draft, ...UNREADABLE, 'moved between reads': (n) => ordinary(n, B), 'another repository': MISMATCH['another repository'] };
  for (const [name, answer] of Object.entries(cases)) {
    const w = resolverWorld(answer);
    try {
      w.plan({ decision: 'resolve' });
      const r = await resolverApply(w.env, { gh: w.gh, app: w.app, clone: w.clone, pushImpl: w.pushImpl });
      assert.equal(r.outcome, 'skipped', name);
      assert.match(r.why, /#21 held before the resolver push/, name);
      assert.deepEqual([w.clones.length, w.pushes.length], [0, 0], `${name}: no clone, no push`);
      assert.deepEqual(writes(w.calls), [], `${name}: no label or comment`);
    } finally { w.done(); }
  }
  const w = resolverWorld((n, h) => ordinary(n, h));
  try {
    w.plan({ decision: 'resolve' });
    await assert.rejects(resolverApply(w.env, { gh: w.gh, app: w.app, clone: w.clone, pushImpl: w.pushImpl }), /CLONED/, 'an ordinary PR goes on to the push path');
  } finally { w.done(); }
});

// ---- serial refresh ---------------------------------------------------------------------------------------------
function refreshWorld(answer, { restHead = A } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'refresh-8555-'));
  const env = { GITHUB_REPOSITORY: REPO, LANDING_BOT_ENABLED: 'true', GITHUB_EVENT_NAME: 'schedule', RUNNER_TEMP: tmp, LANDING_BOT_MAX_QUEUED_RUNS: '50' };
  writeFileSync(join(tmp, 'refresh-plan.json'), JSON.stringify({ act: [{ number: 31, sha: A }] }));
  const reads = [];
  const gh = {
    graph: stackGraph(answer, { reads }),
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs')) return greenMain;
      if (p.startsWith('issues?state=open')) return [];
      if (p.startsWith('actions/runs?status=queued')) return { workflow_runs: [] };
      if (p.startsWith('pulls/31/files')) return [{ filename: 'frontend/src/a.js' }];
      if (p === 'pulls/31') return { number: 31, state: 'open', draft: false, labels: [], head: { sha: restHead, ref: 'agent/x-31', repo: { full_name: REPO } }, base: { repo: { full_name: REPO } } };
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const { calls, app } = recorder();
  return { env, gh, app, calls, reads, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

test('#8555 refresh: update-branch is called for an ordinary PR and never for a member, an unknown or a moved head', async () => {
  const ok = refreshWorld((n, h) => ordinary(n, h));
  try {
    const r = await refreshApply(ok.env, { gh: ok.gh, app: ok.app, now: () => NOW });
    assert.deepEqual(r.log, [{ number: 31, result: 'refreshed' }]);
    assert.deepEqual(writes(ok.calls).map(([v, p]) => [v, p]), [['put', 'pulls/31/update-branch']], 'ordinary behaviour kept');
  } finally { ok.done(); }
  const cases = { ...LAYERS, ...UNREADABLE, ...MISMATCH, 'moved between reads': (n) => ordinary(n, B),
    'queued member': (n, h) => member(n, h, { isInMergeQueue: true, autoMergeRequest: { enabledAt: T(-1) } }) };
  for (const [name, answer] of Object.entries(cases)) {
    const w = refreshWorld(answer);
    try {
      const r = await refreshApply(w.env, { gh: w.gh, app: w.app, now: () => NOW });
      assert.equal(r.done, 0, name);
      assert.match(r.log[0].result, /^skipped: #31 held before the refresh update-branch/, name);
      assert.deepEqual(writes(w.calls), [], `${name}: no update-branch, merge or label`);
      assert.deepEqual(w.calls.filter(([, p]) => FORBIDDEN.test(p)), [], name);
    } finally { w.done(); }
  }
});

// ---- ejection handler -------------------------------------------------------------------------------------------
function ejectionWorld(answer) {
  const s = { head: A, enqueues: [], reads: [] };
  const node = {
    id: 'PR_7', number: 7, state: 'OPEN', isDraft: false, body: '', isInMergeQueue: false, mergeable: 'CONFLICTING', headRefName: 'agent/x', headRefOid: A,
    headRepository: { nameWithOwner: REPO }, baseRepository: { nameWithOwner: REPO }, labels: { nodes: [] }, autoMergeRequest: null,
    timelineItems: { nodes: [
      { __typename: 'AddedToMergeQueueEvent', createdAt: T(-20), actor: { login: 'guillaumelauzier', __typename: 'User' } },
      { __typename: 'RemovedFromMergeQueueEvent', createdAt: T(-15), actor: { login: 'github', __typename: 'Bot' }, reason: 'MERGE_CONFLICT', beforeCommit: { oid: A } },
    ] },
  };
  const gh = {
    graph: stackGraph(answer, { reads: s.reads, other: async () => ({ pullRequests: { nodes: [node] } }) }),
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20')) return greenMain;
      if (p.startsWith('actions/workflows/ci.yml/runs?branch=main&event=push&status=completed')) return { workflow_runs: [{ id: 1, conclusion: 'success' }] };
      if (p.startsWith('actions/workflows/ci.yml/runs?event=merge_group&status=completed')) return { workflow_runs: Array(20).fill({ conclusion: 'success' }) };
      if (p.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: [] };
      if (p.startsWith('actions/runs/1/jobs')) return { jobs: [] };
      if (p.startsWith('issues?state=open')) return [];
      if (p === 'pulls/7/files?per_page=100') return [{ filename: 'frontend/src/a.js' }];
      if (p === 'pulls/7/commits?per_page=100') return [];
      if (p === 'pulls/7') return { number: 7, mergeable: false, head: { sha: A } };
      if (/^issues\/7\/(comments|events)/.test(p)) return [];
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const { calls, app } = recorder();
  const env = { GITHUB_REPOSITORY: REPO, LANDING_BOT_LOGIN: BOT, LANDING_BOT_ENABLED: 'true', GITHUB_EVENT_NAME: 'schedule', LANDING_BOT_DAILY_REQUEUES: '10', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.5' };
  const evidence = async (_n, sha) => ({ ok: true, headSha: sha, fullSuitePassed: true, required: { missing: [], pending: [], failing: [] }, detail: 'all green' });
  return { s, calls, run: () => ejectionSweep(env, { gh, app, now: NOW, evidence }) };
}

test('#8555 ejection: an ordinary ejected PR still goes to the keeper; a member or an unknown gets no write at all', async () => {
  const ok = ejectionWorld((n, h) => ordinary(n, h));
  assert.deepEqual((await ok.run()).keeper, [7], 'ordinary behaviour kept: the keeper is asked');
  assert.ok(writes(ok.calls).length > 0, 'and the sticky comment is written');
  const cases = { ...LAYERS, ...UNREADABLE, ...MISMATCH, 'moved between reads': (n) => ordinary(n, B),
    'queued member': (n, h) => member(n, h, { isInMergeQueue: true, autoMergeRequest: { enabledAt: T(-1) } }) };
  for (const [name, answer] of Object.entries(cases)) {
    const w = ejectionWorld(answer);
    const r = await w.run();
    assert.deepEqual([r.keeper, r.repair], [[], []], `${name}: no keeper or repair dispatch`);
    assert.deepEqual(writes(w.calls), [], `${name}: no enqueue, label, comment, dequeue or auto-merge call`);
    assert.deepEqual(w.s.reads, [7], name);
  }
});

// ---- queue feeder -----------------------------------------------------------------------------------------------
function feederWorld(answerFor) {
  const state = { writes: [], sha: new Map() };
  // LANDING_BOT_FEEDER_ENABLED and readRulesIssue() are #8892's feeder switch and rollout gate; main ignores both.
  const env = { LANDING_BOT_ENABLED: 'true', LANDING_BOT_FEEDER_ENABLED: 'true', LANDING_BOT_FEED_PER_SWEEP: '3', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.25' };
  const groups = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, event: 'merge_group', status: 'completed', conclusion: 'success' }));
  const reader = {
    readRulesIssue: async () => ({ number: 6480, state: 'closed', state_reason: 'completed' }),
    readOrderedList: async () => [8, 5, 7].map((number) => ({ number, tier: 'T1', modelChanged: false })),
    readMainHealth: async () => ({ mainRuns: greenMain.workflow_runs, openAlertTitles: [], recentGroupRuns: groups }),
    readQueueState: async () => ({ freeQueueSlots: 3 }),
    readQueueEntries: async () => [],
    readOwningSlot: async () => '',
    readLandingDecision: async (number) => { const sha = state.sha.get(number) ?? A; return { mayQueue: true, gates: [], pr: { number, head_sha: sha }, report: { headSha: sha, tier: 'T1' } }; },
    readCandidate: async (number) => {
      const sha = state.sha.get(number) ?? A;
      return {
        pull: { number, node_id: `PR_${number}`, state: 'open', draft: false, merged: false, mergeable: true, labels: [],
          head: { sha, ref: `agent/f-${number}`, repo: { full_name: REPO } }, base: { ref: 'main', repo: { full_name: REPO } } },
        files: [{ path: 'documentation/sample.md' }], headSha: sha, number, fullSuitePassed: true, modelRepaired: false, alreadyQueued: false, priorQueueEntry: false,
      };
    },
  };
  const graph = stackGraph((n, h) => answerFor(n)(n, h), { head: (n) => state.sha.get(n) ?? A });
  gateLandingDecisions(reader, graph, { repo: REPO });
  const said = [];
  const enqueue = guardEnqueue(async (entry) => { state.writes.push(entry); return { ...entry, status: 'queued' }; }, graph, { repo: REPO, say: (l) => said.push(l) });
  return { state, said, options: { reader, env, repo: REPO, event: 'schedule', readRemainingDaily: async () => 3, enqueue } };
}

test('#8555 feeder: members and unknowns are never planned or enqueued; ordinary PRs still are', async () => {
  const kinds = { 8: ordinary, 5: LAYERS.upper, 7: UNREADABLE.failed };
  const w = feederWorld((n) => kinds[n]);
  const plan = await planSweep(w.options);
  assert.deepEqual(plan.map((p) => p.number), [8], 'only the ordinary PR is planned');
  await applySweep(w.options, plan);
  assert.deepEqual(w.state.writes.map((p) => p.number), [8], 'and only it is enqueued');
  for (const layer of Object.keys(LAYERS)) {
    const d = feederWorld(() => LAYERS[layer]);
    assert.deepEqual(await planSweep(d.options), [], layer);
    const decision = await d.options.reader.readLandingDecision(5);
    assert.equal(decision.mayQueue, false, layer);
    assert.match(decision.gates.at(-1).detail, /#5 held before queue admission/, layer);
  }
});

test('#8555 feeder: a PR that joins a stack or moves after the plan is not enqueued', async () => {
  // Joined between plan and apply: the apply's fresh decision is no longer mayQueue.
  let joined = false;
  const w = feederWorld((n) => (joined && n === 5 ? LAYERS.bottom : ordinary));
  const plan = await planSweep(w.options);
  assert.deepEqual(plan.map((p) => p.number), [8, 5, 7]);
  joined = true;
  await applySweep(w.options, plan);
  assert.deepEqual(w.state.writes.map((p) => p.number), [8, 7]);
  // Joined between the last read and the write itself: the enqueue boundary holds it and the sweep stops.
  let calls = 0;
  const late = feederWorld((n) => (n === 8 && ++calls > 1 ? LAYERS.upper : ordinary));
  const p2 = await planSweep(late.options);
  calls = 0;
  await assert.rejects(applySweep(late.options, p2), /Queue write for #8 was/);
  assert.deepEqual(late.state.writes, [], 'no enqueue');
  assert.match(late.said.join(), /#8 held before queue entry/);
  // The membership read sees another head than the one planned: held at the boundary too.
  let wrote = 0;
  const r = await guardEnqueue(async () => { wrote++; return { status: 'queued' }; }, stackGraph((n) => ordinary(n, B)), { repo: REPO })({ number: 8, expectedHeadOid: A });
  assert.deepEqual([r.status, wrote], ['held', 0]);
});

test('#8555 feeder: the entry point wires the decision gate and the enqueue guard', () => {
  const src = readFileSync(new URL('scripts/landing-bot/feeder.mjs', ROOT), 'utf8');
  assert.match(src, /gateLandingDecisions\(reader, stackRead, \{repo\}\);/);
  assert.match(src, /enqueue: guardEnqueue\(enqueue, stackRead, \{repo, say\}\)/);
  // Each other automation reads membership with its read-only client, never the App token.
  for (const [file, pattern] of [['keeper.mjs', /stackHeld\(gh\.graph/g], ['resolve.mjs', /stackGuard\(\{ graph: gh\.graph/g], ['refresh.mjs', /stackGuard\(\{ graph: gh\.graph/g], ['ejection.mjs', /stackHeld\(gh\.graph/g]]) {
    assert.ok((readFileSync(new URL(`scripts/landing-bot/${file}`, ROOT), 'utf8').match(pattern) || []).length >= 1, file);
  }
});
