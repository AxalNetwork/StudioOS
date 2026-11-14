/**
 * D4814 (#4814) — Admin › Approvals v2, part 8: the native boards' queue
 * grammar completed (AP-08, AP-10, AP-12). A board's waiting tab selects rows
 * as the Inbox does (AP-03): a box on each row, a header box that is mixed for
 * some, and a bar floating over the queue — "N selected · Assign… · Clear".
 * Each row has ⋯ (the canvas's More column): Assign… and Copy link. Assigning
 * changes ownership only; a decision is still one item at a time, in its
 * drawer. Also: a board's line offers View in Decided only after a decision.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814_part8.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { afterDecision, pickState } from '../src/pages/admin/approvals/boardGrammar.js';
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

test('pickState: only the rows on screen count; all, mixed and none; the bar\'s line', () => {
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  assert.deepEqual(pickState(new Set(), rows), { picked: [], all: false, some: false, line: '0 selected' });
  const some = pickState(new Set(['a', 'c']), rows);
  assert.deepEqual([some.picked.map((r) => r.key), some.all, some.some, some.line], [['a', 'c'], false, true, '2 selected']);
  const all = pickState(new Set(['a', 'b', 'c']), rows);
  assert.deepEqual([all.all, all.some], [true, false]);
  // A key from another page or tab is never sent.
  assert.deepEqual(pickState(new Set(['z', 'a']), rows).picked.map((r) => r.key), ['a']);
  assert.equal(pickState(new Set(['a']), []).all, false, 'an empty tab is never "all picked"');
});

test('afterDecision marks a recorded decision, so only it offers View in Decided', () => {
  assert.equal(afterDecision('Gus is a tester now.', { notified: true }, 'Gus').decided, true);
  assert.equal(afterDecision('x', { notified: false }, 'Gus').decided, undefined, 'the not-delivered warning offers Check item instead');
});

// ---------------------------------------------------------------- mounted

test('mounted AP-08: Product testers — pick two, the bar says so, Assign… sends both and clears the pick', async () => {
  const v = await mount('/admin/approvals/product-testers');
  try {
    assert.ok(v.has('testers-pick-all') && v.has('tester-pick-1') && v.has('tester-pick-3'), 'a box on each waiting row and in the header');
    assert.equal(v.has('testers-bulk'), false, 'no bar until something is picked');
    await v.change('tester-pick-1');
    assert.equal(v.of('testers-bulk-count'), '1 selected');
    assert.equal(v.props('testers-pick-all').checked, false);
    assert.equal(v.props('tester-1')['aria-selected'], true);
    await v.change('testers-pick-all');
    assert.equal(v.of('testers-bulk-count'), '2 selected');
    assert.equal(v.props('testers-pick-all').checked, true);
    await v.click('testers-bulk-assign');
    assert.match(v.of('approvals-assign'), /Assign 2 items.*Assigning changes ownership only/s);
    await v.change('approvals-assign-pick-8');
    await v.click('approvals-assign-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/approvals/assignments', body: { assignee_user_id: 8, items: [{ lane: 'product_testers', item_id: 1 }, { lane: 'product_testers', item_id: 3 }] } }]);
    assert.equal(v.has('testers-bulk'), false, 'the pick is cleared once assigned');
    assert.equal(v.has('board-done-decided'), false, 'an assignment is not a decision: no View in Decided');
  } finally { await v.unmount(); }
});

test('mounted: Clear empties the pick; only the waiting tab selects', async () => {
  const v = await mount('/admin/approvals/product-testers');
  try {
    await v.change('tester-pick-3');
    await v.click('testers-bulk-clear');
    assert.equal(v.has('testers-bulk'), false);
    assert.equal(v.props('tester-pick-3').checked, false);
  } finally { await v.unmount(); }
  const active = await mount('/admin/approvals/product-testers/active');
  try {
    assert.equal(active.ids('tester-pick-').length, 0, 'Active lists testers already decided: nothing to assign');
    assert.equal(active.has('testers-pick-all'), false);
  } finally { await active.unmount(); }
});

test('mounted: a row\'s ⋯ is a disclosure with Assign… and Copy link; Assign… assigns that row alone', async () => {
  const v = await mount('/admin/approvals/product-testers');
  try {
    assert.equal(v.props('tester-more-3-button')['aria-label'], 'More actions for Ben Sample');
    assert.equal(v.props('tester-more-3-button')['aria-expanded'], false);
    await v.click('tester-more-3-button');
    assert.equal(v.props('tester-more-3-button')['aria-expanded'], true);
    assert.equal(v.props('tester-more-3-pop').role, 'group', 'a disclosure popover, not an ARIA menu');
    assert.deepEqual(v.ids('tester-more-3-').filter((id) => /-(assign|copy)$/.test(id)), ['tester-more-3-assign', 'tester-more-3-copy']);
    await v.click('tester-more-3-assign');
    assert.match(v.of('approvals-assign'), /Assign Ben Sample’s item/);
  } finally { await v.unmount(); }
});

test('mounted AP-10: Co-marketing — Proposed selects, by the pitch\'s numeric id; Approved does not', async () => {
  const v = await mount('/admin/approvals/co-marketing');
  try {
    await v.change('pitches-pick-all');
    assert.equal(v.of('pitches-bulk-count'), '1 selected');
    await v.click('pitches-bulk-assign');
    await v.change('approvals-assign-pick-8');
    await v.click('approvals-assign-send');
    assert.deepEqual(v.posts.at(-1).body, { assignee_user_id: 8, items: [{ lane: 'comarketing', item_id: 31 }] });
  } finally { await v.unmount(); }
  const approved = await mount('/admin/approvals/co-marketing/approved');
  try { assert.equal(approved.ids('pitch-pick-').length, 0); } finally { await approved.unmount(); }
});

test('mounted AP-12: Wellbeing — Needs verification selects and assigns by the expert\'s numeric id', async () => {
  const v = await mount('/admin/approvals/wellbeing-experts');
  try {
    await v.change('expert-pick-e1');
    assert.equal(v.of('experts-bulk-count'), '1 selected');
    await v.click('experts-bulk-assign');
    await v.change('approvals-assign-pick-8');
    await v.click('approvals-assign-send');
    assert.deepEqual(v.posts.at(-1).body, { assignee_user_id: 8, items: [{ lane: 'wellbeing_experts', item_id: 51 }] });
  } finally { await v.unmount(); }
});
