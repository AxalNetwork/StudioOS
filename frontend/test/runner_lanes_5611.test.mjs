// D5611: benchmark event/suite parity and a source audit of secret-bearing CI jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { secretJobs } from '../../scripts/lib/runnerBenchmark.mjs';
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const benchmark = read('.github/workflows/runner-benchmark.yml');
const ci = read('.github/workflows/ci.yml');
const stepsOf = (source, job) => {
  const lines = source.split('\n'), start = lines.indexOf(`  ${job}:`);
  assert.ok(start >= 0);
  const next = lines.findIndex((line, i) => i > start && /^  [A-Za-z][\w-]*:$/.test(line));
  const block = lines.slice(start, next < 0 ? undefined : next), at = block.indexOf('    steps:');
  assert.ok(at >= 0);
  return block.slice(at + 1).filter(line => !line.startsWith('  #')).join('\n').trimEnd();
};
const policy = source => {
  assert.match(source, /on:\n  push:\n    branches: \['bench\/runners-\*\*'\]/);
  assert.equal(source.match(/^on:/gm)?.length, 1);
  const triggers = /^on:\n((?:[ \t].*\n|\n)*)/m.exec(source)?.[1] || '';
  assert.deepEqual([...triggers.matchAll(/^  ([\w-]+):/gm)].map(m => m[1]), ['push']);
  assert.doesNotMatch(source, /secrets\s*[.\[:]/);
  assert.match(source, /permissions:\n  contents: read/);
  assert.doesNotMatch(source, /contents: write|issues: write|actions: write/);
};
test('benchmark runs only on explicit branches, without secrets or elevated token permissions', () => {
  policy(benchmark);
  for (const event of ['pull_request', 'workflow_dispatch', 'workflow_run', 'schedule']) assert.throws(() => policy(benchmark.replace("branches: ['bench/runners-**']", "branches: ['bench/runners-**']\n  " + event + ':')));
  assert.throws(() => policy(benchmark + '\n# ${{ secrets.API_KEY }}\n'));
});
test('benchmark suite steps match merged CI, with the same per-part timeout and dynamic part derivation', () => {
  assert.equal(stepsOf(benchmark, 'benchmark'), stepsOf(ci, 'suite'));
  const planner = stepsOf(benchmark, 'plan');
  assert.ok(planner.startsWith(stepsOf(ci, 'plan')));
  assert.match(planner, /id: matrix/);
  assert.match(benchmark, /matrix: \$\{\{ steps\.matrix\.outputs\.matrix \}\}/);
  assert.match(benchmark, /partsOf\(JSON.parse\(readFileSync\('package.json'/);
  assert.match(benchmark, /timeout-minutes: 40/); assert.match(benchmark, /max-parallel: 27/);
  assert.match(benchmark, /benchmarkLanes\(/); assert.match(benchmark, /SPENDING_CAP_VERIFIED/);
});
test('every CI job reading a non-GITHUB_TOKEN secret stays on ubuntu-latest', t => {
  const audit = source => { const jobs = secretJobs(source); for (const job of jobs) assert.equal(job.runner, 'ubuntu-latest', `${job.id}: non-token secret requires free runner`); return jobs; };
  const jobs = audit(ci); t.diagnostic(JSON.stringify(jobs));
  const fixture = 'jobs:\n  sensitive:\n    runs-on: ubuntu-latest\n    env:\n      KEY: ${{ secrets.API_KEY }}\n';
  assert.equal(audit(fixture).length, 1);
  assert.throws(() => audit(fixture.replace('runs-on: ubuntu-latest', 'runs-on: paid-runner')));
});

test('the benchmark workflow builds the AWS shard labels from native Actions context and keeps the gate on GitHub', () => {
  const planner = stepsOf(benchmark, 'plan');
  assert.match(planner, /CODEBUILD_READY: \$\{\{ vars\.RUNNER_BENCHMARK_CODEBUILD_READY \}\}/);
  const script = planner.split(`node --input-type=module <<'NODE' >> "$GITHUB_OUTPUT"\n`)[1].split('\n          NODE')[0];
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/bench/runners-codebuild-2', GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '3',
      SPENDING_CAP_VERIFIED: 'true', CODEBUILD_READY: 'true' },
  });
  const { include } = JSON.parse(output.trim().replace(/^matrix=/, ''));
  assert.ok(include.length > 0);
  assert.deepEqual([...new Set(include.map(j => [j.lane, j.runner].join('/')))], ['codebuild/codebuild-studioos-queue-suite-1234-3']);
  assert.equal(new Set(include.map(j => j.part)).size, include.length);
  assert.match(benchmark, /gate:\n    name: benchmark gate\n    if: always\(\)\n    needs: \[plan, benchmark\]\n    runs-on: ubuntu-latest/);
  assert.match(stepsOf(benchmark, 'gate'), /test "\$PLAN" = success && test "\$SUITE" = success/);
});
