/**
 * D5885 (#5885, part of #4716) — the Best-Fit consultations board (AP-20 to
 * AP-31, D5884): a counted Best-Fit item is reachable from the Inbox, Lanes
 * and the item drawer, and decidable on its board.
 *
 * Only the Worker's transitions are offered; each decision sends the version
 * that was read; a 409 shows the changed-while-reviewing message and the item
 * as it stands now, keeping the typed slot time; a failed list read is
 * Unreadable, never an empty queue or 0; history has actor and time, and a
 * decision before history began reads Not recorded; nobody is said to be told.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_best_fit_5885.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import {
  BEST_FIT_TRANSITIONS, MEMBER_TOLD, NOBODY_TOLD, bestFitAt, decisionBody, decisionCopy, decisionsFor, doneText, historyOf, listOf, refusalOf, rowOf, tabRows,
} from '../src/pages/admin/approvals/bestFitModel.js';
import { continueLine, reviewDestination } from '../src/pages/admin/approvals/inboxModel.js';
import { decidedItemPath } from '../src/pages/admin/approvals/lanesDecidedModel.js';
import BestFitBoard from '../src/pages/admin/approvals/BestFitBoard.jsx';
import { approvalsPageSource } from './_approvalsPage.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const ADMIN = { id: 7, role: 'admin', is_super_admin: 0, email: 'a@example.com', name: 'Admin A' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// One fixed clock for the whole file: the board ages each request from Date.now().
const NOW = Date.parse('2026-11-16T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: NOW });
const d1 = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

const BOOKINGS = [
  { id: 41, user_id: 3, user_name: 'Mina Member', user_email: 'mina@example.com', status: 'requested', topic: 'Seed round', notes: 'Two term sheets', slot_at: null, report_id: 9, requested_at: d1(100), created_at: d1(100), version: 1, admin_id: null, admin_name: null, decided_at: null, decided_by_name: null },
  { id: 42, user_id: 4, user_name: '', user_email: 'nameless@example.com', status: 'requested', topic: null, notes: null, slot_at: 'Tue 17 Nov, 10:00 UTC', report_id: null, requested_at: d1(30), created_at: d1(30), version: 1 },
  { id: 43, user_id: 5, user_name: 'Cara Confirmed', user_email: 'cara@example.com', status: 'confirmed', topic: 'Board', slot_at: 'Mon 16 Nov', requested_at: d1(200), version: 2, admin_name: 'Admin B', decided_at: d1(150), decided_by_name: 'Admin B' },
  { id: 44, user_id: 6, user_name: 'Olly Old', user_email: 'olly@example.com', status: 'completed', topic: 'Data room', requested_at: d1(900), version: 1, decided_at: null },
];
const HISTORY = {
  41: { available: true, since: '2026-11-10', items: [] },
  43: { available: true, since: '2026-11-10', items: [{ id: 1, from_status: 'requested', to_status: 'confirmed', version: 2, actor_user_id: 8, actor_name: 'Admin B', created_at: '2026-11-12 14:02:00' }] },
  44: { available: true, since: '2026-11-10', items: [] },
};
const LANE_ITEMS = [{ lane: 'best_fit', id: 41, assignee: null }, { lane: 'best_fit', id: 42, assignee: { user_id: 7, name: 'Admin A' } }];

async function mount(url, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  globalThis.localStorage?.setItem?.('user', JSON.stringify(ADMIN));
  const seen = [];
  const posts = [];
  globalThis.fetch = async (u, init = {}) => {
    const x = new URL(String(u), 'http://x');
    const path = x.pathname;
    seen.push(path);
    if (init.method === 'POST') { const body = JSON.parse(init.body || '{}'); posts.push({ path, body }); return over.post ? over.post(path, body) : json({ booking: null }); }
    if (path === '/api/auth/me') return json(ADMIN);
    if (path === '/api/admin/approvals') return json({ items: LANE_ITEMS, total: LANE_ITEMS.length, page: 1, page_size: 25, reviewers: [{ id: 7, name: 'Admin A' }], tiles: { per_admin: [] }, assignments: { available: true } });
    if (path === '/api/admin/consultations') return over.list ? over.list() : json(BOOKINGS);
    const m = /^\/api\/admin\/consultations\/(\d+)$/.exec(path);
    if (m) {
      const b = BOOKINGS.find((r) => r.id === Number(m[1]));
      return b ? json({ booking: b, history: HISTORY[b.id] || { available: true, since: '2026-11-10', items: [] } }) : json({ code: 'not_found', message: 'That consultation does not exist.' }, 404);
    }
    return json({}, 404);
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null, h(Route, { path: '*', element: h(BestFitBoard) })), h(Probe)))); });
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
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
    text: () => textOf(container),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked: true } }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; globalThis.localStorage?.removeItem?.('user'); restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('the board offers exactly the Worker\'s transitions', () => {
  const worker = read('cloudflare-worker/src/routes/consultations.ts');
  const block = worker.slice(worker.indexOf('CONSULTATION_TRANSITIONS'), worker.indexOf('});', worker.indexOf('CONSULTATION_TRANSITIONS')));
  const parsed = Object.fromEntries([...block.matchAll(/(\w+): \[([^\]]*)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])]));
  assert.deepEqual(BEST_FIT_TRANSITIONS, parsed);
  assert.deepEqual(decisionsFor('requested').map((d) => d.to), ['confirmed', 'cancelled']);
  assert.deepEqual(decisionsFor('confirmed').map((d) => d.to), ['completed', 'cancelled']);
  assert.deepEqual(decisionsFor('completed'), []);
  assert.deepEqual(decisionsFor('cancelled'), []);
  assert.deepEqual(decisionsFor('cancelled').concat(decisionsFor('requested')).filter((d) => d.danger).map((d) => d.to), ['cancelled']);
});

test('the address: path tabs and one item', () => {
  assert.deepEqual(bestFitAt('/admin/approvals/best-fit'), { tab: 'requested', item: null });
  assert.deepEqual(bestFitAt('/admin/approvals/best-fit/confirmed'), { tab: 'confirmed', item: null });
  assert.deepEqual(bestFitAt('/admin/approvals/best-fit/41'), { tab: null, item: 41 });
  assert.equal(bestFitAt('/admin/approvals/best-fit/requested'), null, 'Requested is the bare address');
  assert.equal(bestFitAt('/admin/approvals/best-fit/41/x'), null);
  assert.equal(bestFitAt('/admin/approvals/co-marketing'), null);
});

test('a decision sends the version that was read, and a slot time only when the field has text', () => {
  const row = rowOf({ id: 41, status: 'requested', version: 3, slot_at: 'recorded' });
  assert.deepEqual(decisionBody('confirmed', row, '  '), { status: 'confirmed', expected_version: 3 }, 'an empty field is never sent: it would blank the recorded slot');
  assert.deepEqual(decisionBody('confirmed', row, ' Tue 10:00 '), { status: 'confirmed', expected_version: 3, slot_at: 'Tue 10:00' });
  assert.deepEqual(decisionBody('cancelled', row, 'Tue'), { status: 'cancelled', expected_version: 3 }, 'only Confirm takes a slot');
});

test('a failed list read is Unreadable, with no rows and no counts; a measured empty is 0', () => {
  const bad = listOf({ status: 'error', error: { status: 503, code: 'consultations_unreadable', message: 'x' } });
  assert.deepEqual([bad.state, bad.rows, bad.counts], ['unreadable', [], null]);
  assert.match(bad.reason, /not a claim that nobody is waiting/);
  assert.equal(listOf({ status: 'error', error: new Error('Network error') }).state, 'unreadable');
  assert.equal(listOf({ status: 'ready', reply: { code: 'x' } }).state, 'unreadable', 'a body that is not the list is not an empty list');
  const ok = listOf({ status: 'ready', reply: [] });
  assert.deepEqual(ok.counts, { requested: 0, confirmed: 0, completed: 0, cancelled: 0 });
  const full = listOf({ status: 'ready', reply: BOOKINGS });
  assert.deepEqual(full.counts, { requested: 2, confirmed: 1, completed: 1, cancelled: 0 });
  assert.deepEqual(tabRows(full, 'requested', '').map((r) => r.id), [41, 42], 'oldest first');
  assert.deepEqual(tabRows(full, 'requested', 'NAMELESS').map((r) => r.id), [42], 'search reads the email');
  assert.equal(rowOf(BOOKINGS[1]).whoSub, 'No name recorded · email shown');
});

test('a 409 is "changed" or "not allowed", with the current row; no answer is "could not tell"; none says someone else decided', () => {
  const current = { id: 41, status: 'confirmed', version: 2 };
  const changed = refusalOf({ status: 409, code: 'version_conflict', message: 'This consultation changed after you read it.', data: { code: 'version_conflict', current } });
  assert.deepEqual([changed.kind, changed.lead, changed.current], ['changed', 'This consultation changed after you read it.', current]);
  const illegal = refusalOf({ status: 409, code: 'illegal_transition', message: 'A consultation cannot move from cancelled to confirmed.', data: { current } });
  assert.deepEqual([illegal.kind, illegal.current], ['illegal', current]);
  assert.equal(refusalOf(new Error('Network error')).kind, 'unknown');
  assert.equal(refusalOf({ status: 503 }).lead, 'We could not tell whether this was saved.');
  for (const r of [changed, illegal, refusalOf({ status: 503 })]) assert.doesNotMatch(`${r.lead} ${r.rest}`, /someone|another admin|decided it/i);
});

test('history: the request, then each change with its actor and time; decided before history reads Not recorded', () => {
  const rec = historyOf({ booking: BOOKINGS[2], history: HISTORY[43] });
  assert.equal(rec.state, 'recorded');
  assert.deepEqual(rec.rows.map((r) => r.line), ['Requested by the member', 'Requested → Confirmed · Admin B']);
  assert.equal(rec.rows[1].when, '12 Nov 2026 · 14:02 UTC');
  const old = historyOf({ booking: BOOKINGS[3], history: HISTORY[44] });
  assert.equal(old.state, 'not_recorded');
  assert.match(old.text, /^Not recorded/);
  assert.equal(historyOf({ booking: BOOKINGS[0], history: HISTORY[41] }).state, 'none');
  const unread = historyOf({ booking: BOOKINGS[0], history: { available: false, reason: 'The history of this consultation could not be read.' } });
  assert.equal(unread.state, 'unread');
  assert.equal(unread.rows.length, 1, 'nothing is invented');
});

test('every dialog says who is told (D5886): the member in app on confirm and cancel, nobody on complete', () => {
  assert.equal(decisionCopy('confirmed', rowOf(BOOKINGS[0])).told, MEMBER_TOLD);
  assert.equal(decisionCopy('cancelled', rowOf(BOOKINGS[0])).told, MEMBER_TOLD);
  assert.equal(decisionCopy('completed', rowOf(BOOKINGS[2])).told, NOBODY_TOLD);
  // The result line reports the Worker's `notified`, and never claims a notice it was not told about.
  assert.match(doneText('confirmed', rowOf(BOOKINGS[0]), true), /told in app/);
  assert.match(doneText('cancelled', rowOf(BOOKINGS[0]), false), /could not be sent\. The decision stands/);
  assert.match(doneText('confirmed', rowOf(BOOKINGS[0]), undefined), /not known/);
  assert.doesNotMatch(doneText('completed', rowOf(BOOKINGS[2]), null), /told|notice/);
  assert.equal(decisionCopy('cancelled', rowOf(BOOKINGS[0])).dismiss, 'Keep consultation', 'never a second "Cancel"');
  assert.match(decisionCopy('completed', rowOf(BOOKINGS[2])).changes, /history, not a second approval/);
});

test('the doors: Inbox, Lanes, the item drawer and Decided all open the board; no Approvals text says it has no review page', () => {
  assert.equal(reviewDestination('best_fit'), 'Best-Fit · Approvals');
  assert.match(continueLine('best_fit'), /made on the Best-Fit board in Approvals/);
  assert.equal(decidedItemPath({ laneKey: 'best_fit', itemId: 41 }), '/admin/approvals/best-fit/41');
  const app = approvalsPageSource();
  assert.match(app, /case 'best_fit': return <Link to="\/admin\/approvals\/best-fit" className=\{LINK\}>Best-Fit<\/Link>;/, 'LaneDoor is a literal link');
  assert.match(app, /<Link to=\{`\/admin\/approvals\/best-fit\/\$\{id\}`\}/, 'the drawer lands on the item, by a literal template');
  assert.match(app, /<DressedDoor lane=\{v\.lane\} itemId=\{v\.id\} before="Continue review in "/);
  const dir = 'frontend/src/pages/admin/approvals';
  for (const f of readdirSync(resolve(process.cwd(), dir))) {
    if (!/\.(jsx?|md)$/.test(f)) continue;
    assert.doesNotMatch(read(`${dir}/${f}`), /Best-Fit · no review page|Best-Fit has no review page/, f);
  }
  const routes = readRoutesSource();
  for (const p of ['/admin/approvals/best-fit', '/admin/approvals/best-fit/confirmed', '/admin/approvals/best-fit/completed', '/admin/approvals/best-fit/cancelled', '/admin/approvals/best-fit/:item']) {
    assert.match(routes, new RegExp(`<Route path="${p.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{guard\\(\\['admin'\\], <ApprovalsBestFitBoard />\\)\\} />`), p);
  }
  assert.doesNotMatch(read('frontend/src/App.jsx'), /best-fit/, 'no App.jsx edit');
});

// ---------------------------------------------------------------- mounted

test('mounted AP-20: tabs, the four-cell summary and the Requested rows, oldest first, with owners', async () => {
  const v = await mount('/admin/approvals/best-fit');
  try {
    assert.match(v.of('bestfit-tab-requested'), /Requested\s*2/);
    assert.match(v.of('bestfit-tab-confirmed'), /Confirmed\s*1/);
    assert.equal(v.of('bestfit-strip-waiting-value'), '2');
    assert.equal(v.of('bestfit-strip-overdue-value'), '1');
    assert.equal(v.of('bestfit-strip-unassigned-value'), '1');
    assert.deepEqual(v.ids('bestfit-row-'), ['bestfit-row-41', 'bestfit-row-42']);
    assert.match(v.of('bestfit-row-41'), /Mina Member.*Seed round.*No slot time recorded.*! Overdue.*Unassigned/s);
    assert.match(v.of('bestfit-row-42'), /nameless@example\.com.*No name recorded.*No topic recorded.*Slot: Tue 17 Nov.*◷ Due soon.*Admin A/s);
    assert.equal(v.props('bestfit-open-41').href, '/admin/approvals/best-fit/41');
  } finally { await v.unmount(); }
});

test('mounted AP-27c: a failed list read is Unreadable — dashes in every tab and cell, no rows, never 0', async () => {
  const v = await mount('/admin/approvals/best-fit', { list: () => json({ code: 'consultations_unreadable', message: 'Best-Fit consultations could not be read. This is not a claim that nobody is waiting.' }, 503) });
  try {
    assert.match(v.of('bestfit-unreadable'), /Unreadable.*not a claim that nobody is waiting/);
    assert.ok(!v.has('bestfit-empty'), 'never the empty queue');
    assert.deepEqual(v.ids('bestfit-row-'), []);
    assert.doesNotMatch(v.of('bestfit-tab-requested'), /\d/);
    assert.ok(!v.has('bestfit-strip-waiting-value'), 'no figure, so no 0');
    assert.match(v.of('bestfit-strip'), /Could not be read/);
  } finally { await v.unmount(); }
});

test('mounted AP-26: an empty read that succeeded says nothing is waiting', async () => {
  const v = await mount('/admin/approvals/best-fit', { list: () => json([]) });
  try {
    assert.match(v.of('bestfit-empty'), /No Best-Fit consultations are waiting\./);
    assert.equal(v.of('bestfit-strip-waiting-value'), '0');
  } finally { await v.unmount(); }
});

test('mounted AP-21/22: a requested item offers Confirm and Cancel only, and Confirm sends the version read with the typed slot', async () => {
  const v = await mount('/admin/approvals/best-fit/41', { post: () => json({ booking: { ...BOOKINGS[0], status: 'confirmed', version: 2 }, notified: true }) });
  try {
    assert.deepEqual(v.ids('bestfit-action-'), ['bestfit-action-confirmed', 'bestfit-action-cancelled']);
    assert.match(v.of('bestfit-fact-report'), /✓ Recorded/);
    assert.match(v.of('bestfit-history'), /Requested by the member/);
    assert.match(v.of('bestfit-history-none'), /No decision yet/);
    assert.match(v.of('bestfit-told'), /tells the member in app/);
    await v.click('bestfit-action-confirmed');
    assert.equal(v.of('bestfit-dialog-confirmed-told'), MEMBER_TOLD);
    await v.change('bestfit-dialog-confirmed-slot', 'Thu 19 Nov, 15:00 UTC');
    await v.click('bestfit-dialog-confirmed-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/consultations/41/status', body: { status: 'confirmed', expected_version: 1, slot_at: 'Thu 19 Nov, 15:00 UTC' } }]);
    assert.match(v.of('board-done'), /confirmed.*told in app.*View in Decided/s);
  } finally { await v.unmount(); }
});

test('mounted: Confirm with an empty slot field sends no slot_at', async () => {
  const v = await mount('/admin/approvals/best-fit/41');
  try {
    await v.click('bestfit-action-confirmed');
    await v.click('bestfit-dialog-confirmed-send');
    assert.deepEqual(v.posts[0].body, { status: 'confirmed', expected_version: 1 });
  } finally { await v.unmount(); }
});

test('mounted AP-24a: a version_conflict shows the changed message and the current row, keeps the typed slot, and writes nothing more', async () => {
  const current = { ...BOOKINGS[0], status: 'confirmed', version: 2, slot_at: 'Mon 23 Nov' };
  const v = await mount('/admin/approvals/best-fit/41', { post: () => json({ code: 'version_conflict', message: 'This consultation changed after you read it.', current }, 409) });
  try {
    await v.click('bestfit-action-confirmed');
    await v.change('bestfit-dialog-confirmed-slot', 'my typed slot');
    await v.click('bestfit-dialog-confirmed-send');
    assert.match(v.of('bestfit-dialog-confirmed-changed'), /This consultation changed after you read it\..*Nothing was recorded by you\./s);
    assert.match(v.of('bestfit-dialog-confirmed-current'), /Now: Confirmed · slot Mon 23 Nov\. Decisions now: Complete, Cancel\./);
    assert.ok(!v.has('bestfit-dialog-confirmed-send'), 'no second send');
    assert.ok(!v.has('board-done'), 'a refusal is never shown as done');
    assert.equal(v.props('bestfit-dialog-confirmed-slot').value, 'my typed slot', 'the typed slot stays on screen');
    assert.equal(v.posts.length, 1);
    assert.match(v.of('bestfit-drawer-current'), /as it stands now/);
    assert.match(v.of('bestfit-fact-status'), /Confirmed/, 'the drawer redraws from the 409 current row');
    assert.deepEqual(v.ids('bestfit-action-'), ['bestfit-action-completed', 'bestfit-action-cancelled'], 'only what Confirmed allows');
    await v.click('bestfit-dialog-confirmed-latest');
    assert.ok(!v.has('bestfit-dialog-confirmed'), 'View latest closes the dialog onto the item');
  } finally { await v.unmount(); }
});

test('mounted AP-25: completed is read-only, its history Not recorded when decided before history; a missing item says so', async () => {
  const v = await mount('/admin/approvals/best-fit/44');
  try {
    assert.deepEqual(v.ids('bestfit-action-'), []);
    assert.equal(v.of('bestfit-nothing-left'), 'Nothing left to decide.');
    assert.match(v.of('bestfit-history-not_recorded'), /Not recorded/);
  } finally { await v.unmount(); }
  const m = await mount('/admin/approvals/best-fit/999');
  try { assert.match(m.of('bestfit-drawer-missing'), /not on this board/); } finally { await m.unmount(); }
});

test('mounted AP-25: a confirmed item\'s history names its actor and time; the Confirmed tab shows the decided cell', async () => {
  const v = await mount('/admin/approvals/best-fit/43');
  try {
    assert.deepEqual(v.ids('bestfit-action-'), ['bestfit-action-completed', 'bestfit-action-cancelled']);
    assert.match(v.of('bestfit-history-v2'), /12 Nov 2026 · 14:02 UTC.*Requested → Confirmed · Admin B/s);
    assert.match(v.of('bestfit-fact-triaged'), /Admin B/);
  } finally { await v.unmount(); }
  const t = await mount('/admin/approvals/best-fit/completed');
  try { assert.match(t.of('bestfit-decided-44'), /○ Not recorded/); } finally { await t.unmount(); }
});

test('mounted AP-22b: Confirm on an item with a recorded slot starts with that slot in the field', async () => {
  const v = await mount('/admin/approvals/best-fit/42');
  try {
    await v.click('bestfit-action-confirmed');
    assert.equal(v.props('bestfit-dialog-confirmed-slot').value, 'Tue 17 Nov, 10:00 UTC');
    assert.match(v.of('bestfit-dialog-confirmed-fields'), /Leave blank to keep it/);
  } finally { await v.unmount(); }
});
