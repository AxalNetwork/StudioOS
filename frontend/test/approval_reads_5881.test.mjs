import test from 'node:test';
import assert from 'node:assert/strict';
import { debounceApprovalSearch, startApprovalRead } from '../src/pages/admin/approvals/approvalReads.js';

test('five rapid search changes commit once after the last key', ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const results = [];
  const search = debounceApprovalSearch(value => results.push(value));
  for (const value of ['a', 'ax', 'axa', 'axal', 'axalv']) {
    search.schedule(value);
    mock.timers.tick(10);
  }
  mock.timers.tick(289);
  assert.deepEqual(results, []);
  mock.timers.tick(1);
  assert.deepEqual(results, ['axalv']);
  search.schedule('stale');
  search.cancel();
  mock.timers.tick(300);
  assert.deepEqual(results, ['axalv']);
});

test('superseded reads abort and their late replies cannot replace the new one', async () => {
  const replies = [];
  const errors = [];
  let settle;
  let signal;
  const cancel = startApprovalRead(s => {
    signal = s;
    return new Promise(resolve => { settle = resolve; });
  }, reply => replies.push(reply), error => errors.push(error));
  await Promise.resolve();
  cancel();
  assert.equal(signal.aborted, true);
  startApprovalRead(() => Promise.resolve('new'), reply => replies.push(reply), error => errors.push(error));
  settle('old');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(replies, ['new']);
  assert.deepEqual(errors, []);
});

test('abort rejections are silent and genuine read failures remain visible', async () => {
  const errors = [];
  const failed = new Error('read failed');
  const reply = () => assert.fail('a rejected request cannot provide a reply');
  startApprovalRead(() => Promise.reject(new DOMException('Cancelled', 'AbortError')), reply, e => errors.push(e));
  startApprovalRead(() => Promise.reject(failed), reply, e => errors.push(e));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [failed]);
});
