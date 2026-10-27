// D1219 (#3216, part 6 of #2424) — the admin desk complete: Contracts ›
// Closings from `/api/admin/closings` (CP13, CP21), one closing as the Super
// Admin and as an Admin (CP14), the activity drawer (CP15), prepare the paper
// (CP3), choose the route (CP5), the SPV, Axal VC fund and third-party fund
// routes (CP6–CP8), and the Closings tab in Contracts' tab row.
//
// Every read and act is stubbed; nothing here reaches a bank or a signing
// provider. Fixtures are fake.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/closings_desk_d1219.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { AdminClosingPage, ClosingsDeskPage } from '../src/pages/closing/ClosingsPages.jsx';
import {
  ACT_FALLBACK, NO_ROUTE_YET, STEP_UP_LINE, actControl, activityCsv, activityRows, awaitingRelease, closeState, closingFigures, closingForDeal,
  deskRows, deskTiles, filterActivity, filterDesk, isMoneyField, lineStatus, moneyCents, openableDeals, ownersOf, paperFields, paperWord,
  quarterStart, routeBody, signersFor, syndicateIdOf,
} from '../src/pages/closing/deskModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

const DESK = [
  { uid: 'c2', deal_id: 9, project_name: 'Halyard Security', round_label: 'Seed', currency: 'USD', deadline: '2026-11-02', owner_name: 'Admin B', lines: 2, lines_waiting: 2, total_cents: 90000000, received_cents: 0, captable: 'not_ready', next_actor: { who: 'investor', why: 'A line has no evidence that money was sent.' } },
  { uid: 'c1', deal_id: 7, project_name: 'Acme Robotics', round_label: 'Seed', currency: 'USD', deadline: '2026-10-31', owner_name: 'Admin A', lines: 3, lines_waiting: 1, total_cents: 145000000, received_cents: 25000000, captable: 'not_ready', next_actor: { who: 'admin', why: 'A line has no capital route.' } },
  { uid: 'c3', deal_id: 11, project_name: 'Northwind Labs', round_label: null, currency: 'USD', deadline: null, owner_name: null, lines: 1, lines_waiting: 0, total_cents: null, received_cents: 35000000, captable: 'proposed', next_actor: { who: 'founder', why: 'The cap-table proposal waits for the founder.' } },
];

test('the desk: rows from the store, deadline first, never a zero for a missing figure', () => {
  const now = new Date(Date.UTC(2026, 9, 21));
  const rows = deskRows(DESK, now);
  assert.deepEqual(rows.map((r) => r.uid), ['c2', 'c1', 'c3'], 'the Worker’s order is kept as given');
  assert.equal(rows[1].href, '/admin/contracts/closings/7');
  assert.equal(rows[1].whoWord, 'Studio team');
  assert.deepEqual([rows[0].left, rows[0].soon], [12, true]);
  assert.equal(rows[2].committed, null, 'a missing total stays missing');
  assert.equal(rows[2].deadline, null);
  assert.equal(deskRows([{ uid: 'x', deal_id: 'abc', next_actor: { who: 'mallory' } }])[0].href, '/admin/contracts/closings', 'a malformed deal id links to the desk');
  assert.equal(deskRows([{ uid: 'x', next_actor: { who: 'mallory' } }])[0].who, null, 'an unknown actor is not guessed');
  assert.deepEqual(deskRows(null), []);
});

test('the desk’s search, filters and sort; a missing figure sorts last, never as zero', () => {
  const rows = deskRows(DESK, new Date(Date.UTC(2026, 9, 21)));
  assert.deepEqual(filterDesk(rows).map((r) => r.uid), ['c1', 'c2', 'c3'], 'deadline first; no deadline last');
  assert.deepEqual(filterDesk(rows, { q: 'acme' }).map((r) => r.uid), ['c1']);
  assert.deepEqual(filterDesk(rows, { q: 'SEED' }).map((r) => r.uid), ['c1', 'c2'], 'the round is searched too');
  assert.deepEqual(filterDesk(rows, { who: 'founder' }).map((r) => r.uid), ['c3']);
  assert.deepEqual(filterDesk(rows, { owner: 'Admin B' }).map((r) => r.uid), ['c2']);
  assert.deepEqual(filterDesk(rows, { sort: 'committed' }).map((r) => r.uid), ['c1', 'c2', 'c3']);
  assert.deepEqual(filterDesk(rows, { sort: 'company' }).map((r) => r.uid), ['c1', 'c2', 'c3']);
  assert.deepEqual(ownersOf(rows), ['Admin A', 'Admin B']);
});

