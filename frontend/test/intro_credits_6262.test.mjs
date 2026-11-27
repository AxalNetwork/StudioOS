/** #6262: spendable credit states gate Accept without blocking Decline or inventing balances. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import InvestorNetworkWorkspace from '../src/pages/investor/InvestorNetworkWorkspace.jsx';
import { counterpartAnswer, introCreditView } from '../src/pages/investor/introCreditModel.js';

const props = [{ uid: 'intro-6262', status: 'pending', target: { name: 'Synthetic Person' }, counterpart_status: 'accepted' }];
const node = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
const press = (v, id) => act(async () => v.props(node(v, id)).onClick());
function stub(read) {
  const calls = []; const replacements = { partnerRelationships: async () => [], partnerSummary: async () => ({}), introPropositions: read,
    listIntroductions: async () => ({ introductions: [] }), partnerReminders: async () => ({ items: [] }),
    introAccept: async (uid) => { calls.push(['accept', uid]); return { credits: { balance: 0 } }; },
    introDecline: async (uid) => { calls.push(['decline', uid]); return { credits: { balance: 0 } }; } };
  const original = Object.fromEntries(Object.keys(replacements).map((key) => [key, api[key]])); Object.assign(api, replacements);
  return { calls, restore() { Object.assign(api, original); } };
}
const mount = () => mountContracts(React.createElement(InvestorNetworkWorkspace, { embedded: true, zone: 'introductions' }), '/network/introductions', { id: 7, role: 'investor' });

test('spendable means balance, never monthly allowance, totals or an inferred zero', () => {
  assert.equal(introCreditView({ balance: 1, monthly_allowance: 0, purchased_total: 500 }).canAccept, true);
  assert.equal(introCreditView({ balance: 0, monthly_allowance: 99 }).canAccept, false);
  assert.match(introCreditView({ balance: 0 }).label, /^0 credits available$/);
  for (const credits of [null, {}, { balance: null }, { balance: -1 }, { balance: '2' }, { balance: NaN }]) {
    const view = introCreditView(credits); assert.equal(view.canAccept, false); assert.equal(view.label, 'Could not be read'); assert.doesNotMatch(view.reason, /You have 0/);
  }
  assert.equal(introCreditView({ balance: 9 }, { unreadable: true }).label, 'Could not be read');
  assert.equal(introCreditView({ balance: 9 }, { loading: true }).canAccept, false);
  assert.deepEqual(['accepted', 'declined', 'pending', 'expired', null].map(counterpartAnswer), ['Agreed', 'Declined', 'Not answered', 'Not answered (expired)', 'Not recorded']);
});

test('the zone shows spendable credits, pending cost and counterpart answer; accepting refreshes the balance', async () => {
  const s = stub(async () => ({ propositions: props, credits: { balance: 1 } })); const view = await mount();
  try {
    await view.flush(); assert.match(view.text(), /1 credit available/); assert.match(view.text(), /Accepting uses 1 credit/); assert.match(view.text(), /Other side: Agreed/);
    assert.equal(view.props(node(view, 'button-accept-intro-intro-6262')).disabled, false);
    await press(view, 'button-accept-intro-intro-6262');
    assert.deepEqual(s.calls, [['accept', 'intro-6262']]); assert.match(view.text(), /0 credits available/);
    assert.equal(Boolean(node(view, 'button-accept-intro-intro-6262')), false);
  } finally { await view.unmount(); s.restore(); }
});

test('zero and unknown balances disable and guard Accept, while Decline still works', async () => {
  for (const credits of [{ balance: 0 }, null]) {
    const s = stub(async () => ({ propositions: props, credits })); const view = await mount();
    try {
      await view.flush(); assert.equal(view.props(node(view, 'button-accept-intro-intro-6262')).disabled, true);
      assert.match(view.text(), credits ? /Insufficient credits/ : /Could not be read/);
      await press(view, 'button-accept-intro-intro-6262'); assert.deepEqual(s.calls, []);
      assert.equal(view.props(node(view, 'button-decline-intro-intro-6262')).disabled, false);
      await press(view, 'button-decline-intro-intro-6262'); assert.deepEqual(s.calls, [['decline', 'intro-6262']]);
    } finally { await view.unmount(); s.restore(); }
  }
});

test('a failed refresh does not reuse a stale credit balance and leaves cached propositions declinable', async () => {
  let fail = false; const s = stub(async () => { if (fail) throw new Error('synthetic read failure'); return { propositions: props, credits: { balance: 8 } }; });
  const view = await mount();
  try {
    await view.flush(); fail = true; await press(view, 'intro-credit-retry'); await view.flush();
    assert.match(view.text(), /Could not be read/); assert.doesNotMatch(view.text(), /8 credits available/);
    assert.equal(view.props(node(view, 'button-accept-intro-intro-6262')).disabled, true);
    assert.equal(view.props(node(view, 'button-decline-intro-intro-6262')).disabled, false);
    await press(view, 'button-decline-intro-intro-6262');
    assert.deepEqual(s.calls, [['decline', 'intro-6262']]);
  } finally { await view.unmount(); s.restore(); }
});
