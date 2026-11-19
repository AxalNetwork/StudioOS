/**
 * D5906 (#5906, board DE09) — the deal page's Investment tab: Your commitment
 * (amount, state, firm, who reads the note, Change amount… and Withdraw…
 * where the Worker takes them), Investment route (the three routes, the
 * stored preference marked, none marked when none is recorded), Round (a
 * total and a count, never a name) and Closing status (the primary action
 * follows the step). A commitment that could not be read is never drawn as
 * none.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_investment_tab_5906.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { dealWorkroomApi } from '../src/lib/api/dealWorkroom.js';
import { dealContextApi } from '../src/lib/api/dealContext.js';
import { DealCommitment } from '../src/pages/deal/DealWorkTabs.jsx';
import { closingStatus, commitmentActions, myCommitment, noteRow, routeCard } from '../src/pages/deal/dealWorkModel.js';

const h = React.createElement;
const DEAL = { id: 7, project_id: 3, project_name: 'Venture', minimum_check: 25000, currency: 'USD', status: 'active', target_raise: 1000000 };
const PENDING = { uid: 'c-p', deal_id: 7, company_id: 501, company_name: 'Alder Ventures', amount: 60000, status: 'pending', notes: null, route_preference: 'syndicate', created_at: '2026-11-01T10:00:00Z' };
const CONFIRMED = { ...PENDING, uid: 'c-c', status: 'confirmed' };
const read = (items) => ({ status: 'ready', dealId: 7, items });
const mineOf = (items) => myCommitment(read(items), 'USD', 7);
const stage = (my_stage) => ({ status: 'ready', data: { my_stage } });

/* ------------------------------------------------------------------ the model */

test('commitmentActions: Change amount on a Pending one on an open deal; Withdraw on any live one; nothing unread or absent', () => {
  assert.deepEqual(commitmentActions(DEAL, mineOf([PENDING])), { change: true, withdraw: true });
  assert.deepEqual(commitmentActions(DEAL, mineOf([CONFIRMED])), { change: false, withdraw: true }, 'the Worker refuses a change to a confirmed one');
  assert.deepEqual(commitmentActions({ ...DEAL, status: 'closed' }, mineOf([PENDING])), { change: false, withdraw: true }, 'the withdrawal route takes any deal status');
  assert.deepEqual(commitmentActions(DEAL, mineOf([])), { change: false, withdraw: false });
  assert.deepEqual(commitmentActions(DEAL, myCommitment({ status: 'unreadable', dealId: 7 }, 'USD', 7)), { change: false, withdraw: false });
  assert.deepEqual(commitmentActions(DEAL, myCommitment({ status: 'loading' }, 'USD', 7)), { change: false, withdraw: false });
});

test('noteRow: who reads the note is said with a note and without one', () => {
  const withNote = noteRow(mineOf([{ ...PENDING, notes: 'Subject to IC.' }]));
  assert.deepEqual([withNote.text, withNote.recorded], ['Subject to IC.', true]);
  assert.match(withNote.readers, /^Only you read this note\./);
  const none = noteRow(mineOf([PENDING]));
  assert.deepEqual([none.text, none.recorded], ['No note recorded.', false]);
  assert.match(none.readers, /yours alone/);
});

test('routeCard: the stored preference is marked, none marks none (never Direct), and an unread one draws no route', () => {
  const syn = routeCard(mineOf([PENDING]));
  assert.deepEqual(syn.options.map((o) => [o.key, o.chosen]), [['direct', false], ['syndicate', true], ['fund', false]]);
  assert.equal(syn.line, 'Your preference: Through a syndicate.');
  const none = routeCard(mineOf([{ ...PENDING, route_preference: null }]));
  assert.equal(none.options.length, 3);
  assert.equal(none.options.filter((o) => o.chosen).length, 0, 'no route is chosen for none recorded');
  assert.equal(none.line, 'No preference recorded. No route is selected.');
  const nothing = routeCard(mineOf([]));
  assert.equal(nothing.options.filter((o) => o.chosen).length, 0);
  assert.match(nothing.line, /^No preference recorded\. You can record one when you commit\./);
  const unread = routeCard(myCommitment({ status: 'unreadable', dealId: 7 }, 'USD', 7));
  assert.equal(unread.state, 'unreadable');
  assert.deepEqual(unread.options, [], 'an unread preference is not drawn as three unchosen routes');
  assert.doesNotMatch(unread.line, /No preference recorded/);
});

test('closingStatus: the primary action follows the step; before Terms nothing is offered; an unread stage is not "not started"', () => {
  const at = (s) => closingStatus(stage(s), 7);
  assert.deepEqual([at('Terms').word, at('Terms').action], ['Terms ready', { label: 'Review terms', href: '/deals/7/terms', closing: false }]);
  assert.deepEqual([at('Committed').word, at('Committed').action], ['Committed', { label: 'Review signing', href: '/deals/7/closing', closing: true }]);
  assert.deepEqual([at('Signed').word, at('Signed').action], ['Signed', { label: 'Review funding', href: '/deals/7/closing', closing: true }]);
  assert.deepEqual([at('Funded').word, at('Funded').action], ['Funded', { label: 'View company reports', href: '/portfolio/updates', closing: false }]);
  for (const s of ['Invited', 'Reviewing', 'Diligence', 'IC']) {
    assert.deepEqual([at(s).word, at(s).action], ['Not started', null], s);
    assert.match(at(s).next, new RegExp(`Your step now: ${s}\\.$`), s);
  }
  assert.match(at(null).next, /No step on this deal is recorded for you yet\./);
  assert.deepEqual([at('You passed').word, at('You passed').action], ['Passed', null]);
  assert.deepEqual([at('Passed by the studio').word, at('Passed by the studio').action], ['Closed by the studio', null]);
  assert.deepEqual(closingStatus({ status: 'unreadable' }, 7), { state: 'unreadable' });
  assert.deepEqual(closingStatus({ status: 'loading' }, 7), { state: 'loading' });
});