test('the tiles: counts from the desk, Closed this quarter from every closing; a failed read is null, never 0', () => {
  const now = new Date(Date.UTC(2026, 9, 21));
  assert.equal(quarterStart(now), '2026-10-01');
  assert.equal(quarterStart(new Date(Date.UTC(2026, 0, 3))), '2026-01-01');
  const rows = deskRows(DESK, now);
  const all = [
    { status: 'closed', closed_at: '2026-10-02T10:00:00Z' },
    { status: 'closed', closed_at: '2026-09-30T23:00:00Z' },
    { status: 'open', closed_at: null },
    { status: 'cancelled', closed_at: '2026-10-05T00:00:00Z' },
  ];
  const t = Object.fromEntries(deskTiles(rows, all, now).map((x) => [x.key, x.value]));
  assert.deepEqual(t, { open: 3, admin: 1, investor: 1, founder: 1, closed: 1 });
  const failed = Object.fromEntries(deskTiles(null, null, now).map((x) => [x.key, x.value]));
  assert.deepEqual(Object.values(failed), [null, null, null, null, null]);
});

test('Open a closing offers only deals without an open closing; an address finds the open closing first', () => {
  const deals = [{ id: 7, project_name: 'Acme', closing_deadline: '2026-11-30' }, { id: 8, project_name: 'Orbit' }, { id: 9, project_name: 'Bluefern', closing_deadline: '2026-11-02' }, { id: 'x' }];
  const closings = [{ deal_id: 7, status: 'open', uid: 'a' }, { deal_id: 9, status: 'closed', uid: 'b' }];
  assert.deepEqual(openableDeals(deals, closings).map((d) => d.id), [9, 8], 'deal 7 has one open; a closed one does not block');
  assert.equal(closingForDeal([{ deal_id: 7, status: 'closed', uid: 'old' }, { deal_id: 7, status: 'open', uid: 'new' }], 7).uid, 'new');
  assert.equal(closingForDeal([{ deal_id: 7, status: 'closed', uid: 'old' }], 7).uid, 'old');
  assert.equal(closingForDeal([{ deal_id: 8, status: 'open', uid: 'z' }], 7), null);
});

test('an Admin never has a Super Admin act enabled; a Super Admin’s live act asks for the step-up', () => {
  const admin = { role: 'admin', is_super_admin: 0 };
  const sa = { role: 'admin', is_super_admin: 1 };
  const allowed = { acts: [{ act: 'closing.countersign', allowed: true, sentence: null }] };
  for (const access of [null, allowed, { acts: [] }]) {
    const c = actControl(admin, access, 'closing.countersign');
    assert.equal(c.enabled, false, 'an Admin, whatever the table says or if it failed');
    assert.equal(c.sentence, ACT_FALLBACK['closing.countersign']);
  }
  assert.equal(actControl(admin, { acts: [{ act: 'fund_investment.commit', allowed: false, sentence: 'A Super Admin commits fund money.' }] }, 'fund_investment.commit').sentence, 'A Super Admin commits fund money.');
  assert.deepEqual(actControl(sa, allowed, 'closing.countersign'), { enabled: true, sentence: STEP_UP_LINE });
  assert.equal(actControl(sa, null, 'closing.countersign').enabled, true, 'the Worker still decides every act');
  assert.equal(actControl(sa, { acts: [{ act: 'closing.countersign', allowed: false, sentence: 'Refused here.' }] }, 'closing.countersign').enabled, false);
});

test('a line’s words: Received only on received; the paper from its staged envelopes', () => {
  assert.deepEqual(['open', 'sent', 'received', 'withdrawn', 'odd'].map(lineStatus), ['Waiting for money', 'Sent, not yet confirmed', 'Received', 'Withdrawn', 'Not recorded']);
  const waiting = { uid: 'e1', title: 'SAFE', stages: [{ role: 'company', state: 'signed' }, { role: 'investor', state: 'signed' }, { role: 'axal', state: 'awaiting_release' }] };
  const voided = { ...waiting, uid: 'e0', voided: true };
  assert.deepEqual(awaitingRelease([waiting, voided, { uid: 'e2', stages: [{ role: 'axal', state: 'waiting' }] }]).map((e) => e.uid), ['e1']);
  assert.equal(paperWord([]), 'No paper sent');
  assert.equal(paperWord([waiting]), 'Waiting for Axal’s countersign');
  assert.equal(paperWord([{ complete: true, stages: [] }]), 'Signed');
  assert.equal(paperWord([{ stages: [{ state: 'signed' }, { state: 'sent' }] }]), 'Signing · 1 of 2 signed');
  assert.equal(paperWord([{ stages: [{ state: 'declined' }] }]), 'Declined');
  assert.equal(paperWord([voided]), 'No paper sent', 'a void envelope is no paper');
});

