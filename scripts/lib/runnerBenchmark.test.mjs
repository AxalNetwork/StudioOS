// D5611: measurement fixtures, unavailable evidence and lane-gate regressions.
//
// D5611: hand-computed measurements and unavailable evidence; no live Actions runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkStages, summarise, benchmarkLanes, secretJobs } from './runnerBenchmark.mjs';
import { collect } from '../runner-benchmark-report.mjs';
import { partsOf } from '../test-drift-parts.mjs';
import { readFileSync } from 'node:fs';
const price = { paid: { usdPerMinute: 0.02, url: 'https://example.test/pricing', asOf: '2026-11-12' } };
const job = (over = {}) => ({ lane: 'paid', name: 'suite', created_at: '2026-11-12T00:00:00Z', started_at: '2026-11-12T00:01:30Z', completed_at: '2026-11-12T00:02:36Z', conclusion: 'success', ...over });
test('wall includes wait; cost rounds every job up, not the sum down', () => {
  const [r] = summarise([job(), job({ started_at: '2026-11-12T00:03:00Z', completed_at: '2026-11-12T00:04:06Z' })], price);
  assert.equal(r.wallMin, 4.1); assert.equal(r.billedMinutes, 4); assert.equal(r.costUsd, 0.08);
  assert.deepEqual(r.wait.suite, { p50: { n: 2, value: 1.5 }, p90: { n: 2, value: 3 } });
  assert.equal(r.runtimeMin, 2.2); assert.equal(r.success, true); assert.deepEqual(r.price, price.paid);
});
test('failed timed jobs still cost money; incomplete, invalid and unpriced evidence stays unavailable', () => {
  assert.equal(summarise([job({ conclusion: 'failure' })], price)[0].costUsd, 0.04);
  assert.equal(summarise([job({ conclusion: 'failure' })], price)[0].success, false);
  for (const bad of [{ completed_at: null }, { started_at: '2026-11-11T23:59:00Z' }, { conclusion: 'skipped' }]) {
    const [r] = summarise([job(bad)], price); assert.equal(r.complete, false); assert.equal(r.wallMin, null); assert.equal(r.costUsd, null);
  }
  assert.equal(summarise([job()], {})[0].costUsd, null); assert.deepEqual(summarise([], price), []);
  assert.throws(() => summarise([job({ lane: '../bad' })]), /invalid/);
  assert.throws(() => summarise([job()], { paid: { ...price.paid, usdPerMinute: -1 } }), /provenance/);
});
test('paid benchmarks need both explicit lane readiness and verified spending cap', () => {
  const free = [{ lane: 'free', runner: 'ubuntu-latest' }];
  assert.deepEqual(benchmarkLanes(), free);
  assert.deepEqual(benchmarkLanes({ github8Ready: 'true', ephemeralReady: 'true' }), free);
  assert.deepEqual(benchmarkLanes({ spendingCapVerified: 'false', ephemeralReady: 'true' }), free);
  assert.deepEqual(benchmarkLanes({ spendingCapVerified: 'true', ephemeralReady: 'true' }), [...free, { lane: 'ephemeral', runner: 'warp-ubuntu-latest-x64-4x' }]);
  assert.equal(benchmarkLanes({ spendingCapVerified: 'true', github8Ready: 'true' })[1].runner, 'studioos-bench-linux-8');
  assert.deepEqual(benchmarkLanes({ spendingCapVerified: 'true', github8Ready: 'yes' }), free);
});
test('report reads one attempt with complete derived part coverage and refuses non-benchmark metadata', () => {
  const run = { event: 'push', path: '.github/workflows/runner-benchmark.yml', head_branch: 'bench/runners-free-1', head_sha: 'a'.repeat(40), run_attempt: 2 };
  const parts = partsOf(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).scripts);
  const requests = [];
  const read = path => { requests.push(path); return path.includes('/jobs?') ? { jobs: parts.map(p => job({ lane: 'free', name: `benchmark/free/${p.name}` })) } : run; };
  const r = collect(read, 'AxalNetwork/StudioOS', 123);
  assert.equal(r.lanes[0].coverageComplete, true); assert.equal(r.lanes[0].comparable, true); assert.equal(r.lanes[0].costUsd, 0);
  assert.equal(requests[1], 'repos/AxalNetwork/StudioOS/actions/runs/123/attempts/2/jobs?per_page=100&page=1');
  assert.equal(collect(path => path.includes('/jobs?') ? { jobs: [] } : run, 'AxalNetwork/StudioOS', 123).lanes.length, 0);
  for (const change of [{ event: 'pull_request' }, { head_branch: 'main' }, { path: '.github/workflows/ci.yml' }]) assert.throws(() => collect(() => ({ ...run, ...change }), 'AxalNetwork/StudioOS', 123), /not a branch-only/);
  assert.throws(() => collect(read, 'AxalNetwork/StudioOS', '123;bad'), /numeric/);
});
test('secret inventory names static and computed secret references without exempting other credentials', () => {
  assert.deepEqual(secretJobs("jobs:\n  paid:\n    runs-on: ubuntu-latest\n    env:\n      KEY: ${{ secrets.API_KEY }}\n      TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"), [{ id: 'paid', runner: 'ubuntu-latest', secrets: ['API_KEY'], unknown: false }]);
  assert.equal(secretJobs("jobs:\n  unknown:\n    runs-on: ubuntu-latest\n    env:\n      KEY: ${{ secrets[key] }}\n")[0].unknown, true);
});

