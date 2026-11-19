/**
 * D6909 part 3 (#6909, PRM22 B/C, PRM18): Record a mark… on a queue row opens that company's mark flow with a line
 * naming the request it answers; the saved mark answers the request (state resolved, the new mark's uid); a failed
 * answer keeps the mark and says so. The investor's mark-history header carries the request's state. Sample data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mark_request_answer_6909.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PortfolioPositionsPage from '../src/pages/PortfolioPositionsPage.jsx';
import InvestorPortfolioPositions from '../src/pages/investor/InvestorPortfolioPositions.jsx';
import { answeringLine, answeredWords, headerChip, queueRows } from '../src/pages/portfolio/markRequestModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ------------------------------------------------------------- the book */

const PROJECT = { id: 1, uid: 'northwind', name: 'Northwind Labs' };
const DETAIL = {
  project: PROJECT,
  rounds: [{ uid: 'r1', round_name: 'Seed', invested_amount: 1500000, ownership_pct: 6.2 }],
  cap_table_snapshot: [],
  marks: [{ uid: 'm1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price', event: 'Priced round' }],
  distributions: [{ uid: 'd1', distribution_date: '2026-05-01', amount: 900000, kind: 'secondary' }],
};
const LIST = { items: [{ project_id: 1, project: PROJECT, total_invested: 1500000, rounds: 1, latest_ownership_pct: 6.2, latest_round: 'Seed' }] };
const STORED_MARK = {
  id: 41, uid: 'mk-7f3a', fund_id: null, project_id: 1, as_of_date: '2026-09-30', fmv: 2100000, post_money: null,
  event: 'Down round', basis: 'gp_estimate', source: 'Q3 board pack', note: null, created_by: 1, created_at: '2026-11-14T14:44:09.120Z',
};

/** The Worker: `detail` answers each company read in turn (the last repeats); `post` answers the write. */
function worker({ details = [DETAIL], post = () => json(STORED_MARK, 201), role = 'admin', extra = null } = {}) {
  let read = 0;
  return ({ path, method, body }) => {
    if (path === '/api/auth/me') return json({ id: 1, role, name: 'Ada' });
    if (method === 'GET' && path === '/api/positions') return json(LIST);
    if (method === 'GET' && path === '/api/positions/northwind') {
      const d = details[Math.min(read, details.length - 1)];
      read += 1;
      return typeof d === 'function' ? d() : json(d);
    }
    if (method === 'POST') return post({ path, body });
    if (extra) { const r = extra({ path, method, body }); if (r) return r; }
    return json({});
  };
}

async function mount(answer, { role = 'admin' } = {}) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, method, body });
    return answer({ path: u.pathname, method, body }) ?? json({});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role, name: 'Ada' }));
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(AuthProvider, null, h(PortfolioPositionsPage, { embedded: true })))));
  await settle();
  const need = (node, what) => { if (!node) throw new Error(`no ${what}`); return node; };
  const fire = async (fn) => { await act(async () => { fn(); }); await settle(); };
  const api = {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    has: (id) => Boolean(byTestId(id)),
    node: byTestId,
    prop: (id, name) => props(need(byTestId(id), id))[name],
    text: (id) => (id ? (byTestId(id) ? squash(textOf(byTestId(id))) : null) : squash(textOf(box))),
    step: (kind) => props(need(byTestId(`write-flow-${kind}`), 'flow'))['data-step'],
    click: (id) => fire(() => props(need(byTestId(id), id)).onClick({ preventDefault() {}, stopPropagation() {} })),
    clickText: (label) => fire(() => props(need(nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label), label)).onClick({ preventDefault() {} })),
    type: (id, value) => fire(() => props(need(byTestId(id), id)).onChange({ target: { value } })),
    submit: (id) => fire(() => props(need(byTestId(id), id)).onSubmit({ preventDefault() {} })),
    value: (id) => props(need(byTestId(id), id)).value,
    closeSheet: () => fire(() => props(need(byTestId('portfolio-position-sheet-close'), 'the sheet’s close')).onClick()),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; localStorage.removeItem('user'); restore(); },
  };
  return api;
}

