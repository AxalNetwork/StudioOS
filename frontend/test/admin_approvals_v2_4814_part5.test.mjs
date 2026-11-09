/**
 * D4814 (#4814) — Admin › Approvals v2, part 5: the failure and success
 * states (AP-18d, AP-18e, AP-18f), the stale backlog, and Eadwyn's rail
 * collapsed on Approvals (AP-19).
 *
 * A decision another admin got to first says the item changed while you were
 * reviewing it and that nothing of yours was recorded (each such refusal is
 * the Worker's conditional write declining), reloads the item, and offers
 * View latest rather than a second send. A decision recorded but not
 * delivered (`notified: false` from the Worker) says so and asks for a check
 * before any retry. An ordinary decision ends with View in Decided.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814_part5.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { CHANGED_CODES, afterDecision, isChanged } from '../src/pages/admin/approvals/boardGrammar.js';
import { STALE_HOURS, bandedRows, inboxRows } from '../src/pages/admin/approvals/inboxModel.js';
import { railCollapsed } from '../src/ui/railOperations.js';
import LaneBoards from '../src/pages/admin/approvals/LaneBoards.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
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
    if (init.method === 'POST') { const body = JSON.parse(init.body || '{}'); posts.push({ path, body }); return over.post ? over.post(path, body) : json({ ok: true, assigned: [] }); }
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

test('AP-18e: only the refusals that wrote nothing read as "changed while you were reviewing"', () => {
  assert.deepEqual([...CHANGED_CODES].sort(), ['already_decided', 'pitch_decided', 'review_changed', 'tester_changed']);
  assert.equal(isChanged({ status: 409, code: 'tester_changed' }), true);
  assert.equal(isChanged({ status: 409, code: 'email_unverified' }), false, 'a refusal for another reason is not "changed"');
  assert.equal(isChanged({ status: 503, code: 'tester_changed' }), false);
  // Every one of them is the Worker's conditional write declining, so nothing was written.
  const worker = ['cloudflare-worker/src/routes/admin_product_testers.ts', 'cloudflare-worker/src/routes/comarketing.ts', 'cloudflare-worker/src/services/wellbeing/expertReview.ts'].map(read).join('\n');
  for (const code of CHANGED_CODES) assert.match(worker, new RegExp(`'${code}'`), `${code} is a code the Worker sends`);
});

test('AP-18f: a decision recorded but not delivered says so; notified null or missing is the ordinary line', () => {
  assert.deepEqual(afterDecision('Gus is a tester now.', { notified: true }, 'Gus'), { warn: false, text: 'Gus is a tester now.' });
  assert.deepEqual(afterDecision('Gus is a tester now.', { notified: null }, 'Gus'), { warn: false, text: 'Gus is a tester now.' });
  assert.deepEqual(afterDecision('Gus is a tester now.', {}, 'Gus'), { warn: false, text: 'Gus is a tester now.' });
  const warn = afterDecision('Gus is a tester now.', { notified: false }, 'Gus');
  assert.equal(warn.warn, true);
  assert.equal(warn.text, 'The decision was recorded, but the notification could not be delivered.');
  assert.match(warn.sub, /Check the item before trying again — Gus may not know yet\./);
});

test('the stale backlog: past 30 days an overdue item gets its own band, ahead of overdue; an unknown age never does', () => {
  assert.equal(STALE_HOURS, 720);
  const rows = inboxRows({ items: [
    { lane: 'kyc', id: 1, who: 'A', age_hours: 4900, sla: 'past' },
    { lane: 'kyc', id: 2, who: 'B', age_hours: 100, sla: 'past' },
    { lane: 'kyc', id: 3, who: 'C', age_hours: 30, sla: 'due_soon' },
    { lane: 'kyc', id: 4, who: 'D', age_hours: null, sla: 'unknown' },
  ] });
  const lines = bandedRows(rows, undefined);
  assert.deepEqual(lines.map((l) => (l.kind === 'band' ? `[${l.band.key}]` : l.row.id)), ['[stale]', 1, '[past]', 2, '[due_soon]', 3, '[unknown]', 4]);
  assert.match(lines[0].band.text, /Stale · waiting over 30 days · check each is still actionable/);
});

test('AP-19: Approvals and its boards use the operations rail — collapsed on every visit until opened', () => {
  assert.match(read('frontend/src/pages/admin/approvals/AdminApprovals.jsx'), /<AdminBoardFrame workspace="Approvals" note=\{RAIL_NOTE\} operations /);
  assert.match(read('frontend/src/pages/admin/approvals/LaneBoards.jsx'), /<AdminBoardFrame workspace="Approvals" note=\{RAIL_NOTE\} operations /);
  const frame = read('frontend/src/pages/admin/AdminBoardFrame.jsx');
  assert.equal((frame.match(/operations=\{operations\}/g) || []).length, 2, 'both the admin and the Super Admin rail take it');
  assert.equal(railCollapsed({ operations: true, stored: false, visitOpen: false }), true, 'collapsed even for someone who keeps the rail open elsewhere');
  assert.equal(railCollapsed({ operations: true, visitOpen: true }), false);
});

// ---------------------------------------------------------------- mounted

test('mounted AP-18e: a conflict says the item changed, nothing of yours was recorded, reloads it, and offers View latest', async () => {
  const v = await mount('/admin/approvals/co-marketing/p1', {
    post: () => json({ code: 'pitch_decided', message: 'This pitch cannot be approved now. Admin B declined it on 2026-11-09.' }, 409),
  });
  try {
    await v.click('pitch-action-approve');
    const before = v.seen.filter((p) => p === '/api/comarketing/admin/pitches/p1').length;
    await v.click('pitch-dialog-approve-send');
    assert.match(v.of('pitch-dialog-approve-changed'), /This item changed while you were reviewing it\. The latest state has been loaded\. Nothing was recorded by you\.\s*This pitch cannot be approved now\. Admin B declined it/);
    assert.ok(v.seen.filter((p) => p === '/api/comarketing/admin/pitches/p1').length > before, 'the item is read again');
    assert.equal(v.of('pitch-dialog-approve-latest'), 'View latest');
    assert.ok(!v.has('pitch-dialog-approve-send'), 'no second send');
    assert.ok(!v.has('board-done'), 'a refusal is never shown as done');
    await v.click('pitch-dialog-approve-latest');
    assert.ok(!v.has('pitch-dialog-approve'), 'View latest closes the dialog onto the reloaded item');
  } finally { await v.unmount(); }
});

test('mounted AP-18f: recorded but not delivered — an amber line, Check item, no View in Decided', async () => {
  const v = await mount('/admin/approvals/product-testers/3', { post: () => json({ tester: null, action: 'approved', notified: false }) });
  try {
    await v.click('tester-action-approve');
    await v.click('tester-dialog-approve-send');
    assert.match(v.of('board-done'), /The decision was recorded, but the notification could not be delivered\.\s*Check the item before trying again — Ben Sample may not know yet\.\s*Check item/);
    assert.equal(v.props('board-done').role, 'alert');
    assert.ok(!v.has('board-done-decided'));
    await v.click('board-done-check');
    assert.ok(!v.has('board-done'), 'Check item reads the board again and clears the line');
  } finally { await v.unmount(); }
});

test('mounted AP-18d: an ordinary decision ends with View in Decided', async () => {
  const v = await mount('/admin/approvals/product-testers/3', { post: () => json({ tester: null, action: 'approved', notified: true }) });
  try {
    await v.click('tester-action-approve');
    await v.click('tester-dialog-approve-send');
    assert.equal(v.props('board-done').role, 'status');
    assert.equal(v.props('board-done-decided').href, '/admin/approvals/decided');
    assert.ok(!v.has('board-done-check'));
  } finally { await v.unmount(); }
});
