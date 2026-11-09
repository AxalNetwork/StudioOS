/**
 * D4814 (#4814) — Admin › Approvals v2, part 3: the native boards' one grammar
 * (AP-08 to AP-13).
 *
 * Breadcrumb Approvals › Lanes › board, the canvas's status tabs, the same
 * four-cell summary (waiting · Overdue · Unassigned · Oldest, or Co-marketing's
 * Approved, not published), the queue with Owner and Review →, the drawer with
 * the owner first and "Decided here, in Approvals", and the decision dialog
 * that says what changes, who is told and what is recorded before any field.
 * Co-marketing keeps approval and publication as two steps; Wellbeing puts
 * credentials first. Owners come from the inbox's assignment record, joined
 * on each item's numeric id; one not read is "Not read", never "Unassigned".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814_part3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import {
  BOARD_LANE, DECIDED_HERE, boardCrumb, boardStrip, lifecycleSteps, ownersOf, readLaneOwners, rowOwner, slaOfBand,
} from '../src/pages/admin/approvals/boardGrammar.js';
import LaneBoards from '../src/pages/admin/approvals/LaneBoards.jsx';

const h = React.createElement;
const ADMIN = { id: 7, role: 'admin', is_super_admin: 0, email: 'a@example.com', name: 'Admin A' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

// ---------------------------------------------------------------- stores

const TESTERS = [
  { id: 1, status: 'applied', applied_at: iso(100), availability: '3 hours a week', consent_email_at: iso(100), consent_version: 'v2', member: { name: 'Gus Demo', email: 'gus@example.com', email_verified: 1, role: 'investor' } },
  { id: 3, status: 'applied', applied_at: iso(30), member: { name: 'Ben Sample', email: 'ben@example.com', email_verified: 1, role: 'founder' } },
  { id: 2, status: 'active', applied_at: iso(900), member: { name: 'Eva Demo', email: 'eva@example.com', email_verified: 1, role: 'advisor' } },
];
const PITCHES = {
  proposed: [{ id: 31, uid: 'p1', title: 'Hiring your first engineer', asset_type: 'webinar', partner_company: 'Partner A', partner_name: 'Chloé Placeholder', created_at: iso(26), proposed_date: '2026-12-03', target_audience: 'Founders' }],
  approved: [{ id: 32, uid: 'p2', title: 'Fundraising digest', asset_type: 'newsletter', partner_company: 'Partner B', reviewed_at: iso(200), attribution_code: 'CM-1' }],
  published: [],
};
const EXPERTS = [
  { id: 51, uid: 'e1', name: 'Eva Expert', headline: 'Clinical psychologist', decision_state: 'pending', profile_completion_pct: 92, review_version: 3, created_at: iso(103), credentials: { licence_number: 'PYL-1', issuer: 'Register', expires_on: '2030-01-01', files: [{ uid: 'f1', file_name: 'Licence.pdf', url: '/f1' }] } },
];
// The inbox, filtered to one lane, as the Worker answers it: numeric ids, assignees.
const LANE_ITEMS = {
  product_testers: [{ lane: 'product_testers', id: 1, assignee: { user_id: 8, name: 'Admin B' } }, { lane: 'product_testers', id: 3, assignee: null }],
  comarketing: [{ lane: 'comarketing', id: 31, assignee: null }],
  wellbeing_experts: [{ lane: 'wellbeing_experts', id: 51, assignee: { user_id: 7, name: 'Admin A' } }],
};
const REVIEWERS = [{ id: 7, name: 'Admin A' }, { id: 8, name: 'Admin B' }];

async function mount(url, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  globalThis.localStorage?.setItem?.('user', JSON.stringify(ADMIN));
  const seen = [];
  const posts = [];
  globalThis.fetch = async (u, init = {}) => {
    const x = new URL(String(u), 'http://x');
    const path = x.pathname;
    const q = x.searchParams;
    seen.push(`${path}${x.search}`);
    if (init.method === 'POST') { posts.push({ path, body: JSON.parse(init.body || '{}') }); return json({ ok: true, assigned: [] }); }
    if (path === '/api/auth/me') return json(ADMIN);
    if (path === '/api/admin/approvals') {
      if (over.inbox) return over.inbox(q);
      const items = LANE_ITEMS[q.get('lane')] || [];
      return json({ items, total: items.length, page: 1, page_size: 25, reviewers: REVIEWERS, tiles: { per_admin: [{ id: 7, count: 1 }, { id: 8, count: 4 }] }, assignments: { available: true } });
    }
    if (path === '/api/admin/product-testers') return json({ rows: TESTERS, matching: TESTERS.length, totals: { applied: 2, active: 1, paused: 0, declined: 0, removed: 0 } });
    const t = /^\/api\/admin\/product-testers\/(\d+)$/.exec(path);
    if (t) { const row = TESTERS.find((r) => r.id === Number(t[1])); return row ? json({ tester: row, programs: [], events: [] }) : json({ code: 'not_found' }, 404); }
    if (path === '/api/comarketing/admin/queue') { const items = PITCHES[q.get('status')] || []; return json({ items, total: items.length, attribution_30d: { visit: 0, signup: 0 } }); }
    const pm = /^\/api\/comarketing\/admin\/pitches\/([^/]+)$/.exec(path);
    if (pm) { const p = Object.values(PITCHES).flat().find((x) => x.uid === pm[1]); return json({ ...p, status: Object.keys(PITCHES).find((k) => PITCHES[k].includes(p)), decided: null }); }
    if (path === '/api/wellbeing/admin/experts') return json({ items: EXPERTS, total: EXPERTS.length });
    const em = /^\/api\/wellbeing\/admin\/experts\/([^/]+)\/review$/.exec(path);
    if (em) return json({ expert: EXPERTS.find((e) => e.uid === em[1]), history: [] });
    return json({}, 404);
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null, h(Route, { path: '*', element: h(LaneBoards) })), h(Probe)))); });
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, key: '', preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    seen, posts, at,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked: true } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; globalThis.localStorage?.removeItem?.('user'); restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('owners: the inbox filtered to a lane, read page by page; complete only when the last page was read', async () => {
  assert.deepEqual(BOARD_LANE, { 'product-testers': 'product_testers', 'co-marketing': 'comarketing', 'wellbeing-experts': 'wellbeing_experts' });
  const pages = { 1: { items: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, assignee: null })), total: 30, page_size: 25 }, 2: { items: Array.from({ length: 5 }, (_, i) => ({ id: i + 26, assignee: null })), total: 30, page_size: 25 } };
  const asked = [];
  const got = await readLaneOwners(async (p) => { asked.push(p); return pages[p]; });
  assert.deepEqual(asked, [1, 2]);
  assert.equal(got.items.length, 30);
  assert.equal(got.complete, true);
  const capped = await readLaneOwners(async () => pages[1], 1);
  assert.equal(capped.complete, false, 'stopped at the page cap with more to read');
});

test('rowOwner: Unassigned, a name, or "Not read" — a missing or unread record is never "Unassigned"', () => {
  const ready = ownersOf({ status: 'ready', reply: { first: { assignments: { available: true } }, items: LANE_ITEMS.product_testers, complete: true } });
  assert.deepEqual(rowOwner(ready, 3), { kind: 'none', text: 'Unassigned' });
  assert.equal(rowOwner(ready, 1).text, 'Admin B');
  assert.equal(rowOwner(ready, 99).kind, 'unread', 'not on the read');
  const off = ownersOf({ status: 'ready', reply: { first: { assignments: { available: false, reason: 'Not readable.' } }, items: [], complete: true } });
  assert.equal(off.state, 'unread');
  assert.equal(rowOwner(off, 3).kind, 'unread');
  assert.equal(rowOwner(ownersOf({ status: 'error', error: new Error('x') }), 3).kind, 'unread');
  assert.equal(rowOwner(ownersOf({ status: 'loading' }), 3).kind, 'loading');
});

test('the four-cell summary: Overdue, Unassigned and Oldest only over every waiting item; a measured 0 says so', () => {
  const owners = ownersOf({ status: 'ready', reply: { first: {}, items: LANE_ITEMS.product_testers, complete: true } });
  const rows = [{ id: 1, name: 'Gus', ageHours: 100, age: '4 d 4 h', band: { key: 'past' } }, { id: 3, name: 'Ben', ageHours: 30, age: '1 d 6 h', band: { key: 'due' } }];
  const cells = boardStrip({ status: 'ready', label: 'Pending', total: 2, rows, complete: true, owners, noun: 'applications' });
  assert.deepEqual(cells.map((c) => [c.key, c.value, c.sub]), [['waiting', '2', 'applications'], ['overdue', '1', 'over 72 hours'], ['unassigned', '1', 'of 2'], ['oldest', '4 d 4 h', 'Gus']]);
  assert.equal(cells[1].tone, 'bad');
  assert.equal(cells[2].tone, 'warn');
  const none = boardStrip({ status: 'ready', label: 'Pending', total: 1, rows: [rows[1]], complete: true, owners });
  assert.deepEqual([none[1].value, none[1].sub, none[1].tone], ['0', 'measured · nothing over 72 h', null]);
  const short = boardStrip({ status: 'ready', label: 'Pending', total: 80, rows, complete: false, owners });
  assert.deepEqual(short.slice(1).map((c) => c.state), ['unreadable', 'unreadable', 'unreadable'], 'a short read draws no Overdue, Unassigned or Oldest');
  assert.equal(short[0].value, '80', 'the waiting figure is the store\'s own count');
  const missing = boardStrip({ status: 'ready', label: 'Pending', total: 3, rows: [...rows, { id: 99, ageHours: 1, band: { key: 'ok' } }], complete: true, owners });
  assert.equal(missing[2].state, 'unreadable', 'an item the owner read did not reach: no Unassigned count');
  assert.ok(boardStrip({ status: 'error', label: 'Pending' }).every((c) => c.state === 'unreadable'));
  assert.equal(slaOfBand({ key: 'past' }), 'past');
  assert.equal(slaOfBand({ key: 'due' }), 'due_soon');
  assert.equal(slaOfBand({ key: 'ok' }), null);
});

test('Co-marketing\'s lifecycle keeps approval and publication two steps; a declined pitch has left the line', () => {
  assert.deepEqual(lifecycleSteps('approved').map((s) => [s.key, s.current]), [['proposed', false], ['approved', true], ['published', false]]);
  assert.ok(lifecycleSteps('rejected').every((s) => !s.current));
  assert.match(lifecycleSteps('proposed')[2].note, /separate step/);
  assert.deepEqual(boardCrumb('Product testers'), { to: '/admin/approvals', label: 'Approvals', via: { to: '/admin/approvals/lanes', label: 'Lanes' }, current: 'Product testers' });
});

// ---------------------------------------------------------------- mounted

test('mounted AP-08: Product testers — Approvals › Lanes, Pending, the summary, Owner and Review →, the pool after the queue', async () => {
  const v = await mount('/admin/approvals/product-testers');
  try {
    assert.match(v.of('admin-page-crumb'), /Approvals\s*›\s*Lanes\s*›\s*Product testers/);
    assert.equal(v.props('admin-page-crumb-via').href, '/admin/approvals/lanes');
    assert.match(v.of('testers-tab-waiting'), /^Pending/);
    assert.ok(v.seen.includes('/api/admin/approvals?page=1&lane=product_testers'), 'owners come from the inbox, filtered to the lane');
    assert.deepEqual(['waiting', 'overdue', 'unassigned', 'oldest'].map((k) => v.of(`testers-strip-${k}-value`)), ['2', '1', '1', '4 d 4 h']);
    assert.match(v.of('tester-owner-3'), /^Unassigned\s*Assign$/);
    assert.equal(v.of('tester-owner-1'), 'Admin B');
    assert.equal(v.of('tester-open-1'), 'Review →');
    assert.match(v.of('tester-1'), /! Overdue/);
    assert.match(v.of('tester-3'), /◷ Due soon/);
    const order = v.ids('');
    assert.ok(order.indexOf('testers-strip') < order.indexOf('testers-table'), 'the summary leads into the queue');
    assert.ok(order.indexOf('testers-table') < order.indexOf('testers-pool'), 'the pool is after the queue');
    await v.click('tester-owner-assign-3');
    assert.match(v.of('approvals-assign'), /Assign Ben Sample’s item.*Assigning changes ownership only/s);
    await v.change('approvals-assign-pick-8');
    await v.click('approvals-assign-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/approvals/assignments', body: { assignee_user_id: 8, items: [{ lane: 'product_testers', item_id: 3 }] } }]);
    assert.match(v.of('board-done'), /Ben Sample is now assigned to Admin B\./);
  } finally { await v.unmount(); }
});

test('mounted AP-09: the tester drawer puts the owner first; Assign to me assigns; the dialog says what changes, who is told and what is recorded first', async () => {
  const v = await mount('/admin/approvals/product-testers/3');
  try {
    const order = v.ids('tester-');
    assert.ok(order.indexOf('tester-owner') < order.indexOf('tester-answers'), 'owner before the application');
    assert.match(v.of('tester-owner'), /Owner\s*Unassigned\s*Nobody owns this item yet\s*Assign to me\s*Change…/);
    assert.equal(v.of('tester-decided-here'), DECIDED_HERE);
    await v.click('tester-owner-take');
    assert.deepEqual(v.posts.at(-1), { path: '/api/admin/approvals/assignments', body: { assignee_user_id: 7, items: [{ lane: 'product_testers', item_id: 3 }] } });
    assert.match(v.of('board-done'), /Ben Sample is now assigned to you\./);
    await v.click('tester-action-approve');
    assert.match(v.of('tester-dialog-approve-explain'), /^What changes.*Who is told.*What is recorded/s);
    const fields = v.ids('tester-dialog-');
    assert.ok(fields.indexOf('tester-dialog-approve-explain') < fields.indexOf('tester-dialog-note'), 'the three lines come before any field');
  } finally { await v.unmount(); }
});

test('mounted AP-10/11: Co-marketing — the lifecycle on the board and in the drawer, Approved not published, owner by numeric id', async () => {
  const v = await mount('/admin/approvals/co-marketing');
  try {
    assert.match(v.of('pitches-lifecycle'), /1 · Proposed — review here\s*2 · Approved — attribution code issued\s*3 · Published — a separate step, from Approved/);
    assert.match(v.of('pitches-strip'), /Proposed\s*1.*Overdue\s*0\s*measured · nothing over 72 h.*Unassigned\s*1\s*of 1.*Approved, not published\s*1\s*oldest/s);
    assert.match(v.of('pitch-owner-p1'), /^Unassigned\s*Assign$/, 'the uid-keyed row finds its owner by numeric id');
    const order = v.ids('');
    assert.ok(order.indexOf('pitches-table') < order.indexOf('pitches-results'), 'results after the queue');
  } finally { await v.unmount(); }
  const d = await mount('/admin/approvals/co-marketing/p1');
  try {
    assert.match(d.of('pitch-lifecycle'), /Proposed.*Approved.*Published.*Approving does not publish\./s);
    const order = d.ids('pitch-');
    assert.ok(order.indexOf('pitch-lifecycle') < order.indexOf('pitch-owner'), 'lifecycle, then the owner');
    assert.match(d.of('pitch-owner'), /Unassigned/);
    assert.equal(d.of('pitch-decided-here'), DECIDED_HERE);
    await d.click('pitch-action-approve');
    assert.match(d.of('pitch-dialog-approve-changes'), /Nothing is published yet\./);
  } finally { await d.unmount(); }
});

test('mounted AP-12/13: Wellbeing — Needs verification, Verify →, credentials first, the register note, an explicit acknowledgement', async () => {
  const v = await mount('/admin/approvals/wellbeing-experts');
  try {
    assert.match(v.of('experts-tab-verify'), /^Needs verification/);
    assert.equal(v.of('expert-open-e1'), 'Verify →');
    assert.match(v.of('expert-owner-e1'), /Admin A\s*· you/);
    assert.deepEqual(['waiting', 'overdue', 'unassigned'].map((k) => v.of(`experts-strip-${k}-value`)), ['1', '1', '0']);
  } finally { await v.unmount(); }
  const d = await mount('/admin/approvals/wellbeing-experts/e1');
  try {
    const order = d.ids('expert-');
    assert.ok(order.indexOf('expert-credentials') < order.indexOf('expert-owner'), 'credentials and evidence come first');
    assert.match(d.of('expert-register-note'), /Register lookups aren’t automated/);
    assert.match(d.of('expert-owner'), /Admin A · you\s*Change…$/, 'the caller owns it: no Assign to me');
    await d.click('expert-action-verify');
    assert.match(d.of('expert-dialog-verify'), /I have checked their licence.*Required to verify\./s);
    assert.equal(d.props('expert-dialog-verify-send').disabled, true, 'not until acknowledged');
  } finally { await d.unmount(); }
});

test('mounted: an unread assignment record leaves every owner "Not read" and no Unassigned count', async () => {
  const v = await mount('/admin/approvals/product-testers', { inbox: () => json({ code: 'approvals_unreadable' }, 503) });
  try {
    assert.equal(v.of('tester-owner-3'), 'Not read');
    assert.match(v.of('testers-strip-unassigned'), /Could not be read/);
    assert.equal(v.of('testers-strip-waiting-value'), '2', 'the board\'s own figures stand');
  } finally { await v.unmount(); }
});

test('mounted: an admin the Worker does not list as a reviewer is offered Change… but never Assign to me', async () => {
  const v = await mount('/admin/approvals/product-testers/3', {
    inbox: (q) => json({ items: LANE_ITEMS[q.get('lane')] || [], total: 2, page: 1, page_size: 25, reviewers: [{ id: 8, name: 'Admin B' }], tiles: {}, assignments: { available: true } }),
  });
  try {
    assert.match(v.of('tester-owner'), /Unassigned/);
    assert.ok(!v.has('tester-owner-take'), 'they cannot be assigned, so it is not offered');
    assert.ok(v.has('tester-owner-change'));
  } finally { await v.unmount(); }
});
