// D1195 (#2382) — HQ › Platform › Product testing's five tabs from the canvas
// (TST1–TST9): each at its own address; Overview's tiles, places bars and
// status chips from the programme list, the Tester pool tile and tab from
// D1042's tester store; Review as D815's console in its review view; one
// program at /programs/:uid; "Not read here yet" with its reason where no read
// exists; and never an email address.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_d1195.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ProductTestingHqPage } from '../src/pages/admin/ConsolePages.jsx';
import { adminProductTestersApi } from '../src/lib/api/productTesting.js';
import {
  NOT_YET, TABS, WAITS, overviewFigures, programHref, testerRow, viewOf,
} from '../src/pages/admin/productTesting/productTestingModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };

const prog = (uid, status, extra = {}) => ({
  uid, status, owner_kind: 'partner', owner_name: 'Partner Firm A', product_name: `Product ${uid}`, places: 10, picked_count: 0, applicant_count: 0,
  eligible_roles: ['founder'], questions: [], updated_at: '2026-10-20 09:00:00', ...extra,
});
const PROGRAMMES = [
  prog('alpha', 'open', { owner_kind: 'hq', owner_name: 'Axal VC', places: 20, picked_count: 12, applicant_count: 26 }),
  prog('beta', 'open', { places: 10, picked_count: 5, applicant_count: 14 }),
  prog('delta', 'submitted', { updated_at: '2026-10-19 08:00:00' }),
  prog('epsilon', 'submitted', { updated_at: '2026-10-20 08:00:00' }),
  prog('eta', 'approved'),
  prog('zeta', 'rejected', { review_note: 'Say what testers will be asked to install.' }),
  prog('omega', 'closed', { places: 5, picked_count: 5, applicant_count: 9 }),
];
const TESTERS = {
  rows: [{ id: 7, status: 'active', member_name: 'Ada Example', member_email: 'ada@example.com', member_role: 'founder', decided_at: '2026-09-02 10:00:00', availability: 'Evenings', consent_email_at: '2026-09-01', consent_version: 'v2' }],
  page: 1, page_size: 25, matching: 1, totals: { applied: 6, active: 57, paused: 4, declined: 9, removed: 3, total: 79 },
};

async function mounted(url, { testers = TESTERS } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    requests.push(path);
    if (path.startsWith('/admin/testing/programmes') && !path.includes('/applicants')) return response({ items: PROGRAMMES });
    if (path.startsWith('/admin/testing/programmes/alpha/applicants')) return response({ programme: PROGRAMMES[0], items: [] });
    if (path.startsWith('/admin/product-testers')) return testers ? response(testers) : response({ error: 'down' }, 503);
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(SUPER));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(ProductTestingHqPage)))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    requests, by,
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    current: () => walk(container).filter((n) => pr(n)['aria-current'] === 'page').map((n) => pr(n)['data-testid']).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('five tabs at their own addresses; a program, its sub-tabs as ?tab=; anything unknown is Overview', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [
    ['Overview', '/admin/platform/product-testing'], ['Review', '/admin/platform/product-testing/review'],
    ['Programs', '/admin/platform/product-testing/programs'], ['Applicants', '/admin/platform/product-testing/applicants'],
    ['Tester pool', '/admin/platform/product-testing/testers'],
  ]);
  assert.deepEqual(viewOf('/admin/platform/product-testing/testers/'), { tab: 'testers', uid: null, sub: null });
  assert.deepEqual(viewOf('/admin/platform/product-testing/programs/abc-1'), { tab: 'programs', uid: 'abc-1', sub: 'overview' });
  assert.deepEqual(viewOf('/admin/platform/product-testing/programs/abc-1', '?tab=activity'), { tab: 'programs', uid: 'abc-1', sub: 'activity' });
  assert.deepEqual(viewOf('/admin/platform/product-testing/programs/abc-1', '?tab=nope'), { tab: 'programs', uid: 'abc-1', sub: 'overview' });
  assert.deepEqual(viewOf('/admin/platform/product-testing/programs/a%3Cb'), { tab: 'programs', uid: null, sub: null }, 'a malformed uid is Programs');
  assert.equal(viewOf('/admin/platform/product-testing/nonsense').tab, 'overview');
  assert.equal(viewOf('/admin/platform/product-testing-review').tab, 'overview', 'only the page\'s own addresses');
  assert.equal(programHref('abc-1', 'applicants'), '/admin/platform/product-testing/programs/abc-1?tab=applicants');
});

