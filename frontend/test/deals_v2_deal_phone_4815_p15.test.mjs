/**
 * D4815 part 15 (#5908) — `/deals/:id` on a phone at 390px, board DE15
 * (canvas section DX15): the strip two by two with Instrument as a full-width
 * last row, investment progress as a vertical stepper, the one next action in
 * a sticky foot bar the page is padded for, tabs that scroll sideways, Market's
 * competitors as cards rather than a table scrolled sideways, and 44px targets.
 *
 * The real DealRoomPage is mounted with a fetch the test controls and
 * `matchMedia` answering the phone query either way.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_deal_phone_4815_p15.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { stripCellClass } from '../src/pages/deal/DealFrame.jsx';
import { PHONE_QUERY } from '../src/workspaces/lens.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const classes = (c) => String(c || '').split(/\s+/).filter(Boolean);

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE', closing_deadline: '2026-12-01', website: 'harbor.example' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const OWN = { uid: 'c-own', deal_id: 4, investor_user_id: 21, company_id: 501, company_name: 'Alder Ventures', firm_context: 501, in_context: true, amount: 50000, status: 'pending' };

function handler(url) {
  if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' }, ic: { state: 'used' } });
  if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ first_visit: true, changes: [] });
  if (/\/api\/deals\/4\/commitments/.test(url)) return response([OWN]);
  if (/\/api\/deals\/4\/round/.test(url)) return response({ investors: 1, confirmed_total: 250000, pending_total: 0, currency: 'USD' });
  if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
  if (/\/networkfx\/syndicates/.test(url)) return response([]);
  if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
  return response({});
}

async function mounted(url, { phone }) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => handler(String(u));
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(INVESTOR));
  const Firm = ({ children }) => {
    const [company, setCompany] = React.useState({ id: 501 });
    return h(ActiveCompanyContext.Provider, { value: { company, setCompany, companies: [], setCompanies() {} } }, children);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Firm, null,
    h(Routes, null, h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }), h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) })))))));
  await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  return {
    has: (id) => byId(id).length > 0,
    all: (id) => byId(id),
    textOf: (id) => text(byId(id)[0]),
    classOf: (id) => classes(props(byId(id)[0]).className),
    propsOf: (n) => props(n),
    text: (n) => text(n),
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('the strip on a phone: Round, Committed, Minimum, Closes two by two, Instrument a full-width last row, no edge drawn twice', () => {
  const keys = ['round', 'instrument', 'committed', 'minimum', 'closes'];
  const at = Object.fromEntries(keys.map((k, i) => [k, classes(stripCellClass(k, i, keys.length))]));
  // The phone's left column draws the inner right edge; the right column does not.
  for (const k of ['round', 'minimum']) assert.ok(at[k].includes('border-r'), `${k} sits in the left column`);
  for (const k of ['committed', 'closes']) assert.ok(!at[k].includes('border-r'), `${k} sits in the right column`);
  // Every cell of the 2×2 has a row under it (Instrument); Instrument has none.
  for (const k of ['round', 'committed', 'minimum', 'closes']) assert.ok(at[k].includes('border-b'), k);
  assert.ok(!at.instrument.includes('border-b') && !at.instrument.includes('border-r'), 'Instrument draws no edge of its own');
  assert.ok(at.instrument.includes('order-last') && at.instrument.includes('col-span-2'), 'Instrument is the full-width last row');
  // From md up: part 4's five across, an inner edge between each, none after the last.
  for (const k of keys) assert.ok(at[k].includes('md:order-none') && at[k].includes('md:border-b-0') && at[k].includes('md:col-span-1'), k);
  for (const k of keys.slice(0, 4)) assert.ok(at[k].includes('md:border-r'), `${k} has an edge after it on a desktop`);
  assert.ok(at.closes.includes('md:border-r-0') && !at.closes.includes('md:border-r'), 'the last cell has none');
});

test('mounted on a phone: the vertical stepper, the foot bar, the 2×2 strip and 44px targets', async () => {
  const v = await mounted('/deals/4', { phone: true });
  try {
    assert.ok(v.has('deal-steps-vertical'), 'progress is a vertical stepper');
    const rows = v.all('deal-steps-vertical')[0].childNodes;
    assert.equal(rows.length, 8, 'all eight steps, one row each');
    assert.deepEqual(rows.map((n) => v.text(n)), ['Invited', 'Reviewing', '3Diligence', '4IC', '5Terms', '6Committed', '7Signed', '8Funded'],
      'a done step shows a tick, every other its number, then its word');
    const now = rows.filter((n) => v.propsOf(n)['aria-current'] === 'step');
    assert.equal(now.length, 1);
    assert.equal(v.text(now[0]), '3Diligence');
    for (const n of rows) assert.ok(classes(v.propsOf(n).className).includes('min-h-[44px]'), 'each row is a 44px target');
    assert.ok(v.has('deal-next-bar'), 'the one next action is the foot bar');
    assert.equal(v.all('deal-next-action').length, 1);
    assert.ok(classes(v.propsOf(v.all('deal-next-action')[0]).className).includes('min-h-[44px]'));
    assert.ok(v.classOf('deal-next-bar').includes('fixed') && v.classOf('deal-next-bar').includes('bottom-0'), 'it sticks to the foot');
    assert.ok(v.classOf('deal-strip-instrument').includes('order-last'), 'Instrument is the last row');
    assert.ok(v.classOf('deal-tabs').includes('overflow-x-auto'), 'the tabs scroll sideways');
    for (const id of v.ids().filter((x) => x.startsWith('deal-tab-'))) assert.ok(v.classOf(id).includes('min-h-[44px]'), id);
    assert.ok(v.classOf('deal-position-open').includes('min-h-[44px]'), 'a frame button is 44px below md');
  } finally { await v.close(); }
});

test('the Overview\'s links on a line of their own are 44px targets below md; one inside a sentence stays inline', () => {
  const src = read('frontend/src/pages/deal/DealOverview.jsx');
  assert.match(src, /const LINK_ALONE = `\$\{LINK\} w-fit max-md:inline-flex max-md:min-h-\[44px\] max-md:items-center`;/);
  for (const id of ['deal-score-open', 'deal-case-notes-more']) assert.match(src, new RegExp(`className=\\{LINK_ALONE\\} data-testid="${id}"`), id);
  assert.match(src, /className=\{LINK_ALONE\}>Open the shared evidence/);
  assert.match(src, /max-md:min-h-\[44px\][^"]*">Full terms/);
  assert.match(src, /<Link to=\{FOUNDER_PAGE\} className=\{LINK\}>/, 'the link inside the founder\'s sentence stays inline');
});

test('mounted on a desktop: the sequence stays a row of chips, with no vertical stepper and no foot bar', async () => {
  const v = await mounted('/deals/4', { phone: false });
  try {
    assert.ok(!v.has('deal-steps-vertical'));
    assert.ok(!v.has('deal-next-bar'));
    assert.equal(v.all('deal-step-now').length, 1);
  } finally { await v.close(); }
});

test('the page is padded for the foot bar wherever the bar is drawn (below 1024px)', () => {
  assert.equal(PHONE_QUERY, '(max-width: 1023px)', 'the bar follows the phone query');
  const page = read('frontend/src/pages/DealRoomPage.jsx');
  assert.match(page, /className="flex flex-col gap-4 pb-24 lg:pb-0"/, 'padding until lg (1024px), where the bar stops');
});

test('Market\'s competitors: cards below md, the table from md, never a table scrolled sideways', () => {
  const src = read('frontend/src/pages/deal/DealInsightTabs.jsx');
  // D6164 part 2: the cards and the table moved into `Competitors`, which adds search and sort (DE24).
  const block = src.slice(src.indexOf('function Competitors('), src.indexOf('function CompanyMarkets('));
  assert.ok(block.length > 0, 'the Competitors component is found');
  assert.match(block, /<ul className="[^"]*\bmd:hidden\b[^"]*" data-testid="deal-market-competitor-cards">/);
  assert.match(block, /<div className="hidden md:block">\s*<table className="w-full border-collapse/);
  assert.doesNotMatch(block, /overflow-x-auto|min-w-\[/, 'no sideways scroll, no minimum width');
  for (const f of ['why_it_matters', 'price_position', 'depth_position']) assert.equal(block.split(`r.${f} || NOT_RECORDED`).length - 1, 2, `${f} in both, Not recorded when empty`);
});

test('the decision part names DE15, the build and its departures', () => {
  const d = read('documentation/architecture/decisions/D4815-p15.md');
  assert.match(d, /^## D4815 part 15 — .+ \(#4815, #5908\)/);
  assert.match(d, /DE15/);
  assert.match(d, /### Departures from the canvas/);
  assert.match(read('documentation/architecture/route-map/canvases/part-3/0230-pages-investor-deals.md'), /DX15 built \(D4815 part 15, #5908\)/);
});
