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
  const calls = { portfolio: [], events: [], fund: [], notices: [], trust: [], booklet: [] };
  const read = (key) => (...args) => { const d = { ...deferred(), args }; calls[key].push(d); return d.promise; };
  const client = {
    positionsAnalytics: read('portfolio'),
    listCalendarEvents: read('events'),
    fundsLpPortal: read('fund'),
    trustMe: read('trust'),
  };
  const noticesClient = { mine: read('notices') };
  const bookletClient = { mine: read('booklet') };
  const seen = { current: null };
  const Probe = (p) => { seen.current = useInvestorSources({ client, noticesClient, bookletClient, ...p }); return null; };
  return { calls, seen, mount: () => mountForm(h(Probe, props)) };
}
const settle = async (m) => { await m.flush(); await m.flush(); };
const act2 = async (m, fn) => { await act(async () => { fn(); }); await settle(m); };

test('both reads start together, and each is on the page the moment it settles', async () => {
  const t = setup();
  const m = await t.mount(); await settle(m);
  assert.equal(t.calls.portfolio.length, 1); assert.equal(t.calls.events.length, 1, 'both asked before either answered');
  assert.deepEqual(t.calls.fund[0].args, [{ view: 'studio' }]);
  assert.deepEqual(t.seen.current.records, Object.fromEntries(Object.keys(t.calls).map(key => [key, undefined])));
  await act2(m, () => t.calls.portfolio[0].resolve({ total: 3 }));
  assert.deepEqual(t.seen.current.records, { ...Object.fromEntries(Object.keys(t.calls).map(key => [key, undefined])), portfolio: { total: 3 } }, 'the portfolio is drawn while the other sources are still loading');
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
  assert.ok(Object.values(t.calls).every(calls => calls.length === 0));
  assert.deepEqual(t.seen.current.records, Object.fromEntries(Object.keys(t.calls).map(key => [key, null])));
  await m.unmount();
  const live = setup();
  const m2 = await live.mount(); await settle(m2);
  await act2(m2, () => live.seen.current.readAll());
  assert.ok(Object.values(live.calls).every(calls => calls.length === 2), 'refresh asks again for each source');
  await m2.unmount();
});


test('fund and booklet settle independently and only the failed notice is retried', async () => {
  const t = setup();
  const m = await t.mount(); await settle(m);
  assert.ok(Object.values(t.calls).every(calls => calls.length === 1));
  await act2(m, () => {
    t.calls.fund[0].resolve({ lp_holdings: [] });
    t.calls.notices[0].reject(new Error('notices unavailable'));
    t.calls.booklet[0].reject(Object.assign(new Error('not found'), { status: 404 }));
  });
  assert.deepEqual(t.seen.current.records.fund, { lp_holdings: [] });
  assert.equal(t.seen.current.records.booklet, null);
  assert.equal(t.seen.current.records.trust, undefined);
  assert.deepEqual(t.seen.current.failures, { notices: 'notices unavailable' });
  await act2(m, () => t.seen.current.retryFailed());
  for (const [key, calls] of Object.entries(t.calls)) assert.equal(calls.length, key === 'notices' ? 2 : 1);
  await m.unmount();
});
