/** D7888: real report code against deterministic GitHub metadata, never a live capacity claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectCapacity, overlapMetrics, validateManifest } from '../../scripts/ci/runners/verify-capacity.mjs';

const SOURCE = 'a'.repeat(40); const EXECUTOR = 'b'.repeat(40); const PLAN = 'c'.repeat(64);
const date = (s) => new Date(Date.UTC(2026, 10, 20, 12, 0, s)).toISOString();
function fixture() {
  const spec = { version: 1, repository: 'AxalNetwork/StudioOS', candidate_sha: SOURCE, executor_sha: EXECUTOR, plan_sha: PLAN,
    parent: { run_id: 10, attempt: 1 }, approved_group_id: 7, capability_label: 'studioos-worker-v1',
    requests: [
      { shard: 'worker-1-of-6', generation: 1, run_id: 10, attempt: 1, job_id: 101, profile: 'standard-hosted', test_step: 1 },
      { shard: 'worker-2-of-6', generation: 1, run_id: 20, attempt: 1, job_id: 201, profile: 'macos-arm64', test_step: 1 },
      { shard: 'worker-3-of-6', generation: 1, run_id: 30, attempt: 1, job_id: 301, profile: 'linux-x64', test_step: 1 },
    ], controllers: [{ job_id: 102, wait_steps: [1] }] };
  const run = (id) => ({ id, run_attempt: 1, repository: { full_name: spec.repository }, head_sha: id === 10 ? SOURCE : EXECUTOR, conclusion: 'success' });
  const job = (run_id, id, labels, start, end) => ({ id, run_id, run_attempt: 1, labels, runner_id: id + 1000, runner_name: 'private-node.example.invalid', runner_group_name: 'private group', runner_group_id: labels.includes('self-hosted') ? 7 : null,
    name: 'private account@example.invalid', created_at: date(start - 5), started_at: date(start), completed_at: date(end), conclusion: 'success',
    steps: [{ number: 1, name: 'private step', started_at: date(start), completed_at: date(end), conclusion: 'success' }] });
  const runs = new Map([10, 20, 30].map((id) => [id, run(id)]));
  const jobs = new Map([
    [10, [job(10, 101, ['ubuntu-latest'], 10, 120), job(10, 102, ['ubuntu-latest'], 20, 100)]],
    [20, [job(20, 201, ['self-hosted', 'macOS', 'ARM64', 'studioos-worker-v1'], 20, 110)]],
    [30, [job(30, 301, ['self-hosted', 'Linux', 'X64', 'studioos-worker-v1'], 30, 100)]],
  ]);
  const paths = [];
  const read = (path) => {
    paths.push(path);
    const m = /^repos\/AxalNetwork\/StudioOS\/actions\/runs\/(\d+)\/attempts\/(\d+)(?:\/jobs\?per_page=100&page=(\d+))?$/.exec(path);
    assert.ok(m, 'only fixed read-only paths are requested');
    if (!m[3]) return structuredClone(runs.get(Number(m[1])));
    const all = jobs.get(Number(m[1])); const from = (Number(m[3]) - 1) * 100;
    return { total_count: all.length, jobs: structuredClone(all.slice(from, from + 100)) };
  };
  return { spec, runs, jobs, paths, read, report: () => collectCapacity(read, spec) };
}

test('records exact requested identities separately from observed timing and anonymous assignment; never invents proof or resource figures', () => {
  const f = fixture(); const report = f.report();
  assert.deepEqual([report.requested_candidate_sha, report.requested_executor_sha, report.requested_plan_sha], [SOURCE, EXECUTOR, PLAN]);
  assert.deepEqual(report.attempts.map((r) => [r.logical_shard, r.assignment_profile, r.queue_wait_ms, r.execution_ms]), [
    ['worker-1-of-6', 'standard-hosted', 5000, 110000], ['worker-2-of-6', 'macos-arm64', 5000, 90000], ['worker-3-of-6', 'linux-x64', 5000, 70000],
  ]);
  assert.deepEqual(report.metrics, { peak_completed_job_overlap: 3, peak_completed_test_overlap: 3, three_pool_overlap_ms: 70000, known_controller_wait_overlap_ms: 80000, resource_headroom: null, provider_metered_cost: null, controller_availability: null });
  assert.deepEqual(report.controllers, [{ job_id: 102, execution_ms: 80000, declared_wait_ms: 80000, non_wait_execution_ms: 0 }]);
  assert.equal(report.live_capacity_proof, 'not_verified');
  assert.ok(report.logical_results.every((r) => r.authoritative_result === null));
  assert.ok(report.attempts.every((r) => /^runner-[a-f0-9]{16}$/.test(r.runner_ref)));
  assert.doesNotMatch(JSON.stringify(report), /private-node|private group|account@|private step|runner_name|runner_group_name/);
  f.spec.requests.push({ ...f.spec.requests[2], shard: 'worker-4-of-6', job_id: 302 });
  f.jobs.get(30).push({ ...f.jobs.get(30)[0], id: 302, runner_id: 1302 });
  const extended = f.report();
  assert.equal(extended.attempts[3].assignment_profile, 'linux-x64', 'another compatible node needs no per-host report configuration');
  assert.notEqual(extended.attempts[3].runner_ref, extended.attempts[2].runner_ref);
  assert.equal(extended.metrics.peak_completed_job_overlap, 4, 'profile equality does not collapse distinct executing nodes');
});

test('completes paginated jobs with a shared request budget and refuses truncated, failed or conflicting pages', () => {
  const f = fixture(); const original = f.jobs.get(10)[0];
  f.jobs.set(10, [...f.jobs.get(10), ...Array.from({ length: 99 }, (_, i) => ({ ...original, id: 10000 + i }))]);
  const report = f.report(); assert.equal(report.attempts.length, f.spec.requests.length);
  assert.ok(f.paths.some((p) => p.endsWith('page=2')));
  assert.throws(() => collectCapacity(f.read, f.spec, { requestCap: 1 }), /github_request_cap/);
  assert.throws(() => collectCapacity((p) => p.endsWith('page=2') ? { total_count: 101, jobs: [] } : f.read(p), f.spec), /incomplete_job_pages/);
  assert.throws(() => collectCapacity((p) => { if (p.endsWith('page=2')) throw Error('private credential'); return f.read(p); }, f.spec), /github_read_unavailable/);
});

test('measures test-step overlap separately from setup and refuses missing or out-of-job test times', () => {
  const f = fixture();
  f.jobs.get(10)[0].steps[0].completed_at = date(20);
  f.jobs.get(20)[0].steps[0].started_at = date(20);
  f.jobs.get(20)[0].steps[0].completed_at = date(30);
  f.jobs.get(30)[0].steps[0].started_at = date(40);
  f.jobs.get(30)[0].steps[0].completed_at = date(90);
  const setupOnly = f.report();
  assert.deepEqual([setupOnly.metrics.peak_completed_job_overlap, setupOnly.metrics.peak_completed_test_overlap,
    setupOnly.metrics.three_pool_overlap_ms, setupOnly.metrics.known_controller_wait_overlap_ms], [3, 1, 0, 60000]);
  const linux = f.jobs.get(30)[0];
  assert.deepEqual([setupOnly.attempts[2].test_started_at, setupOnly.attempts[2].test_completed_at,
    setupOnly.attempts[2].test_execution_ms], [date(40), date(90), 50000]);
  for (const [start, end] of [[null, date(100)], [date(10), date(100)], [date(30), date(121)], [date(100), date(30)]]) {
    linux.steps[0].started_at = start; linux.steps[0].completed_at = end;
    const unavailable = f.report();
    assert.deepEqual([unavailable.attempts[2].test_started_at, unavailable.attempts[2].test_completed_at,
      unavailable.attempts[2].test_execution_ms, unavailable.metrics.three_pool_overlap_ms], [null, null, null, 0]);
  }
  const noTestOverlap = fixture();
  for (const id of [20, 30]) {
    noTestOverlap.jobs.get(id)[0].steps[0].started_at = date(100);
    noTestOverlap.jobs.get(id)[0].steps[0].completed_at = date(100);
  }
  assert.equal(noTestOverlap.report().metrics.known_controller_wait_overlap_ms, 0);
  const missing = fixture(); const epochJob = missing.jobs.get(30)[0];
  // A missing timestamp must not be coerced to Unix zero by numeric comparisons.
  epochJob.started_at = '1970-01-01T00:00:00Z'; epochJob.completed_at = '1970-01-01T00:00:01Z';
  epochJob.steps[0].started_at = null; epochJob.steps[0].completed_at = epochJob.completed_at;
  assert.equal(missing.report().attempts[2].test_execution_ms, null);
});

test('uses separate reviewed group/capability contracts for Linux and Mac, rejecting malformed or unknown profile contracts', () => {
  const f = fixture();
  f.spec.profile_contracts = {
    'linux-x64': { group_id: 8, capability_label: 'studioos-linux-v1' },
    'macos-arm64': { group_id: 9, capability_label: 'studioos-mac-v1' },
  };
  for (const [id, group, label] of [[20, 9, 'studioos-mac-v1'], [30, 8, 'studioos-linux-v1']]) {
    f.jobs.get(id)[0].runner_group_id = group;
    f.jobs.get(id)[0].labels.splice(3, 1, label);
  }
  assert.deepEqual(f.report().attempts.map((r) => r.assignment_profile), ['standard-hosted', 'macos-arm64', 'linux-x64']);
  f.jobs.get(30)[0].runner_group_id = 7;
  assert.equal(f.report().attempts[2].assignment_profile, null);
  f.jobs.get(30)[0].runner_group_id = 8; f.jobs.get(30)[0].labels.splice(3, 1, 'studioos-worker-v1');
  assert.equal(f.report().attempts[2].assignment_profile, null);
  for (const profile_contracts of [null, [], 1, 'text', { 'standard-hosted': { group_id: 8, capability_label: 'studioos-linux-v1' } },
    { 'linux-x64': { group_id: 0, capability_label: 'studioos-linux-v1' } },
    { 'linux-x64': { group_id: 8, capability_label: 'arbitrary' } },
    { 'linux-x64': { group_id: 8, capability_label: 'studioos-linux-v1', secret: 'private' } }]) {
    assert.throws(() => validateManifest({ ...f.spec, profile_contracts }), /invalid_profile_contracts/);
  }
});

test('queued/offline jobs, wrong scope, missing timing and paid hosted labels never look like measured compatible capacity', () => {
  const f = fixture(); const linux = f.jobs.get(30)[0];
  linux.runner_id = 0; linux.started_at = null; linux.completed_at = null; linux.conclusion = null;
  const queued = f.report(); assert.equal(queued.attempts[2].assignment_profile, null); assert.equal(queued.attempts[2].execution_ms, null);
  assert.equal(queued.metrics.three_pool_overlap_ms, 0);
  linux.runner_id = 1301; linux.runner_group_id = 99;
  assert.equal(f.report().attempts[2].assignment_profile, null);
  f.jobs.get(10)[0].labels = ['ubuntu-8-core'];
  assert.equal(f.report().attempts[0].assignment_profile, null);
  f.jobs.get(10)[0].labels = ['ubuntu-latest']; f.jobs.get(10)[0].created_at = undefined;
  assert.equal(f.report().attempts[0].queue_wait_ms, null);
});

test('duplicate delivery and restart do not double-count a job; a late old success cannot satisfy the newer generation or hide a test failure', () => {
  const f = fixture(); f.spec.requests.push({ ...f.spec.requests[1] });
  assert.equal(f.report().attempts.length, 3);
  assert.deepEqual(f.report(), f.report(), 'read-only restart reproduces the report');
  const newer = { ...f.spec.requests[1], generation: 2, job_id: 202 };
  f.spec.requests.push(newer); f.jobs.get(20).push({ ...f.jobs.get(20)[0], id: 202, conclusion: 'cancelled' });
  assert.equal(f.report().logical_results.find((r) => r.logical_shard === newer.shard).observed_result, 'incomplete');
  f.jobs.get(20)[0].steps[0].conclusion = 'failure';
  assert.equal(f.report().logical_results.find((r) => r.logical_shard === newer.shard).observed_result, 'failure');
});

test('parent cancellation, skipped tests, wrong attempt and changed workflow revision cannot become success', () => {
  const f = fixture(); f.runs.get(10).conclusion = 'cancelled';
  assert.ok(f.report().logical_results.every((r) => r.observed_result === 'cancelled'));
  f.runs.get(10).conclusion = 'success'; f.jobs.get(20)[0].steps[0].conclusion = 'skipped';
  assert.equal(f.report().logical_results[1].observed_result, 'incomplete');
  f.jobs.get(20)[0].run_attempt = 2;
  assert.throws(() => f.report(), /job_identity_mismatch/);
  f.jobs.get(20)[0].run_attempt = 1; f.jobs.get(20)[0].steps[0].conclusion = 'success'; f.runs.get(20).head_sha = SOURCE;
  assert.equal(f.report().logical_results[1].observed_result, 'incomplete');
});

test('unrecorded controller phases and invalid intervals stay unknown; exact interval boundaries are not overlap', () => {
  const f = fixture(); f.spec.controllers[0].wait_steps = null;
  assert.equal(f.report().metrics.known_controller_wait_overlap_ms, null);
  assert.equal(f.report().controllers[0].non_wait_execution_ms, null);
  f.spec.controllers[0].wait_steps = [1]; f.jobs.get(10)[1].steps[0].completed_at = date(121);
  assert.equal(f.report().controllers[0].non_wait_execution_ms, null, 'invalid wait duration cannot become negative overhead');
  assert.equal(f.report().controllers[0].declared_wait_ms, null, 'waits outside the controller job are unavailable evidence');
  f.jobs.get(30)[0].completed_at = date(20);
  assert.equal(f.report().attempts[2].timing_state, 'unavailable');
  assert.equal(f.report().metrics.three_pool_overlap_ms, 0);
  assert.deepEqual(overlapMetrics([{ profile: 'standard-hosted', start: 0, end: 1 }, { profile: 'macos-arm64', start: 1, end: 2 }]), { peak_completed_job_overlap: 1, three_pool_overlap_ms: 0 });
  assert.deepEqual(overlapMetrics([
    { profile: 'standard-hosted', start: 0, end: 5 }, { profile: 'macos-arm64', start: 0, end: 5 },
    { profile: 'linux-x64', start: 0, end: 5 }, { profile: 'linux-x64', start: 4, end: 1 },
  ]), { peak_completed_job_overlap: 3, three_pool_overlap_ms: 5 }, 'an invalid interval cannot subtract actual simultaneous capacity');
});

test('invalid or forged manifest bindings are refused before reads, including private extra fields', () => {
  const f = fixture();
  for (const change of [{ repository: 'other/repo' }, { plan_sha: 'unknown' }, { verified: true }, { parent: { ...f.spec.parent, secret: 'private' } }]) {
    assert.throws(() => validateManifest({ ...f.spec, ...change }));
  }
  assert.throws(() => validateManifest({ ...f.spec, controllers: [f.spec.controllers[0], f.spec.controllers[0]] }), /duplicate_controller_phase/);
  assert.throws(() => validateManifest({ ...f.spec, controllers: [{ job_id: 102, wait_steps: [1, 1] }] }), /duplicate_controller_phase/);
  f.spec.requests.push({ ...f.spec.requests[0], shard: 'worker-6-of-6' });
  assert.throws(() => f.report(), /ambiguous_job_binding/);
  assert.deepEqual(f.paths, []);
});

test('the executable uses only GET and emits no raw private errors or manifest fields', () => {
  const f = fixture(); f.report();
  const map = Object.fromEntries([...f.paths].map((path) => [path, f.read(path)]));
  const dir = mkdtempSync(join(tmpdir(), 'capacity-7888-'));
  try {
    const manifest = join(dir, 'manifest.json'); const data = join(dir, 'responses.json');
    writeFileSync(manifest, JSON.stringify(f.spec)); writeFileSync(data, JSON.stringify(map));
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
import {readFileSync} from 'node:fs';
const [verb,path,flag,method] = process.argv.slice(2);
if(verb!=='api'||flag!=='--method'||method!=='GET') { process.stderr.write('private error@example.invalid'); process.exit(3); }
const data=JSON.parse(readFileSync(process.env.CAPACITY_TEST_FIXTURE,'utf8'));
if(!data[path]) process.exit(4);
console.log(JSON.stringify(data[path]));
`, { mode: 0o700 });
    const script = fileURLToPath(new URL('../../scripts/ci/runners/verify-capacity.mjs', import.meta.url));
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CAPACITY_TEST_FIXTURE: data };
    const result = spawnSync(process.execPath, [script, '--manifest', manifest], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).live_capacity_proof, 'not_verified');
    writeFileSync(manifest, JSON.stringify({ ...f.spec, parent: { ...f.spec.parent, credential: 'private error@example.invalid' } }));
    const refused = spawnSync(process.execPath, [script, '--manifest', manifest], { env, encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.doesNotMatch(refused.stdout + refused.stderr, /private error@/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
