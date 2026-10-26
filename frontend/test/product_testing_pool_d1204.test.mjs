// D1204 (#3154) — Product testing part 9: the Tester pool complete (TST9),
// its states (TST12b empty, TST13 loading, TST14 failed and partial), the
// HQ-only card's own line and doors (TST15a), and the phone (TST16): one
// program's applicants as cards with a ⋯ bottom sheet, answers full screen,
// 44px targets. Never an email address.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_pool_d1204.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ProductTestingHqPage } from '../src/pages/admin/ConsolePages.jsx';
import { TestersTab, readPool } from '../src/pages/admin/productTesting/ProductTestingTabs.jsx';
import { hqLine, hqLinks } from '../src/pages/hq/hqNoticeModel.js';
import { adminProductTestersApi } from '../src/lib/api/productTesting.js';
import {
  POOL_FILTERS, WAITS, poolEmpty, poolMenu, poolProfileChart, poolView, rangeOf, testerRow,
} from '../src/pages/admin/productTesting/productTestingModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };

// The read's own shape (services/productTesters.ts present()); every value invented.
const t = (id, status, name, role, extra = {}) => ({
  id, user_id: id * 10, status, decided_at: `2026-09-${String(10 + (id % 18)).padStart(2, '0')} 10:00:00`, decided_by_name: 'Grace Admin',
  availability: 'Evenings', consent_email_at: '2026-09-01', consent_version: 'v2', programmes: { applied: id % 4, picked: id % 2 },
  member: { id: id * 10, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, role, email_verified: true }, ...extra,
});
const ROWS = [
  t(1, 'active', 'Ada Example', 'founder'),
  t(2, 'active', 'Ben Sample', 'investor', { availability: '  ' }),
  t(3, 'active', 'Cleo Mock', 'founder', { decided_at: '2026-10-01 09:00:00' }),
  t(4, 'paused', 'Dan Demo', 'advisor'),
  t(5, 'removed', 'Eve Place', 'partner'),
  t(6, 'active', 'Fay Holder', null),
];
const TOTALS = { applied: 2, active: 4, paused: 1, declined: 0, removed: 1, total: 8 };

/** A tester client that answers pages of `size`, and records each query. */
function fakeApi({ rows = ROWS, totals = TOTALS, size = 100, fail = false, inProgramme = [1, 3] } = {}) {
  const calls = [];
  return {
    calls,
    async list(status, page = 1, opts = {}) {
      calls.push({ status, page, ...opts });
      if (fail) throw new Error('down');
      const pool = opts.inProgramme === 'yes' ? rows.filter((r) => inProgramme.includes(r.id)) : rows;
      return { rows: pool.slice((page - 1) * size, page * size), page, page_size: size, matching: pool.length, totals };
    },
  };
}

async function mountTab(api, { phone = false } = {}) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const dialogs = [];
  const Dialog = (props) => { dialogs.push(props); return h('div', { 'data-testid': 'fake-dialog' }, props.kind); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(TestersTab, { testersApi: api, Dialog }))));
  return harness(container, root, () => { Object.assign(globalThis, previous); restore(); }, { dialogs });
}

async function mountPage(url, { phone = false, over = {} } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    for (const [k, v] of Object.entries(over)) if (path.startsWith(k)) return v();
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(SUPER));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(ProductTestingHqPage)))));
  return harness(container, root, () => { Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); });
}

