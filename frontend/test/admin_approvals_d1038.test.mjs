/**
 * D1038 (#2390) — Admin › Approvals at /admin/approvals: the addresses, the
 * twenty lanes from the Studio glance (a failed lane never 0, an uncounted
 * lane never 0), the Inbox oldest first, HQ decides for a Super Admin only,
 * and the three lane boards on the reads that exist.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_approvals_d1038.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import {
  HQ_LANES, LANES, MOVED_KEY, ageText, bandOf, boardOf, expertBoard, expertState, filtersOf, groupCounts, laneBars, laneViews,
  oldestLine, pitchRows, tabOf, waitingLanes, waitingTile, attributionTotals,
} from '../src/pages/admin/approvals/approvalsModel.js';
import { glancesFromStudioGlance } from '../src/pages/admin/adminStudioOverview.js';
import AdminApprovals, { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';
import LaneBoards from '../src/pages/admin/approvals/LaneBoards.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// The glance as the Worker answers on HQ: worst first, one lane failed (lp), one empty (events).
const GLANCE = {
  tier: 'hq',
  approvals: {
    pending_total: null,
    lanes: [
      { key: 'due_diligence', label: 'Due diligence', count: 6, oldest_age_hours: 146, sla: 'past' },
      { key: 'kyc', label: 'KYC', count: 10, oldest_age_hours: 103, sla: 'past' },
      { key: 'exploring', label: 'Exploring', count: 60, oldest_age_hours: 2, sla: 'ok' },
      { key: 'partner_profiles', label: 'Partner profiles', count: 4, oldest_age_hours: 30, sla: 'due_soon' },
      { key: 'events', label: 'Events', count: 0, oldest_age_hours: null, sla: 'ok' },
      { key: 'jobs', label: 'Jobs', count: 3, oldest_age_hours: null, sla: 'unknown' },
      { key: 'lp', label: 'LP applications', count: null, oldest_age_hours: null, sla: 'unknown' },
      { key: 'referrals', label: 'Referrals', count: 0, oldest_age_hours: null, sla: 'ok' },
      { key: 'cohort', label: 'Cohort applications', count: 7, oldest_age_hours: 50, sla: 'due_soon' },
      { key: 'moderation', label: 'Spinout moderation', count: 1, oldest_age_hours: 9, sla: 'ok' },
      { key: 'best_fit', label: 'Best-Fit consultations', count: 1, oldest_age_hours: 20, sla: 'ok' },
      // D1041 (#2889): part 3's eight lanes, measured empty here so the sums above hold.
      ...['kyb', 'comarketing', 'wellbeing_experts', 'perk_listings', 'strategic_access', 'lab_hosts', 'score_flags', 'articles']
        .map((key) => ({ key, label: key, count: 0, oldest_age_hours: null, sla: 'ok' })),
    ],
    no_queue: [],
  },
};
const ALL_READ = { ...GLANCE, approvals: { ...GLANCE.approvals, lanes: GLANCE.approvals.lanes.map((l) => (l.key === 'lp' ? { ...l, count: 3, oldest_age_hours: 12 } : l)) } };
const ready = (payload) => ({ status: 'ready', hq: glancesFromStudioGlance(payload, null).hq });

// ---------------------------------------------------------------- the model

test('the addresses, the tabs, the boards, and the redirect\'s key', () => {
  assert.equal(tabOf('/admin/approvals'), 'inbox');
  assert.equal(tabOf('/admin/approvals/lanes/'), 'lanes');
  assert.equal(tabOf('/admin/approvals/decided'), 'decided');
  assert.deepEqual(boardOf('/admin/approvals/co-marketing/declined'), { board: 'co-marketing', tab: 'rejected' });
  assert.deepEqual(boardOf('/admin/approvals/wellbeing-experts'), { board: 'wellbeing-experts', tab: 'verify' });
  assert.deepEqual(boardOf('/admin/approvals/product-testers'), { board: 'product-testers', tab: 'waiting' });
  assert.equal(boardOf('/admin/approvals/lanes'), null);
  assert.equal(MOVED_KEY, 'held-approvals');
  assert.deepEqual(filtersOf('?group=deals&lane=kyc&q=ky'), { group: 'deals', lane: 'kyc', q: 'ky' });
  assert.equal(filtersOf('?group=nope').group, null, 'an unknown group is no filter');
});

test('the twenty lanes in four groups; nine new; the nineteen the glance counts (D1041); HQ\'s nine', () => {
  assert.equal(LANES.length, 20);
  assert.deepEqual([...new Set(LANES.map((l) => l.group))], ['people', 'programs', 'community', 'deals']);
  assert.equal(LANES.filter((l) => l.isNew).length, 9);
  assert.equal(LANES.filter((l) => l.glance).length, 19);
  assert.deepEqual(LANES.filter((l) => !l.glance).map((l) => l.key), ['product_testers'], 'only the lane with no store is uncounted');
  assert.deepEqual(LANES.filter((l) => l.here).map((l) => l.key), ['product_testers', 'wellbeing_experts', 'comarketing']);
  assert.equal(HQ_LANES.length, 9);
});

test('ages and bands: "6 d 2 h", none under 24 hours, amber to 72, red from 72; unknown is null', () => {
  assert.equal(ageText(146), '6 d 2 h');
  assert.equal(ageText(9), '9 h');
  assert.equal(ageText(0.5), '30 min');
  assert.equal(ageText(null), null);
  assert.equal(bandOf(23.9).tone, null);
  assert.equal(bandOf(24).tone, 'warn');
  assert.equal(bandOf(72).tone, 'bad');
  assert.equal(bandOf(null), null);
});

test('a lane is a number, unreadable (never 0), not counted yet (never 0), or loading', () => {
  const views = laneViews(ready(GLANCE));
  const v = (k) => views.find((x) => x.key === k);
  assert.deepEqual([v('kyc').state, v('kyc').count, v('kyc').age, v('kyc').band.tone], ['ready', 10, '4 d 7 h', 'bad']);
  assert.deepEqual([v('lp').state, v('lp').count], ['unreadable', null]);
  assert.deepEqual([v('events').state, v('events').count, v('events').band], ['ready', 0, null], 'a measured 0 is fine');
  assert.deepEqual([v('product_testers').state, v('product_testers').count], ['unrecorded', undefined]);
  assert.deepEqual([v('comarketing').state, v('comarketing').count], ['ready', 0], 'D1041: a part 3 lane reads its count');
  const pitched = { ...GLANCE, approvals: { ...GLANCE.approvals, lanes: GLANCE.approvals.lanes.map((l) => (l.key === 'comarketing' ? { ...l, count: 2, oldest_age_hours: 80 } : l)) } };
  const c = laneViews(ready(pitched)).find((x) => x.key === 'comarketing');
  assert.deepEqual([c.state, c.count, c.age, c.band.tone], ['ready', 2, '3 d 8 h', 'bad']);
  const noLane = { ...GLANCE, approvals: { ...GLANCE.approvals, lanes: GLANCE.approvals.lanes.filter((l) => l.key !== 'articles') } };
  assert.deepEqual([laneViews(ready(noLane)).find((x) => x.key === 'articles').state, laneViews(ready(noLane)).find((x) => x.key === 'articles').count], ['unrecorded', undefined], 'a glance from before part 3 is not a 0');
  assert.equal(laneViews({ status: 'loading', hq: null })[0].state, 'loading');
  assert.equal(laneViews({ status: 'unreadable', hq: null }).find((x) => x.key === 'kyc').state, 'unreadable');
});

test('the Waiting tile: "92 +" when a lane failed and which; the full sum and the uncounted lanes when all answered', () => {
  const partial = waitingTile(laneViews(ready(GLANCE)));
  assert.deepEqual([partial.value, partial.sub], ['92 +', 'LP applications could not be read']);
  const whole = waitingTile(laneViews(ready(ALL_READ)));
  assert.deepEqual([whole.value, whole.sub], ['95', 'across 19 of 20 lanes; 1 is not counted yet']);
  assert.equal(waitingTile(laneViews({ status: 'unreadable', hq: null })).state, 'unreadable');
  assert.equal(oldestLine(laneViews(ready(GLANCE))), 'oldest 6 d 2 h, Due diligence');
});

test('the Inbox lists waiting lanes oldest first, an unknown age last, by group and by search from two characters', () => {
  const views = laneViews(ready(GLANCE));
  assert.deepEqual(waitingLanes(views).map((x) => x.key), ['due_diligence', 'kyc', 'cohort', 'partner_profiles', 'best_fit', 'moderation', 'exploring', 'jobs']);
  assert.deepEqual(waitingLanes(views, { group: 'deals' }).map((x) => x.key), ['due_diligence']);
  assert.deepEqual(waitingLanes(views, { q: 'k' }).length, 8, 'one character does not filter');
  assert.deepEqual(waitingLanes(views, { q: 'ky' }).map((x) => x.key), ['kyc']);
  const counts = groupCounts(views);
  assert.equal(counts.people, null, 'a failed lane leaves its group with no total');
  assert.equal(counts.deals, 6);
  assert.equal(counts.all, null);
  assert.equal(groupCounts(laneViews(ready(ALL_READ))).all, 95);
  assert.deepEqual(laneBars(views).slice(0, 3).map((b) => [b.label, b.tone]), [['Due diligence', 'violet'], ['KYC', 'violet'], ['Spin-Out Lab applications', 'amber']]);
});

test('pitches oldest first in the canvas\'s words; attribution summed over the published', () => {
  const now = Date.parse('2026-10-21T16:00:00Z');
  const rows = pitchRows([
    { uid: 'b', title: 'The LP letter, explained', asset_type: 'blog', partner_company: 'Firm Name', partner_name: 'Ben', created_at: '2026-10-20 16:00:00', target_audience: 'First-time LPs' },
    { uid: 'a', title: 'Hiring your first engineer', asset_type: 'webinar', partner_company: 'Partner A', created_at: '2026-10-18 13:00:00', proposed_date: '2026-11-14' },
  ], now);
  assert.deepEqual(rows.map((r) => [r.key, r.type, r.age, r.date, r.audience]), [['a', 'Webinar', '3 d 3 h', '14 Nov 2026', 'Not given'], ['b', 'Blog', '1 d 0 h', 'No date', 'First-time LPs']]);
  assert.equal(rows[1].submitter, 'Ben');
  assert.deepEqual(attributionTotals([{ attribution: { visit: 3, signup: 1 } }, { attribution: { visit: 2 } }]), { visits: 5, signups: 1, leads: 0, conversions: 0 });
});

test('experts by the directory\'s bar; a sample is no item; counts are not drawn when the read stopped short', () => {
  assert.equal(expertState({ verified: false, profile_completion_pct: 92 }), 'verify');
  assert.equal(expertState({ verified: false, profile_completion_pct: 41 }), 'incomplete');
  assert.equal(expertState({ verified: true, hidden: true }), 'hidden');
  assert.equal(expertState({ verified: false, profile_completion_pct: 99, is_sample: true }), null);
  const reply = { matches: [
    { uid: 'e1', name: 'Expert A', verified: false, profile_completion_pct: 92, hourly_rate_usd: 120, categories: ['Coaching'] },
    { uid: 'e2', name: 'Expert B', verified: false, profile_completion_pct: 74, first_session_free: true },
    { uid: 'e3', name: 'Expert C', verified: false, profile_completion_pct: 41 },
    { uid: 'e4', name: 'Expert D', verified: true },
  ], total_active: 4 };
  const b = expertBoard(reply, 'verify');
  assert.deepEqual(b.counts, { verify: 2, incomplete: 1, verified: 1, hidden: 0 });
  assert.deepEqual(b.rows.map((r) => [r.name, r.pricing]), [['Expert A', '$120 an hour'], ['Expert B', 'Free first session']]);
  assert.equal(b.partial, false);
  assert.equal(expertBoard({ ...reply, total_active: 80 }, 'verify').partial, true);
});

// ---------------------------------------------------------------- mounted

async function render(url, el) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: el }))));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    ids: (prefix) => walk(container).map((n) => props(n)?.['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => props(n)?.href),
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub({ glance = () => json(GLANCE), queue = (s) => json({ items: [] }), experts = () => json({ matches: [], total_active: 0 }) } = {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(`${u.pathname}${u.search}`);
    if (u.pathname === '/api/admin/studio/glance') return glance();
    if (u.pathname === '/api/comarketing/admin/queue') return queue(u.searchParams.get('status'));
    if (u.pathname === '/api/wellbeing/experts') return experts();
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}
const reads = (s) => [...new Set(s.seen.filter((p) => !p.startsWith('/api/ai') && !p.startsWith('/api/rail')).map((p) => p.split('?')[0]))].sort();

test('mounted, Inbox: one h1, the moved notice, "92 +" with the failed lane named, lanes oldest first with their doors, and only the glance read', async () => {
  const s = stub();
  const v = await render('/admin/approvals?moved=held-approvals', h(AdminApprovals));
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('approvals-header'), /Approvals has a new address\. Update your bookmark\./);
    assert.match(v.of('approvals-tab-inbox'), /Inbox\s*—/, 'no total while a lane failed');
    assert.match(v.of('approvals-tile-waiting'), /Waiting\s*92 \+\s*LP applications could not be read/);
    assert.match(v.of('approvals-tile-over72'), /Not read here yet\s*oldest 6 d 2 h, Due diligence/);
    assert.match(v.of('approvals-tile-assigned'), /Not read here yet/);
    assert.match(v.of('approvals-partial'), /LP applications could not be read/);
    assert.deepEqual(v.ids('approvals-row-'), ['approvals-row-due_diligence', 'approvals-row-kyc', 'approvals-row-cohort', 'approvals-row-partner_profiles', 'approvals-row-best_fit', 'approvals-row-moderation', 'approvals-row-exploring', 'approvals-row-jobs']);
    assert.match(v.of('approvals-row-jobs'), /Age not recorded/, 'an unknown age sorts last and says so');
    assert.match(v.of('approvals-row-kyc'), /4 d 7 h\s*Over 72 hours/);
    assert.ok(v.hrefs().includes('/admin/due-diligence'));
    assert.deepEqual(reads(s), ['/api/admin/studio/glance']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, Inbox: an Admin on an HQ lane link sees the Super Admin card, never the rows; a failed glance is never an empty inbox', async () => {
  let s = stub();
  let v = await render('/admin/approvals?lane=payouts', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 0 } }));
  try {
    assert.match(v.of('approvals-hq-only'), /This lane belongs to the Super Admin\./);
    assert.ok(!v.has('approvals-inbox'));
  } finally { await v.unmount(); s.restore(); }
  s = stub({ glance: () => json({ detail: 'down' }, 503) });
  v = await render('/admin/approvals', h(AdminApprovals));
  try {
    assert.match(v.of('approvals-failed'), /We could not load Approvals\./);
    assert.ok(!v.has('approvals-empty'), 'a failed read is not "nothing waiting"');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, Lanes: each group\'s lanes with New pills, Could not be read with Try again, Not read here yet, and HQ decides only for a Super Admin', async () => {
  const s = stub();
  let v = await render('/admin/approvals/lanes', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 0 } }));
  try {
    assert.match(v.of('approvals-lane-lp'), /LP applications\s*Could not be read Try again/);
    // D1041: KYB is counted now (the stub's glance answers 0); Product testers has no store.
    assert.match(v.of('approvals-lane-kyb'), /KYB\s*New\s*0/);
    assert.match(v.of('approvals-lane-product_testers'), /Product testers\s*New\s*Not read here yet/);
    assert.match(v.of('approvals-lane-events'), /Events\s*0\s*—\s*Events › Review/);
    assert.match(v.of('approvals-not-a-queue'), /Partner invitations: An open invitation waits on the invitee, not an admin\./);
    assert.ok(!v.has('approvals-hq-lanes'), 'an Admin never sees the HQ group');
  } finally { await v.unmount(); }
  v = await render('/admin/approvals/lanes', h(ApprovalsPage, { viewer: { role: 'admin', is_super_admin: 1 } }));
  try {
    assert.match(v.of('approvals-hq-lanes'), /HQ decides/);
    assert.match(v.of('approvals-hq-proposals'), /not built yet/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, boards: co-marketing reads its five states alone and decides nowhere; wellbeing\'s partial read draws no counts; testers read nothing', async () => {
  const items = { proposed: [{ uid: 'p1', title: 'Hiring your first engineer', asset_type: 'webinar', partner_company: 'Partner A', created_at: '2026-10-18 13:00:00' }] };
  let s = stub({ queue: (st) => (st === 'withdrawn' ? json({ detail: 'down' }, 503) : json({ items: items[st] || [] })) });
  let v = await render('/admin/approvals/co-marketing', h(LaneBoards));
  try {
    assert.match(v.of('approvals-board-header'), /Approvals.*Co-marketing pitches.*New lane/s);
    assert.match(v.of('pitches-tab-proposed'), /Proposed\s*1/);
    assert.match(v.of('pitches-tab-withdrawn'), /Withdrawn\s*—/, 'a failed state is a dash, never 0');
    assert.match(v.of('pitch-p1'), /Hiring your first engineer\s*Webinar\s*Partner A/);
    assert.match(v.of('pitches-decide-line'), /stay on Co-marketing/);
    assert.equal(s.seen.filter((p) => p.startsWith('/api/comarketing/admin/queue')).length, 5);
    assert.ok(!s.seen.some((p) => /\/admin\/pitches\//.test(p)), 'nothing is decided from this board');
  } finally { await v.unmount(); s.restore(); }
  s = stub({ experts: () => json({ matches: [{ uid: 'e1', name: 'Expert A', verified: false, profile_completion_pct: 92 }], total_active: 80 }) });
  v = await render('/admin/approvals/wellbeing-experts', h(LaneBoards));
  try {
    assert.match(v.of('experts-tab-verify'), /To verify\s*—/);
    assert.match(v.of('experts-partial'), /first 1 of 80/);
    assert.match(v.of('expert-e1'), /Expert A/);
  } finally { await v.unmount(); s.restore(); }
  s = stub();
  v = await render('/admin/approvals/product-testers', h(LaneBoards));
  try {
    assert.match(v.of('approvals-testers-none'), /No product tester application is stored yet/);
    assert.deepEqual(reads(s), [], 'no store, no read');
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- the wiring

test('the routes under one guard, the redirect, the row lit on every sub-path, and the canvas in design/incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/approvals', '/admin/approvals/lanes', '/admin/approvals/decided']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <AdminApprovals />)} />`), p);
  }
  for (const p of ['/admin/approvals/product-testers', '/admin/approvals/co-marketing', '/admin/approvals/co-marketing/declined', '/admin/approvals/wellbeing-experts/hidden']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <ApprovalsLaneBoards />)} />`), p);
  }
  assert.ok(app.includes('<Route path="/admin/held/approvals" element={<HeldApprovalsRedirect />} />'));
  const row = SIDEBAR_GROUPS.admin.flatMap((g) => g.items).find((r) => r.label === 'Approvals');
  assert.equal(row.to, '/admin/approvals');
  assert.ok(row.match.includes('/admin/approvals'), 'the lane boards light the row');
  assert.ok(read('design/incoming/Approvals · Boards.dc.html').includes('APR16'));
  assert.ok(read('design/incoming/Approvals Page.dc.html').length > 1000);
  assert.doesNotMatch(read('frontend/src/pages/admin/approvals/LaneBoards.jsx'), /window\.(alert|confirm)|\balert\(|\bconfirm\(/);
});
