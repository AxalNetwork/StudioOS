// D7881 (#7881): delegation must preserve failures and bound every unavailable-Mac path.
//
// From frontend/test/README.md (moved by #6472): D7881: exact dispatch ownership, bounded
// busy/offline/API fallback, cancellation, failure identities and real Mac test failure
// propagation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REPOSITORY, PART, WORKFLOW_PATH, MAC_JOB_NAME, TEST_STEP_NAME, RUNNER_GROUP_ID,
  configFromEnv, configurationProblem, expectedTitle, delegateWorker,
  annotationPath, failureAnnotationLines, githubApi, writeOutputs, cancelOwnedChild,
} from '../../scripts/ci/macbook-worker.mjs';

const ROOT = `/repos/${REPOSITORY}`;
const WORKFLOW = `${ROOT}/actions/workflows/macbook-worker.yml`;
const SOURCE = 'a'.repeat(40);
const TARGET = 'b'.repeat(40);
const QUEUE_BASE = 'c'.repeat(40);
const EPOCH = Date.UTC(2026, 10, 20, 12);
const CONFIG = Object.freeze({
  enabled: true, repo: REPOSITORY, event: 'push', ref: 'refs/heads/main',
  sourceSha: SOURCE, parentRunId: '101', parentRunAttempt: '2', part: PART, queueBaseSha: '',
});
const LIMITS = Object.freeze({
  startTimeoutMs: 90, completionTimeoutMs: 250, pollMs: 10,
  runningPollMs: 10, parentPollMs: 20, cancelTimeoutMs: 50,
});