test('report paginates and distinguishes missing suite coverage', () => {
  const run = { event: 'push', path: '.github/workflows/runner-benchmark.yml', head_branch: 'bench/runners-free-2', head_sha: 'b'.repeat(40), run_attempt: 1 };
  const paths = [];
  const result = collect(path => {
    paths.push(path);
    if (!path.includes('/jobs?')) return run;
    if (path.endsWith('page=1')) return { jobs: Array.from({ length: 100 }, () => ({ name: 'plan' })) };
    return { jobs: [job({ name: 'benchmark/free/rest', lane: 'free' })] };
  }, 'AxalNetwork/StudioOS', 456);
  assert.equal(paths.length, 3); assert.match(paths[2], /page=2$/);
  assert.equal(result.lanes[0].coverageComplete, false); assert.equal(result.lanes[0].comparable, false);
});

test('global and unknown secret expressions conservatively apply to jobs', () => {
  const source = "env:\n  KEY: ${{ secrets.API_KEY }}\njobs:\n  job:\n    runs-on: ubuntu-latest\n";
  assert.deepEqual(secretJobs(source)[0].secrets, ['API_KEY']);
  assert.equal(secretJobs("jobs:\n  job:\n    runs-on: ubuntu-latest\n    env:\n      KEY: ${{ secrets [ key ] }}\n")[0].unknown, true);
});

const trial = { repository: 'AxalNetwork/StudioOS', event: 'push', ref: 'refs/heads/bench/runners-codebuild-1',
  spendingCapVerified: 'true', codebuildReady: 'true', runId: '43728854751', attempt: '2' };

test('AWS selects one fixed project and the specific Actions attempt on three isolated trial refs', () => {
  for (const n of [1, 2, 3]) {
    const options = { ...trial, ref: 'refs/heads/bench/runners-codebuild-' + n, github8Ready: 'true', ephemeralReady: 'true' };
    assert.deepEqual(benchmarkLanes(options), [{ lane: 'codebuild', runner: 'codebuild-studioos-queue-suite-43728854751-2' }]);
  }
  assert.equal(benchmarkLanes({ ...trial, attempt: '3' })[0].runner, 'codebuild-studioos-queue-suite-43728854751-3');
  for (const override of [{ event: 'pull_request' }, { repository: 'other/StudioOS' }, { spendingCapVerified: 'false' },
    { codebuildReady: undefined }, { runId: '12/other' }, { attempt: '0' }]) {
    assert.throws(() => benchmarkLanes({ ...trial, ...override }), /CodeBuild trial requires/);
  }
  for (const ref of ['refs/heads/bench/runners-free-1', 'refs/heads/bench/runners-codebuild-4', 'refs/heads/main', 'refs/pull/1/merge']) {
    assert.deepEqual(benchmarkLanes({ ...trial, ref }), [{ lane: 'free', runner: 'ubuntu-latest' }]);
  }
});

