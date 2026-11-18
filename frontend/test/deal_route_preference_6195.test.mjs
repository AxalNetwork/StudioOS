/**
 * D6195 (#6195): an investor's route preference. Recorded in the commit dialog and
 * changed while Pending; Terms and Commitment show it with the owner's sentence; none
 * recorded reads "No preference recorded", never Direct; Choose the route shows it to
 * the Admin as a preference only and never preselects a route from it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_route_preference_6195.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { CommitModal } from '../src/pages/DealRoomPage.jsx';
import { DealCommitment } from '../src/pages/deal/DealWorkTabs.jsx';
import { ROUTE_NONE, ROUTE_NOTE, myCommitment, preferenceLine, routePreferenceWord, termsPreference } from '../src/pages/deal/dealWorkModel.js';
import { preferenceSentence } from '../src/pages/closing/deskModel.js';

const h = React.createElement;
const DEAL = { id: 7, project_name: 'Venture', minimum_check: 25000, currency: 'USD', status: 'active' };
const PENDING = { uid: 'c-p', deal_id: 7, amount: 60000, status: 'pending', notes: null, route_preference: 'fund', created_at: '2026-11-01T10:00:00Z' };
const INVESTOR = { id: 30, role: 'investor', branch: { code: 'ldn' } };
const read = (items) => ({ status: 'ready', dealId: 7, items });

async function mount() {
  const restore = installDocument();
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const store = new Map();
  globalThis.localStorage = globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  const buttonText = (re) => walk(container).find((n) => n.tagName === 'BUTTON' && re.test(txt(n)));
  return {
    async render(el) { await act(async () => { root.render(h(MemoryRouter, null, el)); }); await settle(); },
    by, pr, settle,
    text: () => txt(container).replace(/\s+/g, ' ').trim(),
    value: (id) => pr(need(id)).value,
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await settle(); },
    async press(re) { const b = buttonText(re); if (!b) throw new Error(`No button ${re}`); await act(async () => { pr(b).onClick?.(); }); await settle(); },
    async click(id) { await act(async () => { pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore?.(); },
  };
}

test('the words: the owner\'s sentence, the three preferences, and none recorded never read as Direct', () => {
  assert.equal(ROUTE_NOTE, 'This is your preference. The studio sets the route in the closing room.');
  assert.deepEqual(['direct', 'syndicate', 'fund'].map(routePreferenceWord), ['Direct', 'Through a syndicate', 'Through a fund']);
  for (const none of [null, undefined, '', 'axal_fund']) assert.equal(preferenceLine(none), ROUTE_NONE, String(none));
  assert.equal(ROUTE_NONE, 'No preference recorded');
  assert.equal(myCommitment(read([PENDING]), 'USD', 7).preference, 'fund');
  assert.equal(myCommitment(read([{ ...PENDING, route_preference: null }]), 'USD', 7).preference, null);
  assert.equal(myCommitment(read([{ ...PENDING, route_preference: 'spv' }]), 'USD', 7).preference, null, 'an unknown value is not shown as a preference');
});

test('Terms reads loading, unreadable, none and a preference each in its own words', () => {
  assert.equal(termsPreference({ state: 'loading' }).state, 'loading');
  const unreadable = termsPreference({ state: 'unreadable' });
  assert.match(unreadable.line, /could not be read[\s\S]*not a claim that you have none/);
  assert.equal(termsPreference({ state: 'none' }).line, 'No preference recorded. You can record one when you commit.');
  assert.deepEqual(termsPreference(myCommitment(read([PENDING]), 'USD', 7)), { state: 'ready', key: 'fund', line: 'Through a fund' });
  assert.deepEqual(termsPreference(myCommitment(read([{ ...PENDING, route_preference: null }]), 'USD', 7)), { state: 'ready', key: null, line: ROUTE_NONE });
});

test('the commit dialog records a preference; none sends null; a change starts from the stored one', async () => {
  const saved = api.createCommitment;
  const sent = [];
  api.createCommitment = async (_id, body) => { sent.push(body); return { ok: true }; };
  const m = await mount();
  try {
    await m.render(h(CommitModal, { deal: DEAL, user: INVESTOR, onClose() {}, onDone() {} }));
    assert.equal(m.pr(m.by('commit-route-none')).checked, true, 'a new commitment starts with no preference, not Direct');
    assert.equal(m.pr(m.by('commit-route-direct')).checked, false);
    assert.match(m.text(), /This is your preference\. The studio sets the route in the closing room\./);
    await act(async () => { m.pr(m.by('commit-route-syndicate')).onChange(); }); await m.settle();
    await m.press(/Confirm Commitment/);
    assert.deepEqual(sent, [{ amount: 25000, notes: null, route_preference: 'syndicate' }]);
    await m.render(h(CommitModal, { key: 'change', deal: DEAL, user: INVESTOR, current: PENDING, onClose() {}, onDone() {} }));
    assert.equal(m.pr(m.by('commit-route-fund')).checked, true, 'Change starts from the stored preference');
    await act(async () => { m.pr(m.by('commit-route-none')).onChange(); }); await m.settle();
    await m.press(/Save the change/);
    assert.deepEqual(sent[1], { amount: 60000, notes: null, route_preference: null }, 'choosing none clears it');
  } finally { await m.unmount(); api.createCommitment = saved; }
});

test('the Commitment tab says the preference with the owner\'s sentence, and none as none', async () => {
  const saved = api.dealCommitments;
  const m = await mount();
  try {
    api.dealCommitments = async () => [PENDING];
    await m.render(h(DealCommitment, { deal: DEAL, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }));
    assert.match(m.text(), /How you would like to invest Through a fund This is your preference\. The studio sets the route in the closing room\./);
    api.dealCommitments = async () => [{ ...PENDING, route_preference: null }];
    await m.render(h(DealCommitment, { key: 'none', deal: DEAL, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }));
    assert.match(m.text(), /How you would like to invest No preference recorded/);
    assert.doesNotMatch(m.text(), /How you would like to invest Direct/);
  } finally { await m.unmount(); api.dealCommitments = saved; }
});

test('Choose the route: the investor\'s preference is said as a preference, and never preselects the route', () => {
  assert.equal(preferenceSentence({ commitment_id: 1, route_preference: 'syndicate' }), "The investor's preference: Through a syndicate. A preference only; the route is the one you set.");
  assert.equal(preferenceSentence({ commitment_id: 1, route_preference: null }), 'The investor recorded no route preference.');
  assert.equal(preferenceSentence({ commitment_id: null, prospect_id: 4 }), null, 'a prospect line has no commitment to read');
  const dialog = readFileSync(new URL('../src/pages/closing/ClosingDialogs.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /const \[route, setRoute\] = useState\(line\.route \|\| ''\);/, 'the route starts from the line, not the preference');
  assert.match(dialog, /data-testid="closing-route-preference">\{preferenceSentence\(line\)\}/);
});