/** No real sleeps, API calls, credentials or workflow dispatches occur in these tests. */
function scenario(options = {}) {
  const config = { ...CONFIG, ...options.config };
  const clock = { value: EPOCH };
  const calls = [];
  const abort = new AbortController();
  let cancelled = false;
  let dispatched = false;
  const elapsed = () => clock.value - EPOCH;
  const start = options.startAfter ?? 20;
  const finish = options.finishAfter ?? 60;
  const result = options.result ?? 'success';
  const isFinished = () => cancelled || elapsed() >= finish;
  const parent = () => ({
    id: 101, run_attempt: 2, repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY }, path: '.github/workflows/ci.yml',
    event: config.event, head_sha: config.sourceSha,
    head_branch: config.ref.slice('refs/heads/'.length),
    status: elapsed() >= (options.parentCancelledAt ?? Infinity) ? 'completed' : 'in_progress',
    conclusion: elapsed() >= (options.parentCancelledAt ?? Infinity) ? 'cancelled' : null,
    ...options.parent,
  });
  const child = () => ({
    id: 201, workflow_id: 42, run_attempt: 1,
    repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY },
    event: 'workflow_dispatch', path: WORKFLOW_PATH, head_branch: 'main',
    head_sha: TARGET, display_title: expectedTitle(config),
    status: isFinished() ? 'completed' : elapsed() < start ? 'queued' : 'in_progress',
    conclusion: cancelled ? 'cancelled' : isFinished() ? result : null,
    ...options.child,
  });
  const jobs = () => {
    if (options.noMacJob) return { total_count: 1, jobs: [{ name: 'Admit the source', runner_id: 1 }] };
    const started = elapsed() >= start;
    const testFailed = elapsed() >= (options.testFailedAt ?? finish) && result === 'failure';
    const testDone = elapsed() >= finish;
    const step = {
      name: TEST_STEP_NAME,
      status: testFailed || testDone || cancelled ? 'completed' : 'in_progress',
      conclusion: testFailed ? 'failure' : cancelled ? 'cancelled' : testDone ? (options.testConclusion ?? result) : null,
    };
    return { total_count: 1, jobs: [{
      id: 301, name: MAC_JOB_NAME, runner_id: started ? 43774 : 0,
      runner_group_id: RUNNER_GROUP_ID,
      labels: ['self-hosted', 'macOS', 'ARM64', 'studioos-macbook'],
      started_at: started ? new Date(EPOCH + start).toISOString() : null,
      status: isFinished() ? 'completed' : started ? 'in_progress' : 'queued',
      conclusion: cancelled ? 'cancelled' : isFinished() ? result : null,
      check_run_url: `https://api.github.com${ROOT}/check-runs/301`,
      steps: options.noTest || !started ? [] : [step],
      ...options.job,
    }] };
  };
  const api = async (method, path, body, { signal } = {}) => {
    calls.push({ method, path, body, at: elapsed() });
    if (signal?.aborted) throw new Error('aborted');
    if (options.apiFailure?.(method, path, elapsed())) throw new Error('private API diagnostic must not leak');
    if (method === 'GET' && path === `${ROOT}/actions/runs/101`) return parent();
    if (method === 'GET' && path === WORKFLOW) return { id: 42, path: WORKFLOW_PATH, state: 'active', ...options.workflow };
    if (method === 'GET' && path.startsWith(`${WORKFLOW}/runs?`)) {
      return { total_count: options.busy ? 1 : 0, workflow_runs: options.busy ? [{ id: 999, status: 'in_progress' }] : [] };
    }
    if (method === 'GET' && path === `${ROOT}/branches/main`) return { commit: { sha: TARGET } };
    if (method === 'POST' && path === `${WORKFLOW}/dispatches`) {
      assert.equal(dispatched, false, 'an uncertain dispatch must not be retried');
      dispatched = true;
      if (options.dispatchError) throw new Error('secret upstream diagnostic');
      return options.dispatchResponse ?? { workflow_run_id: 201, html_url: 'https://untrusted.example/not-followed' };
    }
    if (method === 'GET' && path === `${ROOT}/actions/runs/201`) return child();
    if (method === 'GET' && path === `${ROOT}/actions/runs/201/jobs?per_page=100`) return jobs();
    if (method === 'POST' && path === `${ROOT}/actions/runs/201/cancel`) {
      if (!options.ignoreCancel) cancelled = true;
      return {};
    }
    if (method === 'GET' && path === `${ROOT}/check-runs/301/annotations?per_page=100`) {
      return options.annotations ?? [{ title: 'ci-failure-id', message: 'cloudflare-worker/test/example.test.ts › fails' }];
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  const sleep = async (ms, signal) => {
    if (signal?.aborted) throw new Error('aborted');
    assert.ok(ms > 0 && ms <= 50, 'sleep is bounded');
    clock.value += ms;
    if (elapsed() >= (options.abortAt ?? Infinity)) abort.abort();
  };
  return {
    config, calls, clock, api,
    run: () => delegateWorker({ config, api, now: () => clock.value, sleep, signal: abort.signal, limits: LIMITS,
      onDispatch: options.onDispatch }),
    dispatches: () => calls.filter(call => call.method === 'POST' && call.path.endsWith('/dispatches')),
    cancellations: () => calls.filter(call => call.method === 'POST' && call.path.endsWith('/cancel')),
  };
}

test('D7881: disabled, other parts, every PR and malformed identities stay hosted without an API call', async () => {
  for (const config of [
    { enabled: false }, { part: 'worker-2-of-6' }, { repo: 'outsider/StudioOS' },
    { event: 'pull_request', ref: 'refs/pull/123/merge' },
    { event: 'pull_request_target', ref: 'refs/heads/main' },
    { ref: 'refs/heads/feature' }, { parentRunId: '../201' }, { parentRunAttempt: '0' },
    { sourceSha: 'main' }, { sourceSha: `${SOURCE}\n` },
    { event: 'merge_group', ref: 'refs/heads/gh-readonly-queue/main/pr-12-deadbeef', queueBaseSha: '' },
    { event: 'merge_group', ref: 'refs/heads/gh-readonly-queue/main/../../main', queueBaseSha: QUEUE_BASE },
  ]) {
    const s = scenario({ config });
    const result = await s.run();
    assert.equal(result.delegated, false, JSON.stringify(config));
    assert.equal(result.exitCode, 0);
    assert.equal(s.calls.length, 0);
  }
});

test('D7881: configuration takes the original queue base only from the event payload', () => {
  const env = {
    MACBOOK_WORKER_ENABLED: 'true', GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_EVENT_NAME: 'merge_group', GITHUB_REF: 'refs/heads/gh-readonly-queue/main/pr-12-deadbeef',
    GITHUB_SHA: SOURCE, GITHUB_RUN_ID: '101', GITHUB_RUN_ATTEMPT: '2', PART,
    QUEUE_BASE_SHA: 'untrusted-environment-override',
  };
  assert.equal(configurationProblem(configFromEnv(env)), 'invalid_queue_context');
  const config = configFromEnv(env, { merge_group: { base_sha: QUEUE_BASE } });
  assert.equal(configurationProblem(config), null);
  assert.equal(config.queueBaseSha, QUEUE_BASE);
  assert.equal(configFromEnv({ ...env, MACBOOK_WORKER_ENABLED: 'TRUE' }).enabled, false);
});

test('D7881: parent run, attempt, source, event and CI path are bound before dispatch', async () => {
  for (const parent of [
    { id: 999 }, { run_attempt: 1 }, { head_sha: 'd'.repeat(40) },
    { path: '.github/workflows/other.yml' }, { event: 'pull_request' },
    { head_repository: { full_name: 'fork/StudioOS' } },
    { head_branch: 'feature' }, { status: 'completed', conclusion: 'success' },
  ]) {
    const s = scenario({ parent });
    const result = await s.run();
    assert.equal(result.delegated, false);
    assert.equal(s.dispatches().length, 0);
  }
});

test('D7881: an active Mac child workflow goes directly to hosted execution', async () => {
  const s = scenario({ busy: true });
  const result = await s.run();
  assert.equal(result.reason, 'mac_workflow_busy');
  assert.equal(result.delegated, false);
  assert.equal(s.dispatches().length, 0);
  assert.equal(s.cancellations().length, 0, 'another parent\'s child is never cancelled');
});

test('D7881: dispatch failure or missing returned ID is not retried or treated as success', async () => {
  for (const options of [{ dispatchError: true }, { dispatchResponse: {} }]) {
    const s = scenario(options);
    const result = await s.run();
    assert.equal(result.delegated, false);
    assert.equal(result.exitCode, 0);
    assert.equal(s.dispatches().length, 1);
    assert.equal(s.cancellations().length, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret|upstream|https:/);
  }
});

test('D7881: exact completed Mac test success is the only delegated green result', async () => {
  const s = scenario();
  const result = await s.run();
  assert.deepEqual(result, { delegated: true, childRunId: '201', reason: 'mac_passed', exitCode: 0 });
  assert.equal(s.dispatches().length, 1);
  assert.deepEqual(s.dispatches()[0].body, {
    ref: 'main',
    inputs: { parent_run_id: '101', parent_run_attempt: '2', source_sha: SOURCE, part: PART, queue_base_sha: '' },
  });
  assert.equal(s.cancellations().length, 0);
  assert.ok(s.calls.every(call => call.path.startsWith(`${ROOT}/`)));
});

test('D7881: merge groups pass their bound queue base and leave graph admission to the trusted child', async () => {
  const s = scenario({
    config: { event: 'merge_group', ref: 'refs/heads/gh-readonly-queue/main/pr-12-deadbeef', queueBaseSha: QUEUE_BASE },
    noMacJob: true, finishAfter: 30, result: 'failure',
  });
  const result = await s.run();
  assert.equal(result.delegated, false, 'a denied source never reports delegated tests');
  assert.equal(result.reason, 'child_did_not_verify_tests');
  assert.equal(s.dispatches()[0].body.inputs.queue_base_sha, QUEUE_BASE);
});

test('D7881: a real Mac test failure remains a failure and mirrors escaped failure identities', async () => {
  const s = scenario({ result: 'failure', annotations: [
    { title: 'other', message: 'ignore me' },
    { title: 'ci-failure-id', message: 'a%file\r\n::notice::not a second command' },
    ...Array.from({ length: 8 }, (_, i) => ({ title: 'ci-failure-id', message: `failure ${i}` })),
  ] });
  const result = await s.run();
  assert.equal(result.delegated, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, 'mac_test_failed');
  assert.equal(result.annotations.length, 5);
  assert.equal(result.annotations[0], '::error title=ci-failure-id::a%25file%0D%0A::notice::not a second command');
  assert.ok(result.annotations.every(line => !/[\r\n]/.test(line)));
  assert.equal(result.annotationWarning, false);
  assert.equal(s.cancellations().length, 0);
});

test('D7881: absent, skipped, cancelled and setup-failed tests never count as a delegated pass', async () => {
  for (const options of [
    { noTest: true }, { testConclusion: 'skipped' }, { testConclusion: 'cancelled' },
    { noTest: true, result: 'failure' }, { noMacJob: true },
  ]) {
    const s = scenario(options);
    const result = await s.run();
    assert.equal(result.delegated, false, JSON.stringify(options));
    assert.equal(result.exitCode, 0);
    assert.equal(result.reason, 'child_did_not_verify_tests');
  }
});

test('D7881: an offline Mac or a child waiting for admission falls back after the start budget', async () => {
  for (const options of [{ startAfter: Infinity, finishAfter: Infinity }, { noMacJob: true, finishAfter: Infinity }]) {
    const s = scenario(options);
    const result = await s.run();
    assert.equal(result.delegated, false);
    assert.equal(result.reason, 'mac_start_timeout');
    assert.equal(s.cancellations().length, 1);
    assert.equal(s.cancellations()[0].path, `${ROOT}/actions/runs/201/cancel`);
    assert.equal(s.cancellations()[0].at, LIMITS.startTimeoutMs);
    assert.ok(s.clock.value <= EPOCH + LIMITS.startTimeoutMs + LIMITS.cancelTimeoutMs);
  }
});

test('D7881: runner ID zero is not evidence that the Mac started', async () => {
  const s = scenario({ finishAfter: Infinity, job: { runner_id: 0 } });
  const result = await s.run();
  assert.equal(result.reason, 'mac_start_timeout');
  assert.equal(result.delegated, false);
});

test('D7881: assigned runner ID on a queued job does not start the completion clock', async () => {
  const s = scenario({ finishAfter: Infinity, job: { runner_id: 43774, status: 'queued' } });
  const result = await s.run();
  assert.equal(result.reason, 'mac_start_timeout');
  assert.equal(s.cancellations()[0].at, LIMITS.startTimeoutMs);
});

test('D7881: the child ID is persisted before the first child metadata read', async () => {
  const events = [];
  const s = scenario({ onDispatch: childId => { events.push(childId); assert.equal(s.calls.some(call =>
    call.method === 'GET' && call.path === `${ROOT}/actions/runs/201`), false); } });
  await s.run();
  assert.deepEqual(events, ['201']);
});

test('D7881: runtime budget starts at actual Mac job start and cancels before hosted fallback', async () => {
  const s = scenario({ startAfter: 30, finishAfter: Infinity });
  const result = await s.run();
  assert.equal(result.delegated, false);
  assert.equal(result.reason, 'mac_completion_timeout');
  assert.equal(s.cancellations()[0].at, 30 + LIMITS.completionTimeoutMs);
});

test('D7881: known test failure survives a later hang instead of being hidden by hosted fallback', async () => {
  const s = scenario({ result: 'failure', testFailedAt: 40, finishAfter: Infinity });
  const result = await s.run();
  assert.equal(result.delegated, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.reason, 'mac_test_failed');
  assert.equal(s.cancellations().length, 1);
});

test('D7881: unexpected source target is cancelled; an unrelated run is never cancelled or accepted', async () => {
  const moved = scenario({ child: { head_sha: 'd'.repeat(40) } });
  const movedResult = await moved.run();
  assert.equal(movedResult.delegated, false);
  assert.match(movedResult.reason, /^child_source_target_mismatch/);
  assert.equal(moved.cancellations().length, 1);
  for (const child of [
    { id: 999 }, { workflow_id: 99 }, { run_attempt: 2 },
    { head_branch: 'untrusted' }, { path: '.github/workflows/other.yml' },
    { event: 'pull_request' }, { display_title: 'a different parent' },
    { repository: { full_name: 'fork/StudioOS' } },
  ]) {
    const s = scenario({ child });
    const result = await s.run();
    assert.equal(result.delegated, false);
    assert.equal(result.reason, 'child_identity_mismatch');
    assert.equal(s.cancellations().length, 0);
  }
});

test('D7881: matching job name on another runner group cannot establish Mac success', async () => {
  const s = scenario({ job: { runner_group_id: 99 } });
  const result = await s.run();
  assert.equal(result.delegated, false);
  assert.match(result.reason, /^wrong_mac_runner/);
  assert.equal(s.cancellations().length, 1);
});

test('D7881: parent cancellation and process interruption cancel the exact child and stop the parent', async () => {
  for (const options of [{ parentCancelledAt: 40 }, { abortAt: 30 }]) {
    const s = scenario({ ...options, finishAfter: Infinity });
    const result = await s.run();
    assert.equal(result.delegated, false);
    assert.equal(result.exitCode, 130);
    assert.equal(result.reason, 'parent_cancelled');
    assert.equal(s.cancellations().length, 1);
  }
});

test('D7881: unconfirmed cancellation is bounded and cannot become a green delegation', async () => {
  const s = scenario({ startAfter: Infinity, finishAfter: Infinity, ignoreCancel: true });
  const result = await s.run();
  assert.equal(result.delegated, false);
  assert.equal(result.reason, 'mac_start_timeout_cancel_unconfirmed');
  assert.equal(s.clock.value - EPOCH, LIMITS.startTimeoutMs + LIMITS.cancelTimeoutMs);
});

test('D7881: the separate cancellation hook verifies parent and child ownership even after parent cancellation', async () => {
  const s = scenario({ parentCancelledAt: 0, finishAfter: Infinity });
  const cleanup = await cancelOwnedChild({ config: s.config, childRunId: '201', api: s.api });
  assert.deepEqual(cleanup, { cancelled: true, reason: 'child_cancel_requested' });
  assert.equal(s.cancellations().length, 1);
  for (const options of [
    { parent: { head_sha: 'd'.repeat(40) } },
    { child: { display_title: 'another parent' } },
    { child: { workflow_id: 99 } },
  ]) {
    const unrelated = scenario(options);
    const result = await cancelOwnedChild({ config: unrelated.config, childRunId: '201', api: unrelated.api });
    assert.equal(result.cancelled, false);
    assert.equal(unrelated.cancellations().length, 0);
  }
  const missing = scenario();
  assert.equal((await cancelOwnedChild({ config: missing.config, childRunId: '', api: missing.api })).reason, 'no_child');
  assert.equal(missing.calls.length, 0);
});

test('D7881: an API outage after a verified child starts cancels that child and keeps the hosted fallback', async () => {
  const s = scenario({ finishAfter: Infinity, apiFailure: (method, path, at) =>
    method === 'GET' && path === `${ROOT}/actions/runs/201/jobs?per_page=100` && at >= 40 });
  const result = await s.run();
  assert.equal(result.delegated, false);
  assert.equal(s.cancellations().length, 1);
  assert.match(result.reason, /^child_status_unavailable/);
});

test('D7881: the dispatch-returned ID is cleaned up even when the first metadata read fails', async () => {
  const s = scenario({ apiFailure: (method, path) => method === 'GET' && path === `${ROOT}/actions/runs/201` });
  const result = await s.run();
  assert.equal(result.delegated, false);
  assert.equal(s.cancellations().length, 1);
  assert.equal(s.cancellations()[0].path, `${ROOT}/actions/runs/201/cancel`);
});

test('D7881: missing annotations preserve a real failure without exposing API diagnostics', async () => {
  for (const options of [
    { job: { check_run_url: 'https://attacker.example/steal-token' } },
    { apiFailure: (_method, path) => path.includes('/annotations?') },
    { annotations: [] },
  ]) {
    const s = scenario({ ...options, result: 'failure' });
    const result = await s.run();
    assert.equal(result.delegated, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.annotationWarning, true);
    assert.deepEqual(result.annotations, []);
    assert.doesNotMatch(JSON.stringify(result), /private API|attacker|steal-token/);
    assert.ok(s.calls.every(call => call.path.startsWith(`${ROOT}/`)));
  }
});

test('D7881: check annotation URLs and GitHub requests stay on the fixed repository', async () => {
  assert.equal(annotationPath(`https://api.github.com${ROOT}/check-runs/301`), `${ROOT}/check-runs/301/annotations?per_page=100`);
  for (const value of [
    `http://api.github.com${ROOT}/check-runs/301`,
    `https://api.github.com.evil.example${ROOT}/check-runs/301`,
    `https://user@api.github.com${ROOT}/check-runs/301`,
    `https://api.github.com/repos/other/StudioOS/check-runs/301`,
    `https://api.github.com${ROOT}/check-runs/301?redirect=bad`,
    `https://api.github.com${ROOT}/check-runs/301#fragment`,
  ]) assert.equal(annotationPath(value), null);
  assert.throws(() => failureAnnotationLines({}));
  const requests = [];
  const api = githubApi('fixture-token', { fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return { ok: true, text: async () => '{"workflow_run_id":201}' };
  } });
  assert.deepEqual(await api('POST', `${WORKFLOW}/dispatches`, { ref: 'main' }), { workflow_run_id: 201 });
  assert.equal(requests[0].url, `https://api.github.com${WORKFLOW}/dispatches`);
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].init.headers['X-GitHub-Api-Version'], '2026-03-10');
  for (const path of [
    'https://evil.example/', '/orgs/AxalNetwork/actions/runners',
    `${ROOT}/../another-repo`, `${ROOT}/%2e%2e/another-repo`,
    `${ROOT}/actions\\evil`, `${ROOT}/actions\nHost: evil`,
  ]) await assert.rejects(api('GET', path));
  await assert.rejects(api('DELETE', `${ROOT}/actions/runs/201`));
  assert.equal(requests.length, 1);
});

test('D7881: outputs are fixed names and cannot inject workflow output records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'macbook-outputs-'));
  try {
    const path = join(dir, 'outputs');
    writeOutputs({ delegated: true, childRunId: '201', reason: 'mac_passed' }, path);
    assert.equal(readFileSync(path, 'utf8'), 'delegated=true\nchild_run_id=201\nreason=mac_passed\n');
    assert.throws(() => writeOutputs({ delegated: true, childRunId: '201\nother=value', reason: 'mac_passed' }, path));
    assert.throws(() => writeOutputs({ delegated: true, childRunId: '201', reason: 'passed\ndelegated=true' }, path));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