test('one closing’s figures: received lines only; withdrawn counts nowhere; Mark Closed waits for the founder', () => {
  const f = closingFigures({ total_cents: 65000000, lines: [{ status: 'received', amount_cents: 40000000, route: 'direct' }, { status: 'sent', amount_cents: 25000000, route: null }, { status: 'withdrawn', amount_cents: 9000000, route: null }] });
  assert.deepEqual(f, { lines: 2, committed: 65000000, received: 40000000, waiting: 1, noRoute: 1 });
  assert.equal(closeState({ status: 'open', captable: { state: 'accepted' } }).ok, true);
  assert.equal(closeState({ status: 'open', captable: { state: 'dismissed' } }).ok, true);
  assert.match(closeState({ status: 'open', captable: { state: 'proposed' } }).why, /founder has not decided/);
  assert.match(closeState({ status: 'open', captable: { state: 'not_ready' } }).why, /received or withdrawn/);
  assert.equal(closeState({ status: 'closed', captable: { state: 'accepted' } }).ok, false);
  assert.equal(moneyCents(null), null);
  assert.equal(moneyCents(40000000, 'USD'), '$400,000.00');
  assert.equal(moneyCents(0, 'USD'), '$0.00', 'a recorded zero is a figure; only a missing one is not');
});

test('a route needs its vehicle, except Direct; a syndicate is named by its id', () => {
  assert.deepEqual(routeBody('direct', 'ignored'), { route: 'direct', vehicle_ref: null });
  assert.match(routeBody('syndicate', '  ').error, /SPV this line goes through/);
  assert.deepEqual(routeBody('third_party_fund', ' Harbor Ventures III, L.P. '), { route: 'third_party_fund', vehicle_ref: 'Harbor Ventures III, L.P.' });
  assert.equal(routeBody('third_party_fund', 'x'.repeat(200)).vehicle_ref.length, 120);
  assert.match(routeBody('moon', 'x').error, /Choose a route/);
  assert.equal(syndicateIdOf('syndicate:4'), 4);
  assert.equal(syndicateIdOf('syndicate:04'), null);
  assert.equal(syndicateIdOf('Northwind SPV'), null);
});

test('activity: newest first, each event’s step, the step filter, and CSV that a spreadsheet reads as text', () => {
  const rows = activityRows([
    { event: 'opened', actor_user_id: 1, source_ref: 'deal:7', created_at: '2026-10-03T10:15:00Z' },
    { event: 'route_set', actor_user_id: 1, source_ref: 'route:syndicate', created_at: '2026-10-08T11:30:00Z' },
    { event: 'evidence_added', actor_user_id: 2, source_ref: 'closing_evidence:abc', created_at: '2026-10-18T16:40:00Z' },
    { event: 'mystery', actor_user_id: 0, source_ref: '=HYPERLINK("x")', created_at: '2026-10-19T09:00:00Z' },
  ]);
  assert.deepEqual(rows.map((r) => r.words), ['Recorded an event this page does not name', 'Recorded evidence on a line', 'Set a line’s route to Syndicate (SPV)', 'Opened the closing']);
  assert.deepEqual(rows.map((r) => r.step), [null, 5, 3, 1]);
  assert.equal(rows[0].actor, null, 'no account 0');
  assert.deepEqual(filterActivity(rows, 3).map((r) => r.words), ['Set a line’s route to Syndicate (SPV)']);
  assert.equal(filterActivity(rows, 0).length, 4);
  const csv = activityCsv(rows).split('\n');
  assert.equal(csv[0], 'When,Account,What,Step,Source');
  assert.ok(csv[1].includes(`"'=HYPERLINK(""x"")"`), csv[1]);
  assert.ok(csv[2].endsWith('5 Receipt,closing_evidence:abc'));
});

