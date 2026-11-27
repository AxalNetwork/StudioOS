/** D8626: the merge-queue entry point to the capacity coordinator, off unless CI_CAPACITY_QUEUE_ROUTING is on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as yaml } from 'yaml';
import { capacitySubmission, fullSuiteRequired, FULL_SUITE_CHECK, PILOT_PREREQUISITES } from '../../scripts/ci/capacity-submission.mjs';
import { main as plannerMain } from '../../scripts/ci/capacity-planner.mjs';
import { buildPlan, routedToCoordinator } from '../../scripts/test-drift-parts.mjs';

const REPO = 'AxalNetwork/StudioOS', BASE = 'c'.repeat(40), HEAD = 'd'.repeat(40), EXEC = 'b'.repeat(40);
const BRANCH = `gh-readonly-queue/main/pr-8626-${BASE}`, REF = `refs/heads/${BRANCH}`, APP = 23;
const repo = { id: 7, full_name: REPO };
const RULES = [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { required_status_checks: [
  { context: 'test:drift (full suite)', integration_id: 15368 }, { context: FULL_SUITE_CHECK, integration_id: APP }] } }];

/** A candidate checkout (package.json and suite files), its queue event, and an Actions API that serves one run. */
function candidate(t, { rules = RULES, run = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 's21-queue-8626-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'candidate');
  for (const [folder, count] of [['frontend/test', 2], ['cloudflare-worker/test', 6]]) {
    mkdirSync(join(root, folder), { recursive: true });
    for (let i = 1; i <= count; i++) writeFileSync(join(root, folder, `${i}.test.mjs`), '// fixture suite member\n');
  }
  const scripts = { 'test:frontend': "node --test 'frontend/test/*.test.mjs'", 'test:worker': "node --test 'cloudflare-worker/test/*.test.mjs'", 'test:drift': 'npm run test:frontend && npm run test:worker' };
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }));
  const eventPath = join(dir, 'event.json'), output = join(dir, 'output');
  writeFileSync(eventPath, JSON.stringify({ merge_group: { head_sha: HEAD, head_ref: REF, base_sha: BASE } }));
  writeFileSync(output, '');
  const plan = JSON.stringify(buildPlan(scripts, {}, root), null, 2) + '\n';
  const calls = [];
  const parent = { id: 12, run_attempt: 1, workflow_id: 9, path: '.github/workflows/ci.yml', head_sha: HEAD, event: 'merge_group', head_branch: BRANCH, repository: repo, head_repository: repo, ...run };
  const api = async (method, path) => {
    calls.push({ method, path });
    if (path === `/repos/${REPO}/rules/branches/main`) return rules;
    if (path === `/repos/${REPO}/actions/runs/12`) return parent;
    throw new Error(`unexpected ${method} ${path}`);
  };
  const env = { CI_CAPACITY_ENABLED: 'true', CI_CAPACITY_QUEUE_ROUTING: 'true', GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: 'merge_group', GITHUB_REF: REF,
    GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: HEAD, CI_CAPACITY_EXECUTOR_SHA: EXEC, GITHUB_EVENT_PATH: eventPath, CAPACITY_SOURCE_ROOT: root, GITHUB_OUTPUT: output };
  return { root, plan, eventPath, output, env, api, calls };
}