test('the overview figures: open, waiting with its oldest, places on open programs only, every status counted', () => {
  const f = overviewFigures(PROGRAMMES);
  assert.equal(f.open, 2);
  assert.equal(f.approvedNotOpen, 1);
  assert.equal(f.waiting, 2);
  assert.equal(f.oldestWaiting, '2026-10-19 08:00:00');
  assert.deepEqual({ picked: f.places.picked, places: f.places.places, programs: f.places.programs, applicants: f.places.applicants }, { picked: 17, places: 30, programs: 2, applicants: 40 }, 'the closed program is left out');
  assert.deepEqual(f.chips.map((c) => [c.label, c.n]), [['Waiting for HQ', 2], ['Sent back', 1], ['Draft', 0], ['Approved', 1], ['Open', 2], ['Testing', 0], ['Closed', 1]]);
  assert.equal(overviewFigures([prog('q', 'submitted', { owner_kind: 'hq' })]).waiting, 0, 'HQ\'s own never waits for HQ');
  const unrecorded = overviewFigures([prog('x', 'open', { places: null })]);
  assert.deepEqual([unrecorded.places.places, unrecorded.places.placesUnrecorded], [0, ['Product x']], 'a missing places figure is named, not summed as 0');
});

test('every block with no read says why, and none says zero or none; a tester row never carries the email', () => {
  for (const k of ['weekly', 'profiles', 'mail', 'needs', 'applicants', 'activity', 'partnerApplicants', 'testerPrograms']) assert.ok(WAITS[k], k);
  for (const w of Object.values(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), w);
  const row = testerRow(TESTERS.rows[0]);
  assert.ok(!JSON.stringify(row).includes('@'), 'no email in what the page draws');
  assert.equal(row.consentVersion, 'v2');
  assert.equal(testerRow({ ...TESTERS.rows[0], consent_email_at: null }).consentVersion, null);
});

