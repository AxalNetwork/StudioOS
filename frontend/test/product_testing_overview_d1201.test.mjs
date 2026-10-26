// D1201 (#3151) — HQ › Platform › Product testing, Overview complete (TST1,
// TST11): the weekly, by-profile and Mail reach blocks from D1196's read with
// "View as table"; Needs you from the programme list; the tab counts; the
// rail's line. Every block's four states (reading, figures, empty, unreadable
// with Try again); no zero for a week nobody recorded; never an email address.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_overview_d1201.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ProductTestingHqPage } from '../src/pages/admin/ConsolePages.jsx';
import {
  RAIL, blockState, needsYou, profileBars, reachRows, tabCounts, weeklySeries, weeklySummary,
} from '../src/pages/admin/productTesting/productTestingModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };
const NOW = Date.parse('2026-10-26T09:00:00Z');

const prog = (uid, status, extra = {}) => ({
  uid, status, owner_kind: 'partner', owner_name: 'Partner Firm A', product_name: `Product ${uid}`, places: 10, picked_count: 0, applicant_count: 0,
  eligible_roles: ['founder'], questions: [], updated_at: '2026-10-20 09:00:00', ...extra,
});
const PROGRAMMES = [
  prog('alpha', 'open', { owner_kind: 'hq', owner_name: 'Axal VC', places: 20, picked_count: 12, applicant_count: 26, testing_starts: '2026-10-16' }),
  prog('beta', 'open', { places: 10, picked_count: 5, applicant_count: 14, testing_starts: '2026-11-12' }),
  prog('gamma', 'open', { places: 10, picked_count: 0, applicant_count: 8, testing_starts: '2026-11-17' }),
  prog('delta', 'submitted', { owner_name: 'Partner Firm C', updated_at: '2026-10-24 08:00:00' }),
  prog('epsilon', 'submitted', { updated_at: '2026-10-25 08:00:00' }),
  prog('eta', 'approved', { owner_name: 'Partner Firm B', updated_at: '2026-10-23 08:00:00' }),
  prog('theta', 'testing', { testing_ends: '2026-10-20' }),
  prog('omega', 'closed', { places: 5, picked_count: 5, applicant_count: 9 }),
];
const TESTERS = {
  rows: [], page: 1, page_size: 25, matching: 0, totals: { applied: 6, active: 57, paused: 4, declined: 9, removed: 3, total: 79 },
};
const week = (start, o = {}) => ({ week_start: start, recorded: true, applications: 0, picks: 0, ...o });
const WEEKS = [
  week('2026-08-03', { recorded: false, applications: null, picks: null }), week('2026-08-10', { recorded: false, applications: null, picks: null }),
  week('2026-08-17', { applications: 9, picks: 0 }), week('2026-08-24', { applications: 14, picks: 3 }), week('2026-08-31', { applications: 18, picks: 6 }),
  week('2026-09-07', { applications: 16, picks: 8 }), week('2026-09-14', { applications: 12, picks: 7 }), week('2026-09-21', { applications: 15, picks: 9 }),
  week('2026-09-28', { applications: 11, picks: 6 }), week('2026-10-05', { applications: 17, picks: 8 }), week('2026-10-12', { applications: 16, picks: 8 }),
  week('2026-10-19', { applications: 11, picks: 5, to_date: true }),
];
const by = (o) => ({ founder: 0, investor: 0, advisor: 0, partner: 0, exploring: 0, other: 0, ...o });
const OVERVIEW = {
  as_of: '2026-10-26T09:00:00Z', open_means: 'A program whose status is open or testing.',
  weekly: { available: true, weeks: WEEKS, first_opened: '2026-08-18', counted_by: '…' },
  by_profile: {
    available: true,
    pool: { available: true, total: 57, by_profile: by({ founder: 21, investor: 12, advisor: 9, partner: 8, exploring: 7 }) },
    applicants: { available: true, total: 48, by_profile: by({ founder: 17, investor: 11, advisor: 8, partner: 7, exploring: 5 }) },
  },
  withdrawn: { available: true, total: 0, programmes: [] },
  mail_reach: { available: true, programmes: [
    { uid: 'alpha', product_name: 'Product alpha', status: 'open', picked: 12, consented: 11, emails_on: 10, reachable: 10 },
    { uid: 'beta', product_name: 'Product beta', status: 'open', picked: 5, consented: 5, emails_on: 4, reachable: 4 },
  ] },
};

