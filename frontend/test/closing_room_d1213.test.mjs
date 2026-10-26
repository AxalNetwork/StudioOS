// D1213 (#2424) — the closing room and the Closings desk (CP1–CP21), from
// today's reads: a closing is its deal until the closings store lands. Lines
// from commitments, scoped by role; Received only on the receiving side's
// evidence (a confirmed commitment); the desk from the deals' deadlines; and
// "Not read here yet" on the paper, route, instructions, evidence, cap table,
// reporting and activity — never a zero.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closing_room_d1213.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ClosingRoom, { FounderClosing } from '../src/pages/closing/ClosingRoom.jsx';
import { AdminClosingPage, ClosingsDeskPage } from '../src/pages/closing/ClosingsPages.jsx';
import { DESK_PATH, NOT_YET, STEPS, WAITS, closingHref, daysLeft, deskRows, lineRows, lineWord } from '../src/pages/closing/closingModel.js';
import { SUB_PAGES, dealTabsFor, tabHref, tabOf } from '../src/pages/dealPageModel.js';
import { CLOSING, TABS, isCapRelTab } from '../src/pages/raise/caprel/capRelModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a line is Received only when confirmed; withdrawn lines and missing amounts are never counted', () => {
  assert.deepEqual(['pending', 'confirmed', 'withdrawn', 'odd', undefined].map(lineWord), ['Committed', 'Received', 'Withdrawn', 'Not recorded', 'Not recorded']);
  const r = lineRows([
    { uid: 'a', investor_name: 'Ann', amount: 400000, status: 'confirmed' },
    { uid: 'b', investor_name: null, amount: 250000, status: 'pending' },
    { uid: 'c', investor_name: 'Cy', amount: 90000, status: 'withdrawn' },
    { uid: 'd', investor_name: 'Di', amount: null, status: 'pending' },
  ]);
  assert.equal(r.committed, 650000, 'withdrawn is not committed');
  assert.equal(r.received, 400000, 'a pending line is not money in the account');
  assert.equal(r.unrecordedAmounts, 1);
  assert.equal(r.rows[1].investor, 'Name not recorded');
  assert.equal(r.rows[3].amount, null, 'a missing amount stays missing, never 0');
  assert.deepEqual(lineRows(null).rows, []);
});

test('the desk lists deals with a deadline, by deadline, and marks under 14 days', () => {
  const now = new Date(Date.UTC(2026, 9, 21));
  const rows = deskRows([
    { id: 3, project_name: 'Halyard', closing_deadline: '2026-11-02', capital_committed: 0, target_raise: 900000 },
    { id: 1, project_name: 'Orbit', closing_deadline: '2026-10-31T00:00:00Z', capital_committed: 200000 },
    { id: 9, project_name: 'No deadline', closing_deadline: null },
    { id: 4, project_name: 'Bluefern', closing_deadline: '2026-11-18' },
  ], now);
  assert.deepEqual(rows.map((r) => r.id), [1, 3, 4]);
  assert.deepEqual(rows.map((r) => r.left), [10, 12, 28]);
  assert.deepEqual(rows.map((r) => r.soon), [true, true, false]);
  assert.equal(rows[0].href, '/admin/contracts/closings/1');
  assert.equal(rows[2].confirmed, null, 'an unreturned total is null, not 0');
  assert.equal(daysLeft('nonsense', now), null);
  assert.equal(closingHref('1 OR 1'), DESK_PATH);
});

