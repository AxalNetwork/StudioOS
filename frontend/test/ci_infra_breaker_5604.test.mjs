import test from 'node:test';
import assert from 'node:assert/strict';
import { infraFingerprint } from '../../scripts/lib/ciClassify.mjs';
import { queueStallState, transition } from '../../scripts/lib/githubAlerts.mjs';

const job = (name, step) => ({ name, conclusion: 'failure', steps: step ? [{ name: step, conclusion: 'failure' }] : [] });
const run = (id, head, jobs, conclusion = 'failure') => ({
  event: 'merge_group', status: 'completed', head_sha: head, jobs, conclusion, created_at: `2026-11-11T14:00:0${id}Z`,
});
const one = job('suite (frontend-1-of-2)', 'Install age');
const two = job('suite (frontend-2-of-2)', 'Install age');

test('fingerprints safe setup failures and excludes the dependent summary', () => {
  assert.equal(infraFingerprint([one, two, job('test:drift (full suite)', 'Every part passed')]), 'suite/Install age');
  for (const step of ['Run node scripts/test-drift-parts.mjs', 'Install <unsafe>', null]) {
    assert.equal(infraFingerprint([one, job('suite (worker-1-of-6)', step)]), null);
  }
});

test('repeated infrastructure failures open once across distinct queue heads and green clears', () => {
  const first = run(1, 'a', [one]);
  const repeat = run(2, 'b', [two]);
  const state = queueStallState([first, repeat]);
  assert.deepEqual(state, { active: true, fingerprint: 'suite/Install age' });
  assert.equal(transition(state.active, false), 'open');
  assert.notEqual(transition(queueStallState([repeat, run(3, 'c', [one])]).active, true), 'open');
  assert.equal(queueStallState([first, run(2, 'a', [two])]).active, null);
  assert.equal(queueStallState([first, run(2, 'b', [job('suite (frontend-2-of-2)', 'Install node')])]).active, null);
  assert.equal(transition(queueStallState([repeat, run(3, 'c', [], 'success')]).active, true), 'close');
});