async function mounted(url, { programmes = { items: PROGRAMMES }, testers = TESTERS, overview = OVERVIEW, hold = [] } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  let overviewNow = overview;
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    requests.push(path);
    const key = path.startsWith('/admin/testing/overview') ? 'overview' : path.startsWith('/admin/product-testers') ? 'testers' : path.startsWith('/admin/testing/programmes') ? 'programmes' : null;
    if (key && hold.includes(key)) return new Promise(() => {});
    if (key === 'overview') return overviewNow ? response(overviewNow) : response({ error: 'down' }, 503);
    if (key === 'programmes') return programmes ? response(programmes) : response({ error: 'down' }, 503);
    if (key === 'testers') return testers ? response(testers) : response({ error: 'down' }, 503);
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(SUPER));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(ProductTestingHqPage)))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const find = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    requests, by: find, settle,
    setOverview(o) { overviewNow = o; },
    text: (id) => txt(id ? find(id) : container).replace(/\s+/g, ' ').trim(),
    attr: (id, k) => pr(find(id))[k],
    async click(id) { await act(async () => pr(find(id)).onClick?.({ preventDefault() {} })); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the weekly series: an unrecorded week stays null, never 0; a measured quiet week is 0; the current week is to date', () => {
  // Mutation checked: `recorded ? num(..) : null` → `num(..)` makes the unrecorded weeks 0; dropping `toDate` loses the hollow point.
  const s = weeklySeries(OVERVIEW.weekly);
  assert.equal(s.rows.length, 12);
  assert.deepEqual(s.rows.slice(0, 2).map((r) => [r.recorded, r.applications, r.picks]), [[false, null, null], [false, null, null]]);
  assert.equal(s.rows[2].picks, 0, 'a measured quiet week is a 0');
  assert.equal(s.unrecorded, 2);
  assert.equal(s.max, 18);
  assert.equal(s.rows[11].toDate, true);
  assert.equal(s.rows.filter((r) => r.toDate).length, 1);
  assert.equal(s.rows[0].label, '3 Aug');
  assert.equal(s.firstOpened, '18 Aug 2026');
  assert.equal(weeklySummary(s), 'Applications and picks per week over 12 weeks. No program was open before 18 Aug 2026, so the first 2 weeks are not recorded. Applications ran between 9 and 18 a week and picks between 0 and 9. The current week is not finished.');
  const none = weeklySeries({ available: true, weeks: WEEKS.map((w) => ({ ...w, recorded: false, applications: 3, picks: 1 })), first_opened: null });
  assert.equal(none.anyRecorded, false);
  assert.ok(none.rows.every((r) => r.applications === null && r.picks === null), 'figures on an unrecorded week are never drawn');
  assert.match(weeklySummary(none), /not recorded, because no program has opened yet/);
});

test('a block answers alone: unavailable or missing is unreadable with its reason, never figures', () => {
  assert.deepEqual(blockState({ available: true }), { state: 'ready', reason: null });
  assert.deepEqual(blockState({ available: false, unreadable: true, reason: 'Mail reach could not be read on this database. That is not the same as none.' }),
    { state: 'unreadable', reason: 'Mail reach could not be read on this database. That is not the same as none.' });
  assert.equal(blockState(undefined).state, 'unreadable');
});

test('by profile: the canvas order, Other only when someone is in it, and an unreadable pool leaves its bars out', () => {
  // Mutation checked: `other` always listed → six rows; the pool's figures kept when it is unreadable → its bars drawn.
  const b = profileBars(OVERVIEW.by_profile);
  assert.deepEqual(b.rows.map((r) => [r.label, r.pool, r.applicants]), [
    ['Founders', 21, 17], ['Investors', 12, 11], ['Advisors', 9, 8], ['Operating Partners', 8, 7], ['Explorers', 7, 5],
  ]);
  assert.equal(b.max, 21);
  const withAdmin = profileBars({ ...OVERVIEW.by_profile, pool: { ...OVERVIEW.by_profile.pool, by_profile: by({ founder: 1, other: 1 }) } });
  assert.equal(withAdmin.rows.at(-1).label, 'Other profiles');
  // An unreadable block's figures, even if some were sent, are never drawn.
  const noPool = profileBars({ ...OVERVIEW.by_profile, pool: { available: false, unreadable: true, reason: 'The tester pool could not be read on this database. That is not the same as none.', by_profile: by({ founder: 99 }) } });
  assert.equal(noPool.pool.state, 'unreadable');
  assert.ok(noPool.rows.every((r) => r.pool === null && r.applicants != null));
  assert.equal(noPool.poolTotal, null);
});

