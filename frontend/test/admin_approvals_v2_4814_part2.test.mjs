/**
 * D4814 (#4814) — Admin › Approvals v2, part 2: ownership and the row's actions.
 *
 * The Assign dialog (AP-05): "Assigning changes ownership only", reviewers as
 * a radio list — you, then lowest workload, then alphabetical, each with the
 * items they own — and a button that names the person. The unowned-work
 * callout with Show unassigned and Assign overdue… (AP-01). The ⋯ disclosure
 * popover (AP-17). The floating bulk bar (AP-03). The owner-first drawer with
 * Assign to me, Change…, its place in the queue and "Continue review in …"
 * (AP-04). Phone cards with Open and Assign (AP-14).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814_part2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  ASSIGN_CAP, assignButton, assignChoices, assignNames, collectOverdue, continueLine, overdueAssignLine, overdueAssignTitle,
  ownerLine, ownershipCallout, queueStep,
} from '../src/pages/admin/approvals/inboxModel.js';
import { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const GLANCE = { tier: 'hq', approvals: { pending_total: 4, lanes: [{ key: 'kyc', label: 'KYC', count: 2, oldest_age_hours: 100, sla: 'past' }], hq_decides: null, no_queue: [] } };

const ROWS = [
  { lane: 'kyc', lane_label: 'KYC', id: 41, who: 'Person A', what: 'KYC · founder', created_at: '2026-11-01 08:00:00', age_hours: 100, sla: 'past', assignee: null },
  { lane: 'due_diligence', lane_label: 'Due diligence', id: 9, who: 'Company B', what: 'Due diligence', created_at: '2026-11-02 08:00:00', age_hours: 80, sla: 'past', assignee: { user_id: 8, name: 'Admin B' } },
  { lane: 'score_flags', lane_label: 'Score sign-off', id: 5, who: 'Project C', what: 'Score sign-off', created_at: '2026-11-04 08:00:00', age_hours: 30, sla: 'due_soon', assignee: null },
  { lane: 'product_testers', lane_label: 'Product testers', id: 8, who: 'Tester D', what: 'Product tester application', created_at: '2026-11-05 08:00:00', age_hours: 5, sla: 'ok', assignee: { user_id: 7, name: 'Admin A' } },
];
// 3 of 4 have no owner across every lane, 2 of the 3 overdue have none.
const INBOX = {
  items: ROWS, total: 4, page: 1, page_size: 25,
  lanes: [{ key: 'kyc', label: 'KYC', group: 'people', count: 2, bands: { ok: 0, due_soon: 0, past: 2, unknown: 0 } }],
  unreadable: [],
  tiles: {
    over_72h: 3, assigned_to_me: 1, unassigned: 3, overdue_unassigned: 2, complete: true,
    oldest: { age_hours: 100, lane: 'kyc', label: 'KYC' },
    per_admin: [{ id: 7, name: 'Admin A', count: 1 }, { id: 8, name: 'Admin B', count: 1 }, { id: 9, name: 'Admin C', count: 0 }],
  },
  reviewers: [{ id: 8, name: 'Admin B' }, { id: 9, name: 'Admin C' }, { id: 7, name: 'Admin A' }],
  decides: false,
};
const OVERDUE = { ...INBOX, items: [ROWS[0]], total: 1 };
const ITEM = {
  item: ROWS[1],
  lane: { key: 'due_diligence', label: 'Due diligence', group: 'deals', notifies: 'The founder', decided_on: 'Due diligence', hq: false },
  history: { available: true, items: [{ kind: 'assigned', created_at: '2026-11-03 09:30:00', actor_user_id: 7, actor_name: 'Admin A', assignee_user_id: 8, assignee_name: 'Admin B' }] },
  decides: false,
};
const WEEKLY = { weeks: [], totals: { arrived: [], decided: [] }, tile: null, unreadable: [] };
const ADMIN = { id: 7, role: 'admin', is_super_admin: 0 };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(url, viewer = ADMIN, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  const on = {
    glance: () => json(GLANCE),
    inbox: (q) => json(q.get('age') === 'past' && q.get('assigned') === 'none' ? OVERDUE : INBOX),
    item: () => json(ITEM),
    weekly: () => json(WEEKLY),
    assign: () => json({ assigned: [] }),
    ...over,
  };
  const seen = [];
  const posts = [];
  globalThis.fetch = async (u, init = {}) => {
    const x = new URL(String(u), 'http://x');
    seen.push(`${x.pathname}${x.search}`);
    if (init.method === 'POST') { posts.push({ path: x.pathname, body: JSON.parse(init.body || '{}') }); return on.assign(); }
    if (x.pathname === '/api/admin/studio/glance') return on.glance();
    if (x.pathname === '/api/admin/approvals') return on.inbox(x.searchParams);
    if (x.pathname.startsWith('/api/admin/approvals/items/')) return on.item();
    if (x.pathname === '/api/admin/approvals/decided/weekly') return on.weekly();
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
    seen, posts, at,
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    node: byId,
    ids: (prefix) => walk(container).map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    within: (id, tag) => walk(byId(id)).filter((n) => n.tagName === tag),
    focus(id) { byId(id).focus(); },
    focused: () => (document.activeElement && document.activeElement !== document.body ? props(document.activeElement)['data-testid'] || 'other' : 'body'),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked: true } }); }); await flush(); },
    async key(id, key) { const p = props(byId(id)); await act(async () => { p.onKeyDown({ ...event, key }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('AP-05: reviewers are you, then lowest workload, then alphabetical, each with the items they own', () => {
  const reply = {
    reviewers: [{ id: 2, name: 'Admin B' }, { id: 4, name: 'Admin D' }, { id: 7, name: 'Admin A' }, { id: 3, name: 'Admin C' }, { id: 5, name: 'Admin E' }],
    tiles: { per_admin: [{ id: 7, count: 14 }, { id: 2, count: 4 }, { id: 4, count: 2 }, { id: 3, count: 9 }, { id: 5, count: 4 }] },
  };
  const c = assignChoices(reply, 7);
  assert.deepEqual(c.choices.map((x) => x.label), ['Admin A · You · 14 assigned', 'Admin D · 2 assigned', 'Admin B · 4 assigned', 'Admin E · 4 assigned', 'Admin C · 9 assigned']);
  assert.equal(c.note, 'Order: you, then lowest workload, then alphabetical. Counts are items currently owned.');
  // The Worker withholds per_admin when a lane was not read: no load is shown rather than a short one.
  const short = assignChoices({ reviewers: reply.reviewers, tiles: { per_admin: null, reason: 'Due diligence could not be read.' } }, 7);
  assert.deepEqual(short.choices.map((x) => x.label), ['Admin A · You', 'Admin B', 'Admin C', 'Admin D', 'Admin E']);
  assert.equal(short.note, 'Order: you, then alphabetical. Workloads are not shown: due diligence could not be read.');
  assert.equal(assignButton(c.choices, 7), 'Assign to me');
  assert.equal(assignButton(c.choices, 4), 'Assign to Admin D');
  assert.equal(assignButton(c.choices, null), 'Assign');
  assert.equal(assignNames([{ who: 'A' }, { who: 'B' }, { who: 'C' }, { who: 'D' }, { who: 'E' }]), 'A, B, C and 2 more');
});

test('AP-01: the ownership callout needs exact figures, and claims the cause only when most overdue items have no owner', () => {
  const ready = (tiles, extra = {}) => ({ status: 'ready', reply: { ...INBOX, ...extra, tiles: { ...INBOX.tiles, ...tiles } } });
  const c = ownershipCallout(ready({}));
  assert.equal(c.text, '3 of 4 waiting items have no owner, including 2 overdue.');
  assert.equal(c.cause, 'Unowned items are the main reason this queue is ageing.', '2 of 3 overdue have no owner');
  assert.equal(c.assignOverdue, 2);
  assert.equal(ownershipCallout(ready({ overdue_unassigned: 1 })).cause, null, '1 of 3 overdue is not "the main reason"');
  assert.equal(ownershipCallout(ready({ unassigned: 1, overdue_unassigned: 0 })), null, 'a quarter unowned and no overdue unowned: no callout');
  assert.ok(ownershipCallout(ready({ unassigned: 1, overdue_unassigned: 1 })), 'an overdue item with no owner is enough');
  assert.equal(ownershipCallout(ready({ unassigned: 0, overdue_unassigned: 0 })), null);
  assert.equal(ownershipCallout(ready({ unassigned: null, complete: false, at_least: { unassigned: 3 } }, { unreadable: ['Due diligence'] })), null, 'a floor past an unread lane never says "of N"');
  assert.equal(ownershipCallout(ready({ complete: false })), null, 'a lane cut at the cap: not complete, so no callout even with figures');
  assert.equal(ownershipCallout({ status: 'loading' }), null);
});

test('Assign overdue… reads every overdue unowned item page by page, up to one Assign, and says what it leaves', async () => {
  assert.equal(ASSIGN_CAP, Number(/export const ASSIGNMENT_CAP = (\d+);/.exec(read('cloudflare-worker/src/services/approvalAssignments.ts'))[1]), 'the Worker\'s cap');
  const item = (n) => ({ lane: 'kyc', id: n, who: `P${n}`, age_hours: 100, sla: 'past', assignee: null });
  const pages = { 1: { items: Array.from({ length: 25 }, (_, i) => item(i + 1)), total: 52, page: 1, page_size: 25 }, 2: { items: Array.from({ length: 25 }, (_, i) => item(i + 26)), total: 52, page: 2, page_size: 25 } };
  const asked = [];
  const got = await collectOverdue(async (p) => { asked.push(p); return pages[p]; });
  assert.deepEqual(asked, [1, 2]);
  assert.equal(got.rows.length, 40);
  assert.equal(got.total, 52);
  assert.equal(overdueAssignTitle(got.rows), 'Assign 40 overdue items');
  assert.equal(overdueAssignLine(got.rows, 52), 'The oldest 40 of 52 are listed: one assignment takes at most 40. The rest stay unassigned until you assign them.');
  const one = await collectOverdue(async () => ({ items: [item(1), { ...item(2), assignee: { user_id: 3, name: 'X' } }], total: 2, page: 1, page_size: 25 }));
  assert.deepEqual(one.rows.map((r) => r.id), [1], 'an owned row is never sent');
  assert.equal(overdueAssignLine(one.rows, 1), null);
});

test('AP-04: the drawer\'s place in the queue, its closing line and the owner line', () => {
  const step = queueStep(INBOX, { lane: 'score_flags', id: 5 });
  assert.equal(step.pos, '3 of 4');
  assert.deepEqual([step.prev.key, step.next.key], ['due_diligence:9', 'product_testers:8']);
  assert.equal(queueStep({ ...INBOX, page: 2, total: null }, { lane: 'kyc', id: 41 }).pos, '26 of the queue');
  assert.equal(queueStep(INBOX, { lane: 'kyc', id: 999 }), null, 'not on this page: no position is invented');
  assert.equal(continueLine('kyc'), 'This decision is completed in KYC & KYB, where its evidence and notification rules live.');
  assert.equal(continueLine('product_testers'), 'This decision is made on the Product testers board in Approvals, where its evidence and notification rules live.');
  assert.match(continueLine('best_fit'), /no review page yet/);
  const hist = ITEM.history;
  assert.equal(ownerLine({ kind: 'person', id: 8 }, hist), 'Owner since 3 Nov 2026, 09:30 · assigned by Admin A');
  assert.equal(ownerLine({ kind: 'person', id: 8 }, { available: false }), null, 'History not read: nothing invented');
  assert.equal(ownerLine({ kind: 'none' }, hist), 'Nobody owns this item yet');
});

// ---------------------------------------------------------------- mounted

test('mounted AP-01: the callout, Show unassigned, and Assign overdue… reading the overdue unowned items from every lane', async () => {
  const v = await mount('/admin/approvals');
  try {
    assert.match(v.of('approvals-own-callout'), /3 of 4 waiting items have no owner, including 2 overdue\. Unowned items are the main reason this queue is ageing\.\s*Show unassigned\s*Assign overdue…/);
    assert.equal(v.props('approvals-own-callout').role, 'note');
    await v.click('approvals-own-assign-overdue');
    assert.ok(v.seen.includes('/api/admin/approvals?page=1&age=past&assigned=none'), 'read across every lane, not the page');
    assert.match(v.of('approvals-assign'), /Assign 1 overdue item.*Assigning changes ownership only\. It does not decide this item\./s);
    await v.change('approvals-assign-pick-9');
    assert.equal(v.of('approvals-assign-send'), 'Assign to Admin C');
    await v.click('approvals-assign-send');
    assert.deepEqual(v.posts, [{ path: '/api/admin/approvals/assignments', body: { assignee_user_id: 9, items: [{ lane: 'kyc', item_id: 41 }] } }]);
    assert.match(v.of('approvals-toast'), /Person A is now assigned to Admin C\./);
    await v.click('approvals-own-show');
    assert.equal(v.at.path, '/admin/approvals?assigned=none');
    assert.ok(!v.has('approvals-own-show'), 'no Show unassigned inside the Unassigned view');
  } finally { await v.unmount(); }
});

test('mounted AP-05: the dialog lists you first, then by workload, and the button names the person', async () => {
  const v = await mount('/admin/approvals');
  try {
    await v.click('approvals-owner-assign-kyc:41');
    assert.deepEqual(v.ids('approvals-assign-').filter((id) => /^approvals-assign-\d+$/.test(id)), ['approvals-assign-7', 'approvals-assign-9', 'approvals-assign-8']);
    assert.match(v.of('approvals-assign-7'), /^Admin A\s*You · 1 assigned$/);
    assert.match(v.of('approvals-assign-9'), /^Admin C\s*0 assigned$/);
    assert.equal(v.of('approvals-assign-send'), 'Assign', 'nobody chosen yet');
    assert.equal(v.props('approvals-assign-send').disabled, true);
    await v.change('approvals-assign-pick-7');
    assert.equal(v.of('approvals-assign-send'), 'Assign to me');
  } finally { await v.unmount(); }
});

test('mounted AP-17: ⋯ is a disclosure popover, not a menu; Esc closes it and focus goes back to ⋯', async () => {
  const v = await mount('/admin/approvals');
  try {
    const trigger = v.props('approvals-menu-due_diligence:9');
    assert.equal(trigger['aria-haspopup'], undefined, 'no menu semantics');
    assert.equal(trigger['aria-expanded'], false);
    v.focus('approvals-menu-due_diligence:9');
    await v.click('approvals-menu-due_diligence:9');
    assert.equal(v.props('approvals-menu-due_diligence:9')['aria-expanded'], true);
    assert.equal(v.props('approvals-pop-due_diligence:9').id, v.props('approvals-menu-due_diligence:9')['aria-controls']);
    assert.match(v.of('approvals-pop-due_diligence:9'), /^Assign…Copy linkOpen in Due diligence ↗$/);
    const rp = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    assert.equal(rp(v.within('approvals-menu-due_diligence:9-open-in', 'A')[0]).href, '/admin/due-diligence');
    const inside = [...v.within('approvals-pop-due_diligence:9', 'DIV'), ...v.within('approvals-pop-due_diligence:9', 'BUTTON'), ...v.within('approvals-pop-due_diligence:9', 'A')];
    assert.ok(inside.length >= 4 && !inside.some((n) => /menu/.test(rp(n).role || '')), 'no role=menu or menuitem');
    v.focus('approvals-menu-due_diligence:9-copy');
    await v.key('approvals-actions-due_diligence:9', 'Escape');
    assert.ok(!v.has('approvals-pop-due_diligence:9'));
    assert.equal(v.focused(), 'approvals-menu-due_diligence:9', 'focus is back on ⋯');
    assert.ok(v.has('approvals-review-due_diligence:9'), 'Review is never only in ⋯');
  } finally { await v.unmount(); }
});

test('mounted AP-03: selecting rows floats the bulk bar in a holder with no height; the header box is mixed', async () => {
  const v = await mount('/admin/approvals');
  try {
    assert.ok(!v.has('approvals-bulk'));
    await v.change('approvals-pick-kyc:41');
    await v.change('approvals-pick-score_flags:5');
    assert.match(v.of('approvals-bulk'), /^2 selected\s*Assign…\s*Clear$/);
    assert.equal(v.props('approvals-bulk').role, 'region');
    assert.match(v.props('approvals-bulk-holder').className, /\bsticky\b.*\bh-0\b/, 'it floats: its holder takes no room');
    assert.equal(v.props('approvals-pick-all')['aria-checked'], 'mixed');
    assert.equal(v.props('approvals-row-kyc:41')['aria-selected'], true);
    assert.match(v.props('approvals-row-kyc:41').className, /bg-axal-lavender/);
    await v.click('approvals-bulk-assign');
    assert.match(v.of('approvals-assign'), /Assign 2 items.*Person A, Project C/s);
  } finally { await v.unmount(); }
});

test('mounted AP-04: the drawer puts the owner first, steps through the queue, and continues review by name', async () => {
  const v = await mount('/admin/approvals/items/due_diligence-9');
  try {
    assert.match(v.of('approvals-item-assigned'), /^Owner\s*Admin B\s*Owner since 3 Nov 2026, 09:30 · assigned by Admin A\s*Assign to me\s*Change…$/);
    const order = v.ids('approvals-item-');
    assert.ok(order.indexOf('approvals-item-assigned') < order.indexOf('approvals-item-facts'), 'owner before facts');
    assert.ok(order.indexOf('approvals-item-facts') < order.indexOf('approvals-item-history'), 'facts before history');
    assert.equal(v.of('approvals-item-pos'), '2 of 4');
    assert.equal(v.props('approvals-item-prev').href, '/admin/approvals/items/kyc-41');
    assert.equal(v.props('approvals-item-next').href, '/admin/approvals/items/score_flags-5');
    assert.match(v.of('approvals-item-continue'), /^Continue review in Due diligence →\s*Close\s*This decision is completed in Due diligence, where its evidence and notification rules live\.$/);
    assert.doesNotMatch(v.of('approvals-item'), /Decided on|\bHere\b/);
    await v.click('approvals-item-take');
    assert.deepEqual(v.posts, [{ path: '/api/admin/approvals/assignments', body: { assignee_user_id: 7, items: [{ lane: 'due_diligence', item_id: 9 }] } }]);
    assert.match(v.of('approvals-toast'), /Company B is now assigned to you\./);
  } finally { await v.unmount(); }
  // An admin the Worker does not list as a reviewer cannot be assigned, so Assign to me is not offered.
  const other = await mount('/admin/approvals/items/due_diligence-9', { id: 99, role: 'admin', is_super_admin: 1 });
  try {
    assert.ok(!other.has('approvals-item-take'));
    assert.ok(other.has('approvals-item-assign'), 'Change… stays');
  } finally { await other.unmount(); }
  // A native board says where on Approvals it is decided.
  const board = await mount('/admin/approvals/items/product_testers-8', ADMIN, { item: () => json({ ...ITEM, item: ROWS[3], lane: { key: 'product_testers', label: 'Product testers', group: 'people' }, history: { available: true, items: [] } }) });
  try {
    assert.match(board.of('approvals-item-continue'), /^Continue review in Product testers →\s*Close\s*This decision is made on the Product testers board in Approvals/);
    assert.ok(!board.has('approvals-item-take'), 'the caller already owns it');
    assert.match(board.of('approvals-item-owner'), /Admin A · you/);
  } finally { await board.unmount(); }
});

test('mounted AP-14: a phone card has Open, Assign only when nobody owns it, and ⋯; its sheet is a list of actions, not a menu', async () => {
  const v = await mount('/admin/approvals');
  try {
    assert.match(v.of('approvals-card-kyc:41'), /^Person A\s*KYC · Founder · KYC\s*4 d 4 h · Over 72 hours\s*Unassigned\s*Review in KYC & KYB\s*Open\s*Assign\s*⋯$/);
    assert.ok(!v.has('approvals-card-assign-product_testers:8'), 'an owned item has no Assign on its card');
    assert.match(v.of('approvals-card-owner-product_testers:8'), /Assigned to Admin A/);
    await v.click('approvals-card-more-kyc:41');
    assert.match(v.of('approvals-row-sheet-open-in'), /^Open in KYC & KYB ↗$/);
    await v.click('approvals-card-assign-kyc:41');
  } finally { await v.unmount(); }
});

test('the page source: no ARIA menu on the Inbox, no browser dialogs', () => {
  const page = read('frontend/src/pages/admin/approvals/AdminApprovals.jsx');
  assert.doesNotMatch(page, /role="menu"|role="menuitem"|aria-haspopup="menu"/);
  assert.doesNotMatch(page, /\balert\(|\bconfirm\(/);
});