async function harness(container, root, undo, extra = {}) {
  const settle = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    ...extra, by, all, pr, settle,
    // Whole-page text includes portals (sheets, lightboxes) under document.body.
    page: () => txt(document.body).replace(/\s+/g, ' ').trim(),
    text: (id) => { if (id) assert.ok(by(id) || walk(document.body).find((n) => pr(n)['data-testid'] === id), `no node ${id}`); return txt(id ? (by(id) || walk(document.body).find((n) => pr(n)['data-testid'] === id)) : container).replace(/\s+/g, ' ').trim(); },
    anywhere: (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id),
    async press(id) { const n = by(id) || walk(document.body).find((x) => pr(x)['data-testid'] === id); assert.ok(n, `no node ${id}`); await act(async () => { pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async change(id, value) { assert.ok(by(id), `no node ${id}`); await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); undo(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a tester row reads the nested member, its decider and programs, and never the email', () => {
  const r = testerRow(ROWS[0]);
  assert.equal(r.name, 'Ada Example');
  assert.equal(r.role, 'founder');
  assert.equal(r.decidedBy, 'Grace Admin');
  assert.deepEqual(r.programmes, { applied: 1, picked: 1 });
  assert.ok(!JSON.stringify(r).includes('@'), 'no email in what the page draws');
  assert.equal(testerRow(ROWS[1]).availability, null, 'blank availability is not given');
  assert.equal(testerRow({ ...ROWS[0], programmes: undefined }).programmes, null, 'no programs read is not zero');
  assert.equal(testerRow({ ...ROWS[0], member: undefined }).name, 'Name not recorded');
  assert.equal(WAITS.testerPrograms, undefined);
  assert.ok(WAITS.personaSegment);
});

test('the pool view: status, name search from two letters, filters, sort and pages', () => {
  const ids = (v) => v.rows.map((x) => x.id);
  assert.deepEqual(ids(poolView(ROWS, 'active', POOL_FILTERS)), [3, 6, 2, 1], 'newest tester first');
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, sort: 'since_asc' })), [1, 2, 6, 3]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, sort: 'name' })), [1, 2, 3, 6]);
  assert.deepEqual(ids(poolView(ROWS, 'paused', POOL_FILTERS)), [4]);
  const one = poolView(ROWS, 'active', { ...POOL_FILTERS, q: 'a' });
  assert.equal(one.tooShort, true); assert.equal(one.total, 4, 'one letter does not search');
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, q: 'cle' })), [3]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, q: 'example.com' })), [], 'the email is never searched');
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, role: 'founder' })), [3, 1]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, role: 'none' })), [6]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, availability: 'no' })), [2]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, availability: 'yes' })), [3, 6, 1]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, inProgramme: 'yes' }, new Set([1, 3]))), [3, 1]);
  assert.deepEqual(ids(poolView(ROWS, 'active', { ...POOL_FILTERS, inProgramme: 'no' }, new Set([1, 3]))), [6, 2]);
  assert.equal(poolView(ROWS, 'active', { ...POOL_FILTERS, inProgramme: 'yes' }, null).unread, 'inProgramme', 'unread is not nobody');
  const many = Array.from({ length: 57 }, (_, i) => t(100 + i, 'active', `Member ${i}`, 'founder'));
  const p1 = poolView(many, 'active', POOL_FILTERS);
  assert.equal(rangeOf(p1), '1–25 of 57'); assert.equal(p1.pages, 3);
  assert.equal(rangeOf(poolView(many, 'active', { ...POOL_FILTERS, page: 3 })), '51–57 of 57');
  assert.equal(rangeOf(poolView(many, 'active', { ...POOL_FILTERS, pageSize: 100 })), '1–57 of 57');
  assert.equal(poolView(many, 'active', { ...POOL_FILTERS, page: 9 }).page, 3, 'a page past the end is the last');
});

test('the profile chart counts active testers only; the menu follows the status; empty means nobody at all', () => {
  const c = poolProfileChart(ROWS);
  assert.equal(c.active, 4);
  assert.deepEqual(c.bars.map((b) => [b.label, b.n]), [['Founders', 2], ['Investors', 1], ['Advisors', 0], ['Operating Partners', 0], ['Explorers', 0], ['Profile not recorded', 1]]);
  assert.deepEqual(poolMenu('active').map((m) => m.key), ['open', 'pause', 'remove']);
  assert.deepEqual(poolMenu('paused').map((m) => m.key), ['open', 'resume', 'remove']);
  assert.deepEqual(poolMenu('removed').map((m) => m.key), ['open']);
  assert.deepEqual(poolMenu('declined').map((m) => m.key), ['open']);
  assert.equal(poolEmpty({ total: 0 }), true);
  assert.equal(poolEmpty({ total: 1 }), false);
  assert.equal(poolEmpty(null), false, 'an unread total is not empty');
});