test('the paper’s fields: three facts from reads, everything else typed, and money never proposed', () => {
  const f = paperFields(['company_name', 'investor_name', 'purchase_amount', 'valuation_cap', 'governing_law'],
    { company: 'Acme Robotics, Inc.', investor: 'Fund I', amountCents: 50000000, currency: 'USD' });
  assert.deepEqual(f.map((x) => [x.key, x.value, x.from, x.money]), [
    ['company_name', 'Acme Robotics, Inc.', 'From the deal', false],
    ['investor_name', 'Fund I', 'From the line', false],
    ['purchase_amount', '$500,000.00', 'From the line', true],
    ['valuation_cap', '', null, true],
    ['governing_law', '', null, false],
  ]);
  assert.equal(paperFields(['purchase_amount'], { amountCents: null })[0].value, '', 'no amount is never "$0.00"');
  for (const k of ['discount_rate', 'carry_percent', 'management_fee', 'price_per_share']) assert.ok(isMoneyField(k), k);
  assert.ok(!isMoneyField('signer_title'));
  assert.deepEqual(signersFor({ founderUserId: 3, investorUserId: 41 }), [{ role: 'company', user_id: 3 }, { role: 'investor', user_id: 41 }]);
  assert.deepEqual(signersFor({ founderUserId: null, investorUserId: 41 }), [{ role: 'investor', user_id: 41 }]);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount(element, routes, { url = '/', user = { id: 1, role: 'admin', is_super_admin: 0 } } = {}) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const path = String(u).replace(/^.*\/api/, '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : null;
    asked.push({ method, path, body });
    const hit = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined);
    const value = typeof hit === 'function' ? hit(body) : hit;
    if (value instanceof Error) return response({ detail: value.message, message: value.message, code: value.code }, value.status || 500);
    return response(value ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ name: 'A', email: 'a@example.com', ...user }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, element))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(el).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id),
    props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : el).replace(/\s+/g, ' ').trim(),
    links: () => walk(el).filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => n.getAttribute?.('href') || pr(n).href),
    async click(id) { const p = pr(by(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { p.onClick({ preventDefault() {} }); }); await flush(); },
    async change(id, value, checked = true) { const p = pr(by(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('the desk mounts from /api/admin/closings with its tiles, its rows and the chart’s wait', async () => {
  const v = await mount(h(ClosingsDeskPage), { '/admin/closings': { closings: DESK }, '/closings': { closings: [{ status: 'closed', closed_at: new Date().toISOString() }] } });
  try {
    assert.ok(v.asked.some((a) => a.path === '/admin/closings'));
    assert.ok(!v.asked.some((a) => a.path === '/deals'), 'the desk no longer reads deals');
    assert.ok(v.has('closings-desk-row-7') && v.has('closings-desk-row-9') && v.has('closings-desk-row-11'));
    assert.ok(v.links().includes('/admin/contracts/closings/7'));
    assert.match(v.text('closings-desk-who-7'), /^Studio team A line has no capital route\./);
    assert.match(v.text('closings-tile-open'), /Open 3/);
    assert.match(v.text('closings-tile-founder'), /Waiting on the founder 1/);
    assert.match(v.text('closings-tile-closed'), /Closed this quarter 1/);
    assert.ok(v.has('closings-gap-chart'));
    await v.change('closings-filter-who', 'investor');
    assert.ok(v.has('closings-desk-row-9') && !v.has('closings-desk-row-7'));
    assert.match(v.text('closings-count'), /1 of 3/);
  } finally { await v.close(); }
});

test('a failed desk read says so and blanks only its own blocks', async () => {
  const v = await mount(h(ClosingsDeskPage), { '/admin/closings': new Error('down'), '/closings': { closings: [] } });
  try {
    assert.match(v.text('closings-desk-list'), /The closings could not be read/);
    assert.match(v.text('closings-tile-open'), /Unreadable/);
    assert.match(v.text('closings-tile-closed'), /Closed this quarter 0/, 'the other read still stands');
  } finally { await v.close(); }
  const w = await mount(h(ClosingsDeskPage), { '/admin/closings': { closings: DESK }, '/closings': new Error('down') });
  try {
    assert.match(w.text('closings-tile-closed'), /Unreadable/);
    assert.match(w.text('closings-tile-open'), /Open 3/);
  } finally { await w.close(); }
});

test('Open a closing posts the deal and lands on its address', async () => {
  const v = await mount(h(Routes, null,
    h(Route, { path: '/admin/contracts/closings', element: h(ClosingsDeskPage) }),
    h(Route, { path: '/admin/contracts/closings/:dealId', element: h('p', { 'data-testid': 'landed' }) })), {
    '/admin/closings': { closings: [] }, '/closings': { closings: [] },
    '/deals': [{ id: 8, project_name: 'Orbit', closing_deadline: '2026-12-01' }],
    'POST /closings': { uid: 'new' },
  }, { url: '/admin/contracts/closings' });
  try {
    assert.ok(v.has('closings-desk-empty'));
    await v.click('closings-open-btn');
    await act(async () => { await v.props('closings-open-form').onSubmit({ preventDefault() {} }); });
    assert.match(v.text('closings-open-error'), /Choose the deal/);
    assert.ok(!v.asked.some((a) => a.method === 'POST'), 'no deal, no write');
    await v.change('closings-open-deal', '8');
    await v.change('closings-open-round', '  Seed  ');
    const form = v.props('closings-open-form');
    await act(async () => { await form.onSubmit({ preventDefault() {} }); });
    await new Promise((r) => setTimeout(r, 0));
    const post = v.asked.find((a) => a.method === 'POST' && a.path === '/closings');
    assert.deepEqual(post.body, { deal_id: 8, round_label: 'Seed' });
  } finally { await v.close(); }
});

const CLOSING = {
  uid: 'c1', deal_id: 7, project_id: 5, round_label: 'Seed', instrument: 'Post-money SAFE', template_slug: null, currency: 'USD', status: 'open',
  deadline: '2026-11-30', reach: 'all', total_cents: 65000000, line_count: 2, captable: { state: 'not_ready' },
  lines: [
    { uid: 'l1', commitment_id: 31, investor_user_id: 41, investor_name: 'Fund I', route: null, amount_cents: 40000000, currency: 'USD', status: 'open', evidence: [] },
    { uid: 'l2', commitment_id: 32, investor_user_id: 42, investor_name: 'Northwind Syndicate SPV', route: 'syndicate', vehicle_ref: 'syndicate:4', amount_cents: 25000000, currency: 'USD', status: 'sent', evidence: [{ uid: 'e', kind: 'investor_mercury', side: 'sending', created_at: '2026-10-18' }] },
  ],
  events: [
    { event: 'opened', actor_user_id: 1, source_ref: 'deal:7', created_at: '2026-10-03T10:15:00Z' },
    { event: 'route_set', actor_user_id: 1, source_ref: 'route:syndicate', created_at: '2026-10-08T11:30:00Z' },
  ],
};
const AWAITING = { uid: 'st1', title: 'SAFE for Fund I', stages: [{ role: 'company', state: 'signed' }, { role: 'investor', state: 'signed' }, { role: 'axal', state: 'awaiting_release' }] };
const ONE = {
  '/closings': { closings: [{ uid: 'c1', deal_id: 7, project_name: 'Acme Robotics', round_label: 'Seed', status: 'open' }] },
  '/closings/c1': CLOSING,
  '/legal/esign/staged/line/31': { envelopes: [AWAITING] },
  '/legal/esign/staged/line/32': new Error('down'),
  '/deals': [{ id: 7, founder_user_id: 3, project_name: 'Acme Robotics' }],
  '/fund-admin/access': { acts: [{ act: 'closing.countersign', allowed: true, sentence: null }] },
  '/networkfx/syndicates/4': { id: 4, name: 'Northwind Syndicate SPV', members: [{ id: 1, name: 'Lead Member', commitment_cents: 15000000 }] },
  '/networkfx/syndicates': [{ id: 4, name: 'Northwind Syndicate SPV' }],
};
const at = (routes, user) => mount(h(Routes, null, h(Route, { path: '/admin/contracts/closings/:dealId', element: h(AdminClosingPage) })), routes, { url: '/admin/contracts/closings/7', user });

test('one closing as an Admin: lines, routes, paper per line, and no Super Admin act enabled', async () => {
  const prospect = { uid: 'l3', commitment_id: null, prospect_id: 9, investor_user_id: null, investor_name: 'A prospect', route: null, amount_cents: 1000000, currency: 'USD', status: 'open', evidence: [] };
  const v = await at({ ...ONE, '/closings/c1': { ...CLOSING, lines: [...CLOSING.lines, prospect] } }, { id: 2, role: 'admin', is_super_admin: 0 });
  try {
    assert.match(v.text('closing-line-paper-l3'), /Not read here/, 'a prospect has no commitment, so no paper is read for it');
    assert.ok(!v.asked.some((a) => a.path.startsWith('/legal/esign/staged/line/') && !/\/(31|32)$/.test(a.path)));
    assert.ok(v.has('closing-detail'));
    assert.match(v.text('closing-line-route-l1'), /No route chosen/);
    assert.match(v.text('closing-line-paper-l1'), /Waiting for Axal’s countersign/);
    assert.match(v.text('closing-line-paper-l2'), /Unreadable/, 'one failed paper read blanks only its cell');
    assert.match(v.text('closing-line-status-l2'), /Sent, not yet confirmed/);
    assert.match(v.text('closing-tile-committed'), /\$650,000\.00/);
    assert.match(v.text('closing-tile-received'), /\$0\.00/);
    assert.match(v.text('closing-detail-no-route'), /2 lines have no capital route/);
    assert.ok(!v.has('closing-act-countersign-st1'), 'an Admin never sees the countersign button, even when the table allows it');
    assert.equal(v.text('closing-act-countersign-sentence'), ACT_FALLBACK['closing.countersign']);
    assert.equal(v.text('closing-act-commit-sentence'), ACT_FALLBACK['fund_investment.commit']);
    assert.equal(v.text('closing-act-release-sentence'), ACT_FALLBACK['fund_investment.release']);
    assert.equal(v.text('closing-act-call-sentence'), ACT_FALLBACK['capital_call.issue']);
    assert.match(v.text('closing-complete-why'), /received or withdrawn/);
    assert.ok(!v.has('closing-complete'));
  } finally { await v.close(); }
});

test('one closing as the Super Admin: the countersign shows its step-up, opens a dialog, then releases', async () => {
  const fundLine = { ...CLOSING.lines[1], route: 'axal_fund', vehicle_ref: 'Axal Fund I' };
  const v = await at({ ...ONE, '/closings/c1': { ...CLOSING, lines: [CLOSING.lines[0], fundLine] }, 'POST /legal/esign/staged/st1/countersign': { envelope_uuid: 'u', token: 'tok123' } }, { id: 1, role: 'admin', is_super_admin: 1 });
  try {
    await v.click('closing-line-panel-btn-l2');
    assert.equal(v.text('closing-fund-commit-act'), NO_ROUTE_YET);
    assert.ok(!v.has('closing-fund-call-act'), 'a Super Admin issues the call in Fund admin; no sentence refuses them');
    assert.equal(v.text('closing-act-countersign-stepup-st1'), STEP_UP_LINE);
    assert.equal(v.text('closing-act-commit-sentence'), NO_ROUTE_YET, 'no route: no control, even for a Super Admin');
    assert.ok(!v.has('closing-act-call-sentence'));
    assert.ok(!v.asked.some((a) => a.method === 'POST'), 'nothing is asked before the dialog');
    await v.click('closing-act-countersign-st1');
    assert.ok(v.has('closing-countersign-dialog'));
    assert.ok(!v.asked.some((a) => a.method === 'POST'));
    await v.click('closing-countersign-confirm');
    assert.ok(v.asked.some((a) => a.method === 'POST' && a.path === '/legal/esign/staged/st1/countersign'));
    assert.ok(v.links().includes('/esign/tok123'));
  } finally { await v.close(); }
});

test('CP5: the route dialog lists each route’s needs and sets a syndicate by its id', async () => {
  const v = await at({ ...ONE, 'PUT /closings/c1/lines/l1/route': { ok: true } });
  try {
    await v.click('closing-line-route-btn-l1');
    assert.ok(v.has('closing-route-dialog'));
    assert.match(v.text('closing-route-direct-paper'), /Waiting for Axal’s countersign/);
    assert.match(v.text('closing-route-syndicate'), /Not read here yet/);
    await v.click('closing-route-save');
    assert.match(v.text('closing-route-error'), /Choose a route|not named/);
    const radio = v.by('closing-route-syndicate').childNodes[0].childNodes[0];
    const rp = Object.entries(radio).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { rp.onChange({ target: { checked: true } }); });
    await new Promise((r) => setTimeout(r, 0)); await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    await v.click('closing-route-save');
    assert.match(v.text('closing-route-error'), /SPV this line goes through is not named/);
    assert.ok(!v.asked.some((a) => a.method === 'PUT'), 'nothing is sent without the vehicle');
    await v.change('closing-route-vehicle', 'syndicate:4');
    await v.click('closing-route-save');
    const put = v.asked.find((a) => a.method === 'PUT');
    assert.deepEqual(put.body, { route: 'syndicate', vehicle_ref: 'syndicate:4' });
  } finally { await v.close(); }
});

test('CP6 and CP7: the SPV’s members from its syndicate; the fund card links Fund admin and redraws nothing', async () => {
  const v = await at({ ...ONE, '/closings/c1': { ...CLOSING, lines: [CLOSING.lines[1], { ...CLOSING.lines[0], route: 'axal_fund', vehicle_ref: 'Axal Fund I' }] } }, { id: 2, role: 'admin', is_super_admin: 0 });
  try {
    await v.click('closing-line-panel-btn-l2');
    assert.match(v.text('closing-spv'), /Northwind Syndicate SPV/);
    assert.match(v.text('closing-spv-members'), /Lead Member \$150,000\.00 Not read here yet/);
    assert.match(v.text('closing-spv-payment'), /Sent, not yet confirmed/);
    await v.click('closing-line-panel-btn-l1');
    assert.ok(v.has('closing-fund-card') && !v.has('closing-spv'));
    assert.ok(v.links().includes('/admin/fund-admin/calls'));
    assert.equal(v.text('closing-fund-commit-act'), ACT_FALLBACK['fund_investment.commit']);
    assert.equal(v.text('closing-fund-release-act'), ACT_FALLBACK['fund_investment.release']);
  } finally { await v.close(); }
});

test('CP8: a third-party fund is recorded by its name only, with the line’s evidence', async () => {
  const v = await at({ ...ONE, 'PUT /closings/c1/lines/l2/route': { ok: true } });
  try {
    await v.click('closing-line-third-btn-l2');
    // D1317: the shared Sheet, 560px.
    assert.equal(v.props('closing-third-party').role, 'dialog');
    assert.ok(v.props('closing-third-party')['aria-labelledby']);
    assert.equal(v.props('closing-third-party')['data-width'], 560);
    assert.match(v.text('closing-third-party'), /does not run the fund’s calls or hold its money/);
    assert.match(v.text('closing-third-party-evidence'), /Sending side · investor_mercury/);
    await v.change('closing-third-party-name', 'Harbor Ventures III, L.P.');
    await v.click('closing-third-party-save');
    const put = v.asked.find((a) => a.method === 'PUT');
    assert.equal(put.path, '/closings/c1/lines/l2/route');
    assert.deepEqual(put.body, { route: 'third_party_fund', vehicle_ref: 'Harbor Ventures III, L.P.' });
  } finally { await v.close(); }
});

test('CP3: a counsel draft is never sent; counsel’s text fills from reads and sends in order, Axal last', async () => {
  const draft = Object.assign(new Error('This is a counsel draft. It can be previewed, never sent, until counsel’s text is on file (D578).'), { status: 409, code: 'counsel_draft_only' });
  let previews = 0;
  const preview = (body) => {
    previews += 1;
    if (body.document_type === 'safe') return draft;
    const open = ['company_name', 'investor_name', 'purchase_amount', 'governing_law'].filter((k) => !body.fields?.[k]);
    return { sendable: open.length === 0, title: 'SPV Joinder', body: 'text', line: null, unfilled: open };
  };
  const v = await at({ ...ONE, 'POST /legal/esign/staged/preview': preview, 'POST /legal/esign/staged': { uid: 'new' } });
  try {
    await v.click('closing-line-paper-btn-l1');
    // D1317: the shared Sheet, 640px.
    assert.equal(v.props('closing-paper-drawer').role, 'dialog');
    assert.ok(v.props('closing-paper-drawer')['aria-labelledby']);
    assert.equal(v.props('closing-paper-drawer')['data-width'], 640);
    await v.click('closing-paper-preview');
    assert.match(v.text('closing-paper-error'), /counsel draft/);
    assert.equal(v.props('closing-paper-send').disabled, true);
    const radio = v.by('closing-paper-type-spv_joinder').childNodes[0];
    await act(async () => { Object.entries(radio).find(([k]) => k.startsWith('__reactProps$'))[1].onChange({ target: { checked: true } }); });
    await v.click('closing-paper-preview');
    assert.match(v.text('closing-paper-field-company_name'), /From the deal/);
    assert.match(v.text('closing-paper-field-purchase_amount'), /From the line/);
    assert.ok(v.has('closing-paper-amount-match'));
    assert.ok(v.has('closing-paper-eadwyn'));
    assert.equal(v.props('closing-paper-send').disabled, true, 'a field is still open');
    const gov = v.by('closing-paper-field-governing_law').childNodes.find((n) => String(n.tagName).toUpperCase() === 'INPUT');
    await act(async () => { Object.entries(gov).find(([k]) => k.startsWith('__reactProps$'))[1].onChange({ target: { value: 'Delaware' } }); });
    await v.click('closing-paper-preview');
    assert.equal(v.props('closing-paper-send').disabled, false);
    await v.click('closing-paper-send');
    assert.ok(v.has('closing-paper-confirm-line'));
    assert.ok(!v.asked.some((a) => a.method === 'POST' && a.path === '/legal/esign/staged'), 'nothing sends before the confirm');
    await v.click('closing-paper-send-confirm');
    const start = v.asked.find((a) => a.method === 'POST' && a.path === '/legal/esign/staged');
    assert.deepEqual(start.body.signers, [{ role: 'company', user_id: 3 }, { role: 'investor', user_id: 41 }]);
    assert.equal(start.body.countersign, true);
    assert.equal(start.body.commitment_id, 31);
    assert.equal(start.body.fields.purchase_amount, '$400,000.00');
    assert.equal(start.body.fields.governing_law, 'Delaware');
    assert.ok(previews >= 3);
  } finally { await v.close(); }
});

test('CP15: the activity drawer, newest first and filtered by step', async () => {
  const v = await at(ONE);
  try {
    await v.click('closing-open-activity');
    // D1317: the shared Sheet, 640px.
    assert.equal(v.props('closing-activity-drawer').role, 'dialog');
    assert.ok(v.props('closing-activity-drawer')['aria-labelledby']);
    assert.equal(v.props('closing-activity-drawer')['data-width'], 640);
    assert.match(v.text('closing-activity-list'), /^Account #1 · Set a line’s route to Syndicate \(SPV\).*Account #1 · Opened the closing/);
    await v.click('closing-activity-step-3');
    assert.doesNotMatch(v.text('closing-activity-list'), /Opened/);
    await v.click('closing-activity-step-6');
    assert.ok(v.has('closing-activity-empty'));
  } finally { await v.close(); }
});

test('a deal with no closing draws its room and offers Open a closing; a failed list read says so', async () => {
  const v = await at({ ...ONE, '/closings': { closings: [] }, '/deals/7': { id: 7 }, '/deals/7/commitments': [] });
  try {
    assert.ok(v.has('admin-closing-none') && v.has('closing-room'));
    assert.ok(!v.asked.some((a) => a.path === '/closings/c1'));
  } finally { await v.close(); }
  const e = await at({ ...ONE, '/closings': new Error('down') });
  try { assert.match(e.text('admin-closing'), /The closings could not be read/); } finally { await e.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring and dark
 * ------------------------------------------------------------------ */

test('the Closings tab is in Contracts’ tab row, and the old door is gone', () => {
  const desk = read('frontend/src/pages/admin/contracts/ContractsDesk.jsx');
  const nav = desk.slice(desk.indexOf('<nav aria-label="Contracts tabs"'), desk.indexOf('</nav>'));
  assert.ok(nav.includes('<Link to="/admin/contracts/closings"'), 'the tab sits inside the tab row');
  assert.ok(nav.includes('data-testid="contracts-tab-closings">Closings</Link>'));
  assert.ok(!desk.includes('contracts-closings-door'));
});

test('dark: every light surface, text and border in the desk’s files has its dark counterpart', () => {
  const files = ['ClosingsPages.jsx', 'AdminClosing.jsx', 'ClosingDialogs.jsx', 'PaperDrawer.jsx', 'RoutePanels.jsx', 'ActivityDrawer.jsx'];
  for (const f of files) {
    // Comments carry straight apostrophes that would pair quotes wrongly, so they go first.
    const src = read(`frontend/src/pages/closing/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    // Every quoted string on its own, so a class held in a const and each branch of a ternary are read alone:
    // a template's static text, then the quoted strings inside its expressions and outside any template.
    const strings = [];
    const rest = src.replace(/`([^`]*)`/g, (_, body) => {
      for (const part of body.split(/\$\{[^}]*\}/)) strings.push(part);
      for (const expr of body.match(/\$\{[^}]*\}/g) || []) for (const q of expr.matchAll(/'([^'\n]*)'/g)) strings.push(q[1]);
      return '""';
    });
    for (const q of rest.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) strings.push(q[1] ?? q[2]);
    for (const cls of strings) {
      if (!/(^|\s)(bg|text|border)-[a-z]/.test(cls)) continue;
      for (const [light, dark] of [[/(^|\s)bg-(white|gray-50|gray-100|violet-50|amber-50|sky-50)\b/, /dark:bg-/], [/(^|\s)text-(gray-[5-9]00|red-700|amber-[78]00|emerald-700|violet-[89]00|sky-900)\b/, /dark:text-/], [/(^|\s)border-(gray-[123]00|violet-[25]00)\b/, /dark:border-/]]) {
        if (light.test(cls)) assert.ok(dark.test(cls), `${f}: "${cls}" has no ${dark.source}`);
      }
    }
  }
});

test('the client: the staged routes the desk calls are mounted on the Worker', () => {
  const client = read('frontend/src/lib/api/closings.js');
  const esign = read('cloudflare-worker/src/routes/esign.ts');
  for (const r of ["'/staged/preview'", "'/staged'", "'/staged/line/:commitmentId'", "'/staged/:uid'", "'/staged/:uid/countersign'"]) assert.ok(esign.includes(r), r);
  for (const p of ["staged('/preview')", 'staged()', 'staged(`/line/', '/countersign`)']) assert.ok(client.includes(p), p);
});
