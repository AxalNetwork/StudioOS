import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as m from '../../scripts/lib/ciScorecard.mjs';

const at = n => `2026-11-11T00:${String(n).padStart(2, '0')}:00Z`;
const job = (name, start, end, conclusion = 'success', step = 'Run tests') => ({
  name, created_at: at(0), started_at: at(start), completed_at: at(end), conclusion,
  steps: [{ name: step, conclusion }],
});
const run = (event, sha, jobs, options = {}) => ({
  event, path: '.github/workflows/ci.yml', head_sha: sha, jobs, name: 'CI', status: 'completed',
  head_branch: 'main', created_at: at(0), updated_at: at(8), conclusion: 'success', ...options,
});
const prs = [
  { number: 42, mergedAt: at(10), entries: [{ start: at(1), end: at(10) }] },
  { number: 43, mergedAt: null, entries: [{ start: at(4), end: at(12) }] },
];
const runs = [
  run('merge_group', 'a', [job('suite', 3, 8)], { head_branch: 'gh-readonly-queue/main/pr-42-a', created_at: at(1) }),
  run('push', 'a', [job('suite', 7, 9)]),
  run('push', 'b', []),
  run('pull_request', 'c', [job('frontend', 1, 3)]),
  run('pull_request', 'd', [], { conclusion: 'cancelled' }),
];

test('nearest rank, time distributions and queue-to-merge include sample sizes', () => {
  assert.deepEqual(m.percentile([6, 2, 4, 8], 50), { value: 4, n: 4 });
  assert.deepEqual(m.percentile([6, 2, 4, 8], 90), { value: 8, n: 4 });
  assert.deepEqual(m.prFeedback(runs).p50, { value: 8, n: 1 });
  assert.deepEqual(m.runnerWait(runs).suite.p90, { value: 7, n: 2 });
  assert.deepEqual(m.queueToMerge(prs).p50, { value: 9, n: 1 });
  assert.deepEqual(m.runsPerQueuedPr(runs, prs), { value: 0.5, n: 2 });
});

test('queue overlap counts once and concurrency includes jobs from other events', () => {
  const start = Date.parse(at(0)), now = Date.parse(at(13));
  assert.deepEqual(m.queueStalledMinutes(runs, prs, start, now), { value: 6, n: 2, jobs: 1 });
  assert.deepEqual(m.peakConcurrentJobs(runs, start, now), { value: 2, n: 3 });
  assert.deepEqual(m.pushesWithoutQueueRun(runs), { value: 1, n: 2 });
  assert.deepEqual(m.cancelledShare(runs), { value: 0.2, n: 5 });
  assert.deepEqual(m.runnerMinPerMergedPr(runs, prs), {
    value: 9, n: 1, jobs: 3, breakdown: { 'CI / merge_group': 5, 'CI / pull_request': 2, 'CI / push': 2 },
  });
  assert.equal(m.queueStalledMinutes([...runs, run('merge_group', 'missing', undefined)], prs, start, now).value, null);
});

test('failure classes distinguish infra, later success, inherited, PR-specific, and unknown jobs', () => {
  const red = name => job(name, 1, 2, 'failure');
  const results = m.failureClasses([
    run('push', 'base', [red('shared')], { conclusion: 'failure' }),
    run('pull_request', 'p', [red('shared'), red('own'), red('flaky'), job('infra', 1, 2, 'failure', 'Install age')],
      { created_at: at(10), conclusion: 'failure', laterJobs: [job('flaky', 2, 3)] }),
  ]);
  assert.deepEqual(results, { n: 5, counts: { pr: 1, inherited: 1, unknown: 1, infra: 1, flaky: 1 } });
});

test('empty report has eleven unavailable metrics and excludes untrusted job names', () => {
  const output = m.report({ runs: [], prs: [], start: Date.parse(at(0)), now: Date.parse(at(13)), requests: 0 });
  assert.equal(output.match(/n\/a/g).length, 13);
  assert.deepEqual(m.runnerWait([run('pull_request', 'x', [job('unsafe | <b>', 1, 2)])]), {});
});

test('scorecard workflow uses pinned read permissions and a single issue comment writer', () => {
  const yml = readFileSync(new URL('../../.github/workflows/ci-scorecard.yml', import.meta.url), 'utf8');
  const cli = readFileSync(new URL('../../scripts/ci-scorecard.mjs', import.meta.url), 'utf8');
  assert.match(yml, /^permissions: \{\}$/m);
  assert.match(yml, /    permissions:\n      contents: read\n      actions: read\n      pull-requests: read\n      issues: write\n/);
  assert.doesNotMatch(yml, /workflow_run:/);
  const [before, after] = cli.split('async function publishComment');
  assert.doesNotMatch(before + after.slice(after.indexOf('async function main')), /method: '(?:POST|PATCH|DELETE)'/);
});