test('the tester client sends page size and the filters the read takes', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(String(u).replace(/^.*\/api/, '')); return response({ rows: [], totals: {} }); };
  try {
    await adminProductTestersApi.list('', 2, { pageSize: 100, inProgramme: 'yes' });
    assert.ok(seen[0].startsWith('/admin/product-testers?'));
    const q = new URLSearchParams(seen[0].split('?')[1]);
    assert.equal(q.get('page'), '2'); assert.equal(q.get('page_size'), '100'); assert.equal(q.get('in_programme'), 'yes');
    assert.equal(q.get('status'), null, 'no status reads every status');
  } finally { globalThis.fetch = previous; restore(); }
});

test('readPool reads every page until the matching count, and says when it stopped short', async () => {
  const api = fakeApi({ size: 2 });
  const r = await readPool(api);
  assert.deepEqual(api.calls.map((c) => c.page), [1, 2, 3]);
  assert.equal(r.rows.length, 6); assert.equal(r.complete, true);
  const big = Array.from({ length: 1205 }, (_, i) => t(1000 + i, 'active', `Member ${i}`, 'founder'));
  const capped = await readPool(fakeApi({ rows: big }));
  assert.equal(capped.rows.length, 1000); assert.equal(capped.complete, false); assert.equal(capped.matching, 1205);
});

/* ------------------------------------------------------------------ *
 * The tab, mounted
 * ------------------------------------------------------------------ */

test('TST9: chips with marks and counts, the chart, the table and its columns, no email', async () => {
  const v = await mountTab(fakeApi());
  try {
    assert.equal(v.text('tester-chip-active'), '✓ Active 4');
    assert.equal(v.text('tester-chip-paused'), '‖ Paused 1');
    assert.equal(v.text('tester-chip-removed'), '– Removed 1 · not in the pool');
    assert.ok(v.text('testers-profile-chart').includes('Active · 4'));
    assert.ok(v.text('testers-profile-chart').includes('Paused testers are not counted. Any profile can be a tester.'));
    assert.equal(v.all('tester-row').length, 4);
    assert.ok(v.text('tester-row').startsWith('Cleo Mock Founder 1 Oct 2026 Grace Admin Evenings'));
    assert.ok(v.text('testers-table').includes('Approved by'));
    assert.equal(v.text('testers-range'), '1–4 of 4');
    assert.ok(v.text('testers-filter-persona').includes('Not read here yet'));
    assert.ok(!/@example\.com/.test(v.page()), 'no email is drawn');
  } finally { await v.close(); }
});

test('TST9: search, filters, sort, status chips and page size redraw the table', async () => {
  const api = fakeApi();
  const v = await mountTab(api);
  try {
    await v.change('testers-search', 'ben');
    assert.equal(v.all('tester-row').length, 1);
    assert.ok(v.text('tester-row').startsWith('Ben Sample'));
    await v.change('testers-search', '');
    await v.change('testers-filter-role', 'none');
    assert.ok(v.text('tester-row').startsWith('Fay Holder Profile not recorded'));
    await v.change('testers-filter-role', '');
    await v.change('testers-filter-sort', 'name');
    assert.ok(v.text('tester-row').startsWith('Ada Example'));
    await v.change('testers-filter-inProgramme', 'yes');
    assert.ok(api.calls.some((c) => c.inProgramme === 'yes'), 'the in-program read is asked of the server');
    assert.equal(v.all('tester-row').length, 2);
    await v.change('testers-filter-inProgramme', '');
    await v.press('tester-chip-paused');
    assert.ok(v.text('tester-row').startsWith('Dan Demo'));
    assert.ok(v.text('testers-table').includes('Decided by'));
    await v.press('tester-chip-declined');
    assert.ok(v.text('testers-none').startsWith('No declined testers.'));
  } finally { await v.close(); }
});