test('AWS report separates GitHub timings from provider cost, isolates the complete gate span and retains old reports', () => {
  const run = { event: 'push', path: '.github/workflows/runner-benchmark.yml', head_branch: 'bench/runners-codebuild-1',
    head_sha: 'c'.repeat(40), run_attempt: 1 };
  const parts = partsOf(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).scripts);
  const suite = parts.map((p, i) => job({ name: 'benchmark/codebuild/' + p.name,
    runner_id: 375 + i, labels: ['codebuild-studioos-queue-suite-123-1'] }));
  const planner = job({ name: 'plan', started_at: '2026-11-12T00:00:15Z', completed_at: '2026-11-12T00:00:25Z' });
  const gate = job({ name: 'benchmark gate', created_at: '2026-11-12T00:02:37Z',
    started_at: '2026-11-12T00:03:07Z', completed_at: '2026-11-12T00:03:15Z' });
  const report = jobs => collect(path => path.includes('/jobs?') ? { jobs } : run, 'AxalNetwork/StudioOS', 123);
  const result = report([planner, ...suite, gate]);
  assert.equal(result.lanes[0].lane, 'codebuild');
  assert.equal(result.lanes[0].runtimeMin.toFixed(1), (1.1 * parts.length).toFixed(1));
  assert.equal(result.lanes[0].billedMinutes, null);
  assert.equal(result.lanes[0].costUsd, null);
  assert.equal(result.lanes[0].price, null);
  assert.equal(result.lanes[0].githubRunnerAssignmentVerified, true);
  assert.equal(result.lanes[0].awsComputeType, null);
  // Even a supplied rate cannot make GitHub timestamps authoritative AWS build billing.
  assert.equal(summarise([job({ lane: 'codebuild' })], { codebuild: price.paid })[0].costUsd, null);
  assert.equal(result.stages.planner.waitMin, 0.25);
  assert.equal(result.stages.gate.waitMin, 0.5);
  assert.equal(result.stages.gate.completedAt, gate.completed_at);
  assert.equal(result.stages.plannerToGateMin, 3.25);
  assert.equal(result.candidateComparable, true);
  for (const change of [{ runner_id: 0 }, { runner_id: undefined }, { labels: ['ubuntu-latest'] },
    { labels: ['codebuild-studioos-queue-suite-123-2'] }, { labels: ['codebuild-studioos-queue-suite-456-1'] }, { labels: null }]) {
    const wrongAssignment = report([planner, { ...suite[0], ...change }, ...suite.slice(1), gate]);
    assert.equal(wrongAssignment.lanes[0].githubRunnerAssignmentVerified, false);
    assert.equal(wrongAssignment.lanes[0].comparable, false);
    assert.equal(wrongAssignment.candidateComparable, false);
  }
  assert.equal(report([planner, ...suite, { ...gate, conclusion: 'failure' }]).candidateComparable, false);
  const old = report([planner, ...suite]);
  assert.equal(old.lanes[0].comparable, true);
  assert.equal(old.stages.gate, null);
  assert.equal(old.stages.plannerToGateMin, null);
  assert.equal(old.candidateComparable, false);
  assert.equal(report([planner, ...suite, ...suite.map(j => ({ ...j, name: j.name.replace('/codebuild/', '/free/') })), gate]).candidateComparable, false);
  assert.equal(benchmarkStages([planner, planner, gate]).plannerToGateMin, null);
});
