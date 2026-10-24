/**
 * D994 (#2805) — Partner profiles part 5: To review and All profiles drawn
 * from D990's reads. The four tiles and the weekly series from the counts
 * read; the queue's age pills (amber at 72 hours), Source, Account and
 * Identity check; every filter, sort and column of All profiles; Drafts out of
 * the queue with their own chip; the empty, loading and failed states; and
 * what part 2 and part 4 have not recorded, said, never a zero.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_profiles_d994.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  accountView, ageOf, categoryChart, dayOf, failureRef, filtersSet, identityView, listParams, pageLabel, rowView, sourceWords,
  tilesOf, weeklyChart,
} from '../src/pages/admin/profiles/ppModel.js';
import PartnerProfiles from '../src/pages/admin/profiles/PartnerProfiles.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-24T12:00:00Z');

// ---------------------------------------------------------------- fixtures, as D990 answers

const row = (o) => ({
  ref: 'pp_0000000001', email: 'x@example.com', created_at: '2026-10-24 10:00:00', user_id: null, invitation_id: null,
  full_name: null, organization: null, user_name: null, persona: null, legal_entity_name: null, entity_type: null,
  founder_track: null, company_established: null, partnership_goal: null, agreement_type: null, admin_status: 'pending',
  status: 'pending', sources: ['chat'], account: null, identity_check: null, ...o,
});
const ACC = (role, extra = {}) => ({ user_id: 7, name: null, role, exploring: role === 'exploring', suggested_role: null, assigned_role: null, assigned_at: null, ...extra });
const QUEUE = [
  row({ ref: 'pp_000000000a', email: 'ada@example.com', user_name: 'Ada Example', created_at: '2026-10-20 12:00:00', persona: 'Founder', founder_track: 'Spin-Out (New)', company_established: 0, account: ACC('exploring', { suggested_role: 'founder' }), identity_check: { state: 'not_started', label: 'Not started' } }),
  row({ ref: 'pp_000000000b', email: 'ben@example.com', user_name: 'Ben Sample', created_at: '2026-10-21 11:00:00', sources: ['invitation'], persona: 'Operating Partner', legal_entity_name: 'Sample Capital LP', entity_type: 'Limited partnership', account: ACC('partner'), identity_check: { state: 'approved', label: 'Approved' } }),
  row({ ref: 'pp_000000000c', email: 'dev@example.com', user_name: 'Dev Testcase', created_at: '2026-10-23 16:00:00', sources: ['chat', 'eadwyn'], persona: 'Operating Partner', account: ACC('partner'), identity_check: { state: 'pending', label: 'Pending' } }),
  row({ ref: 'pp_000000000d', email: 'name@example.com', created_at: '2026-10-24 10:00:00', sources: ['invitation'], persona: 'Technical Partner' }),
];
const ALL = [
  ...QUEUE,
  row({ ref: 'pp_000000000e', email: 'draft@example.com', status: 'draft', sources: [], persona: 'Technical Partner', created_at: '2026-10-23 09:00:00' }),
  row({ ref: 'pp_000000000f', email: 'finn@example.com', user_name: 'Finn Mock', status: 'verified', admin_status: 'verified', persona: 'Founder', founder_track: 'Strategic Scale (Existing)', created_at: '2026-09-28 09:00:00', agreement_type: 'Spin-Out Lab participation agreement' }),
  row({ ref: 'pp_0000000010', email: 'odd@example.com', status: null, admin_status: 'archived', persona: null, created_at: '2026-08-14 09:00:00' }),
];
const TOTALS = (rows) => ({
  total: rows.length,
  draft: rows.filter((r) => r.status === 'draft').length,
  pending: rows.filter((r) => r.status === 'pending').length,
  verified: rows.filter((r) => r.status === 'verified').length,
  rejected: rows.filter((r) => r.status === 'rejected').length,
  not_recorded: rows.filter((r) => r.status == null).length,
});
const OPTIONS = { category: ['Founder', 'Operating Partner', 'Technical Partner'], founder_track: ['Spin-Out (New)', 'Strategic Scale (Existing)'], entity_type: ['Limited partnership'], agreement: ['Spin-Out Lab participation agreement'] };
const PART2 = 'Verification and rejection dates are recorded from Partner profiles part 2.';
const PART4 = 'Envelope state is read from Partner profiles part 4.';
const WEEKS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 3 + 7 * i));
  return { week_start: d.toISOString().slice(0, 10), captured: [2, 3, 2, 4, 3, 3, 4, 5, 3, 4, 5, 7][i], verified: null, rejected: null };
});
const COUNTS = {
  as_of: '2026-10-24T12:00:00.000Z',
  waiting: { available: true, reason: null, count: 4, over_24h: 2, over_72h: 1, oldest_at: '2026-10-20 12:00:00', drafts: 1 },
  verified_30d: { available: false, reason: PART2, count: null },
  envelopes_out: { available: false, reason: PART4, count: null },
  weekly: { available: true, reason: null, verified_available: false, verified_reason: PART2, weeks: WEEKS },
};

// ---------------------------------------------------------------- the model

test('a row in the canvas\'s words: sources, account, identity check, entity type and the captured day', () => {
  const v = rowView(QUEUE[0], NOW);
  assert.deepEqual(v.sources, ['Onboarding chat']);
  assert.deepEqual([v.account.text, v.account.sub], ['Explorer', 'Suggested: Founder']);
  assert.deepEqual([v.identity.text, v.identity.tone], ['Not started', 'quiet']);
  assert.equal(v.captured, '20 Oct 2026');
  const ben = rowView(QUEUE[1], NOW);
  assert.deepEqual([ben.sources, ben.entity, ben.entityType, ben.account.text, ben.identity.tone], [['Partner invitation'], 'Sample Capital LP', 'Limited partnership', 'Operating Partner', 'green']);
  assert.deepEqual(rowView(QUEUE[2], NOW).sources, ['Onboarding chat', 'Eadwyn questions']);
  // No account: no identity check to show, and it says so rather than a pill.
  const none = rowView(QUEUE[3], NOW);
  assert.deepEqual([none.account.has, none.account.text], [false, 'No account yet']);
  assert.deepEqual([none.identity.has, none.identity.text, none.identity.tip], [false, '—', 'No account yet']);
  assert.deepEqual(sourceWords([]), ['None recorded'], 'a Draft has no source, and says so');
  assert.equal(accountView(ACC('investor')).sub, null);
  assert.equal(identityView({ state: 'rejected', label: 'Rejected' }).tone, 'red');
  assert.deepEqual([rowView(ALL[4]).status, rowView(ALL[4]).statusKey], ['Draft', 'draft']);
  assert.deepEqual([rowView(ALL[6]).status, rowView(ALL[6]).statusKey], ['Not recorded', 'other']);
  assert.equal(dayOf(null), '—');
});

test('the age pill: minutes, hours, then days, amber from 72 hours exactly, and no stamp is a dash, never 0h', () => {
  assert.deepEqual([ageOf('2026-10-24 11:15:00', NOW).text, ageOf('2026-10-24 11:15:00', NOW).over], ['45m', false]);
  assert.equal(ageOf('2026-10-23 16:00:00', NOW).text, '20h');
  assert.equal(ageOf('2026-10-22 12:00:01', NOW).text, '47h');
  assert.equal(ageOf('2026-10-20 12:00:00', NOW).text, '4d');
  assert.equal(ageOf('2026-10-21 12:00:01', NOW).over, false, 'under 72 hours is not amber');
  assert.equal(ageOf('2026-10-21 12:00:00', NOW).over, true, '72 hours is amber');
  assert.equal(ageOf('2026-10-20 12:00:00', NOW).tip, 'Waiting 4 days');
  assert.deepEqual([ageOf(null, NOW).text, ageOf(null, NOW).over], ['—', false]);
  // D1's zone-less stamp is UTC (parseStamp), not the viewer's local time.
  assert.equal(ageOf('2026-10-24 11:00:00', NOW).text, '1h');
});

test('the tiles: Waiting and Past 72 hours from the counts read, the two part 2 and 4 blocks Not recorded with their reason', () => {
  assert.equal(tilesOf({ status: 'loading' }), null);
  const t = tilesOf({ status: 'ready', data: COUNTS });
  assert.deepEqual([t.waiting.kind, t.waiting.value, t.waiting.sub], ['num', 4, 'oldest 4 days']);
  assert.deepEqual([t.past72.value, t.past72.amber, t.past72.sub], [1, true, '2 under 24h · 1 under 72h']);
  assert.deepEqual(t.verified30, { kind: 'not_recorded', reason: PART2 });
  assert.deepEqual(t.out, { kind: 'not_recorded', reason: PART4 });
  assert.equal(t.drafts, 1);
  // A measured zero shows as 0 (PRF7).
  const zero = tilesOf({ status: 'ready', data: { ...COUNTS, waiting: { ...COUNTS.waiting, count: 0, over_24h: 0, over_72h: 0, oldest_at: null, drafts: 0 } } });
  assert.deepEqual([zero.waiting.value, zero.waiting.sub, zero.past72.value, zero.past72.amber], [0, 'nothing waiting', 0, false]);
  // A failed read, or a failed block, is never a zero.
  const failed = tilesOf({ status: 'error' });
  for (const k of ['waiting', 'past72', 'verified30', 'out']) assert.equal(failed[k].kind, 'failed', k);
  const blockDown = tilesOf({ status: 'ready', data: { ...COUNTS, waiting: { available: false, reason: 'The partner profiles could not be read.', count: null } } });
  assert.equal(blockDown.waiting.kind, 'failed');
  assert.equal(blockDown.past72.kind, 'failed');
  assert.equal(blockDown.drafts, null);
});

test('the weekly chart: captured each week, verified and rejected null (dashed) until part 2, the last week to date', () => {
  const c = weeklyChart(COUNTS.weekly);
  assert.equal(c.rows.length, 12);
  assert.deepEqual(c.rows[0], { label: '3 Aug', values: [2, null, null], toDate: false });
  assert.equal(c.rows[11].toDate, true);
  assert.equal(c.decided, false);
  assert.equal(c.reason, PART2);
  assert.equal(c.thisWeek, 7);
  assert.ok(!c.rows.some((r) => r.values[1] === 0 || r.values[2] === 0), 'a decision not recorded drawn as 0');
  assert.equal(weeklyChart({ available: false, weeks: [] }), null);
  // Once part 2 records them, they draw.
  const later = weeklyChart({ ...COUNTS.weekly, verified_available: true, weeks: WEEKS.map((w) => ({ ...w, verified: 1, rejected: 0 })) });
  assert.deepEqual(later.rows[0].values, [2, 1, 0]);
});

test('the categories chart: Founder split by track, one bar each other category, no category a line, never a bar', () => {
  const c = categoryChart(ALL);
  const founder = c.rows.find((r) => r.category === 'Founder');
  assert.deepEqual(founder.parts.map((p) => [p.key, p.value]), [['spinout', 1], ['scale', 1], ['untracked', 0]]);
  assert.equal(founder.total, '2 · 1 + 1');
  assert.equal(c.rows.find((r) => r.category === 'Technical Partner').total, '2');
  assert.equal(c.none, 1);
  assert.ok(!c.rows.some((r) => !r.category));
  assert.match(c.alt, /no category captured 1\.$/);
});

test('the list\'s parameters: To review is the waiting profiles only, oldest first; All profiles takes the chip and every filter', () => {
  assert.deepEqual(listParams('review', { q: 'a', page: 1 }), { q: null, sort: 'waiting', page: null, page_size: 25, source: null, category: null, founder_track: null, status: 'pending' });
  const all = listParams('all', { q: ' ada ', page: 3, status: 'draft', source: 'invitation', category: 'Founder', founder_track: 'not_recorded', entity_type: 'Delaware LLC', agreement: 'not_recorded', has_account: 'no', identity: 'no_account', captured_from: '2026-10-01', captured_to: '2026-10-24' });
  assert.deepEqual(all, { q: 'ada', sort: 'newest', page: 3, page_size: 25, source: 'invitation', category: 'Founder', founder_track: 'not_recorded', status: 'draft', entity_type: 'Delaware LLC', agreement: 'not_recorded', has_account: 'no', identity: 'no_account', captured_from: '2026-10-01', captured_to: '2026-10-24' });
  assert.equal(listParams('all', { status: 'all' }).status, null);
  assert.equal(filtersSet('review', { source: 'chat', entity_type: 'x' }), 1, 'To review has three filters');
  assert.equal(filtersSet('all', { source: 'chat', entity_type: 'x', captured_to: '2026-10-01' }), 3);
  assert.deepEqual([pageLabel(1, 25, 64), pageLabel(3, 25, 64), pageLabel(1, 25, 0)], ['1–25 of 64', '51–64 of 64', '0 of 0']);
  assert.equal(failureRef({ status: 503, code: 'partner_profiles_unreadable' }), 'HTTP 503 · partner_profiles_unreadable');
  assert.equal(failureRef(new Error('x')), 'The request did not reach the server.');
});

// ---------------------------------------------------------------- the page, mounted

async function render(url) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null,
        h(Route, { path: '/admin/partner-profiles', element: h(PartnerProfiles) }),
        h(Route, { path: '/admin/partner-profiles/all', element: h(PartnerProfiles) }))));
  });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    all: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).map(textOf),
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async click(label) {
      const b = walk(container).find((n) => n.tagName === 'BUTTON' && textOf(n).replace(/\s+/g, ' ').trim() === label);
      assert.ok(b, `no button ${label}`);
      await act(async () => { props(b).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async pick(testId, value) {
      const n = byTestId(testId);
      assert.ok(n, `no ${testId}`);
      await act(async () => { props(n).onChange({ target: { value } }); });
      await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** D990's list on a stub: it filters by status and category and pages, as the Worker does. */
