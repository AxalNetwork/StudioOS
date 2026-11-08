// #4622 (Studio audit 4/5): the investor Studio's two record reads are independent. The real hook is mounted
// with deferred responses; a probe component exposes what the page would draw from it.
//   · both reads start together and each lands when it settles, not when the other has;
//   · one source failing keeps the other's answer on the page, and a retry asks again only for the failed one;
//   · a calendar that answered incompletely is retried too (it has no entry in `failures`);
//   · a read a newer one has superseded is dropped;
//   · an admin previewing reads nothing and is withheld.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { h, mountForm } from './_form_d695.mjs';
import { useInvestorSources } from '../src/pages/investor/useInvestorSources.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function setup(props = {}) {
  const calls = { portfolio: [], events: [] };
  const client = {
    positionsAnalytics: () => { const d = deferred(); calls.portfolio.push(d); return d.promise; },
    listCalendarEvents: () => { const d = deferred(); calls.events.push(d); return d.promise; },
  };
  const seen = { current: null };
  const Probe = (p) => { seen.current = useInvestorSources({ client, ...p }); return null; };
  return { calls, seen, mount: () => mountForm(h(Probe, props)) };
}
const settle = async (m) => { await m.flush(); await m.flush(); };
const act2 = async (m, fn) => { await act(async () => { fn(); }); await settle(m); };

test('both reads start together, and each is on the page the moment it settles', async () => {
  const t = setup();
  const m = await t.mount(); await settle(m);
  assert.equal(t.calls.portfolio.length, 1); assert.equal(t.calls.events.length, 1, 'both asked before either answered');
  assert.deepEqual(t.seen.current.records, { portfolio: undefined, events: undefined });
  await act2(m, () => t.calls.portfolio[0].resolve({ total: 3 }));
  assert.deepEqual(t.seen.current.records, { portfolio: { total: 3 }, events: undefined }, 'the portfolio is drawn while the calendar is still loading');
  await act2(m, () => t.calls.events[0].resolve([{ id: 1 }]));
  assert.deepEqual(t.seen.current.records.events, [{ id: 1 }]);
  await m.unmount();
});

test('a failed source keeps the other\'s answer, and retry asks again only for the failed one', async () => {
  const t = setup();
  const m = await t.mount(); await settle(m);
  await act2(m, () => t.calls.portfolio[0].resolve({ total: 3 }));
  await act2(m, () => t.calls.events[0].reject(new Error('calendar down')));
  assert.equal(t.seen.current.failures.events, 'calendar down');
  assert.deepEqual(t.seen.current.records.portfolio, { total: 3 }, 'a failed calendar did not blank the portfolio');
  assert.equal(t.seen.current.failures.portfolio, undefined);
  await act2(m, () => t.seen.current.retryFailed());
  assert.equal(t.calls.portfolio.length, 1, 'the portfolio was not asked again');
  assert.equal(t.calls.events.length, 2, 'the calendar was');
  assert.equal(t.seen.current.failures.events, undefined, 'the retry clears the failure while it loads');
  assert.equal(t.seen.current.records.events, undefined);
  assert.deepEqual(t.seen.current.records.portfolio, { total: 3 });
  await act2(m, () => t.calls.events[1].resolve([]));
  assert.deepEqual(t.seen.current.records.events, []);
  await m.unmount();
});

test('a calendar that answered incompletely is retried too, and nothing else is', async () => {
  const t = setup();
  const m = await t.mount(); await settle(m);
  await act2(m, () => { t.calls.portfolio[0].resolve({}); t.calls.events[0].resolve({ sources: [{ ok: false }] }); });
  assert.deepEqual(t.seen.current.failures, {}, 'a partial answer is not a failure');
  await act2(m, () => t.seen.current.retryFailed(false));
  assert.deepEqual([t.calls.portfolio.length, t.calls.events.length], [1, 1], 'nothing failed, so nothing is asked');
  await act2(m, () => t.seen.current.retryFailed(true));
  assert.deepEqual([t.calls.portfolio.length, t.calls.events.length], [1, 2], 'a partial calendar is asked again, the portfolio is not');
  await m.unmount();
});

test('a read that a newer one has superseded is dropped', async () => {
  const t = setup();
  const m = await t.mount(); await settle(m);
  await act2(m, () => t.seen.current.read('portfolio'));
  assert.equal(t.calls.portfolio.length, 2);
  await act2(m, () => t.calls.portfolio[1].resolve({ total: 'new' }));
  await act2(m, () => t.calls.portfolio[0].resolve({ total: 'old' }));
  assert.deepEqual(t.seen.current.records.portfolio, { total: 'new' }, 'the older answer did not overwrite the newer one');
  await m.unmount();
});

test('an admin previewing reads nothing, and is withheld; refresh asks for both again', async () => {
  const t = setup({ previewing: true });
  const m = await t.mount(); await settle(m);
  assert.deepEqual([t.calls.portfolio.length, t.calls.events.length], [0, 0]);
  assert.deepEqual(t.seen.current.records, { portfolio: null, events: null });
  await m.unmount();
  const live = setup();
  const m2 = await live.mount(); await settle(m2);
  await act2(m2, () => live.seen.current.readAll());
  assert.deepEqual([live.calls.portfolio.length, live.calls.events.length], [2, 2], 'refresh asks again for both');
  await m2.unmount();
});
