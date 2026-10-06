import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { introTarget, askKey, createIntroRequests } from '../src/lib/investorIntroRequest.js';
import InvestorIntroRequest from '../src/pages/investor/InvestorIntroRequest.jsx';
import { capitalMetric } from '../src/lib/fundAnalytics.js';

const founder = { other: { id: 42, name: 'Fixture founder', role: 'founder' } };
const target = introTarget(founder);
const render = (props = {}) => renderToStaticMarkup(createElement(InvestorIntroRequest, {
  targets: [target], states: {}, ready: true, asked: new Set(), request: () => {}, ...props,
}));

test('only recorded founder or project targets reach the existing request route', () => {
  assert.deepEqual(target.body, { founder_user_id: 42 });
  assert.equal(target.key, 'founder_user_id:42');
  assert.equal(introTarget({ other: { id: 42, role: 'investor' } }), null);
  assert.equal(introTarget({ other: { id: -1, role: 'founder' } }), null);
  assert.deepEqual(introTarget({ project: { id: 12, name: 'Recorded project' } }).body, { project_id: 12 });
  assert.equal(askKey({ founder_user_id: 42 }), target.key);
});

test('rapid clicks and person/organization copies post once, then stay pending rather than made', async () => {
  let resolve;
  let states = {};
  const posted = [];
  const request = createIntroRequests(body => { posted.push(body); return new Promise(r => { resolve = r; }); }, s => { states = s; });
  const first = request(target);
  await request({ ...target });
  assert.deepEqual(posted, [{ founder_user_id: 42 }]);
  assert.equal(states[target.key].status, 'sending');
  assert.match(render({ states }), /Requesting/);
  assert.match(render({ states }), /disabled/);
  resolve({ ok: true, uid: 'fixture-ask' });
  await first;
  await request(target);
  assert.equal(posted.length, 1);
  assert.equal(states[target.key].status, 'pending');
  const html = render({ states });
  assert.match(html, /Request pending/);
  assert.match(html, /does not record either person/);
  assert.match(html, /disabled/);
});

test('quota refusals preserve the route’s own sentence instead of claiming a request exists', async () => {
  let states;
  const message = 'You have used all 3 introductions for 2026-Q4.';
  const request = createIntroRequests(async () => { throw Object.assign(new Error('generic error'), { data: { error: 'quota_exceeded', message } }); }, s => { states = s; });
  await request(target);
  assert.equal(states[target.key].status, 'refused');
  assert.equal(states[target.key].message, message);
  const html = render({ states });
  assert.match(html, /You have used all 3 introductions for 2026-Q4/);
  assert.doesNotMatch(html, /Request pending/);
});

test('existing pending asks disable a repeat; unreadable asks and absent targets cannot spend quota', () => {
  assert.match(render({ asked: new Set([target.key]) }), /Request pending/);
  assert.match(render({ asked: new Set([target.key]) }), /disabled/);
  assert.match(render({ ready: false }), /Recorded asks must be readable/);
  assert.match(render({ ready: false }), /disabled/);
  assert.match(render({ targets: [] }), /Not recorded: no founder account or project/);
  assert.doesNotMatch(render({ targets: [] }), /<button/);
  assert.match(render({ targets: [target, { key: 'project_id:1', label: 'Other recorded project', body: { project_id: 1 } }] }), /Choose a founder or project/);
});

test('collection display uses receipts, never substitutes called, and separates missing from failed', () => {
  assert.deepEqual(capitalMetric({ called_cents: 10000, collected_cents: 2500 }, 'collected_cents'), { value: 2500, state: 'Recorded', reason: null });
  assert.deepEqual(capitalMetric({ collected_cents: null, called_cents: 10000, capital_reason: 'No receipts' }, 'collected_cents'), { value: null, state: 'Not recorded', reason: 'No receipts' });
  assert.deepEqual(capitalMetric({ capital_state: 'unreadable', collected_cents: 0, capital_reason: 'Read failed' }, 'collected_cents'), { value: null, state: 'Unreadable', reason: 'Read failed' });
  assert.equal(capitalMetric(null, 'collected_cents', 'read failed').state, 'Unreadable');
  assert.equal(capitalMetric({ outstanding_cents: 0 }, 'outstanding_cents').value, 0);
});