const OPEN = {
  uid: 'rq-1', project_uid: 'northwind', project_name: 'Northwind Labs', kind: 'mark', reason: 'Latest mark is 7 months old.',
  state: 'open', created_at: '2026-11-03T10:00:00Z', requester: { name: '[Sample Investor]' }, evidence: null,
};
const queueAnd = (patch) => ({ path, method }) => {
  if (method === 'GET' && path === '/api/mark-requests/queue') return json({ items: [OPEN] });
  if (method === 'GET' && path === '/api/mark-requests') return json({ items: [OPEN] });
  if (method === 'PATCH' && path === '/api/mark-requests/rq-1') return patch();
  return null;
};

async function recordFromQueue(page) {
  await page.click('button-queue-record-rq-1');
  await page.type('input-mark-as_of_date', '2026-09-30');
  await page.type('input-mark-fmv', '2,100,000');
  await page.submit('form-mark');
  await page.click('write-flow-continue');
  await page.click('write-flow-confirm');
}

test('model: the answering line, the receipt words for each outcome, and the header chip for each state', () => {
  const [row] = queueRows([OPEN], '2026-11-17');
  assert.match(answeringLine(row), /^Answers the request from \[Sample Investor\] · Record a current mark · requested 3 Nov 2026$/);
  assert.equal(answeringLine(null), null);
  assert.match(answeredWords('answered', row), /answered with this mark/);
  assert.match(answeredWords('failed', row), /mark is saved, but the request .* was not answered/);
  assert.equal(answeredWords(null, row), null, 'nothing is said before the answer is tried');
  assert.equal(answeredWords('answered', null), null, 'a flow opened outside the queue says nothing about a request');
  const req = headerChip(OPEN);
  assert.deepEqual([req.glyph, req.tone, req.label], ['◷', 'is-pending', 'Requested · 3 Nov 2026']);
  const ok = headerChip({ ...OPEN, state: 'resolved', resolved_at: '2026-11-15T09:00:00Z', resolved_mark_uid: 'mk-7f3a' });
  assert.deepEqual([ok.glyph, ok.tone, ok.label], ['✓', 'is-ok', 'Answered · mark recorded · 15 Nov 2026']);
  const no = headerChip({ ...OPEN, state: 'declined', resolved_at: '2026-11-15T09:00:00Z', resolution_note: 'June is the closing price.' });
  assert.deepEqual([no.glyph, no.tone, no.label, no.note], ['✕', 'is-none', 'Declined · 15 Nov 2026', 'June is the closing price.']);
  assert.equal(headerChip(null), null);
});

test('Record a mark… opens the mark flow with the request line, and the saved mark answers that request', async () => {
  const page = await mount(worker({ extra: queueAnd(() => json({ ...OPEN, state: 'resolved', resolved_mark_uid: 'mk-7f3a' })) }));
  try {
    await page.click('button-queue-record-rq-1');
    assert.equal(page.step('mark'), 'prepare', 'the flow is open without a second click');
    assert.match(page.text('write-flow-context'), /Answers the request from .+ · Record a current mark · requested 3 Nov 2026/);
    await page.type('input-mark-as_of_date', '2026-09-30');
    await page.type('input-mark-fmv', '2,100,000');
    await page.submit('form-mark');
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    assert.equal(page.step('mark'), 'receipt');
    const patch = page.calls.filter((c) => c.method === 'PATCH');
    assert.equal(patch.length, 1);
    assert.equal(patch[0].path, '/api/mark-requests/rq-1');
    assert.deepEqual(patch[0].body, { state: 'resolved', mark_uid: 'mk-7f3a', note: null });
    const post = page.calls.findIndex((c) => c.method === 'POST');
    assert.ok(post >= 0 && post < page.calls.findIndex((c) => c.method === 'PATCH'), 'the mark is written before the request is answered');
    assert.match(page.text('write-flow-receipt-note'), /answered with this mark/);
  } finally { await page.close(); }
});