function serveList(u, rows) {
  const p = u.searchParams;
  let out = rows;
  if (p.get('status')) out = out.filter((r) => r.status === p.get('status'));
  if (p.get('category')) out = out.filter((r) => r.persona === p.get('category'));
  if (p.get('source')) out = out.filter((r) => (p.get('source') === 'none' ? !r.sources.length : r.sources.includes(p.get('source'))));
  const size = Number(p.get('page_size') || 25);
  const page = Number(p.get('page') || 1);
  return { rows: out.slice((page - 1) * size, page * size), totals: TOTALS(out), page, page_size: size, sort: p.get('sort') || 'waiting', options: OPTIONS };
}

function stub({ list = (u) => json(serveList(u, ALL)), counts = () => json(COUNTS), record = () => json({ email: 'ada@example.com', user_name: 'Ada Example', chat_history: '[]' }) } = {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(`${u.pathname}${u.search}`);
    if (u.pathname === '/api/admin/partner-profiles') return list(u);
    if (u.pathname === '/api/admin/partner-profiles/counts') return counts(u);
    if (u.pathname.startsWith('/api/profiling/admin/')) return record(u);
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('mounted, To review: the tiles, the queue oldest first with its seven columns, the age pills and the Drafts note', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles?moved=profiles');
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('pp-header'), /The Admin Console has moved: Partner profiles now lives under Approvals\./);
    assert.match(v.of('pp-tab-review'), /To review\s*4/, 'the tab counts the waiting profiles, Drafts left out');
    assert.match(v.of('pp-tab-all'), /All profiles\s*7/);
    assert.match(v.of('pp-tile-waiting'), /Waiting\s*4\s*oldest 4 days/);
    assert.match(v.of('pp-tile-past72'), /Past 72 hours\s*1\s*2 under 24h · 1 under 72h/);
    assert.match(v.of('pp-tile-verified30'), new RegExp(`Not recorded${PART2}`));
    assert.match(v.of('pp-tile-out'), new RegExp(`Not recorded${PART4}`));
    assert.match(v.of('pp-queue'), /Waiting.*Person.*Source.*Onboarding category.*Entity.*Account.*Identity check/s);
    const rows = v.all('pp-queue-row');
    assert.equal(rows.length, 4);
    assert.match(rows[0], /^\d+dAda Example.*Onboarding chat.*Founder.*Spin-Out.*Not incorporated.*Not given.*Explorer.*Suggested: Founder.*Not started.*Review$/s);
    assert.match(rows[1], /Ben Sample.*Partner invitation.*Sample Capital LP.*Limited partnership.*Operating Partner.*Approved/s);
    assert.match(rows[3], /No account yet.*—Review$/s);
    assert.match(v.of('pp-drafts-note'), /Drafts are not in the queue: 1 profile has nothing to review yet\. See them in All profiles\. Opening this list is recorded\./);
    // The queue asks the Worker for waiting profiles only, oldest first.
    assert.ok(s.seen.some((q) => /^\/api\/admin\/partner-profiles\?/.test(q) && q.includes('status=pending') && q.includes('sort=waiting')), s.seen.join('\n'));
    assert.ok(!s.seen.some((q) => q.startsWith('/api/profiling/admin/list')), 'the old list read');
    assert.ok(!s.seen.some((q) => q.startsWith('/api/admin/studio/glance')), 'the glance read; the Waiting tile is the counts read\'s');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, To review: a filter is asked of the Worker; nothing waiting and no profiles ever are said apart', async () => {
  let s = stub();
  let v = await render('/admin/partner-profiles');
  try {
    await v.pick('pp-filter-source', 'invitation');
    assert.equal(v.all('pp-queue-row').length, 2);
    assert.ok(s.seen.some((q) => q.includes('source=invitation') && q.includes('status=pending')));
    await v.pick('pp-filter-category', 'Investor — Syndicate');
    assert.match(v.of('pp-no-match'), /No waiting profile matches/, 'a filtered empty queue is not "nothing waiting"');
    assert.ok(!v.has('pp-queue-empty'));
  } finally { await v.unmount(); s.restore(); }
  const decided = ALL.filter((r) => r.status !== 'pending');
  s = stub({ list: (u) => json(serveList(u, decided)), counts: () => json({ ...COUNTS, waiting: { ...COUNTS.waiting, count: 0, over_24h: 0, over_72h: 0, oldest_at: null } }) });
  v = await render('/admin/partner-profiles');
  try {
    assert.match(v.of('pp-queue-empty'), /Nothing waiting\. Every profile has a decision\./);
    assert.match(v.of('pp-tile-waiting'), /Waiting\s*0\s*nothing waiting/, 'a measured zero shows as 0');
  } finally { await v.unmount(); s.restore(); }
  s = stub({ list: (u) => json(serveList(u, [])), counts: () => json({ ...COUNTS, waiting: { ...COUNTS.waiting, count: 0, over_24h: 0, over_72h: 0, oldest_at: null, drafts: 0 } }) });
  v = await render('/admin/partner-profiles');
  try {
    assert.match(v.of('pp-none'), /No partner profiles yet\./);
    assert.ok(!v.has('pp-queue'), 'the queue is drawn over a studio with no profiles');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: the list failing says so with Details and Try again, and the tiles still answer; the counts failing costs only the tiles', async () => {
  let fail = true;
  let s = stub({ list: (u) => (fail && u.searchParams.get('status') === 'pending' ? json({ error: 'partner_profiles_unreadable', message: 'down' }, 503) : json(serveList(u, ALL))) });
  let v = await render('/admin/partner-profiles');
  try {
    assert.match(v.of('pp-list-failed'), /We could not load partner profiles\.This is not a sign that there are none\./);
    assert.ok(!v.has('pp-queue-empty'), 'a failed list read as nothing waiting');
    assert.match(v.of('pp-tile-waiting'), /Waiting\s*4/, 'one failed block blanked the page');
    await v.click('Details ▾');
    assert.match(v.of('pp-list-failed-ref'), /HTTP 503/);
    fail = false;
    await v.click('Try again');
    assert.equal(v.all('pp-queue-row').length, 4);
  } finally { await v.unmount(); s.restore(); }
  s = stub({ counts: () => json({ detail: 'down' }, 500) });
  v = await render('/admin/partner-profiles');
  try {
    for (const id of ['waiting', 'past72', 'verified30', 'out']) assert.match(v.of(`pp-tile-${id}`), /Could not be read/, id);
    assert.ok(!/\b0\b/.test(v.of('pp-tiles')), 'a failed count drawn as 0');
    assert.equal(v.all('pp-queue-row').length, 4, 'the queue still answers');
    assert.match(v.of('pp-tab-review'), /To review/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, All profiles: the chips with Drafts, the weekly chart with decisions not recorded, categories, every column, and a chip filter', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all');
  try {
    assert.match(v.of('pp-status-chips'), /All · 7.*Waiting · 4.*Verified · 1.*Rejected · 0.*Drafts · 1/s);
    assert.match(v.of('pp-other-status'), /1 with a status the page does not know/);
    assert.match(v.of('pp-weekly'), /Verified and Rejected are not recorded: Verification and rejection dates are recorded from Partner profiles part 2\./);
    assert.match(v.of('pp-weekly'), /7 captured so far/);
    assert.match(v.of('pp-categories'), /No category captured: 1/);
    assert.match(v.of('pp-all'), /Person.*Status.*Source.*Onboarding category.*Entity.*Agreement.*Reviewed.*Captured/s);
    const rows = v.all('pp-all-row');
    assert.equal(rows.length, 7);
    const finn = rows.find((r) => r.includes('Finn Mock'));
    assert.match(finn, /✓ Verified.*Spin-Out Lab participation agreement.*Not recorded.*28 Sep 2026/s, 'a decided profile\'s Reviewed says Not recorded, never a date');
    assert.match(rows.find((r) => r.includes('draft@example.com')), /✎ Draft.*None recorded/s);
    assert.match(v.of('pp-count'), /1–7 of 7/);
    await v.click('Drafts · 1');
    assert.equal(v.all('pp-all-row').length, 1);
    assert.match(v.of('pp-drafts-chip-note'), /A Draft has nothing to review yet/);
    assert.match(v.of('pp-status-chips'), /All · 7.*Waiting · 4/s, 'the chips count every profile, not the filtered list');
    assert.ok(s.seen.some((q) => q.includes('status=draft') && q.includes('sort=newest')));
    await v.click('Clear filters');
    assert.equal(v.all('pp-all-row').length, 7);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, All profiles: the queue\'s Drafts link opens on the Drafts chip; a weekly read that failed is not drawn as zeros', async () => {
  let s = stub();
  let v = await render('/admin/partner-profiles/all?status=draft');
  try {
    assert.equal(v.all('pp-all-row').length, 1);
  } finally { await v.unmount(); s.restore(); }
  s = stub({ counts: () => json({ ...COUNTS, weekly: { available: false, reason: 'The partner profiles could not be read.', verified_available: false, weeks: [] } }) });
  v = await render('/admin/partner-profiles/all');
  try {
    assert.match(v.of('pp-weekly'), /Could not be read.*The partner profiles could not be read\./s);
    assert.ok(!v.has('pp-weekly-toggle'), 'a chart of nothing offered as a table');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: a failed record read is said in the page, not in a browser pop-up', async () => {
  const s = stub({ record: () => json({ detail: 'no' }, 500) });
  const original = globalThis.alert;
  let alerted = false;
  globalThis.alert = () => { alerted = true; };
  const v = await render('/admin/partner-profiles');
  try {
    const review = v.all('pp-queue-row');
    assert.ok(review.length);
    await v.click('Review');
    assert.match(v.of('pp-record-failed'), /This profile could not be read\./);
    assert.equal(alerted, false);
  } finally { await v.unmount(); s.restore(); globalThis.alert = original; }
});

// ---------------------------------------------------------------- the source

test('the source: D990\'s reads only, the literal tab doors, the dark classes, the amber kept in dark, and no "persona" said', () => {
  const page = read('frontend/src/pages/admin/profiles/PartnerProfiles.jsx');
  assert.match(page, /partnerProfilesApi\.counts\(\)/);
  assert.match(page, /partnerProfilesApi\.list\(params\)/);
  assert.doesNotMatch(page, /adminListProfiles|useHeldGlance/, 'the old reads are back');
  assert.match(page, /<HeaderTab to="\/admin\/partner-profiles" /);
  assert.match(page, /<HeaderTab to="\/admin\/partner-profiles\/all" /);
  assert.match(page, /<Link to="\/admin\/partner-profiles\/all\?status=draft"/);
  // PRF12: the amber pills keep their fill in dark mode, so the class has no dark: override.
  assert.match(page, /const AMBER_FILL = 'border-\[#fcd34d\] bg-\[#fcd34d\] text-\[#92400e\]';/);
  assert.ok(!/\balert\(/.test(page));
  assert.ok(!/\bpersona\b/i.test(page.replace(/r\.persona|\.persona/g, '')), 'the page says "persona"');
  // The chart part draws a value not recorded as a dashed mark, never a zero bar.
  const charts = read('frontend/src/ui/Charts.jsx');
  assert.match(charts, /if \(r\.values\[j\] == null\) \{\s*return <line [^>]*strokeDasharray="2 2"/);
});