test('TST9: the ⋯ menu offers what the status allows and opens D1042’s dialog', async () => {
  const v = await mountTab(fakeApi());
  try {
    await v.press('tester-menu-1');
    assert.ok(v.by('tester-menu-1-items'));
    assert.equal(v.pr(v.by('tester-menu-1-open')).href, '/admin/approvals/product-testers/1');
    assert.ok(v.by('tester-menu-1-pause') && v.by('tester-menu-1-remove') && !v.by('tester-menu-1-resume'));
    await v.press('tester-menu-1-pause');
    assert.equal(v.dialogs.at(-1).kind, 'pause-remove');
    assert.equal(v.dialogs.at(-1).tester.member.name, 'Ada Example', 'the dialog gets the row as read');
    await v.press('tester-chip-paused');
    await v.press('tester-menu-4');
    assert.ok(v.by('tester-menu-4-resume') && !v.by('tester-menu-4-pause'));
    await v.press('tester-menu-4-resume');
    assert.equal(v.dialogs.at(-1).kind, 'resume');
  } finally { await v.close(); }
});

test('TST12b–TST14: empty, unreadable and partial each say what they are', async () => {
  let v = await mountTab(fakeApi({ rows: [], totals: { applied: 0, active: 0, paused: 0, declined: 0, removed: 0, total: 0 } }));
  try {
    assert.ok(v.text('testers-empty').includes('No testers yet.'));
    assert.equal(v.pr(v.by('testers-empty-approvals')).href, '/admin/approvals/product-testers');
    assert.equal(v.by('testers-table'), undefined);
  } finally { await v.close(); }
  v = await mountTab(fakeApi({ fail: true }));
  try {
    assert.ok(v.text('testers-unreadable').includes('We could not load the tester pool.'));
    assert.ok(v.text('testers-unreadable').includes('This is not a claim that there are none.'));
    assert.ok(v.by('testers-retry'));
    assert.equal(v.by('testers-empty'), undefined, 'a failed read is never drawn as empty');
  } finally { await v.close(); }
  const big = Array.from({ length: 1003 }, (_, i) => t(1000 + i, 'active', `Member ${i}`, 'founder'));
  v = await mountTab(fakeApi({ rows: big, totals: { ...TOTALS, active: 1003, total: 1003 } }));
  try {
    assert.ok(v.text('testers-partial').includes('first 1000 of 1003'));
  } finally { await v.close(); }
  v = await mountTab({ list: () => new Promise(() => {}) });
  try { assert.ok(v.text('testers-loading').includes('Reading…')); } finally { await v.close(); }
});

