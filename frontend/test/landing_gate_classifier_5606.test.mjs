/** D5606 (#5606): both coexisting aggregate gates must leave leaf failure diagnosis intact. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, infraFingerprint } from '../../scripts/lib/ciClassify.mjs';
import { queueStallState } from '../../scripts/lib/githubAlerts.mjs';

const leaf = 'suite (frontend-1-of-2)';
const failure = (name, step, conclusion = 'failure') => ({
  name, conclusion, steps: [{ name: step, conclusion: 'failure' }],
});
const summaries = () => [
  failure('test:drift (full suite)', 'Every part of test:drift passed'),
  failure('landing gate', 'Required fast checks and full suite passed'),
];
const setup = () => failure(leaf, 'Install age');

test('coexisting failed or timed-out summaries preserve required-shard setup fingerprints', () => {
  for (const conclusion of ['failure', 'timed_out']) {
    const gates = summaries().map(job => ({ ...job, conclusion }));
    assert.equal(infraFingerprint([setup(), ...gates]), 'suite/Install age');
  }
});

test('a deleted ref, actual test failure or required fast-check failure still excludes infrastructure', () => {
  for (const [name, step] of [
    ['suite (worker-4-of-6)', 'Check merge queue ref still exists'],
    ['suite (worker-3-of-6)', 'Run node scripts/test-drift-parts.mjs worker-3-of-6 --plan-file suite-plan.json'],
    ['ci / fast', 'Run drift checker'],
  ]) {
    assert.equal(infraFingerprint([setup(), failure(name, step), ...summaries()]), null, step);
  }
});

test('aggregate failures alone never prove infrastructure or inherited failure', () => {
  assert.equal(infraFingerprint(summaries()), null);
  const result = classify({ pr: summaries(), main: { conclusion: 'failure', jobs: summaries() } });
  assert.equal(result.verdict, 'pr_failure');
  assert.deepEqual(result.prFailed, []);
});

test('inheritance still compares failed leaves against usable main evidence', () => {
  const pr = [setup(), ...summaries()];
  const inherited = classify({ pr, main: { conclusion: 'failure', jobs: [setup()] } });
  assert.equal(inherited.verdict, 'inherited_main_failure');
  assert.deepEqual(inherited.prFailed, [leaf]);
  assert.deepEqual(inherited.shared, [leaf]);
  assert.deepEqual(inherited.own, []);
  const own = classify({ pr, main: { conclusion: 'success', jobs: [] } });
  assert.equal(own.verdict, 'pr_failure');
  assert.deepEqual(own.own, [leaf]);
});

test('two distinct queue heads with the same setup failure remain detectable beside both summaries', () => {
  const run = (head, jobs) => ({
    event: 'merge_group', status: 'completed', conclusion: 'failure', head_sha: head, jobs,
  });
  const first = run('a', [setup(), ...summaries()]);
  const second = run('b', [setup(), ...summaries()]);
  assert.deepEqual(queueStallState([first, second]), { active: true, fingerprint: 'suite/Install age' });
  const testFailure = failure('suite (worker-3-of-6)', 'Run node scripts/test-drift-parts.mjs worker-3-of-6 --plan-file suite-plan.json');
  assert.equal(queueStallState([first, run('c', [testFailure, ...summaries()])]).active, null);
});