test('a failed answer keeps the saved mark and says the request is still open', async () => {
  const page = await mount(worker({ extra: queueAnd(() => json({ detail: 'nope' }, 500)) }));
  try {
    await recordFromQueue(page);
    assert.equal(page.step('mark'), 'receipt', 'the mark is saved whatever the answer did');
    assert.equal(page.text('receipt-uid'), 'mk-7f3a');
    assert.match(page.text('write-flow-receipt-note'), /mark is saved, but the request .* was not answered/);
  } finally { await page.close(); }
});

test('a mark recorded from the sheet itself answers no request and shows no request line', async () => {
  const page = await mount(worker({ extra: queueAnd(() => json({})) }));
  try {
    await page.clickText('View dilution');
    await page.click('button-mark-open');
    assert.equal(page.has('write-flow-context'), false);
    await page.type('input-mark-as_of_date', '2026-09-30');
    await page.type('input-mark-fmv', '2,100,000');
    await page.submit('form-mark');
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    assert.equal(page.step('mark'), 'receipt');
    assert.equal(page.calls.filter((c) => c.method === 'PATCH').length, 0);
    assert.equal(page.has('write-flow-receipt-note'), false);
  } finally { await page.close(); }
});

test('after a queue record, opening the flow from the sheet forgets the request', async () => {
  const page = await mount(worker({ extra: queueAnd(() => json({})) }));
  try {
    await page.click('button-queue-record-rq-1');
    assert.equal(page.has('write-flow-context'), true);
    await page.clickText('Cancel');
    assert.equal(page.has('write-flow-mark'), false, 'Cancel closed the flow');
    await page.click('button-mark-open');
    assert.equal(page.step('mark'), 'prepare');
    assert.equal(page.has('write-flow-context'), false);
  } finally { await page.close(); }
});

/* ------------------------------------------- the investor's mark-history header (PRM18) */

const POSITIONS = { items: [{ project_id: 2, project: { uid: 'northwind', name: 'Northwind Labs', stage: 'seed' }, total_invested: 1500000, latest_ownership_pct: 6.2, fmv: 2400000, multiple: 1.6, unmarked: false, mark_as_of: '2026-03-31', mark_basis: 'round_price' }] };
const HISTORY = { project: { uid: 'northwind', name: 'Northwind Labs' }, marks: [{ uid: 'mk-1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price' }], rounds: [], distributions: [] };

async function investorChip(requests) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/positions') return json(POSITIONS);
    if (path === '/api/positions/northwind') return json(HISTORY);
    if (path === '/api/mark-requests') return requests;
    return json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const byTestId = (id) => walk(box).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(InvestorPortfolioPositions))));
    await settle();
    await act(async () => { props(byTestId('button-mark-history-2')).onClick({ preventDefault() {}, stopPropagation() {} }); });
    await settle();
    assert.ok(byTestId('mark-drawer-body'), 'the mark history opened');
    const chip = byTestId('mark-drawer-request-chip');
    const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
    return chip ? { text: textOf(chip).replace(/\s+/g, ' ').trim(), className: props(chip).className, title: props(chip).title } : null;
  } finally { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); }
}

test('PRM18: the mark-history header shows the request as Requested, Answered or Declined, with a glyph, and nothing when unread', async () => {
  const open = await investorChip(json({ items: [OPEN] }));
  assert.equal(open.text, '◷ Requested · 3 Nov 2026');
  assert.match(open.className, /is-pending/);
  const answered = await investorChip(json({ items: [{ ...OPEN, state: 'resolved', resolved_at: '2026-11-15T09:00:00Z', resolved_mark_uid: 'mk-1' }] }));
  assert.equal(answered.text, '✓ Answered · mark recorded · 15 Nov 2026');
  const declined = await investorChip(json({ items: [{ ...OPEN, state: 'declined', resolved_at: '2026-11-15T09:00:00Z', resolution_note: 'June is the closing price.' }] }));
  assert.equal(declined.text, '✕ Declined · 15 Nov 2026');
  assert.equal(declined.title, 'June is the closing price.');
  assert.equal(await investorChip(json({ detail: 'down' }, 500)), null, 'an unread request list draws no chip');
  assert.equal(await investorChip(json({ items: [] })), null, 'no request, no chip');
});
