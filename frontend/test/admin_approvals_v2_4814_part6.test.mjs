/**
 * D4814 (#4814) — Admin › Approvals v2, part 6: the departures earlier parts
 * left, built where the stores allow.
 *
 * The Assign dialog's reviewer search (AP-05); Decided's Open ↗ opening a
 * product tester or a co-marketing pitch on its own board (AP-07), the pitch
 * by the uid the Worker now sends; and "2 of 6" with ‹ › in each board's
 * drawer, in the tab's own order (AP-09, AP-11, AP-13).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814_part6.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { boardStep } from '../src/pages/admin/approvals/boardGrammar.js';
import { decidedItemPath, matchReviewers } from '../src/pages/admin/approvals/lanesDecidedModel.js';
import { decidedRows } from '../src/pages/admin/approvals/inboxModel.js';
import LaneBoards from '../src/pages/admin/approvals/LaneBoards.jsx';
import { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';

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

async function mountPage(url, viewer, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => {
    const x = new URL(String(u), 'http://x');
    seen.push(`${x.pathname}${x.search}`);
    if (x.pathname === '/api/admin/studio/glance') return json(over.glance || { tier: 'hq', approvals: { pending_total: 0, lanes: [], hq_decides: null, no_queue: [] } });
    if (x.pathname === '/api/admin/approvals') return json({ items: [], total: 0, page: 1, page_size: 25, unreadable: [], lanes: [], tiles: {}, reviewers: [] });
    if (x.pathname === '/api/admin/approvals/decided') return json(over.decided);
    if (x.pathname === '/api/admin/approvals/decided/weekly') return json({ weeks: [], totals: {}, tile: null, unreadable: [] });
    return json({});
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(ApprovalsPage, { viewer }) })), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, key: '', preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    seen, at,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    node: byId,
    props: (id) => props(byId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    within: (id, tag) => walk(byId(id)).filter((n) => n.tagName === tag).map(props),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value, checked = true) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}


// ---------------------------------------------------------------- the model

test('boardStep: "2 of 3" with the rows either side, in the list given; not in the list is null', () => {
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const s = boardStep(rows, 'b');
  assert.deepEqual([s.pos, s.prev.key, s.next.key], ['2 of 3', 'a', 'c']);
  assert.equal(boardStep(rows, 'a').prev, null);
  assert.equal(boardStep(rows, 'c').next, null);
  assert.equal(boardStep(rows, 'z'), null, 'opened from a link: no position is invented');
  assert.equal(boardStep([{ key: 7 }], '7').pos, '1 of 1', 'a numeric id from the address matches');
});

test('decidedItemPath: a tester by id, a pitch by its uid, every other lane its own page', () => {
  const rows = decidedRows({ items: [
    { lane: 'product_testers', item_id: 3, decided_at: '2026-11-01 10:00:00' },
    { lane: 'comarketing', item_id: 31, item_uid: 'pitch-abc', decided_at: '2026-11-01 10:00:00' },
    { lane: 'comarketing', item_id: 32, decided_at: '2026-11-01 10:00:00' },
    { lane: 'kyc', item_id: 4, decided_at: '2026-11-01 10:00:00' },
  ] });
  assert.deepEqual(rows.map(decidedItemPath), ['/admin/approvals/product-testers/3', '/admin/approvals/co-marketing/pitch-abc', null, null],
    'a pitch without a uid from the Worker opens its lane, never a guessed address');
});

test('matchReviewers: names, ignoring case and spaces around; empty is everyone', () => {
  const list = [{ name: 'Admin A' }, { name: 'Bea Builder' }, { name: 'admin c' }];
  assert.deepEqual(matchReviewers(list, ' ADMIN ').map((c) => c.name), ['Admin A', 'admin c']);
  assert.equal(matchReviewers(list, '').length, 3);
});

// ---------------------------------------------------------------- mounted

test('mounted AP-09: the tester drawer says where it stands in Pending and steps with ‹ ›, keeping the tab', async () => {
  const v = await mount('/admin/approvals/product-testers/1');
  try {
    assert.equal(v.of('tester-step-pos'), '1 of 2');
    assert.ok(!v.has('tester-step-prev'), 'the first has no previous');
    assert.equal(v.props('tester-step-next').href, '/admin/approvals/product-testers/3');
    await v.click('tester-step-next');
    assert.equal(v.at.path, '/admin/approvals/product-testers/3');
    assert.equal(v.of('tester-step-pos'), '2 of 2');
    assert.equal(v.props('tester-step-prev').href, '/admin/approvals/product-testers/1');
  } finally { await v.unmount(); }
});

test('mounted AP-05: the Assign dialog searches reviewers by name and says when none match', async () => {
  const v = await mount('/admin/approvals/product-testers');
  try {
    await v.click('tester-owner-assign-3');
    assert.ok(v.has('approvals-assign-7') && v.has('approvals-assign-8'));
    await v.change('approvals-assign-search', 'b');
    assert.ok(!v.has('approvals-assign-7') && v.has('approvals-assign-8'), 'only Admin B');
    await v.change('approvals-assign-search', 'zed');
    assert.match(v.of('approvals-assign-none'), /No reviewer is called “zed”\./);
  } finally { await v.unmount(); }
});

test('mounted AP-07: Decided opens a tester or a pitch on its board, and any other lane on its own page', async () => {
  const decided = { page: 1, page_size: 25, total: 3, unreadable: [], lanes: [], deciders: [], items: [
    { lane: 'product_testers', lane_label: 'Product testers', item_id: 3, who: 'Ben', outcome: 'approved', outcome_word: 'Approved', decided_at: '2026-11-03 10:00:00', decided_by: { id: 7, name: 'Admin A' }, wait_hours: 4 },
    { lane: 'comarketing', lane_label: 'Co-marketing', item_id: 31, item_uid: 'pitch-abc', who: 'Partner A', outcome: 'approved', outcome_word: 'Approved', decided_at: '2026-11-02 10:00:00', decided_by: { id: 7, name: 'Admin A' }, wait_hours: 4 },
    { lane: 'kyc', lane_label: 'KYC', item_id: 4, who: 'Cara', outcome: 'approved', outcome_word: 'Approved', decided_at: '2026-11-01 10:00:00', decided_by: { id: 7, name: 'Admin A' }, wait_hours: 4 },
  ] };
  const v = await mountPage('/admin/approvals/decided', { id: 7, role: 'admin', is_super_admin: 1 }, { decided });
  try {
    assert.equal(v.props('approvals-decided-open-product_testers:3:2026-11-03 10:00:00').href, '/admin/approvals/product-testers/3');
    assert.equal(v.of('approvals-decided-open-product_testers:3:2026-11-03 10:00:00'), 'Open ↗');
    assert.equal(v.props('approvals-decided-open-comarketing:31:2026-11-02 10:00:00').href, '/admin/approvals/co-marketing/pitch-abc');
    assert.match(v.of('approvals-decided-open-kyc:4:2026-11-01 10:00:00'), /^Open in KYC & KYB ↗$/);
  } finally { await v.unmount(); }
});