test('the steps are the canvas’s seven, and every wait says why without a zero', () => {
  assert.deepEqual(STEPS, ['Paper', 'Sign', 'Route', 'Pay', 'Receipt', 'Cap table', 'Reporting']);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

test('the rooms are addresses under their pages, not new tabs', () => {
  assert.equal(tabOf('closing', 'investor'), 'closing');
  assert.equal(tabOf('closing', 'exploring'), 'overview');
  assert.equal(tabHref(7, 'closing'), '/deals/7/closing');
  for (const role of ['investor', 'founder', 'admin', 'partner']) assert.ok(!dealTabsFor(role).includes('closing'), role);
  assert.deepEqual(SUB_PAGES.closing.roles, ['investor', 'founder', 'admin', 'partner']);
  assert.equal(TABS.length, 7, 'Capital relationships keeps the canvas’s seven tabs');
  assert.ok(isCapRelTab('capital-relationships', CLOSING.id));
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const DEAL = { id: 7, project_id: 5, project_name: 'Acme Robotics', instrument: 'SAFE', currency: 'USD', closing_deadline: '2026-11-30', capital_committed: 400000 };
const LINES = [
  { uid: 'l1', investor_name: 'Harbor Ventures', amount: 400000, status: 'confirmed' },
  { uid: 'l2', investor_name: 'Fund I', amount: 250000, status: 'pending' },
];

async function mount(element, routes, url = '/') {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '').split('?')[0];
    asked.push(path);
    const hit = routes[path];
    if (hit instanceof Error) return response({ detail: 'down' }, 500);
    return response(hit ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', name: 'A', email: 'a@example.com' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, element)));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(el).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id),
    text: (id) => txt(id ? by(id) : el).replace(/\s+/g, ' ').trim(),
    links: () => walk(el).filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => n.getAttribute?.('href') || pr(n).href),
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

const ROUTES = {
  '/deals/7': DEAL,
  '/deals/7/commitments': LINES,
  '/deals/7/closing-checklist': { checklist: { items: [{ uid: 'i1', label: 'SAFE signed', state: 'done', done_by_name: 'Admin B' }, { uid: 'i2', label: 'Wire received', state: 'open' }] } },
  '/deals/7/transfers': { items: [{ uid: 't1', amount_cents: 40000000, reference: 'WIRE-1', phone_verified: 1 }] },
};

test('the admin sees every line with its sums, the checklist, the transfers and every wait', async () => {
  const v = await mount(h(ClosingRoom, { dealId: 7, role: 'admin' }), ROUTES);
  try {
    assert.match(v.text('closing-head'), /Closing · Acme Robotics · SAFE/);
    assert.match(v.text('closing-line-l1'), /Harbor Ventures.*\$400,000.*Received/);
    assert.match(v.text('closing-line-l2'), /Committed/);
    assert.match(v.text('closing-lines-sums'), /Committed \$650,000 · Received \$400,000/);
    assert.match(v.text('closing-checklist'), /SAFE signed · Admin B/);
    assert.match(v.text('closing-transfers'), /\$400,000\.00 · WIRE-1 · Phone-verified/);
    for (const id of ['paper', 'route', 'instructions', 'evidence', 'captable', 'reporting', 'activity']) assert.ok(v.text(`closing-wait-${id}`).startsWith(NOT_YET), id);
  } finally { await v.close(); }
});

test('an investor sees their own line and the round’s confirmed total, never the checklist or transfers', async () => {
  const v = await mount(h(ClosingRoom, { dealId: 7, role: 'investor' }), { ...ROUTES, '/deals/7/commitments': [LINES[0]] });
  try {
    assert.match(v.text('closing-lines'), /Your line/);
    assert.match(v.text('closing-head'), /Confirmed in the round \$400,000/);
    assert.ok(v.has('closing-wait-roundTotal'));
    for (const id of ['closing-checklist', 'closing-transfers', 'closing-lines-sums', 'closing-wait-activity']) assert.ok(!v.has(id), id);
    assert.ok(!v.asked.includes('/deals/7/transfers'), 'the transfers read is never made for an investor');
  } finally { await v.close(); }
});

test('one failed read costs one block; an Operating Partner gets no lines', async () => {
  const v = await mount(h(ClosingRoom, { dealId: 7, role: 'admin' }), { ...ROUTES, '/deals/7/commitments': new Error('down') });
  try {
    assert.match(v.text('closing-lines'), /The lines could not be read/);
    assert.ok(v.has('closing-checklist') && v.has('closing-transfers'));
  } finally { await v.close(); }
  const p = await mount(h(ClosingRoom, { dealId: 7, role: 'partner' }), { ...ROUTES, '/deals/7/commitments': { total: 400000 } });
  try {
    assert.ok(!p.has('closing-lines'), 'a total-only read draws no lines');
    assert.ok(p.has('closing-checklist') && p.has('closing-transfers'));
  } finally { await p.close(); }
});

test('the desk links each closing; a failed deals read says so', async () => {
  const deals = [DEAL, { id: 8, project_name: 'Orbit', closing_deadline: null }];
  const v = await mount(h(ClosingsDeskPage), { '/deals': deals });
  try {
    assert.ok(v.has('closings-desk-row-7') && !v.has('closings-desk-row-8'));
    assert.ok(v.links().includes('/admin/contracts/closings/7'));
    assert.ok(v.text('closing-wait-closings').startsWith(NOT_YET));
  } finally { await v.close(); }
  const e = await mount(h(ClosingsDeskPage), { '/deals': new Error('down') });
  try { assert.match(e.text(), /The deals could not be read/); } finally { await e.close(); }
});

test('one closing at its address, and a malformed id reads nothing', async () => {
  const at = (url) => mount(h(Routes, null, h(Route, { path: '/admin/contracts/closings/:dealId', element: h(AdminClosingPage) })), ROUTES, url);
  const v = await at('/admin/contracts/closings/7');
  try { assert.ok(v.has('closing-room')); } finally { await v.close(); }
  const bad = await at('/admin/contracts/closings/7x');
  try { assert.ok(bad.has('admin-closing-missing')); assert.equal(bad.asked.length, 0); } finally { await bad.close(); }
});

test('the founder’s room picks the deal ?deal= names, else the nearest deadline, among the venture’s deals only', async () => {
  const deals = [{ ...DEAL, id: 7 }, { ...DEAL, id: 9, closing_deadline: '2026-11-05' }, { ...DEAL, id: 11, project_id: 99 }];
  const v = await mount(h(FounderClosing, { projectId: 5, search: '' }), { ...ROUTES, '/deals': deals, '/deals/9/commitments': [], '/deals/9/closing-checklist': { checklist: null } });
  try {
    assert.ok(v.has('closing-founder-deal-7') && v.has('closing-founder-deal-9') && !v.has('closing-founder-deal-11'));
    assert.ok(v.asked.includes('/deals/9/commitments'), 'the nearest deadline is the room');
    assert.ok(v.has('closing-lines-empty'));
  } finally { await v.close(); }
  const w = await mount(h(FounderClosing, { projectId: 5, search: '?deal=7' }), { ...ROUTES, '/deals': deals });
  try { assert.ok(w.asked.includes('/deals/7/commitments')); } finally { await w.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: two admin routes, the Contracts door, the deal and Capital relationships doors, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/contracts/closings" element={guard(['admin'], <ClosingsDeskPage />)} />`));
  assert.ok(app.includes(`<Route path="/admin/contracts/closings/:dealId" element={guard(['admin'], <AdminClosingPage />)} />`));
  assert.ok(read('frontend/src/pages/admin/contracts/ContractsDesk.jsx').includes('<Link to="/admin/contracts/closings"'));
  assert.ok(read('frontend/src/pages/DealRoomPage.jsx').includes("{tab === 'closing' && <ClosingRoom dealId={deal.id} role={role} deal={deal} />}"));
  assert.ok(read('frontend/src/pages/DealRoomPage.jsx').includes("tabHref(deal.id, 'closing')"));
  assert.ok(read('frontend/src/pages/raise/caprel/CapRelTool.jsx').includes("else if (tab === 'closing') body = <FounderClosing"));
  for (const f of ['Closing Room Page.dc.html', 'Closing room · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Closing room · Boards.dc.html').includes('name="Closing Room Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1213.md'));
  assert.ok(existsSync('documentation/audits/CLOSING_MAP_2026-10-26.md'));
});
