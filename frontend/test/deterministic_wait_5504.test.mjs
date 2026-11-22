/** D5504 (#5504): waits observe the result even with a frozen Date clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { waitUntil } from './_waitUntil.mjs';

test('a delayed result is observed without assuming a number of turns', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2034-12-31T23:59:59Z') });
  let visible = false;
  const show = setImmediate().then(() => { visible = true; });
  await waitUntil(() => visible, { label: 'synthetic result' });
  assert.equal(visible, true);
  await show;
});

test('a missing or wrong result fails with its observed state under frozen time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2034-12-31T23:59:59Z') });
  await assert.rejects(waitUntil(() => false, { timeoutMs: 1, label: 'correct record', describe: () => 'wrong record' }), /correct record: wrong record/);
});

test('an invalid deadline is rejected instead of creating an unbounded wait', async () => {
  for (const timeoutMs of [-1, Infinity, NaN]) await assert.rejects(waitUntil(() => false, { timeoutMs }), /finite nonnegative/);
});