test('TST16: on a phone the tester ⋯ is a 44px button and opens a bottom sheet with Cancel', async () => {
  const v = await mountTab(fakeApi(), { phone: true });
  try {
    assert.match(v.pr(v.by('tester-menu-1')).className, /max-md:min-h-\[44px\]/);
    await v.press('tester-menu-1');
    assert.equal(v.by('tester-menu-1-items'), undefined, 'no dropdown on a phone');
    assert.ok(v.anywhere('tester-menu-1-sheet'));
    assert.ok(v.text('tester-menu-1-sheet-eyebrow').includes('Ada Example'));
    assert.ok(v.anywhere('tester-menu-1-sheet-cancel'));
    await v.press('tester-menu-1-sheet-remove');
    assert.equal(v.dialogs.at(-1).kind, 'remove');
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * One program's applicants on a phone (TST16d–f)
 * ------------------------------------------------------------------ */

const ALPHA = { uid: 'alpha', status: 'open', owner_kind: 'hq', owner_name: 'Axal VC', product_name: 'Data room alpha', places: 20, picked_count: 1, applicant_count: 2,
  eligible_roles: ['founder'], questions: ['Have you shared a data room before?'], updated_at: '2026-10-20 09:00:00' };
const ap = (uid, name, status, extra = {}) => ({ uid, name, role: 'founder', status, tester: false, answers: ['Yes, twice.'], availability: 'Evenings', consented: true,
  applied_at: '2026-09-02 14:31:00', updated_at: '2026-09-02 14:31:00', ...extra });
const OVER = {
  '/admin/testing/programmes/alpha/applicants': () => response({ programme: ALPHA, can_decide: true, tester_pool_readable: true, items: [ap('a1', 'Ada Example', 'applied', { tester: true }), ap('a2', 'Finn Mock', 'picked')] }),
  '/admin/testing/programmes/alpha/events': () => response({ programme: ALPHA, events: { available: true, page: 1, page_size: 100, total: 0, items: [] } }),
  '/admin/testing/programmes': () => response({ items: [ALPHA] }),
  '/admin/testing/applications': () => response({ applications: { available: true, page: 1, page_size: 100, total: 0, items: [] } }),
};

test('TST16: a program’s applicants are cards with a 44px ⋯ sheet, and answers open full screen', async () => {
  const v = await mountPage('/admin/platform/product-testing/programs/alpha?tab=applicants', { phone: true, over: OVER });
  try {
    assert.ok(v.by('testing-applicant-cards'));
    assert.equal(v.by('testing-applicants-table'), undefined, 'no wide table on a phone');
    assert.equal(v.all('testing-applicant-card').length, 2);
    assert.ok(v.text('testing-applicant-card').includes('Founder · applied 2 Sep 2026'));
    assert.match(v.pr(v.by('testing-applicant-menu-a1')).className, /max-md:min-h-\[44px\]/);
    await v.press('testing-applicant-menu-a1');
    for (const k of ['pick', 'decline', 'withdraw']) assert.ok(v.anywhere(`testing-applicant-menu-a1-sheet-${k}`), k);
    assert.ok(v.text('testing-applicant-menu-a1-sheet-eyebrow').includes('Ada Example · applied 2 Sep 2026'));
    await v.press('testing-applicant-menu-a1-sheet-cancel');
    await v.press('testing-applicant-menu-a2');
    assert.equal(v.anywhere('testing-applicant-menu-a2-sheet-pick'), undefined, 'a picked applicant is not picked again');
    assert.equal(v.anywhere('testing-applicant-menu-a2-sheet-decline'), undefined);
    await v.press('testing-applicant-menu-a2-sheet-cancel');
    await v.press('testing-applicant-open-a1');
    const answers = v.anywhere('testing-answers-a1');
    assert.ok(answers, 'the answers open');
    assert.ok(v.page().includes('Have you shared a data room before?'));
    assert.ok(v.page().includes('Yes, twice.'));
    assert.ok(!/@example\.com/.test(v.page()));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * TST15a and the sources
 * ------------------------------------------------------------------ */

test('TST15a: a studio admin on Product testing is told what HQ runs and sent to Accounts or Approvals', () => {
  for (const p of ['/admin/platform/product-testing', '/admin/platform/product-testing/testers']) {
    assert.ok(hqLine(p).startsWith('HQ runs product testing. You can approve and manage testers on Accounts, and decide tester applications in Approvals.'), p);
    assert.deepEqual(hqLinks(p).map((l) => [l.label, l.href]), [['Go to Accounts', '/admin/accounts'], ['Go to Approvals', '/admin/approvals']]);
  }
  assert.deepEqual(hqLinks('/admin/platform/allowances').map((l) => l.href), ['/studio', '/admin/my-licence'], 'other HQ pages keep their doors');
  assert.ok(hqLine('/admin/platform/product-testingx').startsWith('HQ manages this page.'));
});

test('the sources: phone targets, the pinned form bar, the review buttons, and no browser pop-up', () => {
  const tabs = read('../src/pages/admin/productTesting/ProductTestingTabs.jsx');
  const menu = read('../src/pages/admin/productTesting/ActionMenu.jsx');
  const consoleSrc = read('../src/pages/admin/consoles/ProductTestingConsole.jsx');
  const form = read('../src/pages/testing/ProgrammeForm.jsx');
  for (const src of [tabs, menu]) assert.ok(!/window\.(confirm|alert|prompt)\(/.test(src));
  assert.match(menu, /min-h-\[48px\]/, 'sheet rows are 48px');
  assert.match(consoleSrc, /bar: 'max-sm:sticky max-sm:bottom-0/);
  assert.match(consoleSrc, /save: 'max-sm:order-2 max-sm:flex-\[1\.4\]'/);
  assert.match(consoleSrc, /cancel: 'max-sm:order-1 max-sm:min-h-\[44px\] max-sm:flex-1'/);
  assert.match(consoleSrc, /className=\{`\$\{primaryCls\} max-sm:flex-1`\} onClick=\{\(\) => ask\('approve'/);
  assert.match(form, /classes\.bar/);
  assert.ok(!/member_email|\.email\b/.test(tabs.slice(tabs.indexOf('Tester pool (TST9)'))), 'the pool never reads an email');
});