test('Mail reach: the four steps per open program, counts only', () => {
  const rows = reachRows(OVERVIEW.mail_reach);
  assert.deepEqual(rows.map((r) => [r.name, ...r.steps.map((s) => s.n)]), [['Product alpha', 12, 11, 10, 10], ['Product beta', 5, 5, 4, 4]]);
  assert.deepEqual(rows[0].steps.map((s) => s.label), ['Picked', 'Agreed to email', 'Program emails on', 'Reachable']);
  assert.ok(!JSON.stringify(rows).includes('@'));
});

test('Needs you: waiting for review, approved not open, testing dates passed both ways, applicants none picked; nothing from a missing date', () => {
  // Mutation checked: HQ's own submitted listed → an extra review row; `t > today` → `t >= today` drops a start that is today;
  // the unpicked rule without `picked_count > 0` → alpha and beta listed; the ended rule on `testing_starts` → theta missed.
  const rows = needsYou(PROGRAMMES, NOW);
  assert.deepEqual(rows.map((r) => r.text), [
    'Product delta · Partner Firm C · waiting for review 2 days',
    'Product epsilon · Partner Firm A · waiting for review 1 day',
    'Product eta · approved 3 days ago, not open',
    'Product alpha · testing started 16 Oct 2026, still Open',
    'Product theta · testing ended 20 Oct 2026, still Testing',
    'Product gamma · 8 applicants, none picked yet',
  ]);
  assert.deepEqual(rows.map((r) => r.action.to), [
    '/admin/platform/product-testing/review', '/admin/platform/product-testing/review', '/admin/platform/product-testing/programs',
    '/admin/platform/product-testing/programs', '/admin/platform/product-testing/programs', '/admin/platform/product-testing/programs/gamma?tab=applicants',
  ]);
  assert.deepEqual(needsYou([prog('q', 'submitted', { owner_kind: 'hq' })], NOW), [], 'HQ\'s own never waits for HQ');
  assert.equal(needsYou([prog('s', 'open', { testing_starts: '2026-10-26' })], NOW).length, 1, 'testing that starts today has started');
  assert.equal(needsYou([prog('e', 'testing', { testing_ends: '2026-10-26' })], NOW).length, 0, 'testing that ends today has not ended');
  assert.deepEqual(needsYou([prog('n', 'open', { testing_starts: null }), prog('m', 'testing', { testing_ends: 'not a date' })], NOW), [], 'a missing date never makes a row');
  assert.match(needsYou([prog('u', 'submitted', { updated_at: null })], NOW)[0].text, /when it was sent is not recorded/);
});

