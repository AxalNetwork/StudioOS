/**
 * D752 (#1891) — the investor's "Show Axal you can fund this": the model, the
 * share sheet, the four doors and "Proof of funds you've shared". Every call is
 * a stub that counts its calls. The accounts carry planted balance fields the
 * Worker never sends, so a leak would show. Ids, names and amounts are invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/proof_of_funds_d752.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { statementSentence, CONSENT_TEMPLATE, CONSENT_VERSION } from '../../cloudflare-worker/src/services/capitalAttestationTerms.ts';
import { api } from '../src/lib/api.js';
import {
  CONNECT_FIRST, EMPTY_LIST, HOLDER_MISSING, NOT_ATTESTABLE_WORDS, ONLY_CHECKING_SAVINGS, REVOKE_CONFIRM, SECTION_TITLE,
  accountChoices, amountError, dollars, fillConsent, newestDealTarget, ownDealTarget, shareBody, showsProof, stateWords,
  statementPreview, todayUtc, viewsWords,
} from '../src/pages/investor/proofOfFundsModel.js';
import { ProofDoor, ProofOfFundsSheet, SharedProofOfFunds, useProofTargets } from '../src/pages/investor/ProofOfFunds.jsx';
import { CommitModal, CommitmentsTab } from '../src/pages/DealRoomPage.jsx';
import { MyCommitment } from '../src/pages/SpinoutLabLpCommitment.jsx';

const h = React.createElement;
const ID_A = 'acc-' + '7f3e' + '91c2';
const ID_B = 'acc-' + '2b0d' + '55aa';
const PLANTED = { available_cents: 123456789, current_cents: 5000012, balance: 1284568 };
const ACCOUNTS = () => ({
  holder_name: 'Own Practice LLC',
  accounts: [
    { id: ID_A, name: 'Operating', kind: 'checking', last_four: '4417', ...PLANTED },
    { id: ID_B, name: null, kind: 'savings', last_four: '0932', ...PLANTED },
    { id: 'acc-t', name: 'Reserve', kind: 'treasury', last_four: '9911', ...PLANTED },
  ],
});
const TARGET = { purpose: 'deal_commitment', target_id: 101, deal_id: 1, fund_id: null, label: 'Venture · deal commitment', max_cents: 30000000, attestable: true, reason: null, active: null };
const READ = (targets = [TARGET], extra = {}) => ({ minimum_cents: 100000, valid_days: 30, consent: { version: CONSENT_VERSION, template: CONSENT_TEMPLATE }, targets, unreadable: [], ...extra });
const INVESTOR = { id: 30, role: 'investor' };
const BRANCH_INVESTOR = { id: 30, role: 'investor', branch: { code: 'ldn' } };

function stubs(over = {}) {
  const calls = [];
  const rec = (name, fn) => (...args) => { calls.push([name, ...args]); return fn(...args); };
  const never = () => new Promise(() => {});
  return {
    calls,
    count: (n) => calls.filter(([k]) => k === n).length,
    api: {
      targets: rec('targets', over.targets || (async () => READ())),
      accounts: rec('accounts', over.accounts || (async () => ACCOUNTS())),
      share: rec('share', over.share || never),
      list: rec('list', over.list || (async () => ({ attestations: [] }))),
      revoke: rec('revoke', over.revoke || (async () => ({ ok: true }))),
    },
    personal: { status: rec('status', over.status || (async () => ({ connected: true }))) },
  };
}

async function mount() {
  const restore = installDocument();
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  let sets = 0;
  const store = new Map();
  const counted = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { sets += 1; store.set(k, String(v)); }, removeItem: (k) => store.delete(k) };
  globalThis.localStorage = counted;
  const prevSession = globalThis.sessionStorage;
  globalThis.sessionStorage = counted;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    async render(el) { await act(async () => { root.render(h(MemoryRouter, null, el)); }); await settle(); },
    by, settle, pr, nodes: () => walk(container),
    text: () => txt(container).replace(/\s+/g, ' ').trim(),
    stringProps: () => walk(container).flatMap((n) => Object.entries(pr(n)).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`)),
    async click(id) { await act(async () => { pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async tick(id, checked = true) {
      const n = need(id);
      const input = n.tagName === 'INPUT' ? n : walk(n).find((x) => x.tagName === 'INPUT');
      await act(async () => { pr(input).onChange({ target: { checked } }); }); await settle();
    },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await settle(); },
    disabled: (id) => !!pr(need(id)).disabled,
    sets: () => sets,
    async unmount() { await act(async () => root.unmount()); restore(); globalThis.sessionStorage = prevSession; },
  };
}

// ─────────────────────────────────────────────────────────── the model

test('model: dollars, and the preview and consent equal the Worker\'s own words', () => {
  assert.equal(dollars(100000), '$1,000');
  assert.equal(dollars(123456700), '$1,234,567');
  assert.equal(dollars(100050), null);
  assert.equal(dollars(null), null);
  for (const accounts_counted of [1, 2]) {
    for (const amount_floor_cents of [100000, 123456700]) {
      const row = { amount_floor_cents, as_of: '2026-10-18', holder_name: 'Own Practice LLC', accounts_counted, consented_at: '2026-10-18 09:00:00' };
      assert.equal(statementPreview({ amount_cents: amount_floor_cents, as_of: '2026-10-18', holder_name: 'Own Practice LLC', accounts_counted, consented_on: '2026-10-18' }), statementSentence(row));
    }
  }
  const words = fillConsent(CONSENT_TEMPLATE, { accounts: 2, amount_cents: 123456700, as_of: '2026-10-18', holder_name: 'Own Practice LLC' });
  assert.ok(!words.includes('{') && words.includes('$1,234,567') && words.includes('Own Practice LLC'));
});

test('model: account choices keep five named fields, drop the planted balances and Treasury', () => {
  const choices = accountChoices(ACCOUNTS());
  assert.equal(choices.length, 2);
  for (const c of choices) assert.deepEqual(Object.keys(c), ['id', 'name', 'kind', 'last_four', 'line']);
  assert.deepEqual(choices.map((c) => c.line), ['Checking ending 4417 · Operating', 'Savings ending 0932']);
  assert.ok(!JSON.stringify(choices).match(/123456789|5000012|1284568/));
});

test('model: the amount, the body, the doors\' targets, the words', () => {
  assert.equal(amountError('1000', TARGET, 100000), '');
  assert.equal(amountError('300000', TARGET, 100000), '');
  for (const bad of ['999', '300001', '1000.50', '', 'abc']) assert.notEqual(amountError(bad, TARGET, 100000), '', bad);
  assert.deepEqual(shareBody({ target: TARGET, amount_cents: 100000, account_ids: [ID_A], consent_version: 'd752-1' }),
    { purpose: 'deal_commitment', target_id: 101, amount_cents: 100000, account_ids: [ID_A], consent: true, consent_version: 'd752-1' });
  const read = READ([TARGET, { ...TARGET, target_id: 103 }, { ...TARGET, purpose: 'lp_application', target_id: 201, deal_id: null }]);
  assert.equal(ownDealTarget(read, { id: 103, investor_user_id: 31 }, INVESTOR), null, 'another investor\'s row, even when a target id matches');
  assert.equal(ownDealTarget(read, { id: 101, investor_user_id: 30 }, INVESTOR)?.target_id, 101);
  assert.equal(newestDealTarget(READ([{ ...TARGET, deal_id: 2, target_id: 99 }, TARGET, { ...TARGET, target_id: 100 }]), 1)?.target_id, 101);
  assert.deepEqual(['active', 'superseded', 'revoked'].map((state) => stateWords({ state })?.word), ['Active', 'Replaced', 'Revoked']);
  assert.equal(stateWords({ state: 'active', expired: true }).word, 'Expired');
  assert.equal(stateWords({ state: 'odd' }), null);
  assert.deepEqual([0, 1, 3, null].map((n) => viewsWords({ admin_view_count: n, last_admin_view_at: '2026-10-19 08:00:00' })),
    ['Not viewed yet', 'Viewed once, last 2026-10-19', 'Viewed 3 times, last 2026-10-19', null]);
  assert.equal(showsProof(INVESTOR), true);
  for (const u of [BRANCH_INVESTOR, { id: 2, role: 'admin' }, { id: 10, role: 'founder' }, { id: 20, role: 'partner' }, null]) assert.equal(showsProof(u), false, JSON.stringify(u));
});

// ─────────────────────────────────────────────────────────── the sheet

const sheet = (s, props = {}) => h(ProofOfFundsSheet, { target: TARGET, consent: READ().consent, minimumCents: 100000, onClose() {}, api: s.api, personal: s.personal, ...props });

test('sheet: not connected says so with the Connectors link and never reads accounts; a failed status read is Unreadable', async () => {
  let s = stubs({ status: async () => ({ connected: false }) });
  let m = await mount();
  try {
    await m.render(sheet(s));
    assert.ok(m.text().includes(CONNECT_FIRST));
    assert.ok(m.stringProps().includes('href=/account/connectors'));
    assert.equal(s.count('accounts'), 0);
  } finally { await m.unmount(); }
  s = stubs({ status: async () => { throw new TypeError('network'); } });
  m = await mount();
  try {
    await m.render(sheet(s));
    assert.ok(m.text().includes('could not be read'));
    assert.equal(s.count('accounts'), 0);
  } finally { await m.unmount(); }
});

test('sheet: connected lists accounts by name and last four, picks none, and holds no id or balance anywhere', async () => {
  const s = stubs();
  const m = await mount();
  try {
    await m.render(sheet(s));
    const t = m.text();
    assert.ok(t.includes('Checking ending 4417') && t.includes('Savings ending 0932') && t.includes(ONLY_CHECKING_SAVINGS));
    assert.ok(!t.includes('Reserve'), 'Treasury is not drawn');
    const boxes = m.nodes().filter((n) => n.tagName === 'INPUT' && m.pr(n).type === 'checkbox');
    assert.ok(boxes.every((b) => !m.pr(b).checked));
    const everything = `${t} ${m.stringProps().join(' ')}`;
    for (const leak of [ID_A, ID_B, '123456789', '1234567', '5000012', '1284568', '50000.12', '128456801']) assert.ok(!everything.includes(leak), leak);
    assert.equal(m.sets(), 0, 'no browser storage written');
    assert.equal(s.count('accounts'), 1);
    assert.ok(s.calls.findIndex(([k]) => k === 'status') < s.calls.findIndex(([k]) => k === 'accounts'), 'status first');
  } finally { await m.unmount(); }
});

test('sheet: the amount starts at the cap and is held to it; the preview follows the ticks; Share needs consent and sends exactly the body', async () => {
  const s = stubs();
  const m = await mount();
  try {
    await m.render(sheet(s));
    assert.equal(m.pr(m.by('proof-amount')).value, '300000');
    await m.tick('proof-account-0');
    await m.tick('proof-account-1');
    assert.equal(m.disabled('proof-share-submit'), true, 'no consent yet');
    const today = todayUtc();
    const row = (n) => ({ amount_floor_cents: 30000000, as_of: today, holder_name: 'Own Practice LLC', accounts_counted: n, consented_at: `${today} 00:00:00` });
    assert.equal(m.text().includes(statementSentence(row(2))), true);
    await m.tick('proof-account-1', false);
    assert.equal(m.text().includes(statementSentence(row(1))), true);
    await m.type('proof-amount', '300001');
    assert.ok(m.by('proof-amount-error'));
    await m.tick('proof-consent');
    assert.equal(m.disabled('proof-share-submit'), true, 'above the cap');
    await m.type('proof-amount', '300000');
    assert.equal(m.disabled('proof-share-submit'), false);
    await m.click('proof-share-submit');
    assert.equal(s.count('share'), 1);
    assert.deepEqual(s.calls.find(([k]) => k === 'share')[1],
      { purpose: 'deal_commitment', target_id: 101, amount_cents: 30000000, account_ids: [ID_A], consent: true, consent_version: 'd752-1' });
  } finally { await m.unmount(); }
});

async function refused(code, message, opts = {}) {
  const s = stubs({ share: async () => { throw Object.assign(new Error(message), { code, status: 409 }); }, ...opts });
  const m = await mount();
  let closed = 0;
  await m.render(sheet(s, { onClose: () => { closed += 1; }, onTargetsChanged: async () => s.api.targets() }));
  await m.tick('proof-account-0');
  await m.tick('proof-consent');
  await m.click('proof-share-submit');
  return { s, m, closed: () => closed };
}

test('sheet: every refusal is printed as the Worker wrote it, and never says it shared', async () => {
  for (const code of ['consent_required', 'consent_outdated', 'balance_below_amount', 'mercury_unreadable', 'purpose_not_allowed', 'account_not_found', 'holder_unreadable']) {
    const message = `Worker sentence for ${code.replace(/_/g, ' ')}. Nothing was shared.`;
    const { m } = await refused(code, message);
    try {
      const banner = m.text();
      assert.ok(banner.includes(message), code);
      assert.ok(!/Shared with Axal/.test(banner), code);
      assert.ok(!/\d/.test(m.by('proof-refusal') ? JSON.stringify(m.text().slice(m.text().indexOf(message), m.text().indexOf(message) + message.length)) : ''), code);
    } finally { await m.unmount(); }
  }
});

test('sheet: per code — the picks stay; outdated words reload and untick; reconnect links Connectors; target_not_found closes', async () => {
  let r = await refused('balance_below_amount', 'Your available balance at Mercury is below that amount. Nothing was shared.');
  try {
    assert.equal(r.m.pr(r.m.by('proof-amount')).value, '300000');
    assert.equal(r.m.pr(r.m.nodes().find((n) => n.tagName === 'INPUT' && r.m.pr(n)['data-testid'] === 'proof-consent')).checked, true);
  } finally { await r.m.unmount(); }
  r = await refused('consent_outdated', 'The words you agreed to have changed. Read them again.', { targets: async () => READ([TARGET], { consent: { version: 'd752-2', template: 'New words {accounts} {amount} {as_of} {holder}.' } }) });
  try {
    assert.equal(r.s.count('targets'), 1);
    assert.equal(r.m.pr(r.m.by('proof-consent')).checked, false);
    assert.ok(r.m.text().includes('New words'));
  } finally { await r.m.unmount(); }
  r = await refused('mercury_reconnect_required', 'Mercury no longer accepts your token. Reconnect it with a Read Only token.');
  try { assert.ok(r.m.text().includes('Connectors › Mercury')); } finally { await r.m.unmount(); }
  r = await refused('target_not_found', 'That is not one of your open commitments.');
  try { assert.deepEqual([r.closed(), r.s.count('targets')], [1, 1]); } finally { await r.m.unmount(); }
});

test('sheet: a 201 draws the Worker\'s statement, not the preview; holder missing keeps Share off; an active statement says it is replaced', async () => {
  const worker = 'At least $300,000 available at Mercury on 2026-10-18, held by Own Practice LLC, across 1 account. Shared by the investor on 2026-10-18 (worker).';
  let shared = 0;
  const s = stubs({ share: async () => ({ ok: true, attestation: { statement: worker, accounts_counted: 1 }, accounts_unreadable: 1 }) });
  let m = await mount();
  try {
    await m.render(sheet(s, { onShared: () => { shared += 1; } }));
    await m.tick('proof-account-0'); await m.tick('proof-account-1'); await m.tick('proof-consent');
    await m.click('proof-share-submit');
    assert.ok(m.text().includes(worker));
    assert.ok(!m.by('proof-preview'));
    assert.ok(m.text().includes('Mercury gave no balance for 1 of the accounts you picked, so the statement counts 1.'));
    assert.equal(shared, 1);
  } finally { await m.unmount(); }
  const noHolder = stubs({ accounts: async () => ({ ...ACCOUNTS(), holder_name: null }) });
  m = await mount();
  try {
    await m.render(sheet(noHolder));
    await m.tick('proof-account-0'); await m.tick('proof-consent');
    assert.ok(m.text().includes(HOLDER_MISSING));
    assert.equal(m.disabled('proof-share-submit'), true);
  } finally { await m.unmount(); }
  m = await mount();
  try {
    await m.render(sheet(stubs(), { target: { ...TARGET, active: { uid: 'x', amount_floor_cents: 100000, as_of: '2026-10-01', expires_on: '2026-10-31', expired: false } } }));
    assert.ok(m.text().includes('You shared one on 2026-10-01. Sharing again replaces it.'));
  } finally { await m.unmount(); }
});

// ─────────────────────────────────────────────────────────── the doors

test('doors: share, shared with Manage, expired with Share a new one, and each not-attestable reason', () => {
  const html = (t) => renderToStaticMarkup(h(MemoryRouter, null, h(ProofDoor, { target: t, onShare() {} })));
  assert.match(html(TARGET), /Show Axal you can fund this/);
  const shared = html({ ...TARGET, active: { uid: 'u', as_of: '2026-10-01', expires_on: '2026-10-31', expired: false } });
  assert.match(shared, /Proof of funds shared · as of 2026-10-01/);
  assert.match(shared, /href="\/spinout-lab\/investor-workspace#proof-of-funds"/);
  assert.match(shared, /data-provider="mercury"[\s\S]*Mercury|Proof of funds/);
  assert.match(html({ ...TARGET, active: { uid: 'u', as_of: '2026-09-01', expires_on: '2026-10-01', expired: true } }), /Proof of funds expired · as of 2026-09-01[\s\S]*Share a new one/);
  for (const [reason, w] of Object.entries(NOT_ATTESTABLE_WORDS)) assert.ok(html({ ...TARGET, attestable: false, reason }).includes(w.text.replace(/'/g, '&#x27;')), reason);
  assert.equal(html(null), '');
});

test('the deal\'s Commitments tab: a door on the investor\'s own row only; no read and no door for anyone else', async () => {
  const saved = api.dealCommitments;
  api.dealCommitments = async () => [{ id: 101, investor_user_id: 30, investor_name: 'Investor', amount: 300000, status: 'pending' }, { id: 103, investor_user_id: 31, investor_name: 'Second', amount: 250000, status: 'pending' }];
  const { mercuryAttestationsApi } = await import('../src/lib/api/mercuryAttestations.js');
  const savedTargets = mercuryAttestationsApi.targets;
  let reads = 0;
  mercuryAttestationsApi.targets = async () => { reads += 1; return READ([TARGET, { ...TARGET, target_id: 103 }]); };
  try {
    let m = await mount();
    try {
      await m.render(h(CommitmentsTab, { dealId: 1, user: INVESTOR, onShare() {} }));
      assert.equal(reads, 1);
      const doors = m.nodes().filter((n) => m.pr(n)['data-testid'] === 'proof-door');
      assert.equal(doors.length, 1, 'one door: the investor\'s own row');
    } finally { await m.unmount(); }
    for (const user of [{ id: 2, role: 'admin' }, { id: 20, role: 'partner' }, { id: 10, role: 'founder' }, BRANCH_INVESTOR]) {
      reads = 0;
      m = await mount();
      try {
        await m.render(h(CommitmentsTab, { dealId: 1, user, onShare() {} }));
        assert.equal(reads, 0, JSON.stringify(user));
        assert.ok(!m.by('proof-door'));
      } finally { await m.unmount(); }
    }
  } finally { api.dealCommitments = saved; mercuryAttestationsApi.targets = savedTargets; }
});

test('CommitModal: the optional last step after the commitment is recorded; Done never asks; a branch closes as today', async () => {
  const saved = api.createCommitment;
  const order = [];
  api.createCommitment = async () => { order.push('commit'); return { ok: true, uid: 'c1' }; };
  try {
    for (const [button, want] of [['commit-done', undefined], ['commit-share', { share: true }]]) {
      const done = [];
      const m = await mount();
      try {
        await m.render(h(CommitModal, { deal: { id: 1, project_name: 'Venture', minimum_check: 1000 }, user: INVESTOR, onClose() {}, onDone: (o) => done.push(o) }));
        const confirm = m.nodes().find((n) => n.tagName === 'BUTTON' && /Confirm Commitment/.test((n.childNodes || []).map((c) => c.nodeValue ?? c.textContent ?? '').join('')));
        await act(async () => { m.pr(confirm).onClick(); }); await m.settle();
        assert.ok(m.text().includes('Commitment recorded.'));
        assert.deepEqual(done, []);
        await m.click(button);
        assert.deepEqual(done, [want], button);
      } finally { await m.unmount(); }
    }
    const done = [];
    const m = await mount();
    try {
      await m.render(h(CommitModal, { deal: { id: 1, project_name: 'Venture', minimum_check: 1000 }, user: BRANCH_INVESTOR, onClose() {}, onDone: (o) => done.push(o) }));
      const confirm = m.nodes().find((n) => n.tagName === 'BUTTON' && /Confirm Commitment/.test((n.childNodes || []).map((c) => c.nodeValue ?? c.textContent ?? '').join('')));
      await act(async () => { m.pr(confirm).onClick(); }); await m.settle();
      assert.deepEqual(done, [undefined], 'straight to onDone on a branch');
      assert.ok(!m.text().includes('Commitment recorded.'));
    } finally { await m.unmount(); }
    assert.ok(order.length >= 3);
  } finally { api.createCommitment = saved; }
});

const PORTAL = {
  lp_holdings: [
    { id: 301, fund_id: 1, fund_name: 'Fund I', commitment_amount: 500000, invested_amount: 0, returns: 0, lpa_signed: 1, status: 'committed' },
    { id: 302, fund_id: 2, fund_name: 'Outside Fund', commitment_amount: 100000, invested_amount: 0, returns: 0, lpa_signed: 1 },
  ],
  performance: [],
  capital_calls_recorded: true,
  capital_calls: [],
  distributions: [],
  funds: {},
};

test('My commitment: a door on the Fund I card that is a target, none on another fund; without proof the HTML is unchanged', () => {
  const render = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(MyCommitment, { portal: PORTAL, failed: false, onReload() {}, ...props })));
  const lpTarget = { ...TARGET, purpose: 'lp_commitment', target_id: 301, deal_id: null, fund_id: 1, label: 'Fund I commitment' };
  const html = render({ proof: { targets: READ([lpTarget]), onShare() {} } });
  const fund1 = html.slice(html.indexOf('data-testid="commitment-fund-1"'), html.indexOf('data-testid="commitment-fund-2"'));
  const fund2 = html.slice(html.indexOf('data-testid="commitment-fund-2"'));
  assert.match(fund1, /Show Axal you can fund this/);
  assert.doesNotMatch(fund2, /Show Axal you can fund this/);
  assert.equal(render({}), render({ proof: null }));
  assert.doesNotMatch(render({}), /proof-door/);
});

test('the hook: no call when not enabled', async () => {
  const s = stubs();
  function Probe({ enabled }) { const t = useProofTargets({ enabled, api: s.api }); return h('span', null, t.status); }
  const m = await mount();
  try {
    await m.render(h(Probe, { enabled: false }));
    assert.equal(s.count('targets'), 0);
    await m.render(h(Probe, { enabled: true }));
    assert.equal(s.count('targets'), 1);
  } finally { await m.unmount(); }
});

// ─────────────────────────────────────────────────────────── the shared section

const DTO = (over) => ({ uid: `u-${Math.random()}`, purpose: 'lp_application', target_id: 201, target_label: 'Fund I application', amount_floor_cents: 25000000,
  as_of: '2026-10-18', expires_on: '2026-11-17', expired: false, holder_name: 'Own Practice LLC', accounts_counted: 2, state: 'active', revoked_at: null,
  admin_view_count: 0, last_admin_view_at: null, statement: 'At least $250,000 available at Mercury on 2026-10-18, held by Own Practice LLC, across 2 accounts. Shared by the investor on 2026-10-18.', ...over });

test('shared: four states with their pills, dates, statements and views; revoked has no Revoke; Keep it calls nothing; Revoke reloads', async () => {
  const rows = [DTO({ uid: 'a1' }), DTO({ uid: 'e1', expired: true, admin_view_count: 1, last_admin_view_at: '2026-10-19 09:00:00' }),
    DTO({ uid: 's1', state: 'superseded', admin_view_count: 3, last_admin_view_at: '2026-10-20 09:00:00' }), DTO({ uid: 'r1', state: 'revoked', revoked_at: '2026-10-21 09:00:00' })];
  let changed = 0;
  const s = stubs({ list: async () => ({ attestations: rows }) });
  const m = await mount();
  try {
    await m.render(h(SharedProofOfFunds, { targetsState: { status: 'ready', read: READ() }, api: s.api, onChanged: () => { changed += 1; } }));
    const t = m.text();
    for (const w of ['Active', 'Expired', 'Replaced', 'Revoked', 'Not viewed yet', 'Viewed once, last 2026-10-19', 'Viewed 3 times, last 2026-10-20', 'You revoked it on 2026-10-21.', 'As of 2026-10-18 · expires 2026-11-17', 'expired 2026-11-17']) assert.ok(t.includes(w), w);
    assert.ok(t.includes(SECTION_TITLE));
    assert.ok(m.by('proof-revoke-ask-0') && m.by('proof-revoke-ask-1') && m.by('proof-revoke-ask-2'));
    assert.ok(!m.by('proof-revoke-ask-3'), 'a revoked row has no Revoke');
    await m.click('proof-revoke-ask-0');
    assert.ok(m.text().includes(REVOKE_CONFIRM));
    await m.click('proof-keep-0');
    assert.equal(s.count('revoke'), 0);
    const lists = s.count('list');
    await m.click('proof-revoke-ask-0');
    await m.click('proof-revoke-0');
    assert.deepEqual(s.calls.filter(([k]) => k === 'revoke'), [['revoke', 'a1']]);
    assert.equal(s.count('list'), lists + 1);
    assert.equal(changed, 1);
  } finally { await m.unmount(); }
});

test('shared: already_revoked is printed; empty, unreadable list and an unreadable purpose each say so', async () => {
  let s = stubs({ list: async () => ({ attestations: [DTO({ uid: 'a1' })] }), revoke: async () => { throw Object.assign(new Error('That statement is already revoked.'), { code: 'already_revoked', status: 409 }); } });
  let m = await mount();
  try {
    await m.render(h(SharedProofOfFunds, { targetsState: { status: 'ready', read: READ() }, api: s.api }));
    await m.click('proof-revoke-ask-0'); await m.click('proof-revoke-0');
    assert.ok(m.text().includes('That statement is already revoked.'));
  } finally { await m.unmount(); }
  s = stubs();
  m = await mount();
  try { await m.render(h(SharedProofOfFunds, { targetsState: { status: 'ready', read: READ() }, api: s.api })); assert.ok(m.text().includes(EMPTY_LIST)); } finally { await m.unmount(); }
  s = stubs({ list: async () => { throw new TypeError('network'); } });
  m = await mount();
  try { await m.render(h(SharedProofOfFunds, { targetsState: { status: 'ready', read: READ() }, api: s.api })); assert.ok(m.text().includes('This is not a claim that you shared none.')); } finally { await m.unmount(); }
  s = stubs();
  m = await mount();
  try {
    await m.render(h(SharedProofOfFunds, { targetsState: { status: 'ready', read: READ([], { unreadable: ['lp_application'] }) }, api: s.api }));
    assert.ok(m.text().includes('Your Fund I application could not be read for proof of funds. This is not a claim that it is not open.'));
  } finally { await m.unmount(); }
});

// ─────────────────────────────────────────────────────────── static rules

const read = (rel) => readFileSync(resolve('frontend/src', rel), 'utf8');

test('static: no balance field, storage or HTML injection; no money path; no fixed widths; the workspace gates every read on showsProof', () => {
  for (const f of ['pages/investor/ProofOfFunds.jsx', 'pages/investor/proofOfFundsModel.js', 'lib/api/mercuryAttestations.js']) {
    const s = read(f);
    for (const bad of ['available_cents', 'current_cents', 'balance:', 'localStorage', 'sessionStorage', 'dangerouslySetInnerHTML']) assert.ok(!s.includes(bad), `${f}: ${bad}`);
  }
  for (const m of read('lib/api/mercuryAttestations.js').matchAll(/request\(`?'?([^'`,)]+)/g)) assert.doesNotMatch(m[1], /send|transfer|pay|payout|wire/i);
  const comp = read('pages/investor/ProofOfFunds.jsx');
  assert.doesNotMatch(comp, /min-w-\[/);
  assert.doesNotMatch(comp, /\bw-\[\d{3}/);
  assert.doesNotMatch(comp, /data-testid=\{`[^`]*\$\{a\.id\}/, 'no account id in a test id');
  const ws = read('pages/SpinoutLabLpWorkspacePage.jsx');
  assert.match(ws, /const proofOn = showsProof\(user\);\s*const proofTargets = useProofTargets\(\{ enabled: proofOn \}\);/);
  assert.match(ws, /\{proofOn && <SharedProofOfFunds/);
  // #1780: every use row's door comes from USE_DOORS, and the attestation row's is still ATTESTATION_DOOR.
  assert.match(read('pages/account/MercurySheet.jsx'), /const door = Object\.hasOwn\(USE_DOORS, u\.key\) \? USE_DOORS\[u\.key\] : null;[^]*<Link className=\{BTN\.link\} to=\{door\.href\}/);
  assert.match(read('pages/account/mercuryModel.js'), /capital_attestation: ATTESTATION_DOOR,/);
});
