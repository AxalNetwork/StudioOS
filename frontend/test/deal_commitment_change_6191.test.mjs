/**
 * D6191 (#6191): Change amount starts from the live commitment and keeps its note;
 * the header offers Commit only when it can succeed; refusals read as sentences.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_commitment_change_6191.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { CommitModal } from '../src/pages/DealRoomPage.jsx';
import { DealCommitment } from '../src/pages/deal/DealWorkTabs.jsx';
import { closedReason, commitAction, commitRefusal, myCommitment } from '../src/pages/deal/dealWorkModel.js';

const h = React.createElement;
const DEAL = { id: 7, project_name: 'Venture', minimum_check: 25000, currency: 'USD', status: 'active' };
const PENDING = { uid: 'c-p', deal_id: 7, amount: 60000, status: 'pending', notes: 'Subject to IC on Thursday', created_at: '2026-11-01T10:00:00Z' };
const CONFIRMED = { ...PENDING, uid: 'c-c', status: 'confirmed' };
const read = (items) => ({ status: 'ready', dealId: 7, items });
const INVESTOR = { id: 30, role: 'investor', branch: { code: 'ldn' } }; // a branch investor: Done goes straight to onDone

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

test('commitAction: Commit only on an open deal with no live commitment; Change amount on a Pending one', () => {
  const cur = 'USD';
  assert.deepEqual(commitAction(DEAL, myCommitment(read([]), cur, 7)), { kind: 'commit', reason: null });
  const change = commitAction(DEAL, myCommitment(read([PENDING]), cur, 7));
  assert.equal(change.kind, 'change'); assert.equal(change.row.uid, 'c-p');
  assert.equal(commitAction(DEAL, myCommitment(read([CONFIRMED]), cur, 7)).kind, null, 'a confirmed commitment is not offered a change');
  // A withdrawn one is history, not live: the investor may commit again.
  assert.equal(commitAction(DEAL, myCommitment(read([{ ...PENDING, status: 'withdrawn' }]), cur, 7)).kind, 'commit');
  for (const status of ['closed', 'scored', 'draft', null]) {
    const a = commitAction({ ...DEAL, status }, myCommitment(read([PENDING]), cur, 7));
    assert.equal(a.kind, null, String(status));
    assert.equal(a.reason, closedReason({ ...DEAL, status }));
  }
  assert.match(closedReason({ status: 'closed' }), /its status is closed\./);
  assert.match(closedReason({}), /not recorded/);
  // A read in flight or unreadable offers nothing: the header never guesses.
  assert.deepEqual(commitAction(DEAL, myCommitment({ status: 'loading' }, cur, 7)), { kind: null, reason: null });
  assert.deepEqual(commitAction(DEAL, myCommitment({ status: 'unreadable', dealId: 7 }, cur, 7)), { kind: null, reason: null });
});

test('commitRefusal: every Worker refusal of a commitment reads as a sentence that says nothing was recorded', () => {
  const cases = [
    ['KYC required', /identity verification/],
    ['You must be invited to this deal before committing capital', /invitation to this deal/],
    ['Amount is below the deal minimum', /minimum check is \$25,000/],
    ['Deal is not open for commitments', /no longer open/],
    ['Withdraw the confirmed commitment before replacing it', /Withdraw it before/],
    ['Deal or commitment changed; refresh before retrying', /changed while you were editing/],
  ];
  for (const [message, want] of cases) {
    const said = commitRefusal(new Error(message), DEAL);
    assert.match(said, want, message);
    assert.match(said, /Nothing was recorded\.$/, message);
  }
  assert.equal(commitRefusal(new Error('boom'), DEAL), 'Your commitment could not be recorded. Try again.');
});

test('Change amount opens on the live commitment and saving without touching the note keeps it', async () => {
  const saved = api.createCommitment;
  const sent = [];
  api.createCommitment = async (id, body) => { sent.push([id, body]); return { ok: true, uid: 'c-p' }; };
  const done = [];
  const m = await mount();
  try {
    await m.render(h(CommitModal, { deal: DEAL, user: INVESTOR, current: PENDING, onClose() {}, onDone: (o) => done.push(o) }));
    assert.equal(m.text().includes('Change your commitment'), true);
    assert.equal(m.value('commit-amount'), '60000', 'the current amount, not the deal minimum');
    assert.equal(m.value('commit-notes'), 'Subject to IC on Thursday');
    await m.type('commit-amount', '75000');
    await m.press(/Save the change/);
    assert.deepEqual(sent, [[7, { amount: 75000, notes: 'Subject to IC on Thursday' }]], 'the note is sent back unchanged');
    assert.deepEqual(done, [undefined]);
  } finally { await m.unmount(); api.createCommitment = saved; }
});

test('A new commitment still starts at the minimum with no note', async () => {
  const saved = api.createCommitment;
  const sent = [];
  api.createCommitment = async (id, body) => { sent.push(body); return { ok: true }; };
  const m = await mount();
  try {
    await m.render(h(CommitModal, { deal: DEAL, user: INVESTOR, onClose() {}, onDone() {} }));
    assert.equal(m.text().includes('Commit capital'), true);
    assert.equal(m.value('commit-amount'), 25000);
    assert.equal(m.value('commit-notes'), '');
    await m.press(/Confirm Commitment/);
    assert.deepEqual(sent, [{ amount: 25000, notes: null }]);
  } finally { await m.unmount(); api.createCommitment = saved; }
});

test('A refusal stays in the dialog, in words', async () => {
  const saved = api.createCommitment;
  api.createCommitment = async () => { throw new Error('KYC required'); };
  const done = [];
  const m = await mount();
  try {
    await m.render(h(CommitModal, { deal: DEAL, user: INVESTOR, current: PENDING, onClose() {}, onDone: (o) => done.push(o) }));
    await m.press(/Save the change/);
    assert.match(m.text(), /Finish identity verification \(KYC\) before you commit\. Nothing was recorded\./);
    assert.equal(m.text().includes('KYC required'), false, 'not the raw code');
    assert.deepEqual(done, [], 'the dialog stays open');
  } finally { await m.unmount(); api.createCommitment = saved; }
});

test('Commitment tab: Change amount hands over the live row; a closed deal offers nothing and says why', async () => {
  const saved = api.dealCommitments;
  const savedRound = api.dealRound;
  const opened = [];
  const m = await mount();
  try {
    api.dealCommitments = async () => [PENDING];
    await m.render(h(DealCommitment, { deal: DEAL, user: { id: 30, role: 'investor' }, onChangeAmount: (row) => opened.push(row?.uid ?? null), onShare() {} }));
    await m.click('deal-change-amount');
    assert.deepEqual(opened, ['c-p']);
    await m.render(h(DealCommitment, { key: 'closed', deal: { ...DEAL, status: 'closed' }, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }));
    assert.equal(m.by('deal-change-amount'), undefined);
    assert.match(m.text(), /This deal is not open for commitments: its status is closed\./);
    api.dealCommitments = async () => [];
    await m.render(h(DealCommitment, { key: 'none-closed', deal: { ...DEAL, status: 'closed' }, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }));
    assert.equal(m.by('deal-commit-open'), undefined);
    assert.ok(m.by('deal-commit-closed'));
    await m.render(h(DealCommitment, { key: 'none-open', deal: DEAL, user: { id: 30, role: 'investor' }, onChangeAmount: (row) => opened.push(row), onShare() {} }));
    await m.click('deal-commit-open');
    assert.deepEqual(opened, ['c-p', null], 'a new commitment starts from nothing');
  } finally { await m.unmount(); api.dealCommitments = saved; api.dealRound = savedRound; }
});