test('tab counts: Review the amber dot with how many wait, the rest numbers; reading draws a bar and a failed read a dash, never 0', () => {
  // Mutation checked: the failed programmes read → `num 0` instead of a dash; Review as a plain number when some wait.
  const ready = (data) => ({ status: 'ready', data });
  const c = tabCounts(ready({ items: PROGRAMMES }), ready(TESTERS));
  assert.deepEqual(c.review, { kind: 'flag', value: 2, testId: 'testing-tab-review-count' });
  assert.deepEqual([c.programs, c.applicants, c.testers], [{ kind: 'num', value: 8 }, { kind: 'num', value: 48 }, { kind: 'num', value: 57 }]);
  assert.deepEqual(tabCounts(ready({ items: [] }), ready(TESTERS)).review, { kind: 'num', value: 0 }, 'nothing waiting is a measured 0');
  const loading = tabCounts({ status: 'loading' }, { status: 'loading' });
  assert.ok(Object.values(loading).every((x) => x.kind === 'load'));
  const failed = tabCounts({ status: 'unreadable' }, { status: 'unreadable' });
  assert.ok(Object.values(failed).every((x) => x.kind === 'dash' && x.tip), 'a failed read is a dash with why');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('Overview draws the three blocks from the read, Needs you, the rail line and the tab counts; no email, no wait left', async () => {
  const v = await mounted('/admin/platform/product-testing');
  try {
    assert.ok(v.requests.includes('/admin/testing/overview'));
    assert.equal(v.requests.filter((u) => u === '/admin/testing/programmes').length, 1, 'the tiles and the tab counts share one read');
    assert.ok(v.by('testing-weekly-chart'));
    assert.match(v.attr('testing-weekly-chart', 'aria-label'), /first 2 weeks are not recorded/);
    assert.ok(v.by('testing-weekly-unrecorded'), 'the dashed Not recorded hairline');
    assert.ok(v.by('testing-weekly-applications-to-date') && v.by('testing-weekly-picks-to-date'), 'the current week is hollow');
    assert.ok(v.text('testing-weekly').includes('to date'));
    assert.ok(v.by('testing-profiles-pool-founder') && v.by('testing-profiles-applicants-founder'));
    assert.equal(v.text('testing-reach-alpha-reachable'), '10');
    assert.match(v.text('testing-need-review-delta'), /^Product delta · Partner Firm C · waiting for review \d+ days? Review$/);
    assert.ok(v.by('testing-need-unpicked-gamma'));
    assert.ok(v.text('testing-rail-line').includes(RAIL.line));
    assert.ok(v.text('testing-rail-line').includes('never sees an email address'));
    assert.equal(v.text('testing-tab-review-count'), '2');
    assert.ok(v.text('testing-tab-programs').endsWith('8'));
    assert.ok(v.text('testing-tab-applicants').endsWith('48'));
    assert.ok(v.text('testing-tab-testers').endsWith('57'));
    for (const id of ['weekly', 'profiles', 'mail', 'needs']) assert.equal(v.by(`testing-wait-${id}`), undefined, id);
    assert.ok(!/@example\.com/.test(v.text()), 'no email is drawn');
  } finally { await v.close(); }
});

test('View as table: each block\'s table holds the chart\'s figures, an unrecorded week says so, never 0', async () => {
  // Mutation checked: the weekly table printing `r.applications` for an unrecorded week → "0"/blank instead of Not recorded.
  const v = await mounted('/admin/platform/product-testing');
  try {
    await v.click('testing-weekly-toggle-table');
    assert.ok(v.by('testing-weekly-table') && !v.by('testing-weekly-chart'));
    const t = v.text('testing-weekly-table');
    assert.ok(t.startsWith('Week of Applications Picks 3 Aug Not recorded Not recorded 10 Aug Not recorded Not recorded 17 Aug 9 0'), t);
    assert.ok(t.includes('19 Oct · to date 11 5'));
    assert.equal(v.attr('testing-weekly-toggle-table', 'aria-checked'), true);
    await v.click('testing-profiles-toggle-table');
    assert.ok(v.text('testing-profiles-table').includes('Founders 21 17'));
    await v.click('testing-reach-toggle-table');
    assert.ok(v.text('testing-reach-table').includes('Product alpha 12 11 10 10'));
    await v.click('testing-weekly-toggle-chart');
    assert.ok(v.by('testing-weekly-chart'));
  } finally { await v.close(); }
});

test('reading: each block says so, and the tabs draw their loading bars, before any figure', async () => {
  const v = await mounted('/admin/platform/product-testing', { hold: ['overview', 'testers'] });
  try {
    for (const id of ['testing-weekly', 'testing-profiles', 'testing-reach']) assert.ok(v.by(`${id}-loading`), id);
    assert.equal(v.attr('testing-tab-testers', 'children')[1]?.props?.count?.kind, 'load');
  } finally { await v.close(); }
});

test('empty: no program ever opened reads Not recorded, an empty pool and no open program say so, nothing needs you', async () => {
  const empty = {
    ...OVERVIEW,
    weekly: { available: true, weeks: WEEKS.map((w) => ({ week_start: w.week_start, recorded: false, applications: null, picks: null, ...(w.to_date ? { to_date: true } : {}) })), first_opened: null },
    by_profile: { available: true, pool: { available: true, total: 0, by_profile: by({}) }, applicants: { available: true, total: 0, by_profile: by({}) } },
    mail_reach: { available: true, programmes: [] },
  };
  const v = await mounted('/admin/platform/product-testing', { programmes: { items: [] }, overview: empty, testers: { ...TESTERS, totals: { applied: 0, active: 0, paused: 0, declined: 0, removed: 0, total: 0 } } });
  try {
    assert.ok(v.text('testing-weekly-not-recorded').startsWith('Not recorded: no program has opened yet'));
    assert.ok(!v.by('testing-weekly-chart') && !v.by('testing-weekly-toggle'), 'no chart of zeros, no toggle');
    assert.ok(v.by('testing-profiles-empty'));
    assert.ok(v.by('testing-reach-empty'));
    assert.ok(v.by('testing-needs-none'));
    assert.equal(v.text('testing-tab-review').endsWith('0'), true, 'nothing waiting is a measured 0');
  } finally { await v.close(); }
});

test('unreadable: a failed overview costs its three blocks, each with Try again, and Try again reads it again', async () => {
  // Mutation checked: Try again not wired to the read → no second request.
  const v = await mounted('/admin/platform/product-testing', { overview: null });
  try {
    for (const id of ['testing-weekly', 'testing-profiles', 'testing-reach']) assert.ok(v.text(`${id}-unreadable`).includes('This is not a claim that there are none'), id);
    assert.equal(v.text('testing-tile-open-value'), '3', 'the tiles still answer');
    assert.ok(v.by('testing-need-review-delta'), 'Needs you still answers');
    v.setOverview(OVERVIEW);
    await v.click('testing-weekly-retry');
    assert.equal(v.requests.filter((u) => u === '/admin/testing/overview').length, 2);
    assert.ok(v.by('testing-weekly-chart'));
  } finally { await v.close(); }
});

test('one block unreadable costs only that block; an unreadable pool leaves its bars out (TST14a)', async () => {
  const partial = {
    ...OVERVIEW,
    mail_reach: { available: false, unreadable: true, reason: 'Mail reach could not be read on this database. That is not the same as none.' },
    by_profile: { available: true, pool: { available: false, unreadable: true, reason: 'The tester pool could not be read on this database. That is not the same as none.' }, applicants: OVERVIEW.by_profile.applicants },
  };
  const v = await mounted('/admin/platform/product-testing', { overview: partial, testers: null });
  try {
    assert.ok(v.text('testing-reach-unreadable').includes('Mail reach could not be read on this database'));
    assert.ok(v.by('testing-weekly-chart'), 'the weekly block still answers');
    assert.ok(v.by('testing-profiles-pool-unreadable'));
    assert.ok(!v.by('testing-profiles-pool-founder') && v.by('testing-profiles-applicants-founder'));
    assert.ok(v.text('testing-profiles').includes('its bars are left out'));
    assert.equal(v.attr('testing-tab-testers', 'children')[1]?.props?.count?.kind, 'dash', 'a failed pool read is a dash, not 0');
  } finally { await v.close(); }
});

test('dark and phone: every new colour has its dark pair, and the phone keeps the tiles, weekly, places and Needs you (TST11, TST16a)', () => {
  const src = readFileSync('frontend/src/pages/admin/productTesting/ProductTestingTabs.jsx', 'utf8');
  const overview = src.slice(src.indexOf('export function useTestingReads'), src.indexOf('One program (TST5, TST6)'));
  for (const cls of overview.match(/\b(?:bg|stroke|fill|border|text)-(?:violet|sky|gray|red|white)-?\d*\b/g) || []) {
    if (/^(?:text|border)-gray-(?:300|400|500)$/.test(cls)) continue;
    const family = cls.split('-').slice(0, 2).join('-');
    assert.ok(new RegExp(`dark:${family.split('-')[0]}-`).test(overview), `${cls} has no dark pair`);
  }
  assert.match(overview, /stroke-violet-600 dark:stroke-violet-400/, 'violet becomes #a78bfa in the dark');
  assert.match(overview, /<div className="hidden gap-3\.5 sm:grid lg:grid-cols-2">\s*<ProfilesBlock/, 'by profile and Mail reach leave the phone');
  assert.ok(!/hidden[^"]*"[^>]*>\s*<NeedsBlock/.test(overview), 'Needs you stays on the phone');
});
