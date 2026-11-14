// D4604 (#4604): Network › Introductions tells a delivered intro from one whose record is still to update, and gives
// each the one recovery step that fits it, on the existing desk. Synthetic people only; the APIs are stubbed.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/intro_delivery_4604.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { relationshipsApi } from '../src/lib/api/relationships.js';
import { mailApi } from '../src/lib/api/mail.js';
import IntroductionsDesk from '../src/pages/relationships/IntroductionsDesk.jsx';
import { DELIVERY_LINE, deliveryOf } from '../src/pages/relationships/relationshipsModel.js';

const h = React.createElement;
const OP = 'a'.repeat(32);
const ASK = {
  uid: 'r1', status: 'accepted', created_at: '2026-11-02 10:00:00', team_key: 'v:1', note: 'Synthetic reason.',
  requester: { id: 4, name: 'Synthetic Asker' }, teammate: { id: 2, name: 'Synthetic Teammate' }, person: { name: 'Synthetic Person', company: 'Example Co' },
  outcome: { value: null, label: 'Not recorded' }, follow_up: null, delivery: null,
};

function stubs(answers) {
  const calls = [];
  const saved = { r: { ...relationshipsApi }, m: { ...mailApi } };
  for (const [k, fn] of Object.entries(answers)) {
    const [group, name] = k.split('.');
    const target = group === 'mail' ? mailApi : relationshipsApi;
    target[name] = async (...a) => { calls.push([k, ...a]); return fn(...a); };
  }
  return { calls, restore: () => { Object.assign(relationshipsApi, saved.r); Object.assign(mailApi, saved.m); } };
}
const by = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
const press = async (m, id) => { const n = by(m, id); assert.ok(n, `missing ${id}`); m.props(n).onClick?.(); await m.flush(); await m.flush(); };

test('the delivery state: only an accepted request has one, and only "not sent" lets the intro be written again', () => {
  // Mutation checked: canWrite true for record_pending → a delivered intro could be composed and sent again.
  assert.deepEqual(deliveryOf(ASK), { state: null, line: null, operationUid: null, canWrite: true });
  assert.equal(deliveryOf({ ...ASK, status: 'made', delivery: { state: 'record_pending', operation_uid: OP } }).state, null);
  for (const state of ['sending', 'unconfirmed', 'record_pending']) {
    const d = deliveryOf({ ...ASK, delivery: { state, operation_uid: OP } });
    assert.deepEqual([d.state, d.line, d.operationUid, d.canWrite], [state, DELIVERY_LINE[state], OP, false], state);
  }
  assert.equal(deliveryOf({ ...ASK, delivery: { state: 'not_sent', operation_uid: OP } }).canWrite, true);
  assert.match(DELIVERY_LINE.record_pending, /^Sent: .*not updated yet\. Updating it sends nothing\.$/, 'delivered and recorded are two facts');
});

test('a delivered intro whose record lags: no Write button, and Update the record reconciles it without sending', async () => {
  // Mutations checked: the Write button left on a record_pending card → it is found; the button calling the send → no reconcile call.
  let received = [{ ...ASK, delivery: { state: 'record_pending', operation_uid: OP } }];
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received, follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': async () => ({}),
    'r.reconcileIntroDelivery': async () => { received = []; return { request: { ...ASK, status: 'made' } }; },
    'mail.send': async () => { throw new Error('no send in this test'); },
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.equal(!!by(m, 'in-write-r1'), false, 'no second composition of a delivered intro');
    assert.equal(m.props(by(m, 'in-delivery-r1'))['data-state'], 'record_pending');
    assert.match(m.text(), /Sent: your mail server took this intro/);
    await press(m, 'in-delivery-r1-reconcile');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'r.reconcileIntroDelivery').map((c) => c.slice(1)), [['r1']]);
    assert.equal(s.calls.filter((c) => c[0] === 'mail.send').length, 0);
    assert.ok(s.calls.filter((c) => c[0] === 'r.introRequests').length >= 2, 'the desk reads again after the reconcile');
  } finally { s.restore(); await m.unmount(); }
});

test('an unconfirmed send takes the teammate\'s word on the desk; a refused one offers Write the intro again', async () => {
  // Mutation checked: the unconfirmed card resolving another operation → the resolve call names the wrong uid.
  let received = [{ ...ASK, delivery: { state: 'unconfirmed', operation_uid: OP } }];
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received, follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': async () => ({}),
    'mail.resolveSend': async () => { received = [{ ...ASK, delivery: { state: 'not_sent', operation_uid: OP } }]; return { operation: { uid: OP, state: 'refused' } }; },
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.equal(!!by(m, 'in-write-r1'), false, 'held back until the teammate says which');
    await press(m, 'in-delivery-r1-unsure-not-arrived');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'mail.resolveSend').map((c) => c.slice(1)), [[OP, 'not_arrived']]);
    assert.ok(by(m, 'in-write-r1'), 'not arrived: the intro can be written again');
    assert.match(m.text(), /The last send of this intro did not go out/);
  } finally { s.restore(); await m.unmount(); }
});