/* ------------------------------------------------------------------ the tab, drawn */

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
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    async render(el) { await act(async () => { root.render(h(MemoryRouter, null, el)); }); await settle(); },
    by, all, pr,
    text: () => txt(container).replace(/\s+/g, ' ').trim(),
    textOf: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    async unmount() { await act(async () => root.unmount()); restore?.(); },
  };
}

const ROUND = { investors: 3, confirmed_total: 250000, pending_total: 60000, currency: 'USD' };

async function drawn({ commitments, round = async () => ROUND, stageRead = async () => ({ my_stage: 'Committed' }), deal = DEAL }) {
  const saved = [api.dealCommitments, dealWorkroomApi.round, dealContextApi.stage];
  api.dealCommitments = commitments;
  dealWorkroomApi.round = round;
  dealContextApi.stage = stageRead;
  const m = await mount();
  await m.render(h(DealCommitment, { deal, user: { id: 30, role: 'investor' }, onChangeAmount() {}, onShare() {} }));
  return { m, async done() { await m.unmount(); [api.dealCommitments, dealWorkroomApi.round, dealContextApi.stage] = saved; } };
}

test('a Pending commitment: amount, state, firm, the note line, both actions, the route marked, the round as a count, and the closing room as the step\'s action', async () => {
  const { m, done } = await drawn({ commitments: async () => [PENDING] });
  try {
    assert.match(m.textOf('deal-my-commitment'), /^Your commitment Pending \$60,000 Recorded 1 Nov 2026 Firm Held for Alder Ventures\. Note No note recorded\. A note is yours alone/);
    assert.equal(m.textOf('deal-change-amount'), 'Change amount…');
    assert.equal(m.textOf('deal-withdraw'), 'Withdraw…');
    assert.equal(m.pr(m.by('deal-route-syndicate'))['data-chosen'], 'true');
    assert.equal(m.pr(m.by('deal-route-syndicate'))['aria-current'], 'true');
    assert.equal(m.pr(m.by('deal-route-direct'))['data-chosen'], undefined);
    assert.equal(m.pr(m.by('deal-route-fund'))['data-chosen'], undefined);
    assert.match(m.textOf('deal-route'), /Your preference: Through a syndicate\. This is your preference\. The studio sets the route in the closing room\./);
    assert.match(m.textOf('deal-round'), /^Round \$250,000 confirmed of \$1,000,000 \$60,000 more is pending 3 investors have a live commitment Other investors are counted, never named, and their amounts are not shown\.$/);
    assert.match(m.textOf('deal-closing-status'), /^Closing status Committed Next: sign in the closing room once the paper is sent to you\. Review signing/);
    const doors = m.all('deal-closing-door');
    assert.equal(doors.length, 1, 'the closing room is offered once: the step\'s own action');
    assert.equal(m.pr(doors[0]).href, '/deals/7/closing');
  } finally { await done(); }
});

test('a Confirmed commitment offers Withdraw… and no Change amount…', async () => {
  const { m, done } = await drawn({ commitments: async () => [CONFIRMED] });
  try {
    assert.equal(Boolean(m.by('deal-change-amount')), false);
    assert.ok(m.by('deal-withdraw'));
    assert.match(m.textOf('deal-my-commitment'), /Confirmed/);
  } finally { await done(); }
});

test('an unreadable commitment is never drawn as none: no Commit, no "not committed", no route marked as none', async () => {
  const { m, done } = await drawn({ commitments: async () => { throw new Error('boom'); } });
  try {
    assert.match(m.textOf('deal-my-commitment'), /could not be read\. That is not a claim that you have none\./);
    assert.doesNotMatch(m.text(), /You have not committed/);
    assert.equal(Boolean(m.by('deal-commit-open')), false);
    assert.equal(Boolean(m.by('deal-withdraw')), false);
    assert.equal(Boolean(m.by('deal-route-direct')), false, 'no route is drawn from an unread preference');
    assert.doesNotMatch(m.textOf('deal-route'), /No preference recorded/);
    assert.equal(m.pr(m.by('deal-my-route-preference'))['data-state'], 'unreadable');
  } finally { await done(); }
});

test('at Terms the primary action is Review terms, with the closing room beside it; an unread stage says so', async () => {
  const t = await drawn({ commitments: async () => [], stageRead: async () => ({ my_stage: 'Terms' }) });
  try {
    assert.match(t.m.textOf('deal-closing-status'), /^Closing status Terms ready Next: review the terms\./);
    assert.equal(t.m.pr(t.m.by('deal-closing-action')).href, '/deals/7/terms');
    assert.equal(t.m.textOf('deal-closing-action'), 'Review terms');
    assert.equal(t.m.textOf('deal-closing-door'), 'Open the closing room');
    assert.ok(t.m.by('deal-commit-open'), 'no commitment on an open deal: Commit');
  } finally { await t.done(); }
  const u = await drawn({ commitments: async () => [], stageRead: async () => { throw new Error('stage_unreadable'); } });
  try {
    assert.match(u.m.textOf('deal-closing-status'), /could not be read\. That is not a claim that closing has not started\./);
    assert.doesNotMatch(u.m.textOf('deal-closing-status'), /Not started/);
    assert.equal(Boolean(u.m.by('deal-closing-action')), false);
  } finally { await u.done(); }
});
