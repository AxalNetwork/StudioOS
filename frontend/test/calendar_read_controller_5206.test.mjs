/** D5206 (#5206) — only the newest Calendar request may publish. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CalendarReadController, calendarReadResult } from '../src/pages/calendarReadController.js';

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const request = (d) => () => d.promise;
const win = (from) => ({ from, to: `${from}+range` });
const item = (id) => ({ items: [{ id }], sources: [{ kind: 'manual', ok: true }], coverage: { complete: true } });

test('Month A cannot overwrite the newer Week B response', async () => {
  const c = new CalendarReadController();
  const a = deferred(); const b = deferred();
  const pa = c.read({ key: 'mine:month', window: win('month'), request: request(a) });
  const pb = c.read({ key: 'mine:week', window: win('week'), request: request(b) });
  b.resolve(item('week')); await pb;
  assert.equal(c.state.items[0].id, 'week');
  a.resolve(item('month')); await pa;
  assert.equal(c.state.items[0].id, 'week');
  assert.equal(c.state.key, 'mine:week');
});

test('date navigation and scope switches invalidate their older windows', async () => {
  for (const [oldKey, newKey] of [['mine:nov', 'mine:dec'], ['studio:dec', 'all:dec']]) {
    const c = new CalendarReadController();
    const a = deferred(); const b = deferred();
    const pa = c.read({ key: oldKey, window: win(oldKey), request: request(a) });
    const pb = c.read({ key: newKey, window: win(newKey), request: request(b) });
    b.resolve(item(newKey)); await pb;
    a.resolve(item(oldKey)); await pa;
    assert.equal(c.state.key, newKey);
    assert.equal(c.state.items[0].id, newKey);
  }
});

test('Refresh keeps the successful window rendered and owns its own error', async () => {
  const c = new CalendarReadController();
  await c.read({ key: 'mine:week', window: win('week'), request: async () => item('first') });
  const refresh = deferred();
  const pending = c.read({ key: 'mine:week', window: win('week'), request: request(refresh), preserve: true });
  assert.equal(c.state.refreshing, true);
  assert.equal(c.state.items[0].id, 'first');
  refresh.reject(new Error('refresh failed')); await pending;
  assert.equal(c.state.status, 'ready');
  assert.equal(c.state.items[0].id, 'first');
  assert.equal(c.state.error, 'refresh failed');
});

test('Retry supersedes the failed request and an unmount cancels publication', async () => {
  const c = new CalendarReadController();
  await c.read({ key: 'mine:week', window: win('week'), request: async () => { throw new Error('first failed'); } });
  assert.equal(c.state.status, 'unreadable');
  const retry = deferred();
  const pending = c.read({ key: 'mine:week', window: win('week'), request: request(retry), preserve: true });
  retry.resolve(item('retry')); await pending;
  assert.equal(c.state.items[0].id, 'retry');
  const late = deferred();
  const afterUnmount = c.read({ key: 'mine:week', window: win('week'), request: request(late), preserve: true });
  c.cancel();
  late.resolve(item('late')); await afterUnmount;
  assert.equal(c.state.items[0].id, 'retry');
});

test('a provider retry cannot overwrite a newer window and partial coverage is explicit', async () => {
  const c = new CalendarReadController();
  await c.read({ key: 'mine:month', window: win('month'), request: async () => item('month') });
  const provider = deferred();
  const part = c.readPart({
    key: 'mine:month', window: win('month'), request: request(provider),
    optimistic: (state) => state,
    success: (state, result) => ({ ...state, ...calendarReadResult(result) }),
    failure: (state) => state,
  });
  const week = deferred();
  const next = c.read({ key: 'mine:week', window: win('week'), request: request(week) });
  week.resolve(item('week')); await next;
  provider.resolve(item('provider')); await part;
  assert.equal(c.state.items[0].id, 'week');
  assert.equal(calendarReadResult({ items: [], sources: [{ kind: 'google', ok: false }] }).status, 'partial');
  assert.equal(calendarReadResult({ items: [], coverage: { complete: false } }).status, 'partial');
});