test('D8626 a queue candidate becomes one merge_group submission of its own equal-weight plan, read from its checkout', async t => {
  const c = candidate(t);
  const s = await capacitySubmission(c.env, c.api);
  assert.equal(s.event, 'merge_group');
  assert.equal(s.sourceSha, HEAD);
  assert.equal(s.queueBaseSha, BASE);
  assert.equal(s.planArtifactId, null);
  // The planner rebuilds the same bytes from the same checkout, so the digest the coordinator checks matches.
  assert.equal(s.planDigest, 'sha256:' + createHash('sha256').update(c.plan).digest('hex'));
  assert.deepEqual(s.shards, Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`));
  assert.deepEqual(s.prerequisites, [...PILOT_PREREQUISITES]);
  assert.deepEqual(await capacitySubmission(c.env, c.api), s, 'one parent attempt is one request');
  assert.equal(readFileSync(c.output, 'utf8').split('\n').filter(l => l.startsWith('capacity_submission=')).length, 2);
  assert.deepEqual(JSON.parse(readFileSync(c.output, 'utf8').split('\n')[0].slice('capacity_submission='.length)), s);
  // Rules first, then the run: nothing is read about the run unless main requires the full-suite result.
  assert.deepEqual(c.calls.slice(0, 2).map(x => x.path), [`/repos/${REPO}/rules/branches/main`, `/repos/${REPO}/actions/runs/12`]);
  assert.ok(c.calls.every(x => x.method === 'GET'));
});

test('D8626 nothing is prepared, and nothing is read, unless queue routing is on and the Mac handoff is off', async t => {
  const c = candidate(t);
  const none = async () => assert.fail('a disabled submission reads nothing');
  assert.deepEqual(await capacitySubmission({ ...c.env, CI_CAPACITY_ENABLED: 'false' }, none), { accepted: false, reason: 'capacity_disabled' });
  for (const value of [undefined, '', 'false', 'TRUE', '1']) {
    assert.deepEqual(await capacitySubmission({ ...c.env, CI_CAPACITY_QUEUE_ROUTING: value }, none), { accepted: false, reason: 'queue_routing_disabled' }, String(value));
  }
  assert.deepEqual(await capacitySubmission({ ...c.env, MACBOOK_WORKER_ENABLED: 'true' }, none), { accepted: false, reason: 'macbook_worker_enabled' });
  assert.equal(readFileSync(c.output, 'utf8'), '', 'no submission output');
});

test('D8626 routing waits for main to require the App-owned ci-capacity/full-suite', async t => {
  const refused = [
    [],
    [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test:drift (full suite)', integration_id: 15368 }] } }],
    // A context with no App could be posted as a commit status by any token with statuses: write.
    [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: FULL_SUITE_CHECK }] } }],
    [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: FULL_SUITE_CHECK, integration_id: 0 }] } }],
    [{ type: 'required_deployments', parameters: { required_status_checks: [{ context: FULL_SUITE_CHECK, integration_id: APP }] } }],
    null, { message: 'Not Found' },
  ];
  for (const rules of refused) {
    const c = candidate(t, { rules });
    assert.deepEqual(await capacitySubmission(c.env, c.api), { accepted: false, reason: 'full_suite_not_required' }, JSON.stringify(rules));
    assert.equal(c.calls.length, 1, 'the run is not read');
    assert.equal(readFileSync(c.output, 'utf8'), '');
  }
  const c = candidate(t);
  assert.deepEqual(await capacitySubmission({ ...c.env, CI_CAPACITY_FULL_SUITE_APP_ID: '99' }, c.api), { accepted: false, reason: 'full_suite_not_required' }, 'another App');
  assert.equal((await capacitySubmission({ ...c.env, CI_CAPACITY_FULL_SUITE_APP_ID: String(APP) }, c.api)).event, 'merge_group', 'the configured App');
  assert.equal(fullSuiteRequired(RULES, 'not-an-id'), false);
  assert.equal(fullSuiteRequired(RULES, undefined), true);
});

test('D8626 a submission names only this queue entry: its ref, event, base and run must all agree', async t => {
  const event = (c, group) => writeFileSync(c.eventPath, JSON.stringify({ merge_group: { head_sha: HEAD, head_ref: REF, base_sha: BASE, ...group } }));
  const context = [
    [{ GITHUB_REF: 'refs/heads/main' }], [{ GITHUB_REF: 'refs/heads/gh-readonly-queue/main/pr-8626-xyz' }],
    [{ GITHUB_REF: `refs/heads/gh-readonly-queue/other/pr-8626-${BASE}` }], [{ GITHUB_REPOSITORY: 'someone/fork' }],
    [{ GITHUB_SHA: 'e'.repeat(40) }], [{ CAPACITY_PLAN_ARTIFACT_ID: '45' }], [{ GITHUB_RUN_ID: '0' }],
    [{}, { head_sha: 'e'.repeat(40) }], [{}, { head_ref: 'refs/heads/main' }], [{}, { base_sha: 'e'.repeat(40) }], [{}, { base_sha: 'nope' }],
  ];
  for (const [patch, group] of context) {
    const c = candidate(t);
    if (group) event(c, group);
    await assert.rejects(capacitySubmission({ ...c.env, ...patch }, c.api), /capacity_submission_context/, JSON.stringify([patch, group]));
  }
  for (const run of [{ event: 'push' }, { head_branch: 'main' }, { head_sha: 'e'.repeat(40) }, { run_attempt: 2 }, { path: '.github/workflows/other.yml' },
    { head_repository: { id: 8, full_name: 'someone/fork' } }]) {
    const c = candidate(t, { run });
    await assert.rejects(capacitySubmission(c.env, c.api), /capacity_submission_parent/, JSON.stringify(run));
    assert.equal(readFileSync(c.output, 'utf8'), '');
  }
});

/** The planner at a queue candidate, with the coordinator answering `answer`. */
async function plan(t, answer, envPatch = {}) {
  const c = candidate(t);
  const s = await capacitySubmission(c.env, c.api);
  writeFileSync(c.output, '');
  const env = { ...c.env, CAPACITY_SUBMISSION: JSON.stringify(s), CAPACITY_EXECUTOR_SHA: EXEC, CI_CAPACITY_URL: 'https://capacity.invalid/', CI_CAPACITY_AUDIENCE: 'fixture', ...envPatch };
  const posts = [];
  const fetcher = async (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); return answer(s); };
  const result = plannerMain(env, { fetcher, oidcToken: async () => 'a.b.c' });
  return { s, c, posts, result, output: () => readFileSync(c.output, 'utf8') };
}

test('D8626 the planner says accepted only for this exact request, and nothing else lets a part skip', async t => {
  const ok = await plan(t, s => Response.json({ accepted: true, requestId: s.requestId }));
  assert.equal((await ok.result).accepted, true);
  assert.equal(ok.output(), `accepted=true\nrequest_id=${ok.s.requestId}\n`);
  assert.equal(ok.posts.length, 1);
  assert.equal(ok.posts[0].url, 'https://capacity.invalid/capacity/submit');
  assert.equal(ok.posts[0].body.submission.requestId, ok.s.requestId);
  assert.equal(ok.posts[0].body.plan, ok.c.plan);

  const other = await plan(t, () => Response.json({ accepted: true, requestId: '00000000-0000-4000-8000-000000000000' }));
  await other.result;
  assert.equal(other.output(), '', 'another request id is not this acceptance');
  const no = await plan(t, s => Response.json({ accepted: false, requestId: s.requestId }));
  await no.result;
  assert.equal(no.output(), '');
  const refused = await plan(t, () => Response.json({ error: 'capacity_active_bound' }, { status: 503 }));
  await assert.rejects(refused.result, /capacity_authority_unavailable/);
  assert.equal(refused.output(), '', 'a refusal leaves every part hosted');
  const off = await plan(t, () => assert.fail('no submission without queue routing'), { CI_CAPACITY_QUEUE_ROUTING: 'false' });
  assert.deepEqual(await off.result, { accepted: false, reason: 'queue_routing_disabled' });
  assert.equal(off.posts.length, 0);
});

test('D8626 a suite part skips its tests only as a planned Worker part of a routed queue run', () => {
  const id = '0f4f8d2a-6b1c-4e3d-9a7b-1c2d3e4f5a6b';
  const worker = { name: 'worker-3-of-6', script: 'test:worker' };
  const routed = { CAPACITY_ROUTED: 'true', GITHUB_EVENT_NAME: 'merge_group', CAPACITY_REQUEST_ID: id };
  assert.equal(routedToCoordinator(routed, worker), true);
  for (const [env, part] of [
    [{ ...routed, CAPACITY_ROUTED: 'false' }, worker], [{ ...routed, CAPACITY_ROUTED: '' }, worker],
    [{ ...routed, GITHUB_EVENT_NAME: 'push' }, worker], [{ ...routed, GITHUB_EVENT_NAME: 'pull_request' }, worker],
    [{ ...routed, CAPACITY_REQUEST_ID: '' }, worker], [{ ...routed, CAPACITY_REQUEST_ID: 'x' }, worker],
    [routed, { name: 'frontend-1-of-2', script: 'test:frontend' }], [routed, { name: 'rest' }],
    [routed, { name: 'worker-3-of-6', script: 'test:frontend' }], [routed, { name: 'rest', script: 'test:worker' }], [routed, undefined],
  ]) assert.equal(routedToCoordinator(env, part), false, JSON.stringify([env, part]));
});

const ci = yaml(readFileSync('.github/workflows/ci.yml', 'utf8'));
const planner = yaml(readFileSync('.github/workflows/capacity-planner.yml', 'utf8'));
const FLAGS = ["github.event_name == 'merge_group'", "github.repository == 'AxalNetwork/StudioOS'", "vars.CI_CAPACITY_ENABLED == 'true'", "vars.CI_CAPACITY_QUEUE_ROUTING == 'true'"];

test('D8626 ci.yml: both routing jobs run only in the queue under both flags; the suite and gate read only `accepted`', () => {
  const route = ci.jobs.route, call = ci.jobs['capacity-route'];
  for (const flag of FLAGS) {
    assert.ok(route.if.includes(flag), `route: ${flag}`);
    assert.ok(call.if.includes(flag), `capacity-route: ${flag}`);
  }
  assert.ok(call.if.includes("needs.route.outputs.capacity_submission != ''"));
  assert.equal(call.needs, 'route');
  assert.equal(call.uses, ci.jobs['capacity-submit'].uses, 'one reviewed planner pin for both callers');
  assert.equal(call.with.submission, '${{ needs.route.outputs.capacity_submission }}');
  assert.deepEqual(route.permissions, { contents: 'read', actions: 'read' }, 'the route job holds no OIDC token');
  const prepare = route.steps.find(s => s.id === 'capacity');
  assert.equal(prepare.run, 'node scripts/ci/capacity-submission.mjs');
  assert.equal(prepare['continue-on-error'], true, 'a refusal leaves the queue hosted, never red');
  for (const name of ['CI_CAPACITY_QUEUE_ROUTING', 'MACBOOK_WORKER_ENABLED', 'CI_CAPACITY_FULL_SUITE_APP_ID']) assert.equal(prepare.env[name], `\${{ vars.${name} }}`);
  assert.equal(route.steps[0].with['persist-credentials'], false);
  // The suite's only routing input: the planner's exact `accepted`, for a Worker part, in the queue.
  assert.deepEqual(ci.jobs.suite.needs, ['verified', 'capacity-route']);
  assert.equal(ci.jobs.suite.env.CAPACITY_ROUTED, "${{ github.event_name == 'merge_group' && needs.capacity-route.outputs.accepted == 'true' && startsWith(matrix.part, 'worker-') }}");
  assert.equal(ci.jobs.suite.env.CAPACITY_REQUEST_ID, '${{ needs.capacity-route.outputs.request_id }}');
  assert.doesNotMatch(JSON.stringify(ci.jobs.suite.steps), /capacity-route|CAPACITY_ROUTED/, 'no suite step changes (runner-benchmark.yml mirrors them)');
  const gate = ci.jobs.gate.steps[0];
  assert.equal(gate.env.ROUTED, '${{ needs.capacity-route.outputs.accepted }}');
  assert.match(gate.run, /if \[ "\$EVENT" = "merge_group" \] && \[ "\$ROUTED" = "true" \]; then\n\s+required=\$\(gh api "repos\/\$REPO\/rules\/branches\/main" --jq '[^']*select\(\.context == "ci-capacity\/full-suite" and \(\(\.integration_id \/\/ 0\) > 0\)\)[^']*' \|\| echo 0\)\n\s+if \[ "\$\{required:-0\}" -lt 1 \]; then\n\s+echo "::error::[^"]+"\n\s+exit 1\n/);
  assert.equal((gate.run.match(/exit 0/g) || []).length, 2, 'routing adds no way to pass');
});

test('D8626 capacity-planner.yml: a queue submission needs the routing flag, and `accepted` comes from the submit step', () => {
  const submit = planner.jobs.submit;
  for (const flag of ["vars.CI_CAPACITY_ENABLED == 'true'", "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    "github.event_name == 'merge_group' && startsWith(github.ref, 'refs/heads/gh-readonly-queue/main/pr-') && vars.CI_CAPACITY_QUEUE_ROUTING == 'true'"]) {
    assert.ok(submit.if.includes(flag), flag);
  }
  assert.equal(submit.env.CI_CAPACITY_QUEUE_ROUTING, '${{ vars.CI_CAPACITY_QUEUE_ROUTING }}');
  assert.deepEqual(submit.outputs, { accepted: '${{ steps.submit.outputs.accepted }}', request_id: '${{ steps.submit.outputs.request_id }}' });
  assert.equal(planner.on.workflow_call.outputs.accepted.value, '${{ jobs.submit.outputs.accepted }}');
  const step = submit.steps.find(s => s.id === 'submit');
  assert.equal(step.run, 'node control/scripts/ci/capacity-planner.mjs', 'the planner runs from the reviewed control checkout');
  assert.equal(step['continue-on-error'], "${{ github.event_name == 'merge_group' }}", 'a queue refusal stays visible as a step, never as a red candidate');
});

test('D8626 the suite runner reports a routed Worker part and runs nothing; the same part unrouted is not skipped', async t => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 's21-runner-8626-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const planFile = join(dir, 'suite-plan.json');
  writeFileSync(planFile, JSON.stringify(buildPlan(pkg.scripts, {}, process.cwd()), null, 2) + '\n');
  const id = '0f4f8d2a-6b1c-4e3d-9a7b-1c2d3e4f5a6b';
  const run = (env, part = 'worker-2-of-6') => spawnSync(process.execPath, ['scripts/test-drift-parts.mjs', part, '--plan-file', planFile],
    { encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  const routed = run({ CAPACITY_ROUTED: 'true', GITHUB_EVENT_NAME: 'merge_group', CAPACITY_REQUEST_ID: id });
  assert.equal(routed.status, 0, routed.stderr);
  assert.equal(routed.stdout.trim(), `worker-2-of-6 runs through the capacity coordinator, request ${id}; its result is ci-capacity/full-suite on this commit.`);
  // An unknown part is still refused before anything is skipped: routing never hides a bad matrix.
  assert.equal(run({ CAPACITY_ROUTED: 'true', GITHUB_EVENT_NAME: 'merge_group', CAPACITY_REQUEST_ID: id }, 'worker-9-of-6').status, 2);
});
