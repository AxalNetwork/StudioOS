/**
 * D1126 (#3006) — Program grants' gaps on D981 that stand on their own: HQ's
 * History tab at /admin/licences/programs/history, and Download CSV on HQ's
 * header. What the Worker answers is tested in
 * cloudflare-worker/test/program_grants_history_d1126.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_grants_history_d1126.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { HISTORY_PATH, NOT_RECORDED_GRANT, historyLine } from '../src/lib/programGrants.js';
import ProgramGrants from '../src/pages/admin/grants/ProgramGrants.jsx';
import ProgramGrantsHistory from '../src/pages/admin/grants/ProgramGrantsHistory.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const LISBON = { uid: 'l1', licence_ref: 'AXL-002', brand_name: 'Studio Lisbon' };
const EVENTS = [
  { id: 9, at: '2026-10-14 09:00:00', action: 'terms_changed', action_label: 'Terms changed', program_key: 'refer-and-earn', program_name: 'Refer & Earn',
    licence: LISBON, changed: [{ key: 'credits_per_quarter', before: 300, after: 400 }, { key: 'hq_share_bps', before: null, after: 1000 }],
    deal_types: null, request: null, reason: 'Referral volume doubled since July.', by: 'Sue Super' },
  { id: 7, at: '2026-09-12 09:00:00', action: 'deal_types_changed', action_label: 'Partner deal types changed', program_key: null, program_name: null,
    licence: LISBON, changed: [], deal_types: { before: [], after: ['revenue_share'] }, request: null, reason: 'The studio hired a deal partner.', by: null },
  { id: 3, at: '2025-02-01 09:00:00', action: 'granted', action_label: 'Granted', program_key: 'perks', program_name: 'Perks',
    licence: null, changed: [], deal_types: null, request: null, reason: null, by: 'Sue Super' },
];

// ---------------------------------------------------------------- the model

test('a history row says what changed, on what, for which studio, with HQ\'s reason; an unset value is Not recorded', () => {
  const a = historyLine(EVENTS[0]);
  assert.equal(a.what, 'Terms changed: Refer & Earn');
  assert.equal(a.studio, 'Studio Lisbon · AXL-002');
  assert.deepEqual(a.details, ['credits per quarter: 300 → 400', `hq share basis points: ${NOT_RECORDED_GRANT} → 1000`]);
  assert.equal(a.reason, 'Referral volume doubled since July.');
  assert.equal(a.by, 'by Sue Super');
  const b = historyLine(EVENTS[1]);
  assert.equal(b.what, 'Partner deal types changed');
  assert.deepEqual(b.details, ['Partner deal types: none → revenue_share']);
  assert.equal(b.by, 'by HQ');
  assert.equal(historyLine(EVENTS[2]).studio, 'A licence the ledger no longer holds', 'never another studio\'s name');
  assert.equal(HISTORY_PATH, '/admin/licences/programs/history');
});

// ---------------------------------------------------------------- the pages, mounted

async function render(el, url) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el)); });
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    async click(id) { const n = byTestId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(routes) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(`${u.pathname}${u.search}`);
    const hit = routes[u.pathname];
    return hit ? hit(u) : json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('mounted History: every studio\'s decisions, newest first, the tabs, and older pages by "Show older"', async () => {
  const s = stub({
    '/api/admin/program-grants/history': (u) => (u.searchParams.get('before') === '7'
      ? json({ items: [EVENTS[2]], next_before: null })
      : json({ items: EVENTS.slice(0, 2), next_before: 7 })),
  });
  const v = await render(h(ProgramGrantsHistory), HISTORY_PATH);
  try {
    assert.match(v.of('grants-history-header'), /Licences.*Program grants.*HQ only.*Grid.*History/s);
    assert.match(v.of('grants-history-row-9'), /Studio Lisbon · AXL-002.*Terms changed: Refer & Earn.*credits per quarter: 300 → 400.*HQ’s reason: Referral volume doubled/s);
    assert.match(v.of('grants-history-row-7'), /by HQ.*Partner deal types changed/s);
    assert.equal(v.has('grants-history-row-3'), false);
    await v.click('grants-history-more');
    assert.match(v.of('grants-history-row-3'), /A licence the ledger no longer holds.*Granted: Perks/s);
    assert.equal(v.has('grants-history-more'), false, 'no more pages');
    assert.ok(s.seen.includes('/api/admin/program-grants/history?before=7'));
    assert.ok(!s.seen.some((p) => p.includes('export.csv')), 'nothing downloads unasked');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted History: a failed read says so, never an empty history; an empty one says nothing is recorded yet', async () => {
  let s = stub({ '/api/admin/program-grants/history': () => json({ error: 'boom' }, 503) });
  let v = await render(h(ProgramGrantsHistory), HISTORY_PATH);
  try {
    assert.match(v.of('grants-history-unreadable'), /could not be read. That is not the same as none/);
    assert.equal(v.has('grants-history-empty'), false);
  } finally { await v.unmount(); s.restore(); }
  s = stub({ '/api/admin/program-grants/history': () => json({ items: [], next_before: null }) });
  v = await render(h(ProgramGrantsHistory), HISTORY_PATH);
  try { assert.match(v.of('grants-history-empty'), /No program decision is recorded yet/); } finally { await v.unmount(); s.restore(); }
});

test('HQ\'s grid: the tabs, and Download CSV in the More menu, whose refusal is shown on the page', async () => {
  const s = stub({
    '/api/admin/licences': () => json({ items: [] }),
    '/api/admin/program-grants/export.csv': () => json({ error: 'forbidden', message: 'Super admin required' }, 403),
  });
  const v = await render(h(ProgramGrants), '/admin/licences/programs');
  try {
    assert.ok(v.has('grants-tab-grid') && v.has('grants-tab-history'));
    assert.equal(v.has('grants-csv-error'), false);
    await v.click('admin-page-more');
    assert.match(v.of('grants-csv'), /Download CSV/);
    await v.click('grants-csv');
    assert.ok(s.seen.includes('/api/admin/program-grants/export.csv'));
    assert.match(v.of('grants-csv-error'), /could not be downloaded: Super admin required/);
  } finally { await v.unmount(); s.restore(); }
});

test('the route, its guard, the rail and the tab doors; History writes nothing', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/licences/programs/history" element={guard(['admin'], hqOnly(<ProgramGrantsHistory />))} />`));
  assert.ok(read('frontend/src/lib/railPages.js').includes("alias('/admin/licences/programs/history', key(SA, 'Licences')"));
  const grid = read('frontend/src/pages/admin/grants/ProgramGrants.jsx');
  assert.ok(grid.includes('<HeaderTab to="/admin/licences/programs" data-testid="grants-tab-grid">Grid</HeaderTab>'));
  assert.ok(grid.includes('<HeaderTab to="/admin/licences/programs/history" data-testid="grants-tab-history">History</HeaderTab>'));
  assert.doesNotMatch(read('frontend/src/pages/admin/grants/ProgramGrantsHistory.jsx'), /method: ['"](POST|PUT|PATCH|DELETE)|\.post\(/);
});
