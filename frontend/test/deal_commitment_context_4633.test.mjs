/**
 * D4633 (#4633) — the commitment shown and acted on is the selected firm's,
 * a late answer cannot change the deal on screen, and Ask means one thing.
 *
 * Model tests, then the real DealRoomPage mounted with a fetch the test
 * controls: a two-firm commitment read, and two deals whose reads answer in
 * reverse order.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_commitment_context_4633.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { myCommitment, proposedTerms, roundLines, LEGACY_LINE } from '../src/pages/deal/dealWorkModel.js';
import { keyStrip } from '../src/pages/deal/dealFrameModel.js';
import { roundAsk } from '../src/components/deals/dealMoney.js';
import { studioRow } from '../src/pages/investor/dealflow/studioLensModel.js';
import { dealRow } from '../src/pages/investor/dealflow/dealFlowModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const deal = (id, name) => ({ id, project_id: id + 100, project_name: name, status: 'active', currency: 'USD', target_raise: 1000000, amount: 400000, capital_committed: 250000, minimum_check: 25000 });
const ALDER = { uid: 'c-alder', deal_id: 4, company_id: 501, company_name: 'Alder Ventures', firm_context: 501, in_context: true, legacy: false, amount: 50000, status: 'pending', created_at: '2026-11-04 10:00:00' };
const LEGACY = { uid: 'c-legacy', deal_id: 4, company_id: null, company_name: null, firm_context: 501, in_context: false, legacy: true, amount: 5000, status: 'pending', created_at: '2026-09-01 10:00:00' };

// ------------------------------------------------------------------ the model

test('the commitment is the one in the read\'s firm, named; a legacy row is listed apart; another deal\'s read is not this one', () => {
  const read = { status: 'ready', dealId: 4, items: [LEGACY, ALDER] };
  const c = myCommitment(read, 'USD', 4);
  assert.equal(c.state, 'ready');
  assert.equal(c.uid, 'c-alder', 'never the legacy row, though it is live');
  assert.equal(c.firm, 'Held for Alder Ventures.');
  assert.deepEqual(c.legacy.map((l) => [l.uid, l.note]), [['c-legacy', LEGACY_LINE]]);
  assert.equal(myCommitment({ status: 'ready', dealId: 4, items: [LEGACY] }, 'USD', 4).state, 'none', 'a legacy row alone offers no action');
  assert.equal(myCommitment(read, 'USD', 5).state, 'loading', 'a read for deal 4 is never deal 5\'s commitment');
  assert.equal(myCommitment({ status: 'ready', dealId: 4, items: [{ ...ALDER, company_id: null, company_name: null }] }, 'USD', 4).firm, 'Held in your own name.');
  // The key strip reads the same row.
  const tile = keyStrip(deal(4, 'Harbor'), read, 'investor').find((t) => t.key === 'mine');
  assert.match(String(tile.value), /50,000/);
});

test('Ask is the target, else the legacy amount, on every screen; neither recorded is not 0', () => {
  const d = { id: 9, target_raise: 2000000, amount: 500000, currency: 'USD' };
  assert.equal(roundAsk(d), 2000000);
  assert.equal(roundAsk({ amount: 500000 }), 500000, 'a deal drafted before the target existed');
  assert.equal(roundAsk({ target_raise: '', amount: null }), null);
  assert.equal(studioRow(d).ask, 2000000, 'the Studio lens');
  assert.equal(dealRow(d).ask, 2000000, 'the Deal Flow table');
  assert.match(keyStrip(d, null, 'founder').find((t) => t.key === 'round').value, /2,000,000/);
  assert.match(roundLines({ status: 'ready', data: { investors: 1, confirmed_total: 1000000 } }, d).confirmed, /of \$2,000,000/);
  assert.equal(proposedTerms(d).find((r) => r.label === 'Round size').value, '$2,000,000', 'the proposed terms');
  // Editing the target moves all of them together.
  const edited = { ...d, target_raise: 3000000 };
  assert.deepEqual([studioRow(edited).ask, dealRow(edited).ask, roundAsk(edited)], [3000000, 3000000, 3000000]);
});

// ------------------------------------------------------------------ mounted

async function mounted(url, handler) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push({ line: `${(init?.method || 'GET').toUpperCase()} ${String(u)}`, body: init?.body ? JSON.parse(init.body) : null }); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(INVESTOR));
  let go = null;
  let pickFirm = null;
  const Page = () => { go = useNavigate(); return h(DealRoomPage); };
  const Firm = ({ children }) => {
    const [company, setCompany] = React.useState({ id: 501 });
    pickFirm = setCompany;
    return h(ActiveCompanyContext.Provider, { value: { company, setCompany, companies: [], setCompanies() {} } }, children);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Firm, null,
    h(Routes, null, h(Route, { path: '/deals/:dealId', element: h(Page) }), h(Route, { path: '/deals/:dealId/:tab', element: h(Page) })))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(document.body).filter((n) => props(n)['data-testid'] === id);
  return {
    requests, settle, text: () => text(document.body), has: (id) => byId(id).length > 0, textOf: (id) => text(byId(id)[0]),
    posts: (re) => requests.filter((r) => r.line.startsWith('POST') && re.test(r.line)),
    async navigate(to) { await act(async () => go(to)); await settle(); },
    async firm(id) { await act(async () => pickFirm({ id })); await settle(); },
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

function base(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: null, ic: { state: 'used' } });
    if (/\/commitments/.test(url)) return response([]);
    if (/\/round/.test(url)) return response({ investors: 1, confirmed_total: 250000, pending_total: 0, currency: 'USD' });
    if (/\/networkfx\/syndicates/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(deal(4, 'Harbor Ledger'));
    if (/\/api\/deals\/5(\?|$)/.test(url)) return response(deal(5, 'Quay Robotics'));
    return response({});
  };
}

test('two firms: the card names the firm, the withdrawal targets that firm\'s commitment, and the legacy row has no action', async () => {
  const v = await mounted('/deals/4/commitment', base({ 'deals/4/commitments': (u, m) => (m === 'GET' ? response([LEGACY, ALDER]) : null) }));
  try {
    assert.match(v.textOf('deal-my-firm'), /Held for Alder Ventures\./);
    assert.match(v.textOf('deal-my-amount'), /\$50,000/);
    assert.match(v.textOf('deal-my-legacy'), /\$5,000[\s\S]*Recorded before commitments named a firm/);
    await v.click('deal-withdraw');
    await v.type('deal-withdraw-reason', 'Our allocation closed.');
    await v.click('deal-withdraw-dialog-confirm');
    const sent = v.posts(/withdrawal/);
    assert.equal(sent.length, 1);
    assert.match(sent[0].line, /\/deals\/4\/commitments\/c-alder\/withdrawal$/, 'the displayed firm\'s commitment, never the legacy one');
  } finally { await v.close(); }
});

test('reversed answers: deal 4\'s reads answering after the page moved to deal 5 change nothing on deal 5', async () => {
  const held = [];
  const hold = (body) => new Promise((resolve) => held.push(() => resolve(response(body))));
  const v = await mounted('/deals/4', base({
    '/api/deals/4(\\?|$)': (u, m) => (m === 'GET' ? hold(deal(4, 'Harbor Ledger')) : null),
    'deals/4/commitments': (u, m) => (m === 'GET' ? hold([ALDER]) : null),
  }));
  try {
    assert.ok(!v.text().includes('Harbor Ledger'), 'deal 4 has not answered');
    await v.navigate('/deals/5');
    assert.match(v.text(), /Quay Robotics/);
    // Now deal 4's reads answer, late.
    await act(async () => { for (const r of held.splice(0)) r(); });
    await v.settle();
    assert.match(v.text(), /Quay Robotics/, 'the header is still deal 5');
    assert.ok(!v.text().includes('Harbor Ledger'));
    const before = v.posts(/commitments/).length;
    assert.equal(before, 0, 'no action was sent for either deal');
  } finally { await v.close(); }
});

test('reversed answers on the Commitment tab: deal 4\'s commitment answering on deal 5 is not drawn, and not acted on', async () => {
  const held = [];
  const v = await mounted('/deals/4/commitment', base({
    'deals/4/commitments': (u, m) => (m === 'GET' ? new Promise((resolve) => held.push(() => resolve(response([ALDER])))) : null),
    'deals/5/commitments': (u, m) => (m === 'GET' ? response([]) : null),
  }));
  try {
    await v.navigate('/deals/5/commitment');
    assert.match(v.text(), /Quay Robotics/);
    assert.match(v.textOf('deal-my-commitment'), /You have not committed to this deal\./);
    await act(async () => { for (const r of held.splice(0)) r(); });
    await v.settle();
    assert.match(v.textOf('deal-my-commitment'), /You have not committed to this deal\./, 'deal 4\'s answer did not land on deal 5');
    assert.ok(!v.has('deal-withdraw'), 'no withdrawal is offered for a commitment that is not this deal\'s');
  } finally { await v.close(); }
});

test('a firm switch reads the commitment again, and the earlier firm\'s late answer does not replace it', async () => {
  const BIRCH = { ...ALDER, uid: 'c-birch', company_id: 502, company_name: 'Birch Capital', firm_context: 502, amount: 90000, status: 'confirmed' };
  const held = [];
  let calls = 0;
  const v = await mounted('/deals/4/commitment', base({
    'deals/4/commitments': (u, m) => {
      if (m !== 'GET') return null;
      calls += 1;
      return calls === 1 ? new Promise((resolve) => held.push(() => resolve(response([ALDER])))) : response([BIRCH]);
    },
  }));
  try {
    await v.firm(502);
    assert.match(v.textOf('deal-my-firm'), /Held for Birch Capital\./);
    await act(async () => { for (const r of held.splice(0)) r(); });
    await v.settle();
    assert.match(v.textOf('deal-my-firm'), /Held for Birch Capital\./, 'Alder\'s late answer did not land');
    assert.match(v.textOf('deal-my-amount'), /\$90,000/);
  } finally { await v.close(); }
});
