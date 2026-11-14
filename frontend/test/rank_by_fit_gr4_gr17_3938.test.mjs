// #3938 part 9 (D1478): the two Rank by fit buttons part 8 left for want of a
// page — GR4 on Grow › Talent (a posting's applicants) and GR17 on the Grow
// cycle's Partner network (the venture's partners against a need).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rank_by_fit_gr4_gr17_3938.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import FounderGrowTalent, { rankPosting } from '../src/pages/founder/FounderGrowTalent.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

test('GR4: the posting ranked is the role picked, or the only one; never a draft, never "All" across roles', () => {
  // Mutation checked: the draft check dropped → a draft role offers the press.
  const live = { id: 7, title: 'Backend engineer', status: 'published' };
  const draft = { id: 8, title: 'Designer', status: 'draft' };
  assert.equal(rankPosting([live], 'all').job, live, 'the only role, under All');
  assert.equal(rankPosting([live, draft], '7').job, live);
  assert.deepEqual(rankPosting([live, draft], '8'), { job: null, why: 'A draft role has no applicants to rank yet.' });
  assert.deepEqual(rankPosting([live, { ...live, id: 9 }], 'all'), { job: null, why: 'Pick a role to rank its applicants.' });
  assert.deepEqual(rankPosting([live], 'shortlisted').why, 'Pick a role to rank its applicants.');
  assert.deepEqual(rankPosting([], 'all'), { job: null, why: null });
});

