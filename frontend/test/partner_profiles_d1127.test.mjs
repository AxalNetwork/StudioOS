/**
 * D1127 (#3007) — Partner profiles gaps on the page: the header's More menu
 * (Export this view, Approvals, the Exploring board), the row checkboxes and
 * each row's "⋯" (Open, Reopen for review, Export), the Columns picker, Rows
 * per page, an Explorer's binding agreement in the Account column, and part
 * 2's Reviewed column, changed dot, Reviewed by filter and Reviewed sort.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_profiles_d1127.test.mjs
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
  COLUMNS, NOT_RECORDED, REOPEN, REVIEWED_BEFORE, SORTS, bindingLine, canReopen, changedView, exportParams, listParams, reviewedView,
  reviewerOptions, shownColumns,
} from '../src/pages/admin/profiles/ppModel.js';
import PartnerProfiles from '../src/pages/admin/profiles/PartnerProfiles.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------------------------------------------------------------- fixtures, as D990 and D991 answer

const row = (o) => ({
  ref: 'pp_0000000001', email: 'x@example.com', created_at: '2026-10-20 10:00:00', user_id: null, invitation_id: null,
  full_name: null, organization: null, user_name: null, persona: 'Advisor', legal_entity_name: null, entity_type: null,
  founder_track: null, company_established: null, partnership_goal: null, agreement_type: null, admin_status: 'pending',
  status: 'pending', reviewed_at: null, reviewed_by: null, changed_after_review_at: null,
  sources: ['chat'], account: null, identity_check: null, envelope: null, ...o,
});
const EXPLORER = (binding) => ({ user_id: 7, name: null, role: 'exploring', exploring: true, suggested_role: 'founder', assigned_role: null, assigned_at: null, binding });
const ROWS = [
  row({ ref: 'pp_000000000a', email: 'ada@example.com', user_name: 'Ada Example', created_at: '2026-10-20 08:00:00', account: EXPLORER({ state: 'not_sent', sent_at: null, signed_at: null }) }),
  row({ ref: 'pp_000000000b', email: 'chloe@example.com', user_name: 'Chloé Placeholder', created_at: '2026-10-21 08:00:00', account: EXPLORER({ state: 'sent', sent_at: '2026-10-02 09:00:00', signed_at: null }) }),
  row({ ref: 'pp_000000000c', email: 'val@example.com', user_name: 'Val Verified', status: 'verified', admin_status: 'verified', created_at: '2026-09-30 08:00:00',
    reviewed_at: '2026-10-03 12:00:00', reviewed_by: { user_id: 900, name: 'Ada Admin' }, changed_after_review_at: '2026-10-14 09:00:00',
    account: { user_id: 8, name: 'Val Verified', role: 'investor', exploring: false, suggested_role: null, assigned_role: null, assigned_at: null, binding: null } }),
  row({ ref: 'pp_000000000d', email: 'old@example.com', user_name: 'Olga Older', status: 'rejected', admin_status: 'rejected', created_at: '2026-08-10 08:00:00' }),
];
const TOTALS = (rows) => ({ total: rows.length, draft: 0, pending: rows.filter((r) => r.status === 'pending').length, verified: rows.filter((r) => r.status === 'verified').length, rejected: rows.filter((r) => r.status === 'rejected').length, not_recorded: 0 });
const OPTIONS = { category: ['Advisor'], founder_track: [], entity_type: [], agreement: [], reviewed_by: [{ id: 900, name: 'Ada Admin' }] };
const COUNTS = {
  as_of: '2026-10-24T12:00:00Z',
  waiting: { available: true, reason: null, count: 2, over_24h: 2, over_72h: 2, oldest_at: '2026-10-20 08:00:00', drafts: 0 },
  verified_30d: { available: false, reason: 'Not recorded before 24 Oct 2026.', count: null },
  envelopes_out: { available: true, reason: null, count: 0, not_delivered: 0 },
  weekly: { available: true, reason: null, verified_available: false, verified_reason: 'Not recorded before 24 Oct 2026.', weeks: [{ week_start: '2026-10-19', captured: 2, verified: null, rejected: null }] },
};

// ---------------------------------------------------------------- the model

test('part 2\'s fields in the page\'s words: "3 Oct by Ada Admin", Not recorded before review dates began, and the changed dot', () => {
  assert.deepEqual(reviewedView(ROWS[2]), { text: '3 Oct by Ada Admin', tip: 'Verified on 3 Oct 2026 by Ada Admin.', recorded: true });
  assert.deepEqual(reviewedView(ROWS[3]), { text: NOT_RECORDED, tip: REVIEWED_BEFORE, recorded: false }, 'a verdict before D991 has no date, never a guess');
  assert.equal(reviewedView(ROWS[0]).text, '—', 'no verdict, nothing reviewed');
  assert.equal(reviewedView({ ...ROWS[2], reviewed_by: null }).text, '3 Oct', 'a day with no reviewer recorded names nobody');
  assert.deepEqual(changedView(ROWS[2]), { text: '● Changed after verified', tip: 'Changed after it was verified: its answers were written again on 14 Oct 2026.' });
  assert.equal(changedView({ ...ROWS[2], status: 'rejected' }).text, '● Changed after rejected');
  assert.equal(changedView({ ...ROWS[0], changed_after_review_at: '2026-10-14 09:00:00' }), null, 'a profile with no verdict has nothing to flag');
  assert.equal(changedView({ ...ROWS[2], changed_after_review_at: null }), null);
  assert.equal(canReopen(ROWS[2]), true);
  assert.equal(canReopen(ROWS[3]), true);
  assert.equal(canReopen(ROWS[0]), false, 'a waiting profile is already in the queue');
  assert.equal(canReopen({ ...ROWS[2], ref: null }), false, 'Reopen needs the reference');
});

test('an Explorer\'s binding agreement in PRF1\'s words; any other account shows none', () => {
  assert.equal(bindingLine(ROWS[0].account), 'binding agreement not sent');
  assert.equal(bindingLine(ROWS[1].account), 'binding agreement sent 2 Oct');
  assert.equal(bindingLine(EXPLORER({ state: 'signed', sent_at: '2026-10-01 09:00:00', signed_at: '2026-10-04 10:00:00' })), 'binding agreement signed 4 Oct');
  assert.equal(bindingLine(EXPLORER({ state: 'sent', sent_at: null, signed_at: null })), 'binding agreement sent', 'no day stored, no day drawn');
  assert.equal(bindingLine(ROWS[2].account), null);
  assert.equal(bindingLine({ ...EXPLORER({ state: 'sent', sent_at: '2026-10-02 09:00:00' }), exploring: false }), null);
  assert.equal(bindingLine(null), null);
});

test('the Reviewed by choices, the Reviewed sort, Rows per page, the export\'s parameters and the columns', () => {
  assert.deepEqual(reviewerOptions(OPTIONS.reviewed_by), [{ key: '900', label: 'Ada Admin' }, { key: 'not_recorded', label: NOT_RECORDED }]);
  assert.deepEqual(reviewerOptions([{ id: 5, name: null }]).map((o) => o.label), ['Account 5', NOT_RECORDED]);
  assert.deepEqual(reviewerOptions(undefined), [{ key: 'not_recorded', label: NOT_RECORDED }]);
  assert.ok(SORTS.all.some((o) => o.key === 'reviewed'), 'All profiles sorts by Reviewed');
  assert.ok(!SORTS.review.some((o) => o.key === 'reviewed'), 'the queue holds no verdicts to sort by');
  assert.equal(listParams('all', { page_size: 50 }).page_size, 50);
  assert.equal(listParams('all', { page_size: 100 }).page_size, 100);
  assert.equal(listParams('all', { page_size: 7 }).page_size, 25, 'only 25, 50 or 100');
  assert.equal(listParams('all', { reviewed_by: '900' }).reviewed_by, '900');
  assert.equal(listParams('review', { reviewed_by: '900' }).reviewed_by, undefined, 'the queue has no Reviewed by filter');
  const ex = exportParams('all', { status: 'verified', page: 3, page_size: 50, reviewed_by: '900', sort: 'reviewed' });
  assert.equal(ex.page, undefined, 'an export is every page');
  assert.equal(ex.page_size, undefined);
  assert.deepEqual([ex.status, ex.reviewed_by, ex.sort], ['verified', '900', 'reviewed']);
  assert.equal(exportParams('review', {}).status, 'pending', 'the queue\'s export is the waiting profiles');
  assert.deepEqual(shownColumns([]), COLUMNS.map((c) => c.key));
  assert.deepEqual(shownColumns(['reviewed', 'nonsense']), ['source', 'category', 'entity', 'agreement', 'captured']);
  assert.ok(!COLUMNS.some((c) => c.key === 'person' || c.key === 'status'), 'Person and Status cannot be hidden');
});

// ---------------------------------------------------------------- mounted

async function render(url) {
  const restore = installDocument();
  // The CSV download clicks a link it makes; the test DOM's nodes have neither click nor remove.
  const make = document.createElement.bind(document);
  const clicked = [];
  document.createElement = (tag) => { const n = make(tag); if (tag === 'a') { n.click = () => clicked.push(n.download); n.remove = () => {}; } return n; };
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
  const allById = (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id);
  const fire = async (n, handler, arg) => { await act(async () => { await props(n)[handler](arg); }); await settle(); };
  return {
    clicked,
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    all: (id) => allById(id).map(textOf),
    count: (id) => allById(id).length,
    props: (id) => props(byTestId(id)),
    async press(id, i = 0) { const n = allById(id)[i]; assert.ok(n, `no ${id}[${i}]`); await fire(n, 'onClick', { preventDefault() {}, stopPropagation() {} }); },
    async check(id, checked, i = 0) { const n = allById(id)[i]; assert.ok(n, `no ${id}[${i}]`); await fire(n, 'onChange', { target: { checked } }); },
    async pick(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await fire(n, 'onChange', { target: { value } }); },
    async type(id, value) { const n = byTestId(id); assert.ok(n, `no ${id}`); await fire(n, 'onChange', { target: { value } }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function serveList(u, rows) {
  const p = u.searchParams;
  let out = rows;
  if (p.get('status')) out = out.filter((r) => r.status === p.get('status'));
  if (p.get('reviewed_by')) out = out.filter((r) => String(r.reviewed_by?.user_id) === p.get('reviewed_by'));
  const size = Number(p.get('page_size') || 25);
  const page = Number(p.get('page') || 1);
  return { rows: out.slice((page - 1) * size, page * size), totals: TOTALS(out), page, page_size: size, sort: p.get('sort') || 'waiting', options: OPTIONS };
}

function stub({ exportAnswer = () => new Response('Reference\r\npp_000000000a', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="partner-profiles-2026-10-25.csv"', 'X-Export-Rows': '1' } }), reopen = () => json({ ok: true }) } = {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    seen.push({ path: `${u.pathname}${u.search}`, method: init.method || 'GET', body: init.body || null });
    if (u.pathname === '/api/admin/partner-profiles') return json(serveList(u, ROWS));
    if (u.pathname === '/api/admin/partner-profiles/counts') return json(COUNTS);
    if (u.pathname === '/api/admin/partner-profiles/export') return exportAnswer(u);
    if (/^\/api\/admin\/partner-profiles\/pp_\w+\/reopen$/.test(u.pathname)) return reopen(u);
    if (u.pathname.startsWith('/api/profiling/admin/')) return json({ email: 'val@example.com', user_name: 'Val Verified', chat_history: '[]' });
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('mounted, To review: an Explorer\'s binding agreement under the Account column', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles');
  try {
    const rows = v.all('pp-queue-row');
    assert.match(rows.find((r) => r.includes('Ada Example')), /Explorer.*Suggested: Founder.*binding agreement not sent/s);
    assert.match(rows.find((r) => r.includes('Chloé')), /Explorer.*binding agreement sent 2 Oct/s);
    assert.deepEqual(v.all('pp-binding'), ['binding agreement not sent', 'binding agreement sent 2 Oct']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted, All profiles: Reviewed says who and when, Not recorded before it was kept, and the changed dot; the Reviewed by filter is asked of the Worker', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all');
  try {
    const rows = v.all('pp-all-row');
    assert.match(rows.find((r) => r.includes('Val Verified')), /✓ Verified● Changed after verified.*3 Oct by Ada Admin/s);
    assert.match(rows.find((r) => r.includes('Olga Older')), /Rejected.*Not recorded/s);
    assert.deepEqual(v.all('pp-changed'), ['● Changed after verified']);
    assert.equal(v.props('pp-filter-reviewed').disabled, false, 'Reviewed by is no longer waiting for part 2');
    assert.ok(!/part 2/.test(v.text()), 'no sentence says part 2 is still to come');
    await v.pick('pp-filter-reviewed', '900');
    assert.ok(s.seen.some((q) => q.path.startsWith('/api/admin/partner-profiles?') && q.path.includes('reviewed_by=900')), 'the filter goes to the Worker');
    assert.deepEqual(v.all('pp-all-row').map((r) => /Val Verified/.test(r)), [true]);
    await v.pick('pp-sort', 'reviewed');
    assert.ok(s.seen.some((q) => q.path.includes('sort=reviewed')));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: Rows per page asks the Worker for that many and starts again at page 1', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all');
  try {
    assert.equal(v.props('pp-count-size').value, 25);
    await v.pick('pp-count-size', '50');
    assert.ok(s.seen.some((q) => q.path.startsWith('/api/admin/partner-profiles?') && q.path.includes('page_size=50')));
    assert.equal(v.props('pp-count-size').value, 50);
  } finally { await v.unmount(); s.restore(); }
  const q = stub();
  const w = await render('/admin/partner-profiles');
  try {
    await w.pick('pp-queue-count-size', '100');
    assert.ok(q.seen.some((x) => x.path.includes('status=pending') && x.path.includes('page_size=100')), 'the queue has Rows per page too');
  } finally { await w.unmount(); q.restore(); }
});

test('mounted: the Columns picker hides a column and Person and Status stay', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all');
  try {
    await v.press('pp-columns');
    assert.match(v.of('pp-columns-menu'), /Source.*Onboarding category.*Entity.*Agreement.*Reviewed.*Captured.*Person and Status always show/s);
    await v.check('pp-col-reviewed', false);
    await v.check('pp-col-captured', false);
    assert.ok(!/3 Oct by Ada Admin/.test(v.of('pp-all')), 'the Reviewed column is gone');
    assert.ok(!/30 Sep 2026/.test(v.of('pp-all')), 'the Captured column is gone');
    assert.match(v.all('pp-all-row').find((r) => r.includes('Val Verified')), /Val Verified.*✓ Verified/s, 'Person and Status remain');
    assert.equal(localStorage.getItem('partner-profiles.hidden-columns'), '["reviewed","captured"]', 'kept for this viewer');
    await v.check('pp-col-reviewed', true);
    assert.match(v.of('pp-all'), /3 Oct by Ada Admin/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: Export this view sends the tab\'s filters to the export, and says what it downloaded', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all?status=verified');
  try {
    await v.press('admin-page-more');
    assert.match(v.of('admin-page-more-menu'), /Export this view.*Open Approvals.*Open the Exploring board/s);
    assert.equal(v.props('pp-more-approvals').href, '/admin/approvals');
    assert.equal(v.props('pp-more-exploring').href, '/admin/exploring');
    await v.press('pp-more-export');
    const ex = s.seen.find((q) => q.path.startsWith('/api/admin/partner-profiles/export'));
    assert.ok(ex, s.seen.map((q) => q.path).join('\n'));
    assert.ok(ex.path.includes('status=verified') && ex.path.includes('sort=newest'), ex.path);
    assert.ok(!/[?&]page=|page_size=/.test(ex.path), 'an export is every page of the view');
    assert.deepEqual(v.clicked, ['partner-profiles-2026-10-25.csv']);
    assert.equal(v.of('pp-note'), 'Exported 1 profile. The export is recorded under your name.Dismiss');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: the chosen rows export by reference; a refused export is said in the Worker\'s words', async () => {
  const s = stub({ exportAnswer: (u) => (u.searchParams.get('refs')?.split(',').length > 1
    ? new Response('x', { status: 200, headers: { 'X-Export-Rows': '2', 'Content-Disposition': 'attachment; filename="p.csv"' } })
    : json({ error: 'export_too_large', message: 'This view holds 5,001 profiles; an export holds at most 5,000. Narrow it with a filter.' }, 413)) });
  const v = await render('/admin/partner-profiles/all');
  try {
    assert.equal(v.count('pp-check'), 4);
    assert.ok(!v.has('pp-chosen'));
    await v.check('pp-check', true, 0);
    await v.check('pp-check', true, 2);
    assert.match(v.of('pp-chosen'), /2 selected/);
    await v.press('pp-export-chosen');
    const ex = s.seen.find((q) => q.path.startsWith('/api/admin/partner-profiles/export'));
    assert.deepEqual(new URL(ex.path, 'http://x').searchParams.get('refs').split(',').sort(), ['pp_000000000a', 'pp_000000000c']);
    assert.match(v.of('pp-note'), /Exported 2 profiles/);
    await v.check('pp-check-all', true);
    assert.match(v.of('pp-chosen'), /4 selected/, 'the header box chooses every row on the page');
    await v.check('pp-check-all', false);
    assert.ok(!v.has('pp-chosen'));
    // The chosen rows are the page's: a new read of the list clears them, so no hidden row rides along.
    await v.check('pp-check', true, 1);
    assert.match(v.of('pp-chosen'), /1 selected/);
    await v.pick('pp-count-size', '50');
    assert.ok(!v.has('pp-chosen'), 'a re-read list keeps an old choice');
    // One row's own Export, refused: said in place, nothing downloaded.
    await v.press('pp-row-more', 0);
    await v.press('pp-row-export');
    assert.match(v.of('pp-note'), /This view holds 5,001 profiles; an export holds at most 5,000\. Narrow it with a filter\./);
    assert.equal(v.clicked.length, 1, 'only the first export downloaded');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: a row\'s "⋯" holds Open, Reopen for review on a verdict only, and Export; Reopen asks first, then puts it back', async () => {
  const s = stub();
  const v = await render('/admin/partner-profiles/all');
  try {
    const rowsNow = v.all('pp-all-row');
    const at = (name) => rowsNow.findIndex((r) => r.includes(name));
    await v.press('pp-row-more', at('Ada Example'));
    assert.match(v.of('pp-row-menu'), /^OpenExport$/, 'a waiting profile has nothing to reopen');
    await v.press('pp-row-more', at('Ada Example'));
    await v.press('pp-row-more', at('Val Verified'));
    assert.match(v.of('pp-row-menu'), /^OpenReopen for reviewExport$/);
    await v.press('pp-row-reopen');
    assert.match(v.of('pp-reopen-dialog'), new RegExp(`${REOPEN.title('Val Verified')}.*${REOPEN.sub}.*Reason · optional.*${REOPEN.foot}`, 's'));
    assert.ok(!s.seen.some((q) => q.method === 'POST'), 'nothing is written before Reopen is pressed');
    await v.type('pp-reopen-reason', 'Asked to redo the chat.');
    await v.press('pp-reopen-go');
    const post = s.seen.find((q) => q.method === 'POST');
    assert.equal(post.path, '/api/admin/partner-profiles/pp_000000000c/reopen');
    assert.deepEqual(JSON.parse(post.body), { reason: 'Asked to redo the chat.' });
    assert.ok(!v.has('pp-reopen-dialog'));
    assert.match(v.of('pp-note'), /Back in the queue\./);
    // Open is the record read, as the old button was.
    await v.press('pp-row-more', at('Val Verified'));
    await v.press('pp-row-open');
    assert.ok(s.seen.some((q) => q.path.startsWith('/api/profiling/admin/')));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted: a refused Reopen is said in the dialog, which stays open', async () => {
  const s = stub({ reopen: () => json({ error: 'not_reviewed', message: 'This profile has no verdict to reopen.' }, 409) });
  const v = await render('/admin/partner-profiles/all');
  try {
    const rowsNow = v.all('pp-all-row');
    const at = (name) => rowsNow.findIndex((r) => r.includes(name));
    await v.press('pp-row-more', at('Olga Older'));
    await v.press('pp-row-reopen');
    await v.press('pp-reopen-go');
    assert.equal(v.of('pp-reopen-refusal'), 'This profile has no verdict to reopen.');
    assert.ok(v.has('pp-reopen-dialog'));
    assert.equal(JSON.parse(s.seen.find((q) => q.method === 'POST').body).reason, null, 'an empty reason is sent as none');
  } finally { await v.unmount(); s.restore(); }
});

test('the source: the export and Reopen go through the client, the doors are literal, and nothing waits for part 2', () => {
  const page = read('frontend/src/pages/admin/profiles/PartnerProfiles.jsx');
  const client = read('frontend/src/lib/api/partnerProfiles.js');
  assert.match(client, /exportCsv: \(params = \{\}\) =>/);
  assert.match(client, /api\._downloadCsv\(`\$\{BASE\}\/export/);
  assert.match(page, /<HeaderMenuItem to="\/admin\/approvals"/);
  assert.match(page, /<HeaderMenuItem to="\/admin\/exploring"/);
  assert.ok(!/REVIEWED_WAITS|CHANGED_WAITS/.test(page));
  assert.ok(!/\balert\(|window\.confirm|confirm\(/.test(page), 'no browser pop-up');
  assert.match(read('cloudflare-worker/src/routes/admin_partner_profiles.ts'), /r\.get\('\/export'[\s\S]*r\.get\('\/:ref'/, 'the export is mounted before the by-reference read');
});