test('the tester client refuses an unknown status and pages by query', async () => {
  assert.throws(() => adminProductTestersApi.list('pending'), /Unknown tester status/);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('Overview: the HQ-only header and tabs, four tiles from the two reads, places bars, status chips, and the waits', async () => {
  const v = await mounted('/admin/platform/product-testing');
  try {
    assert.deepEqual(v.current().filter((id) => id.startsWith('testing-tab-')), ['testing-tab-overview']);
    assert.ok(v.text().includes('HQ only'));
    assert.equal(v.text('testing-tile-open-value'), '2');
    assert.equal(v.text('testing-tile-waiting-value'), '2');
    assert.ok(v.text('testing-tile-waiting').includes('Oldest sent 19 Oct 2026'));
    assert.equal(v.text('testing-tile-places-value'), '17 of 30');
    assert.equal(v.text('testing-tile-pool-value'), '57');
    assert.ok(v.text('testing-tile-pool').includes('4 paused · 6 applications waiting in Approvals'));
    assert.ok(v.by('testing-bar-alpha') && v.by('testing-bar-beta') && !v.by('testing-bar-omega'));
    assert.equal(v.text('testing-chip-submitted'), 'Waiting for HQ 2');
    for (const id of ['weekly', 'profiles', 'mail', 'needs']) assert.ok(v.text(`testing-wait-${id}`).includes(NOT_YET), id);
    assert.ok(v.requests.includes('/admin/product-testers?status=active'));
    assert.ok(!/@example\.com/.test(v.text()), 'no email is drawn');
  } finally { await v.close(); }
});

test('Overview: an unreadable tester pool costs only its tile', async () => {
  const v = await mounted('/admin/platform/product-testing', { testers: null });
  try {
    assert.ok(v.text('testing-tile-pool').includes('Could not be read'));
    assert.equal(v.text('testing-tile-open-value'), '2', 'every other block answers');
  } finally { await v.close(); }
});

test('Review: what waits on HQ, what is approved and not open, and what was sent back; no full programme list', async () => {
  const v = await mounted('/admin/platform/product-testing/review');
  try {
    assert.deepEqual(v.current().filter((id) => id.startsWith('testing-tab-')), ['testing-tab-review']);
    assert.ok(v.by('product-testing-review'));
    assert.ok(v.text('testing-waiting').includes('Product delta') && v.text('testing-waiting').includes('Product epsilon'));
    assert.ok(v.text('testing-approved').includes('Product eta'));
    assert.ok(v.text('testing-sent-back').includes('Say what testers will be asked to install.'));
    assert.ok(!v.by('testing-all') && !v.by('testing-new-programme'));
  } finally { await v.close(); }
});

test('Programs is D815\'s console as it was', async () => {
  const v = await mounted('/admin/platform/product-testing/programs');
  try {
    assert.ok(v.by('product-testing-console') && v.by('testing-all') && v.by('testing-new-programme'));
  } finally { await v.close(); }
});

test('one program: details, HQ\'s own applicants, a partner\'s applicants and the history waiting', async () => {
  let v = await mounted('/admin/platform/product-testing/programs/alpha');
  try {
    assert.ok(v.current().includes('testing-tab-programs'), 'Programs stays lit under a program');
    assert.equal(v.text('testing-program-name'), 'Product alpha');
    assert.ok(v.text('testing-program-details').includes('12 of 20 places filled'));
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/alpha?tab=applicants');
  try {
    assert.ok(v.by('testing-program-applicants'));
    assert.ok(v.requests.includes('/admin/testing/programmes/alpha/applicants'));
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/beta?tab=applicants');
  try {
    assert.ok(v.text('testing-wait-partnerApplicants').includes(NOT_YET));
    assert.ok(!v.requests.some((u) => u.includes('/beta/applicants')), 'HQ cannot read a partner\'s applicants today');
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/alpha?tab=activity');
  try { assert.ok(v.by('testing-wait-activity')); } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/missing');
  try { assert.ok(v.by('testing-program-missing')); } finally { await v.close(); }
});

test('Applicants waits and makes no read; the Tester pool draws the store with no email, and its status chips page it', async () => {
  let v = await mounted('/admin/platform/product-testing/applicants');
  try {
    assert.ok(v.text('testing-wait-applicants').includes(NOT_YET));
    assert.deepEqual(v.requests.filter((u) => u.startsWith('/admin/')), []);
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/testers');
  try {
    assert.equal(v.text('tester-chip-active'), 'Active 57');
    assert.ok(v.text('tester-applications-link').startsWith('6 applications waiting'));
    assert.ok(v.text('tester-row').startsWith('Ada Example Founder 2 Sep 2026 Evenings v2 Active'));
    assert.ok(!/@example\.com/.test(v.text()), 'no email is drawn');
    assert.ok(v.text('testing-wait-testerPrograms').includes(NOT_YET));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the sub-path routes behind hqOnly, the tabs as literal doors, and the canvas in incoming', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['', '/:tab', '/programs/:uid']) {
    assert.ok(app.includes(`<Route path="/admin/platform/product-testing${p}" element={guard(['admin'], hqOnly(<ProductTestingHqPage />))} />`), p || 'base');
  }
  const pages = read('frontend/src/pages/admin/ConsolePages.jsx');
  for (const t of TABS) assert.ok(pages.includes(`<HeaderTab to="${t.path}"`), t.key);
  assert.match(pages, /<ConsolePage hqOnly crumb=\{\{ \.\.\.PLATFORM, current: 'Product testing' \}\}/);
  for (const f of ['Product Testing Page.dc.html', 'Product testing · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Product testing · Boards.dc.html').includes('Product Testing Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1195.md'));
  assert.ok(existsSync('documentation/audits/PRODUCT_TESTING_MAP_2026-10-25.md'));
});
