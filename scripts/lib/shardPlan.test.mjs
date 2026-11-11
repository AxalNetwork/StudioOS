// D5609: skew, unknown weights, deterministic bytes and coverage failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planParts, assertExactOnce, newestMainArtifact } from './shardPlan.mjs';

test('longest first balances a skewed suite within ten percent of the mean', () => {
  const files = Array.from({ length: 120 }, (_, i) => `test/${String(i).padStart(3, '0')}.test.mjs`);
  const timings = Object.fromEntries(files.map((f, i) => [f, i < 108 ? 1 : (i - 107) * 20]));
  const plan = planParts({ files, timings, parts: 6 });
  const mean = plan.reduce((n, p) => n + p.estimatedMs, 0) / plan.length;
  assert.ok(Math.max(...plan.map((p) => p.estimatedMs)) <= mean * 1.1);
  assertExactOnce(plan, files);
  assert.equal(JSON.stringify(plan), JSON.stringify(planParts({ files: [...files].reverse(), timings, parts: 6 })));
});

test('an unknown file weighs this suite p90, invalid durations are unknown, no artifact gives equal weights', () => {
  const files = Array.from({ length: 10 }, (_, i) => `${i}.test.mjs`);
  const timings = Object.fromEntries(files.slice(0, 9).map((f, i) => [f, i + 1]));
  timings['other-suite.test.ts'] = 9999;
  const [part] = planParts({ files, timings, parts: 1 });
  assert.equal(part.estimatedMs, 45 + 9);
  for (const bad of [0, -1, NaN, Infinity, '2']) {
    assert.equal(planParts({ files: ['a', 'b'], timings: { a: 5, b: bad }, parts: 1 })[0].estimatedMs, 10);
  }
  assert.deepEqual(planParts({ files: ['c', 'b', 'a'], parts: 2 }).map((p) => p.files), [['a', 'c'], ['b']]);
});

test('coverage rejects dropped, repeated, extra and duplicate input files', () => {
  assert.throws(() => assertExactOnce([{ files: ['a'] }], ['a', 'b']), /missing file: b/);
  assert.throws(() => assertExactOnce([{ files: ['a', 'a'] }], ['a']), /repeated file: a/);
  assert.throws(() => assertExactOnce([{ files: ['b'] }], ['a']), /extra file: b/);
  assert.throws(() => planParts({ files: ['a', 'a'], parts: 2 }), /duplicate input/);
  for (const parts of [0, -1, 1.5]) assert.throws(() => planParts({ files: [], parts }), /positive integer/);
});


test('newest main artifact includes merged queue SHAs and excludes newer unmerged PRs', () => {
  const row = (id, sha, branch) => ({ id, name: 'test-deps-sha', expired: false, created_at: `2026-11-11T12:0${id}:00Z`, workflow_run: { head_sha: sha, head_branch: branch } });
  const artifacts = [row(1, 'old', 'main'), row(2, 'merged', 'gh-readonly-queue/main/pr-1'), row(3, 'unmerged', 'feature')];
  assert.equal(newestMainArtifact(artifacts, [{sha:'old'}, {sha:'merged'}]).id, 2);
  assert.equal(newestMainArtifact(artifacts, []), null);
});
