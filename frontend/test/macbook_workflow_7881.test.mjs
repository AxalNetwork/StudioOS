/** D7881 (#7881): the optional Mac handoff preserves CI authority, source admission, plans and bounded hosted recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { LIMITS, MAC_JOB_NAME, PART, REPOSITORY, TEST_STEP_NAME, WORKFLOW } from '../../scripts/ci/macbook-worker.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const ORIGINAL = Object.freeze({
  ci: read('.github/workflows/ci.yml'),
  benchmark: read('.github/workflows/runner-benchmark.yml'),
  mac: read(`.github/workflows/${WORKFLOW}`),
});

// These workflows use the repository's two-space block style. Read active
// properties and step order, not comments, without a new YAML dependency.
const code = source => source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
function block(source, key, indent = 0) {
  const lines = code(source).split('\n');
  // Exactly `indent` spaces, then the key: a key never starts with a space.
  const prefix = `${' '.repeat(indent)}${key}:`;
  const start = lines.findIndex(line => line.startsWith(prefix));
  assert.ok(start >= 0, `missing ${key}`);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > indent)) end++;
  return lines.slice(start, end).join('\n');
}
function scalar(source, key, indent) {
  let value;
  try { value = block(source, key, indent); } catch { return undefined; }
  const [head, ...tail] = value.split('\n');
  const first = head.slice(head.indexOf(':') + 1).trim().replace(/\s+#.*$/, '');
  if (/^[>|][-+]?$/.test(first)) {
    const body = tail.map(line => line.slice(Math.min(line.search(/\S/) < 0 ? line.length : indent + 2, line.length)));
    return first.startsWith('>') ? body.join(' ').trim() : body.join('\n').trimEnd();
  }
  return /^(?:".*"|'.*')$/.test(first) ? first.slice(1, -1) : first;
}
const child = (source, key, indent) => block(source, key, indent);
const job = (source, name) => child(child(source, 'jobs', 0), name, 2);
function steps(source) {
  return child(source, 'steps', 4).split(/^ {6}- /m).slice(1).map(step => `        ${step}`);
}
const value = (step, key) => scalar(step, key, 8);
const withValue = (step, key) => scalar(child(step, 'with', 8), key, 10);
const envValue = (step, key) => scalar(child(step, 'env', 8), key, 10);
function uniqueStep(list, predicate, description) {
  const found = list.filter(predicate);
  assert.equal(found.length, 1, `one ${description}`);
  return found[0];
}
const named = (list, name) => uniqueStep(list, step => value(step, 'name') === name, name);
const byId = (list, id) => uniqueStep(list, step => value(step, 'id') === id, `step id ${id}`);

const context = (overrides = {}) => ({
  github: { repository: REPOSITORY, event_name: 'push', ref: 'refs/heads/main' },
  vars: { MACBOOK_WORKER_ENABLED: 'true' },
  matrix: { part: PART },
  steps: { macbook: { outputs: { delegated: 'false', child_run_id: '123' } }, admission: { outputs: { plan_mode: 'parent-artifact' } }, tests: { outcome: 'success' } },
  ...overrides,
});
function evaluate(expression, ctx, previousSuccess = true, wasCancelled = false) {
  assert.equal(typeof expression, 'string', 'an explicit expression is present');
  const source = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  return runInNewContext(source, {
    ...ctx, always: () => true, success: () => previousSuccess,
    failure: () => !previousSuccess, cancelled: () => wasCancelled,
  }, { timeout: 100 });
}
function canRun(step, ctx, previousSuccess = true, wasCancelled = false) {
  const expression = value(step, 'if');
  if (expression === undefined) return previousSuccess;
  const statusFunction = /\b(?:always|success|failure|cancelled)\s*\(/.test(expression);
  return (statusFunction || previousSuccess) && Boolean(evaluate(expression, ctx, previousSuccess, wasCancelled));
}
const changedGithub = changes => context({ github: { ...context().github, ...changes } });

function assertMacBoundary(sources) {
  const trigger = child(sources.mac, 'on', 0);
  assert.deepEqual([...trigger.matchAll(/^ {2}([\w-]+):/gm)].map(match => match[1]), ['workflow_dispatch']);
  const worker = job(sources.mac, 'worker');
  assert.equal(scalar(worker, 'name', 4), MAC_JOB_NAME, 'controller identifies the actual Mac job');
  const guard = scalar(worker, 'if', 4);
  assert.equal(evaluate(guard, changedGithub({ event_name: 'workflow_dispatch' })), true);
  for (const github of [
    { event_name: 'pull_request' }, { event_name: 'pull_request_target' }, { event_name: 'merge_group' },
    { event_name: 'workflow_dispatch', repository: 'outsider/fork' },
    { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' },
  ]) assert.equal(Boolean(evaluate(guard, changedGithub(github))), false, JSON.stringify(github));
  assert.equal(Boolean(evaluate(guard, context({ github: { ...context().github, event_name: 'workflow_dispatch' }, vars: { MACBOOK_WORKER_ENABLED: 'false' } }))), false);
  const routing = child(worker, 'runs-on', 4);
  assert.equal(scalar(routing, 'group', 6), 'StudioOS MacBook');
  assert.equal(scalar(routing, 'labels', 6), '[self-hosted, macOS, ARM64, studioos-macbook]');
  assert.doesNotMatch(code(sources.mac), /\bsecrets\.|\bsecrets:\s*inherit|write-all|^\s+[\w-]+:\s*write\s*$|create-github-app-token|CI_QUEUE_RUNNER|ubuntu-latest-m|CLOUDFLARE_API_TOKEN/m);
  const permissions = child(sources.mac, 'permissions', 0);
  for (const permission of ['contents', 'actions', 'pull-requests']) assert.equal(scalar(permissions, permission, 2), 'read');
  assert.equal(scalar(child(sources.mac, 'concurrency', 0), 'cancel-in-progress', 2), 'false', 'another dispatch cannot cancel the running shard');
}

function assertAdmissionOrder(sources) {
  const list = steps(job(sources.mac, 'worker'));
  const admission = byId(list, 'admission');
  const trusted = named(list, 'Check out trusted admission code');
  const source = named(list, 'Check out the admitted source');
  const tests = byId(list, 'tests');
  assert.equal(value(tests, 'name'), TEST_STEP_NAME, 'controller observes the actual test step');
  assert.equal(withValue(trusted, 'ref'), '${{ github.sha }}', 'admission code comes from the main executor commit');
  assert.equal(withValue(source, 'ref'), '${{ steps.admission.outputs.source_sha }}', 'candidate ref comes from successful admission');
  assert.ok(list.indexOf(trusted) < list.indexOf(admission) && list.indexOf(admission) < list.indexOf(source));
  assert.match(value(admission, 'run'), /macbook-control-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT\/scripts\/ci\/macbook-admission\.mjs/);
  assert.equal(envValue(admission, 'SOURCE_SHA'), '${{ inputs.source_sha }}');
  assert.equal(envValue(admission, 'GH_TOKEN'), '${{ github.token }}');
  assert.notEqual(value(admission, 'continue-on-error'), 'true');
  assert.equal(value(source, 'if'), undefined, 'a failed admission cannot be bypassed with always()');
  for (const checkout of list.filter(step => /^actions\/checkout@/.test(value(step, 'uses') || ''))) {
    assert.ok(checkout === trusted || checkout === source, 'no extra candidate checkout before admission');
    assert.equal(withValue(checkout, 'persist-credentials'), 'false');
  }
  const recheck = named(list, 'Confirm the parent still needs this shard');
  assert.ok(list.indexOf(source) < list.indexOf(recheck) && list.indexOf(recheck) < list.indexOf(tests));
  assert.match(value(recheck, 'run'), /macbook-control-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT\/scripts\/ci\/macbook-admission\.mjs/);
  assert.notEqual(value(recheck, 'continue-on-error'), 'true');
  assert.equal(envValue(tests, 'SOURCE_SHA'), '${{ steps.admission.outputs.source_sha }}');
  assert.equal(envValue(tests, 'SOURCE_REF'), '${{ steps.admission.outputs.source_ref }}');
  assert.equal(envValue(tests, 'PARENT_EVENT'), '${{ steps.admission.outputs.parent_event }}');
  const run = value(tests, 'run');
  assert.match(run, /test "\$\(\/usr\/bin\/git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  for (const assignment of ['GITHUB_SHA="$SOURCE_SHA"', 'GITHUB_REF="$SOURCE_REF"', 'GITHUB_EVENT_NAME="$PARENT_EVENT"', 'GITHUB_RUN_ID="$PARENT_RUN_ID"']) assert.ok(run.includes(assignment), assignment);
  assert.match(run, /node scripts\/test-drift-parts\.mjs "\$PART" --plan-file suite-plan\.json/);
  assert.equal(value(tests, 'continue-on-error'), undefined, 'a real test failure fails the child');
}

function assertExactPlan(sources) {
  const list = steps(job(sources.mac, 'worker'));
  const source = named(list, 'Check out the admitted source');
  const download = named(list, "Download the parent's exact shard plan");
  const queue = named(list, 'Generate the same merge-queue plan');
  for (const [mode, artifact, equal] of [['parent-artifact', true, false], ['equal-weights', false, true], ['', false, false]]) {
    const ctx = context({ steps: { admission: { outputs: { plan_mode: mode } } } });
    assert.equal(canRun(download, ctx), artifact, mode);
    assert.equal(canRun(queue, ctx), equal, mode);
  }
  assert.equal(withValue(download, 'artifact-ids'), '${{ steps.admission.outputs.plan_artifact_id }}');
  assert.equal(withValue(download, 'run-id'), '${{ inputs.parent_run_id }}');
  assert.equal(withValue(download, 'github-token'), '${{ github.token }}');
  assert.equal(withValue(download, 'path'), withValue(source, 'path'));
  assert.equal(value(queue, 'working-directory'), withValue(source, 'path'));
  assert.match(value(queue, 'run'), /^node scripts\/test-drift-parts\.mjs --plan --equal-weights$/);
  const tests = byId(list, 'tests');
  assert.equal(value(tests, 'working-directory'), withValue(source, 'path'));
  const install = named(list, 'Install Worker dependencies');
  assert.ok(list.indexOf(source) < list.indexOf(download) && list.indexOf(download) < list.indexOf(install));
  assert.ok(list.indexOf(source) < list.indexOf(queue) && list.indexOf(queue) < list.indexOf(install));
  assert.doesNotMatch(value(queue, 'run'), /timings|download/);
}

function assertCallerGate(sources) {
  const suite = job(sources.ci, 'suite');
  assert.equal(scalar(suite, 'runs-on', 4), 'ubuntu-latest', 'fallback always owns a standard hosted runner');
  const list = steps(suite);
  const controller = byId(list, 'macbook');
  assert.equal(envValue(controller, 'GH_TOKEN'), '${{ github.token }}');
  assert.equal(envValue(controller, 'PART'), '${{ matrix.part }}');
  assert.equal(value(controller, 'run'), 'node scripts/ci/macbook-worker.mjs');
  assert.equal(value(controller, 'continue-on-error'), undefined, 'Mac test failure cannot be ignored');
  for (const event_name of ['pull_request', 'pull_request_target', 'workflow_dispatch']) {
    assert.equal(canRun(controller, changedGithub({ event_name })), false, event_name);
  }
  assert.equal(canRun(controller, changedGithub({ event_name: 'push', ref: 'refs/heads/feature' })), false);
  assert.equal(canRun(controller, changedGithub({ event_name: 'push' })), true);
  assert.equal(canRun(controller, changedGithub({ event_name: 'merge_group', ref: 'refs/heads/gh-readonly-queue/main/pr-1-abc' })), true);
  assert.equal(canRun(controller, context({ vars: { MACBOOK_WORKER_ENABLED: 'false' } })), false);
  const fallback = uniqueStep(list, step => /^node scripts\/test-drift-parts\.mjs .*--plan-file suite-plan\.json$/.test(value(step, 'run') || ''), 'hosted shard');
  assert.ok(list.indexOf(controller) < list.indexOf(fallback));
  for (const [delegated, prior, expected] of [['true', true, false], ['false', true, true], ['', true, true], ['true', false, false], ['false', false, false]]) {
    const ctx = context({ steps: { macbook: { outputs: { delegated } } } });
    assert.equal(canRun(fallback, ctx, prior), expected, `${delegated}, previous success=${prior}`);
  }
  assert.equal(value(fallback, 'continue-on-error'), undefined);
  const benchmark = job(sources.benchmark, 'benchmark');
  const benchmarkController = byId(steps(benchmark), 'macbook');
  assert.equal(canRun(benchmarkController, changedGithub({ ref: 'refs/heads/bench/runners-test' })), false, 'benchmark cannot silently delegate a measured lane');
  for (const gate of ['landing', 'gate']) {
    const gateSteps = steps(job(sources.ci, gate));
    const check = uniqueStep(gateSteps, step => /\$SUITE/.test(value(step, 'run') || ''), `${gate} suite result`);
    assert.equal(envValue(check, 'SUITE'), '${{ needs.suite.result }}');
    // Exercise the actual shell gate: a controller/test failure cannot become
    // green through a new output or a fall-through success branch.
    for (const [result, expected] of [['success', 0], ['failure', 1], ['cancelled', 1], ['skipped', 1]]) {
      const ran = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', value(check, 'run')], {
        encoding: 'utf8', env: { ...process.env, EVENT: 'merge_group', DRAFT: 'false', VERIFIED_RUN: '', PLAN: 'skipped', SUITE: result, REQUIRED: 'pass' },
      });
      assert.equal(ran.status, expected, `${gate} ${result}: ${ran.stderr}`);
    }
  }
}

function assertTraceTransfer(sources) {
  const parent = steps(job(sources.ci, 'suite'));
  const childSteps = steps(job(sources.mac, 'worker'));
  const download = named(parent, 'Collect the delegated Mac test traces');
  const upload = named(parent, "Upload this part's test traces");
  const macUpload = named(childSteps, 'Upload Mac test traces');
  assert.equal(withValue(download, 'name'), withValue(macUpload, 'name'));
  assert.equal(withValue(download, 'run-id'), '${{ steps.macbook.outputs.child_run_id }}');
  assert.equal(withValue(download, 'path'), withValue(upload, 'path'));
  assert.equal(withValue(macUpload, 'path'), envValue(byId(childSteps, 'tests'), 'TEST_TRACE_DIR'));
  assert.ok(parent.indexOf(download) < parent.indexOf(upload));
  const failed = context({ steps: { macbook: { outputs: { delegated: 'true' } }, tests: { outcome: 'failure' } } });
  assert.equal(canRun(download, failed, false), true, 'failed delegated tests retain traces');
  assert.equal(canRun(upload, failed, false), true);
  assert.equal(canRun(macUpload, failed, false), true);
  assert.equal(canRun(download, context(), true), false, 'hosted fallback does not fetch unrelated Mac traces');
  for (const step of [download, upload, macUpload]) assert.equal(value(step, 'continue-on-error'), 'true', 'telemetry failure cannot replace the test result');
}

function assertOwnedCancellation(sources) {
  const list = steps(job(sources.ci, 'suite'));
  const controller = byId(list, 'macbook');
  const cleanup = named(list, 'Cancel the owned Mac run when CI is cancelled');
  assert.ok(list.indexOf(controller) < list.indexOf(cleanup));
  assert.equal(value(cleanup, 'run'), 'node scripts/ci/macbook-worker.mjs --cancel-owned');
  assert.equal(envValue(cleanup, 'CHILD_RUN_ID'), '${{ steps.macbook.outputs.child_run_id }}', 'only this controller identifies a child to cancel');
  assert.equal(envValue(cleanup, 'GH_TOKEN'), '${{ github.token }}');
  assert.equal(envValue(cleanup, 'PART'), '${{ matrix.part }}');
  for (const [childId, cancelled, expected] of [['123', true, true], ['', true, false], ['123', false, false]]) {
    const ctx = context({ steps: { macbook: { outputs: { child_run_id: childId } } } });
    assert.equal(canRun(cleanup, ctx, false, cancelled), expected, `child=${childId}, cancelled=${cancelled}`);
  }
}

function assertCleanup(sources) {
  const cleanup = named(steps(job(sources.mac, 'worker')), "Remove this job's files");
  assert.equal(canRun(cleanup, context(), false), true);
  const run = value(cleanup, 'run');
  const expected = [
    '$GITHUB_WORKSPACE/macbook-source-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT',
    '$GITHUB_WORKSPACE/macbook-control-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT',
    '$RUNNER_TEMP/macbook-worker-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT',
  ];
  const lines = run.split('\n').filter(line => line.trim());
  const removals = lines.filter(line => line.trim().startsWith('rm '));
  assert.deepEqual(removals.map(line => /^rm -rf -- "([^"]+)"$/.exec(line.trim())?.[1]).sort(), [...expected].sort(), 'cleanup is scoped to this child run and attempt');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    const guard = `[[ "$${key}" =~ ^[0-9]+$ ]]`;
    assert.ok(lines.indexOf(guard) >= 0 && lines.indexOf(guard) < lines.indexOf(removals[0]), `validate ${key} before removal`);
  }
  assert.equal(lines.length, removals.length + 2, 'cleanup has no extra unscoped operations');
  // Only execute the allowlisted cleanup above, in an isolated fake workspace.
  const temp = mkdtempSync(join(tmpdir(), 'macbook-workflow-7881-'));
  try {
    const workspace = join(temp, 'workspace');
    const runnerTemp = join(temp, 'runner-temp');
    const own = [join(workspace, 'macbook-source-123-2'), join(workspace, 'macbook-control-123-2'), join(runnerTemp, 'macbook-worker-123-2')];
    for (const directory of [...own, join(workspace, 'unrelated'), join(runnerTemp, 'unrelated')]) mkdirSync(directory, { recursive: true });
    const sentinel = join(workspace, 'unrelated', 'keep');
    writeFileSync(sentinel, 'other job');
    const ran = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', run], { encoding: 'utf8', env: { GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runnerTemp, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', PATH: process.env.PATH } });
    assert.equal(ran.status, 0, ran.stderr);
    assert.ok(own.every(path => !existsSync(path)), 'owned directories removed');
    assert.equal(readFileSync(sentinel, 'utf8'), 'other job');
    assert.ok(existsSync(join(runnerTemp, 'unrelated')));
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

function assertTimeoutBudget(sources) {
  const timeout = scalar(job(sources.ci, 'suite'), 'timeout-minutes', 4);
  const mainBudget = Number(evaluate(timeout, context()));
  const hostedBudget = Number(evaluate(timeout, context({ vars: { MACBOOK_WORKER_ENABLED: 'false' } })));
  assert.equal(Number(evaluate(timeout, changedGithub({ event_name: 'pull_request' }))), hostedBudget);
  assert.equal(Number(evaluate(timeout, context({ matrix: { part: 'worker-2-of-6' } }))), hostedBudget);
  const delegationMinutes = Math.ceil((LIMITS.startTimeoutMs + LIMITS.completionTimeoutMs + LIMITS.cancelTimeoutMs) / 60_000);
  assert.ok(mainBudget >= delegationMinutes + hostedBudget + 5, 'full hosted retry and setup fit after bounded delegation');
  const gateBudget = Number(scalar(job(sources.ci, 'gate'), 'timeout-minutes', 4));
  assert.ok(mainBudget + gateBudget < 90, 'critical path keeps headroom below the merge queue check timeout');
  const childBudget = Number(scalar(job(sources.mac, 'worker'), 'timeout-minutes', 4));
  assert.ok(childBudget >= Math.ceil(LIMITS.completionTimeoutMs / 60_000));
  assert.ok(childBudget + hostedBudget + 5 <= mainBudget, 'even the child execution cap leaves a complete hosted fallback');
}

const guards = {
  boundary: assertMacBoundary, admission: assertAdmissionOrder, plan: assertExactPlan,
  result: assertCallerGate, trace: assertTraceTransfer, cancellation: assertOwnedCancellation,
  cleanup: assertCleanup, budget: assertTimeoutBudget,
};
for (const [name, guard] of Object.entries(guards)) test(`D7881 workflow wiring: ${name}`, () => guard(ORIGINAL));

test('D7881 wiring guards reject actual unsafe regressions and accept restored files', () => {
  const mutants = [
    ['boundary', 'mac', '  workflow_dispatch:\n', '  pull_request:\n  workflow_dispatch:\n'],
    ['boundary', 'mac', "github.ref == 'refs/heads/main' &&", "github.ref != '' &&"],
    ['boundary', 'mac', '  actions: read', '  actions: write'],
    ['boundary', 'mac', 'group: StudioOS MacBook', 'group: Default Larger Runners'],
    ['admission', 'mac', 'ref: ${{ github.sha }}', 'ref: ${{ inputs.source_sha }}'],
    ['admission', 'mac', 'ref: ${{ steps.admission.outputs.source_sha }}', 'ref: main'],
    ['admission', 'mac', '        id: admission\n', '        id: admission\n        continue-on-error: true\n'],
    ['admission', 'mac', 'GITHUB_SHA="$SOURCE_SHA"', 'GITHUB_SHA="$GITHUB_SHA"'],
    ['plan', 'mac', 'artifact-ids: ${{ steps.admission.outputs.plan_artifact_id }}', 'name: suite-plan'],
    ['plan', 'mac', 'run: node scripts/test-drift-parts.mjs --plan --equal-weights', 'run: node scripts/test-drift-parts.mjs --plan test-timings.json'],
    ['result', 'ci', '        id: macbook\n', '        id: macbook\n        continue-on-error: true\n'],
    ['result', 'ci', "if: steps.macbook.outputs.delegated != 'true'", "if: always() && steps.macbook.outputs.delegated != 'true'"],
    ['result', 'ci', "github.event_name == 'merge_group' || github.event_name == 'push' && github.ref == 'refs/heads/main'", "github.event_name == 'pull_request' || github.event_name == 'push' && github.ref == 'refs/heads/main'"],
    ['trace', 'ci', "if: always() && steps.macbook.outputs.delegated == 'true'", "if: success() && steps.macbook.outputs.delegated == 'true'"],
    ['trace', 'ci', 'run-id: ${{ steps.macbook.outputs.child_run_id }}', 'run-id: ${{ github.run_id }}'],
    ['cancellation', 'ci', 'CHILD_RUN_ID: ${{ steps.macbook.outputs.child_run_id }}', 'CHILD_RUN_ID: ${{ github.run_id }}'],
    ['cancellation', 'ci', "if: cancelled() && steps.macbook.outputs.child_run_id != ''", "if: success() && steps.macbook.outputs.child_run_id != ''"],
    ['cleanup', 'mac', 'rm -rf -- "$GITHUB_WORKSPACE/macbook-source-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"', 'rm -rf -- "$GITHUB_WORKSPACE"'],
    ['cleanup', 'mac', '[[ "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]\n          rm', 'true\n          rm'],
    ['budget', 'ci', '&& 75 || 40', '&& 40 || 40'],
    ['budget', 'mac', '    timeout-minutes: 28', '    timeout-minutes: 80'],
  ];
  for (const [name, file, from, to] of mutants) {
    assert.ok(ORIGINAL[file].includes(from), `${name} mutation anchor: ${from}`);
    const mutated = { ...ORIGINAL, [file]: ORIGINAL[file].replace(from, to) };
    assert.throws(() => guards[name](mutated), `${name} accepted mutation ${from} -> ${to}`);
    guards[name](ORIGINAL);
  }
});
