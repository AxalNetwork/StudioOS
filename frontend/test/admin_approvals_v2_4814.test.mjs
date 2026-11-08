/**
 * D4814 (#4814) — Admin › Approvals v2, part 1: action before analytics.
 *
 * The header and tabs, one urgency strip (Waiting · Overdue · Unassigned ·
 * Oldest), the work views (Needs attention · Assigned to me · Unassigned ·
 * All), then the queue (Request · Waiting · Owner · Review · ⋯) with one
 * Filters and one Sort, then Workload. The Inbox tab, Waiting and All show
 * one number; Unassigned counts every lane; an unread lane is "N+", never 0;
 * Waiting on HQ is a studio shell's alone; raw store values are in words.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_v2_4814.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { LINE } from '../src/pages/admin/approvals/approvalsModel.js';
import {
  bandedRows, filterChips, filterCount, humanToken, humanWhat, inboxQueryOf, inboxRows, reviewDestination,
  summaryStrip, urgencyPill, viewPatch, waitingFigure, workViewCounts, workViewOf,
} from '../src/pages/admin/approvals/inboxModel.js';
import { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// The glance's studio lanes sum to 31; HQ's own lane (payouts) holds 1 more,
// which only the inbox read counts. This is the live shape behind "Inbox 31,
// Waiting 32, 1 for HQ".
const GLANCE = {
  tier: 'hq',
  approvals: {
    pending_total: 31,
    lanes: [
      { key: 'kyc', label: 'KYC', count: 20, oldest_age_hours: 100, sla: 'past' },
      { key: 'jobs', label: 'Jobs', count: 11, oldest_age_hours: 30, sla: 'due_soon' },
      ...['kyb', 'partner_profiles', 'exploring', 'product_testers', 'lp', 'cohort', 'lab_hosts', 'moderation', 'referrals', 'strategic_access', 'perk_listings',
        'best_fit', 'events', 'wellbeing_experts', 'comarketing', 'articles', 'due_diligence', 'score_flags']
        .map((key) => ({ key, label: key, count: 0, oldest_age_hours: null, sla: 'ok' })),
    ],
    hq_decides: { lanes: [{ key: 'payouts', count: 1, oldest_age_hours: 5 }], pending_total: 1, unreadable: [] },
    no_queue: [],
  },
};

// An unfiltered inbox read as the Worker answers it: no `unfiltered_total`
// (that rides only on a filtered read), 32 in all, one item per band.
const INBOX = {
  items: [
    { lane: 'kyc', lane_label: 'KYC', id: 41, who: 'Person A', what: 'KYC · founder', created_at: '2026-11-01 08:00:00', age_hours: 100, sla: 'past', assignee: null },
    { lane: 'score_flags', lane_label: 'Score sign-off', id: 5, who: 'Project B', what: 'Score sign-off · TIER_2', created_at: '2026-11-04 08:00:00', age_hours: 30, sla: 'due_soon', assignee: { user_id: 7, name: 'Admin A' } },
    { lane: 'product_testers', lane_label: 'Product testers', id: 8, who: null, what: 'Product tester application', created_at: '2026-11-05 08:00:00', age_hours: 5, sla: 'ok', assignee: { user_id: 8, name: 'Admin B' } },
    { lane: 'payouts', lane_label: 'Payout requests', id: 2, who: 'Studio C', what: 'Payout · REJECT', created_at: null, age_hours: null, sla: 'unknown' },
  ],
  total: 32,
  page: 1,
  page_size: 25,
  lanes: [
    { key: 'kyc', label: 'KYC', group: 'people', count: 20, bands: { ok: 0, due_soon: 10, past: 10, unknown: 0 } },
    { key: 'jobs', label: 'Jobs', group: 'community', count: 11, bands: { ok: 11, due_soon: 0, past: 0, unknown: 0 } },
    { key: 'payouts', label: 'Payout requests', group: 'hq', count: 1, bands: { ok: 0, due_soon: 0, past: 0, unknown: 1 } },
  ],
  unreadable: [],
  tiles: {
    over_72h: 10, assigned_to_me: 2, unassigned: 27, overdue_unassigned: 4, complete: true,
    oldest: { age_hours: 100, lane: 'kyc', label: 'KYC' },
    per_admin: [{ id: 7, name: 'Admin A', count: 2 }, { id: 8, name: 'Admin B', count: 3 }],
  },
  reviewers: [{ id: 7, name: 'Admin A' }, { id: 8, name: 'Admin B' }],
  decides: false,
};
// Due diligence failed: the Worker withholds the exact figures and sends floors.
const PARTIAL = {
  ...INBOX,
  total: 127,
  unreadable: ['Due diligence'],
  tiles: { over_72h: null, assigned_to_me: null, unassigned: null, overdue_unassigned: null, complete: false, oldest: { age_hours: 103, lane: 'kyc', label: 'KYC' },
    at_least: { over_72h: 6, unassigned: 68, assigned_to_me: 1 }, reason: 'Due diligence could not be read, so these counts would be missing whatever is in them.' },
};
const WEEKLY = { weeks: [{ week_start: '2026-11-02' }], totals: { arrived: [3], decided: [2], arrived_leaves_out: [], decided_leaves_out: [] }, tile: { decided_this_week: 2, median_wait_hours: 10 }, unreadable: [] };
const REQUESTS = { items: [{ uid: 'r1', kind: 'seat_increase', subject: 'Seats', status: 'open', sla: 'ok', created_at: '2026-10-20 10:00:00' }] };

const SUPER = { id: 7, role: 'admin', is_super_admin: 1 };
const ADMIN = { id: 7, role: 'admin', is_super_admin: 0 };
const STUDIO = { id: 7, role: 'admin', is_super_admin: 0, branch: { code: 'pt', name: 'Studio Lisbon' } };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(url, viewer, over = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  const on = { glance: () => json(GLANCE), inbox: () => json(INBOX), weekly: () => json(WEEKLY), requests: () => json(REQUESTS), ...over };
  const seen = [];
  globalThis.fetch = async (u) => {
    const x = new URL(String(u), 'http://x');
    seen.push(`${x.pathname}${x.search}`);
    if (x.pathname === '/api/admin/studio/glance') return on.glance();
    if (x.pathname === '/api/admin/approvals') return on.inbox(x.searchParams);
    if (x.pathname === '/api/admin/approvals/decided/weekly') return on.weekly();
    if (x.pathname === '/api/licence/mine/requests') return on.requests();
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
    text: () => textOf(container),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    tags: (tag) => walk(container).filter((n) => n.tagName === tag),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target: { value, checked: true } }); }); await flush(); },
    async key(id, key) { const p = props(byId(id)); await act(async () => { p.onKeyDown({ ...event, key }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}
const inboxCalls = (v) => v.seen.filter((p) => p.startsWith('/api/admin/approvals?'));

// ---------------------------------------------------------------- the model

test('P0: the Inbox tab, Waiting and All are one number, whether or not the read was filtered', () => {
  const ready = { status: 'ready', reply: INBOX };
  assert.equal(waitingFigure(ready).value, '32', 'an unfiltered read carries no unfiltered_total; total is the figure');
  assert.equal(workViewCounts(ready).all, '32');
  assert.equal(summaryStrip(ready).waiting.value, '32');
  const filtered = { status: 'ready', reply: { ...INBOX, total: 3, unfiltered_total: 32 } };
  assert.equal(waitingFigure(filtered).value, '32', 'a filtered read keeps Waiting at the whole');
  assert.equal(workViewCounts(filtered).all, '32');
  assert.match(summaryStrip(ready).waiting.sub, /across 3 lanes · 1 of them for HQ/, 'the HQ share is said, and is inside the figure');
  assert.deepEqual(waitingFigure({ status: 'ready', reply: { ...INBOX, total: null, total_reason: 'Not counted.' } }), { state: 'unreadable', reason: 'Not counted.' });
});

test('the strip: Waiting · Overdue · Unassigned · Oldest; Unassigned from every lane, not the page', () => {
  const s = summaryStrip({ status: 'ready', reply: INBOX });
  assert.deepEqual(Object.keys(s), ['waiting', 'overdue', 'unassigned', 'oldest']);
  assert.equal(s.overdue.value, '10');
  assert.equal(s.overdue.sub, 'over 72 hours · 4 have no owner');
  assert.equal(s.unassigned.value, '27', 'the Worker\'s count across all lanes, though one row on this page is unassigned');
  assert.equal(s.unassigned.sub, 'of 32 have no owner');
  assert.deepEqual([s.oldest.value, s.oldest.sub], ['4 d 4 h', 'waiting · KYC']);
  assert.equal(summaryStrip({ status: 'loading' }).unassigned.state, 'loading');
});

test('an unread lane: every figure is "N+" from the floor, never 0 and never short', () => {
  const s = summaryStrip({ status: 'ready', reply: PARTIAL });
  assert.deepEqual([s.waiting.value, s.overdue.value, s.unassigned.value], ['127+', '6+', '68+']);
  assert.equal(s.overdue.sub, 'Due diligence not read');
  assert.equal(s.oldest.sub, 'of lanes read · may be older');
  const v = workViewCounts({ status: 'ready', reply: PARTIAL });
  assert.deepEqual([v.attention, v.mine, v.unassigned, v.all], ['6+ overdue', '1+', '68+', '127+']);
  const none = summaryStrip({ status: 'ready', reply: { ...PARTIAL, tiles: { ...PARTIAL.tiles, at_least: undefined } } });
  assert.equal(none.unassigned.state, 'unreadable', 'no floor either: "Could not be read", never 0');
  assert.equal(workViewCounts({ status: 'ready', reply: { ...PARTIAL, tiles: { ...PARTIAL.tiles, at_least: undefined } } }).unassigned, null);
});

test('the work views live in the address; Needs attention is the default and keeps the oldest-first order', () => {
  assert.equal(workViewOf(''), 'attention');
  assert.equal(workViewOf('?assigned=me'), 'mine');
  assert.equal(workViewOf('?assigned=none'), 'unassigned');
  assert.equal(workViewOf('?view=all'), 'all');
  assert.equal(workViewOf('?sort=newest'), 'all', 'another order is not Needs attention');
  assert.equal(workViewOf('?assigned=8'), 'all', 'a named owner is a filter on All');
  assert.deepEqual(viewPatch('attention'), { assigned: null, view: null, sort: null });
  assert.deepEqual(viewPatch('unassigned'), { assigned: 'none', view: null });
  assert.equal(inboxQueryOf('?assigned=none').filters.assigned, 'none', 'the Worker reads the view as its own filter');
  assert.equal(filterCount(inboxQueryOf('?assigned=me&age=past').filters), 1, 'the view is not a filter');
  assert.equal(filterCount(inboxQueryOf('?assigned=8').filters), 1, 'a named owner is');
});

test('bands: overdue, then due soon, then the rest, a band row before each; another order has none', () => {
  const rows = inboxRows(INBOX);
  const lines = bandedRows(rows, undefined);
  assert.deepEqual(lines.map((l) => (l.kind === 'band' ? `[${l.band.key}]` : l.row.key)), ['[past]', 'kyc:41', '[due_soon]', 'score_flags:5', '[ok]', 'product_testers:8', '[unknown]', 'payouts:2']);
  assert.equal(lines[0].band.text, '! Overdue · over 72 hours');
  assert.equal(lines[2].band.text, '◷ Due soon · 24–72 hours');
  assert.ok(bandedRows(rows, 'who').every((l) => l.kind === 'row'));
  assert.deepEqual(urgencyPill('past'), { text: '! Overdue', tone: 'bad' });
  assert.deepEqual(urgencyPill('due_soon'), { text: '◷ Due soon', tone: 'warn' });
  assert.equal(urgencyPill('ok'), null);
  assert.equal(urgencyPill('unknown'), null, 'an unknown age is never placed in a band');
});

test('Review says where review continues: never "Here", never "Decided on"', () => {
  assert.equal(reviewDestination('kyc'), 'KYC & KYB');
  assert.equal(reviewDestination('product_testers'), 'Product testers · Approvals');
  assert.equal(reviewDestination('comarketing'), 'Co-marketing · Approvals');
  assert.equal(reviewDestination('payouts'), 'Commissions');
  for (const lane of ['kyc', 'kyb', 'best_fit', 'wellbeing_experts', 'proposals', 'nope']) assert.doesNotMatch(reviewDestination(lane), /^Here$|Decided on/, lane);
});

test('raw store values in words: TIER_2, REJECT, unnamed, a role; free text as written', () => {
  assert.equal(humanWhat('Score sign-off · TIER_2'), 'Score sign-off · Tier 2');
  assert.equal(humanWhat('Score sign-off · REJECT'), 'Score sign-off · Reject');
  assert.equal(humanWhat('Partner profile · unnamed'), 'Partner profile · Profile name not recorded');
  assert.equal(humanWhat('Partner profile · service_provider'), 'Partner profile · Service provider');
  assert.equal(humanWhat('KYC · founder'), 'KYC · Founder');
  assert.equal(humanWhat('Job · Senior Engineer, AI'), 'Job · Senior Engineer, AI');
  assert.equal(humanWhat('TIER_2'), 'TIER_2', 'the first part is the lane\'s own words');
  assert.equal(humanToken('AI'), 'AI');
  assert.equal(humanWhat(null), 'Not recorded');
  const rows = inboxRows(INBOX);
  assert.equal(rows[2].who, 'Profile name not recorded');
  assert.equal(rows[1].what, 'Score sign-off · Tier 2');
});

test('chips: one per filter in force, none for the view or the order', () => {
  assert.deepEqual(filterChips(inboxQueryOf('?assigned=none&sort=who').filters), []);
  assert.deepEqual(filterChips(inboxQueryOf('?group=people&age=past&assigned=8&q=ad').filters, { reviewers: INBOX.reviewers }).map((c) => c.text),
    ['Search: ad', 'Group: People and accounts', 'Age: Over 72 hours', 'Owner: Admin B']);
});

// ---------------------------------------------------------------- mounted

test('mounted: header, tabs, strip, views, queue, then Workload — action before analytics', async () => {
  const v = await mount('/admin/approvals', SUPER);
  try {
    assert.equal(LINE, 'Review every waiting decision here. Continue to the relevant review surface when required.');
    assert.match(v.of('approvals-header'), /Review every waiting decision here\. Continue to the relevant review surface when required\./);
    const order = ['approvals-header', 'approvals-strip', 'approvals-views', 'approvals-inbox', 'approvals-workload'];
    const all = v.ids('approvals-');
    assert.deepEqual(order.map((id) => all.indexOf(id)), [...order.map((id) => all.indexOf(id))].sort((a, b) => a - b), 'in this order');
    assert.ok(order.every((id) => all.includes(id)));
    const charts = ['approvals-chart-lanes', 'approvals-chart-weeks'].map((id) => all.indexOf(id));
    assert.ok(charts.every((i) => i > all.indexOf('approvals-inbox')), 'the charts are below the queue');
    assert.ok(!v.has('approvals-tiles') && !v.has('approvals-tile-waiting'), 'no second dashboard header of tiles');
    assert.match(v.of('approvals-strip'), /Waiting\s*32.*Overdue\s*10.*Unassigned\s*27.*Oldest\s*4 d 4 h/s);
    assert.equal(v.props('approvals-view-attention')['aria-checked'], true, 'Needs attention is the default');
    assert.match(v.of('approvals-attention-line'), /overdue, then due soon, then everything else, oldest first in each band/);
  } finally { await v.unmount(); }
});

test('mounted P0: the Inbox tab, Waiting and All agree for a Super Admin (live shape: 31 on the glance, 32 on the inbox)', async () => {
  const v = await mount('/admin/approvals', SUPER);
  try {
    assert.match(v.of('approvals-tab-inbox'), /Inbox\s*32$/);
    assert.equal(v.of('approvals-strip-waiting-value'), '32');
    assert.match(v.of('approvals-view-all'), /All\s*32$/);
    assert.match(v.of('approvals-strip-waiting'), /1 of them for HQ/);
  } finally { await v.unmount(); }
  const partial = await mount('/admin/approvals', SUPER, { inbox: () => json(PARTIAL) });
  try {
    assert.match(partial.of('approvals-tab-inbox'), /Inbox\s*127\+$/);
    assert.equal(partial.of('approvals-strip-waiting-value'), '127+');
    assert.equal(partial.of('approvals-strip-unassigned-value'), '68+');
    assert.equal(partial.of('approvals-strip-overdue-value'), '6+');
    assert.match(partial.of('approvals-view-all'), /All\s*127\+$/);
  } finally { await partial.unmount(); }
});

test('mounted: the queue\'s columns — Request · Waiting · Owner · Review — with band rows and no "Decided on"', async () => {
  const v = await mount('/admin/approvals', SUPER);
  try {
    const heads = v.tags('TH').map((n) => n.textContent.trim()).filter((t) => !/^[!◷]|Under 24|Arrival/.test(t));
    assert.deepEqual(heads.filter(Boolean).slice(0, 4), ['Request', 'Waiting', 'Owner', 'Review']);
    assert.doesNotMatch(v.of('approvals-inbox'), /Decided on|\bHere\b/);
    assert.deepEqual(v.ids('approvals-band-'), ['approvals-band-past', 'approvals-band-due_soon', 'approvals-band-ok', 'approvals-band-unknown']);
    assert.match(v.of('approvals-row-kyc:41'), /Person A\s*KYC · Founder\s*KYC · People and accounts\s*4 d 4 h\s*! Overdue/);
    assert.match(v.of('approvals-row-score_flags:5'), /Score sign-off · Tier 2.*◷ Due soon.*Admin A · you/s, 'the caller is "you"');
    assert.match(v.of('approvals-row-product_testers:8'), /Profile name not recorded/);
    assert.match(v.of('approvals-owner-kyc:41'), /^Unassigned\s*Assign$/);
    assert.match(v.props('approvals-owner-kyc:41').children[0].props.className, /amber/, 'Unassigned is amber');
    assert.equal(v.of('approvals-owner-payouts:2'), 'Not read', 'an unread assignment is never "Unassigned"');
    assert.equal(v.of('approvals-review-kyc:41'), 'Review');
    assert.equal(v.props('approvals-review-kyc:41').href, '/admin/approvals/items/kyc-41');
    assert.equal(v.of('approvals-review-in-kyc:41'), 'in KYC & KYB');
    assert.equal(v.of('approvals-review-in-product_testers:8'), 'in Product testers · Approvals');
    assert.ok(v.has('approvals-menu-kyc:41'), '⋯ stays');
    await v.click('approvals-owner-assign-kyc:41');
    assert.match(v.of('approvals-assign'), /Assign Person A’s identity check/, 'inline Assign opens the dialog for that row');
  } finally { await v.unmount(); }
});

test('mounted: one Sort, one Filters ("Filters · N" only when active), chips only when filters exist, all in the address', async () => {
  const v = await mount('/admin/approvals', SUPER);
  try {
    assert.equal(v.ids('').filter((id) => /sort/.test(id)).length, 1, 'one Sort control on the page');
    assert.equal(v.of('approvals-filters-open'), 'Filters');
    assert.ok(!v.has('approvals-chips'), 'no chips without filters');
    await v.click('approvals-filters-open');
    await v.click('approvals-sheet-age-past');
    assert.match(v.at.path, /age=past/);
    assert.equal(v.of('approvals-filters-open'), 'Filters · 1');
    assert.match(v.of('approvals-chips'), /Age: Over 72 hours.*Clear all/s);
    await v.click('approvals-chip-remove-age');
    assert.doesNotMatch(v.at.path, /age=/);
    assert.ok(!v.has('approvals-chips'));
    await v.change('approvals-sort', 'newest');
    assert.match(v.at.path, /sort=newest/);
    assert.match(v.at.path, /view=all/, 'another order leaves Needs attention for All');
    assert.equal(v.props('approvals-view-all')['aria-checked'], true);
    assert.equal(v.ids('approvals-band-').length, 0, 'no band rows out of the oldest-first order');
  } finally { await v.unmount(); }
});

test('mounted: the views reach the Worker; arrow keys move between them', async () => {
  const v = await mount('/admin/approvals', SUPER);
  try {
    await v.click('approvals-view-unassigned');
    assert.equal(v.at.path, '/admin/approvals?assigned=none');
    assert.ok(inboxCalls(v).includes('/api/admin/approvals?page=1&assigned=none'));
    assert.equal(v.props('approvals-view-unassigned')['aria-checked'], true);
    assert.equal(v.props('approvals-view-unassigned').tabIndex, 0);
    assert.equal(v.props('approvals-view-mine').tabIndex, -1);
    assert.equal(v.of('approvals-filters-open'), 'Filters', 'a view is not a filter');
    await v.key('approvals-views', 'ArrowRight');
    assert.equal(v.at.path, '/admin/approvals?view=all');
    await v.click('approvals-view-attention');
    assert.equal(v.at.path, '/admin/approvals');
  } finally { await v.unmount(); }
  const s = await mount('/admin/approvals', SUPER);
  try {
    await s.click('approvals-strip-show-unassigned');
    assert.equal(s.at.path, '/admin/approvals?assigned=none', 'the strip\'s Show opens the Unassigned view');
  } finally { await s.unmount(); }
});

test('mounted: Waiting on HQ only in a studio shell; the HQ-held shell neither draws nor reads it', async () => {
  for (const viewer of [SUPER, ADMIN]) {
    const v = await mount('/admin/approvals', viewer);
    try {
      assert.ok(!v.has('approvals-waiting-on-hq'));
      assert.ok(!v.seen.some((p) => p.startsWith('/api/licence/mine/requests')));
    } finally { await v.unmount(); }
  }
  const studio = await mount('/admin/approvals', STUDIO);
  try {
    assert.match(studio.of('approvals-waiting-on-hq'), /Waiting on HQ.*Seat increase/s);
    const all = studio.ids('approvals-');
    assert.ok(all.indexOf('approvals-waiting-on-hq') > all.indexOf('approvals-inbox'), 'below the queue, never beside it as work');
  } finally { await studio.unmount(); }
});

test('the page source: no alert or confirm, and the queue\'s columns are not "Decided on"', () => {
  const page = read('frontend/src/pages/admin/approvals/AdminApprovals.jsx');
  assert.doesNotMatch(page, /\balert\(|\bconfirm\(/);
  assert.doesNotMatch(page, />Decided on<|>Here</);
});