async function mount(url, routes, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), body: options.body ? JSON.parse(options.body) : null, method: options.method || 'GET' }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, ...routes))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    requests, by, pr, text: (n = container) => text(n).replace(/\s+/g, ' '),
    select: (label) => walk(container).find((n) => String(n.tagName).toUpperCase() === 'SELECT' && pr(n)['aria-label'] === label),
    rowsIn: (prefix) => walk(container).map((n) => pr(n)['data-testid']).filter((id) => id && id.startsWith(prefix)),
    async press(n) { assert.ok(n, 'drawn'); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async type(n, value) { assert.ok(n, 'drawn'); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const TALENT_ROUTES = [h(Route, { key: 't', path: '/grow/talent', element: h(FounderGrowTalent) })];
const JOBS = [{ id: 7, project_id: 3, title: 'Backend engineer', status: 'published' }];
const APPS = [
  { id: 101, posting_id: 7, name: 'Ana Ortiz', status: 'applied', created_at: '2026-10-28' },
  { id: 102, posting_id: 7, name: 'Bo Chen', status: 'applied', created_at: '2026-10-29' },
  { id: 103, posting_id: 7, name: 'Cy Park', status: 'shortlisted', created_at: '2026-10-30' },
];
function talentHandler(rankAnswer) {
  return (url) => {
    if (/\/api\/projects(\?|$)/.test(url)) return response([{ id: 3, name: 'Harbor Ledger' }]);
    if (/\/api\/jobs\/7\/applications/.test(url)) return response({ applications: APPS });
    if (/\/api\/jobs(\?|$)/.test(url)) return response({ jobs: JOBS });
    if (url.includes('/research/grow/talent/rank')) return rankAnswer();
    return response({});
  };
}

test('GR4 on Grow › Talent: the role\'s applicants ranked by fit, each with its place and Eadwyn\'s line; Usual order puts them back', async () => {
  // Mutation checked: applyRank skipped → the order check fails; the line ignored → "Why this rank" stays the default.
  const m = await mount('/grow/talent?project_id=3', TALENT_ROUTES, talentHandler(() => response({
    job: 'GR4', posting_id: 7, rows: [{ application_id: 103, position: 1, line: 'Has shipped a ledger at scale.' }, { application_id: 101, position: 2, line: null }],
  })));
  try {
    assert.deepEqual(m.rowsIn('grow-talent-row-'), ['grow-talent-row-101', 'grow-talent-row-102', 'grow-talent-row-103'], 'the usual order first');
    await m.press(m.by('grow-talent-rank-run'));
    const call = m.requests.find((r) => r.url.includes('/research/grow/talent/rank'));
    assert.deepEqual([call.method, call.body], ['POST', { scope_key: '3', posting_id: 7 }], 'the project and the posting, nothing else');
    assert.deepEqual(m.rowsIn('grow-talent-row-'), ['grow-talent-row-103', 'grow-talent-row-101', 'grow-talent-row-102'], 'ranked first, the rest after');
    assert.match(m.text(m.by('grow-talent-row-103')), /#1 by fit .*Has shipped a ledger at scale\./);
    assert.match(m.text(m.by('grow-talent-row-101')), /#2 by fit .*No fit rationale recorded\./, 'no line, none invented');
    assert.match(m.text(m.by('grow-talent-row-102')), /Not scored/);
    assert.match(m.text(m.by('grow-talent-rank-done')), /Ranked by fit: 2 of 3 first\./);
    await m.press(m.by('grow-talent-rank-clear'));
    assert.deepEqual(m.rowsIn('grow-talent-row-'), ['grow-talent-row-101', 'grow-talent-row-102', 'grow-talent-row-103']);
  } finally { await m.close(); }
});

test('GR4: a refused press says why and leaves the list as it was', async () => {
  const m = await mount('/grow/talent?project_id=3', TALENT_ROUTES, talentHandler(() => response({ detail: 'Not enough AI tokens for this press.', message: 'Not enough AI tokens for this press.' }, 402)));
  try {
    await m.press(m.by('grow-talent-rank-run'));
    assert.match(m.text(m.by('grow-talent-rank-error')), /Not enough AI tokens/);
    assert.deepEqual(m.rowsIn('grow-talent-row-'), ['grow-talent-row-101', 'grow-talent-row-102', 'grow-talent-row-103']);
  } finally { await m.close(); }
});

const GROW_ROUTES = [h(Route, { key: 'g', path: '/grow/:slug', element: h(CycleRoute, { cycle: 'grow' }) })];
const PARTNERS = {
  module: { slug: 'partner-network', name: 'Partner network' },
  card: { state: 'empty', reason: 'No partners yet.' },
  records: {
    cols: ['Partner', 'Type', 'Stage', 'Terms', 'Revenue sourced'],
    rows: [
      { uid: 'gp-a', name: 'Acme Payroll', type: 'integration', stage: 'signed', terms: null, revenue_cents: null },
      { uid: 'gp-b', name: 'Bolt Accounting', type: 'reseller', stage: 'talking', terms: null, revenue_cents: null },
      { uid: 'gp-c', name: 'Crest Banking', type: 'referral', stage: 'signed', terms: null, revenue_cents: null },
    ],
  },
  parts: {},
};
function growHandler(url) {
  if (/\/api\/projects(\?|$)/.test(url)) return response([{ id: 3, name: 'Harbor Ledger' }]);
  if (url.includes('/cycles/grow/modules/partner-network')) return response(PARTNERS);
  if (url.includes('/cycles/grow/partners/rank')) return response({ job: 'GR17', rows: [{ uid: 'gp-c', position: 1, line: null }, { uid: 'gp-b', position: 2, line: null }] });
  return response({});
}
const order = (t) => ['Acme Payroll', 'Bolt Accounting', 'Crest Banking'].map((n) => [n, t.indexOf(n)]).sort((a, b) => a[1] - b[1]).map(([n]) => n);

test('GR17 on Partner network: the need is required, the partners are ranked against it, and Usual order puts them back', async () => {
  // Mutation checked: needsQuery dropped → the press runs with no need; the ranked rows not passed to the table → the order check fails;
  // the reset on a new read dropped → the re-sorted read still shows the old ranking.
  const m = await mount('/grow/partner-network?project_id=3', GROW_ROUTES, growHandler);
  try {
    assert.ok(m.by('grow-partners-rank'), 'the button is on the Partner network');
    assert.deepEqual(order(m.text()), ['Acme Payroll', 'Bolt Accounting', 'Crest Banking']);
    assert.equal(m.pr(m.by('grow-partners-rank-run')).disabled, true, 'no need typed, no press');
    await m.type(m.by('grow-partners-rank-query'), 'Payroll for EU contractors');
    await m.press(m.by('grow-partners-rank-run'));
    const call = m.requests.find((r) => r.url.includes('/cycles/grow/partners/rank'));
    assert.deepEqual([call.method, call.body], ['POST', { project: 3, query: 'Payroll for EU contractors' }]);
    assert.deepEqual(order(m.text()), ['Crest Banking', 'Bolt Accounting', 'Acme Payroll'], 'ranked first, the rest after');
    assert.match(m.text(m.by('grow-partners-rank-done')), /Ranked by fit: 2 of 3 first\./);
    await m.press(m.by('grow-partners-rank-clear'));
    assert.deepEqual(order(m.text()), ['Acme Payroll', 'Bolt Accounting', 'Crest Banking']);
    // A new read of the module (here, another sort) is the list as read: a ranking never outlives the rows it ranked.
    await m.type(m.by('grow-partners-rank-query'), 'Payroll for EU contractors');
    await m.press(m.by('grow-partners-rank-run'));
    assert.deepEqual(order(m.text()), ['Crest Banking', 'Bolt Accounting', 'Acme Payroll']);
    const reads = m.requests.filter((r) => r.url.includes('/cycles/grow/modules/partner-network')).length;
    await m.type(m.select('Sort'), '-revenue_cents');
    assert.ok(m.requests.filter((r) => r.url.includes('/cycles/grow/modules/partner-network')).length > reads, 'the sort read the module again');
    assert.deepEqual(order(m.text()), ['Acme Payroll', 'Bolt Accounting', 'Crest Banking'], 'the new read is shown as read');
    assert.ok(!m.by('grow-partners-rank-done'));
  } finally { await m.close(); }
});

test('GR17: no other Grow module carries the partners\' press', async () => {
  const m = await mount('/grow/market-expansion?project_id=3', GROW_ROUTES, (url) => (url.includes('/cycles/grow/modules/') ? response({ ...PARTNERS, module: { slug: 'market-expansion', name: 'Market expansion' }, records: { cols: ['Market'], rows: [{ uid: 'mk-1', name: 'Spain' }] } }) : growHandler(url)));
  // Mutation checked: the slug check dropped → the market rows get the partners' press.
  try { assert.match(m.text(), /Spain/, 'the module has rows'); assert.ok(!m.by('grow-partners-rank')); } finally { await m.close(); }
});
