/**
 * #7109: a manual "Fix conflicts" request dispatched by Merge Control runs the conflict resolver (#6475) only while
 * its pins hold: its own switch, the pull request head and base it was made for, out of the queue, still conflicting,
 * and a request id no earlier run carried. Fake GitHub reads; the clone is a stub that records it was reached.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { manualCheck, manualRequest, requestRan } from '../../scripts/landing-bot/resolve-rules.mjs';
import { applyStage, planStage } from '../../scripts/landing-bot/resolve.mjs';
import { assertWorkflow } from '../../scripts/landing-bot/workflowGuard.mjs';

const REPO = 'AxalNetwork/StudioOS';
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), MOVED = 'c'.repeat(40);
const REQUEST = '0123456789abcdef';
const NOW = Date.parse('2026-11-27T12:00:00Z');
const req = { head: HEAD, base: BASE, request: REQUEST };
const ON = { LANDING_BOT_MANUAL_CONFLICT: 'true' };
const live = (over = {}) => ({ state: 'open', head: HEAD, base: BASE, inMergeQueue: false, mergeable: false, ...over });

// Mutation checked: the switch test dropped (switch case fails); `!==` on the head made `===` (moved and passing cases fail).
test('#7109: the manual pins: switch, open, out of the queue, same head and base, still conflicting', () => {
  assert.equal(manualRequest({}), null);
  assert.deepEqual(manualRequest({ MANUAL_EXPECTED_HEAD: HEAD, MANUAL_EXPECTED_BASE: BASE, MANUAL_REQUEST: REQUEST }), req);
  for (const bad of [{ MANUAL_EXPECTED_HEAD: HEAD }, { MANUAL_EXPECTED_HEAD: HEAD, MANUAL_EXPECTED_BASE: BASE, MANUAL_REQUEST: 'x' },
    { MANUAL_EXPECTED_HEAD: 'main', MANUAL_EXPECTED_BASE: BASE, MANUAL_REQUEST: REQUEST }]) {
    assert.deepEqual(manualRequest(bad), { invalid: 'the manual request is malformed' });
  }
  assert.deepEqual(manualCheck(req, live(), ON), { decision: 'resolve', reasons: [] });
  assert.equal(manualCheck(req, live(), {}).decision, 'skip');
  assert.equal(manualCheck(req, live(), { LANDING_BOT_MANUAL_CONFLICT: 'dispatch' }).decision, 'skip');
  assert.equal(manualCheck(req, live({ state: 'closed' }), ON).decision, 'skip');
  for (const [over, reason] of [
    [{ head: MOVED }, 'its head moved since the request'],
    [{ base: MOVED }, 'its base moved since the request'],
    [{ inMergeQueue: true }, 'it is in the merge queue again'],
    [{ inMergeQueue: null }, 'its merge-queue state could not be read'],
    [{ mergeable: true }, 'the conflict went away'],
    [{ mergeable: null }, 'GitHub has not confirmed the conflict'],
  ]) assert.deepEqual(manualCheck(req, live(over), ON), { decision: 'report', reasons: [reason] }, reason);
  assert.equal(requestRan([{ id: 1, display_title: `Conflict resolver for #77 (request ${REQUEST})` }], REQUEST, 2), true);
  assert.equal(requestRan([{ id: 2, display_title: `Conflict resolver for #77 (request ${REQUEST})` }], REQUEST, 2), false);
  assert.equal(requestRan([{ id: 1, display_title: 'Conflict resolver for #77' }], REQUEST, 2), false);
});

const pull = (over = {}) => ({
  number: 77, state: 'open', draft: false, body: 'Closes #66', title: 'Add a field', labels: [], mergeable: false,
  head: { ref: 'agent/x/66-field', sha: HEAD, repo: { full_name: REPO } }, base: { sha: BASE, repo: { full_name: REPO } }, ...over,
});
function fakes({ pr = pull(), queue = false, runs = [] } = {}) {
  const reads = [];
  const writes = [];
  const gh = {
    async get(path) {
      reads.push(path);
      if (path === 'pulls/77') return pr;
      if (path.startsWith('pulls/77/files')) return [{ filename: 'frontend/src/pages/validate.js' }];
      if (path.startsWith('pulls/77/commits')) return [];
      if (path.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: [{ event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: '2026-11-27T10:00:00Z' }] };
      if (path.startsWith('actions/workflows/landing-bot-conflict.yml/runs')) return { workflow_runs: runs };
      if (path.startsWith('issues?state=open')) return [];
      throw new Error(`unexpected read ${path}`);
    },
    async graph(_query, variables) {
      if (/stackEntry/.test(_query)) return { nameWithOwner: REPO, pullRequest: { number: variables.number, headRefOid: pr.head.sha, isDraft: pr.draft, isInMergeQueue: false, autoMergeRequest: null, stack: null, stackEntry: null } };
      assert.equal(variables.n, 77);
      if (queue instanceof Error) throw queue;
      return { pullRequest: { isInMergeQueue: queue } };
    },
  };
  const app = {
    async get(path) { if (/\/comments/.test(path)) return []; throw new Error(`unexpected app read ${path}`); },
    async post(path, body) { writes.push(['post', path, body]); return {}; },
    async patch(path, body) { writes.push(['patch', path, body]); return {}; },
    async del(path) { writes.push(['del', path]); return null; },
  };
  return { gh, app, reads, writes };
}
const planEnv = (tmp, over = {}) => ({
  GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '9001', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: tmp, RESOLVE_PR: '77',
  GITHUB_EVENT_NAME: 'workflow_dispatch', LANDING_BOT_ENABLED: 'dispatch', LANDING_BOT_LOGIN: 'landing-bot[bot]',
  LANDING_BOT_DAILY_MODEL_RUNS: '5', LANDING_BOT_DAILY_PUSHES: '5', LANDING_BOT_MAX_CONFLICT_FILES: '3', LANDING_BOT_MAX_CONFLICT_LINES: '200',
  MANUAL_EXPECTED_HEAD: HEAD, MANUAL_EXPECTED_BASE: BASE, MANUAL_REQUEST: REQUEST, ...ON, ...over,
});
const REACHED = new Error('reached the clone');
const clone = () => { throw REACHED; };

// Mutation checked: the manual block removed from planStage (every refused case reaches the clone and fails);
// the requestRan check removed (the repeated request reaches the clone and fails).
test('#7109: plan stops before any model call unless every pin holds, and a repeated request runs nothing', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'manual-plan-'));
  const plan = (env, f) => planStage(env, { gh: f.gh, now: NOW, clone });
  for (const [name, env, f, decision, reason] of [
    ['switch off', planEnv(tmp, { LANDING_BOT_MANUAL_CONFLICT: '' }), fakes(), 'skip', /LANDING_BOT_MANUAL_CONFLICT is not true/],
    ['malformed', planEnv(tmp, { MANUAL_REQUEST: 'nope' }), fakes(), 'skip', /malformed/],
    ['head moved', planEnv(tmp), fakes({ pr: pull({ head: { ...pull().head, sha: MOVED } }) }), 'report', /head moved/],
    ['base moved', planEnv(tmp), fakes({ pr: pull({ base: { ...pull().base, sha: MOVED } }) }), 'report', /base moved/],
    ['re-queued', planEnv(tmp), fakes({ queue: true }), 'report', /merge queue again/],
    ['queue unreadable', planEnv(tmp), fakes({ queue: new Error('502') }), 'report', /could not be read/],
    ['conflict gone', planEnv(tmp), fakes({ pr: pull({ mergeable: true }) }), 'report', /conflict went away/],
    ['repeated', planEnv(tmp), fakes({ runs: [{ id: 8000, display_title: `Conflict resolver for #77 (request ${REQUEST})`, status: 'completed', created_at: '2026-11-27T11:00:00Z' }] }), 'skip', /already run/],
  ]) {
    const p = await plan(env, f);
    assert.equal(p.decision, decision, name);
    assert.match(p.reasons.join('; '), reason, name);
    assert.equal(JSON.parse(readFileSync(join(tmp, 'resolver', 'plan.json'), 'utf8')).decision, decision, name);
  }
  // Every pin holds: the plan goes on to stage the merge, with the request on the plan for the apply job.
  const f = fakes();
  await assert.rejects(plan(planEnv(tmp), f), REACHED);
  // An ordinary keeper dispatch has no pins and is unchanged: no queue read, straight on to the clone.
  const plain = fakes({ queue: new Error('must not be read') });
  await assert.rejects(plan(planEnv(tmp, { MANUAL_EXPECTED_HEAD: '', MANUAL_EXPECTED_BASE: '', MANUAL_REQUEST: '', LANDING_BOT_MANUAL_CONFLICT: '' }), plain), REACHED);
});

function applyDir(planBody) {
  const tmp = mkdtempSync(join(tmpdir(), 'manual-apply-'));
  mkdirSync(join(tmp, 'plan'));
  writeFileSync(join(tmp, 'plan', 'plan.json'), JSON.stringify({ pr: 77, head: HEAD, ref: 'agent/x/66-field', files: ['frontend/src/pages/validate.js'], day: '2026-11-27', ...planBody }));
  return { GITHUB_REPOSITORY: REPO, RUNNER_TEMP: tmp, PLAN_DIR: join(tmp, 'plan'), PATCH_DIR: join(tmp, 'patch'), MODEL_OUTCOME: 'passed',
    LANDING_BOT_ENABLED: 'dispatch', LANDING_BOT_LOGIN: 'landing-bot[bot]', RESOLVER_APP_TOKEN: 'test-token', ...ON };
}

// Mutation checked: the `report` branch removed from applyStage (returns skipped, no comment: fails); the base/queue
// recheck removed from fresh() (reaches the clone: fails).
test('#7109: apply reports a request that did not run, and rechecks base, queue and switch before any push', async () => {
  const f = fakes();
  const r = await applyStage(applyDir({ decision: 'report', reasons: ['the conflict went away'], manual: req }), { gh: f.gh, app: f.app, clone, pushImpl: () => assert.fail('pushed') });
  assert.deepEqual(r, { outcome: 'reported', why: 'the conflict went away' });
  assert.deepEqual(f.writes.map((w) => w.slice(0, 2)), [['post', 'issues/77/comments']]);
  assert.match(f.writes[0][2].body, new RegExp(`request ${REQUEST} did not push anything: the conflict went away`));
  for (const [name, fk, env, outcome, writes] of [
    ['base moved', fakes({ pr: pull({ base: { ...pull().base, sha: MOVED } }) }), {}, 'reported', 1],
    ['re-queued', fakes({ queue: true }), {}, 'reported', 1],
    ['switch off since', fakes(), { LANDING_BOT_MANUAL_CONFLICT: 'false' }, 'skipped', 0],
  ]) {
    const res = await applyStage({ ...applyDir({ decision: 'resolve', manual: req }), ...env }, { gh: fk.gh, app: fk.app, clone, pushImpl: () => assert.fail('pushed') });
    assert.equal(res.outcome, outcome, name);
    assert.equal(fk.writes.length, writes, name);
    assert.ok(!fk.writes.some((w) => /labels/.test(w[1])), `${name}: no label`);
  }
  // With the pins holding, apply goes on to the clone it re-checks the patch in.
  const ok = fakes();
  await assert.rejects(applyStage(applyDir({ decision: 'resolve', manual: req }), { gh: ok.gh, app: ok.app, clone, pushImpl: () => assert.fail('pushed') }), REACHED);
});

test('#7109: the resolver workflow carries the request inputs, its switch, and runs apply to report', () => {
  assertWorkflow('.github/workflows/landing-bot-conflict.yml');
  const wf = readFileSync(new URL('../../.github/workflows/landing-bot-conflict.yml', import.meta.url), 'utf8');
  for (const input of ['expected_head', 'expected_base', 'request']) assert.match(wf, new RegExp(`\\n      ${input}:\\n[^\\n]*\\n        required: false\\n        default: ''`));
  assert.match(wf, /run-name: Conflict resolver for #\$\{\{ inputs\.pr \}\}\$\{\{ inputs\.request != '' && format\(' \(request \{0\}\)', inputs\.request\) \|\| '' \}\}/);
  assert.equal(wf.match(/LANDING_BOT_MANUAL_CONFLICT: \$\{\{ vars\.LANDING_BOT_MANUAL_CONFLICT \}\}/g)?.length, 2);
  assert.match(wf, /needs\.plan\.outputs\.decision == 'report'/);
});
