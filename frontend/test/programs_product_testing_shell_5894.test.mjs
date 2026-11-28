/**
 * D5894 (#5894) — Product testing in the generic program shell (PG03a), D5313's pattern, under the owner's answer B
 * (2026-11-27): its HQ page keeps its home at /admin/platform/product-testing, and the shell links out to it as its
 * Applications module. No redirect.
 *
 * What is pinned:
 *   · the shell's six core sections in PG03's order and words, with the Applications module between Participation
 *     and History at its MODULE_PATHS address, which is the HQ page's own;
 *   · the six shell addresses are literal routes onto ProgramPage under the admin guard, never hqOnly; the HQ page's
 *     three App.jsx lines stay as they were, hqOnly, and each of its addresses (a tab, a :uid, a query) still opens
 *     that page, not the shell, with no redirect;
 *   · each shell address opens its own section with its tab lit, deep links included;
 *   · HQ-only stays HQ-only: an Admin has no Applications tab, no door onto the HQ page, no figure, and makes no
 *     /api/admin/testing read; a Super Admin gets the tab, the door and the figures;
 *   · Participation is R11's applications, or "Could not be read", and members are "Not recorded", never 0;
 *   · a failed registry read marks only Availability, Settings and the modules.
 * Every name and id is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_product_testing_shell_5894.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { Suspense, act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import adminProgramsGenericRoutes from '../src/routes/adminProgramsGeneric.jsx';
import adminProgramsProductTestingRoutes from '../src/routes/adminProgramsProductTesting.jsx';
// Loaded first, so a route's first mount does not wait on a cold import.
import '../src/pages/admin/programs/ProgramPage.jsx';
import '../src/pages/admin/programs/GenericProgramPage.jsx';
import {
  PAGES, PRODUCT_TESTING_FOOT, PRODUCT_TESTING_HQ_ONLY, PRODUCT_TESTING_PATH, TESTING_MEMBERS_UNRECORDED, routeFor, testingParticipationTiles,
} from '../src/pages/admin/programs/programsModel.js';
import { MODULE_HQ_ONLY, moduleRows, shellModules } from '../src/pages/admin/programs/genericProgramModel.js';

const h = React.createElement;
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const BASE = '/admin/programs/product-testing';
const HQ = '/admin/platform/product-testing';

const DETAIL = {
  program: { key: 'product-testing', group: 'Product', name: 'Product testing', purpose: 'Members test products.', who: 'The roles each program names', join_method: 'By application', status: 'live', position: 9, updated_at: '2026-11-07T10:00:00Z', studio_only: null, member_access: 'apply', modules: ['applications'] },
  playbook: { published: false, version: null, published_at: null, sections: [] },
  draft: { sections: [{ key: 'purpose', title: 'Purpose', body: null, computed: false, template_keys: [] }], edited_at: null, differs: false },
  grant: { state: 'hq_only' }, grantable: false, approved_proposal: null, capabilities: [],
};
const PROGRAMMES = { items: [
  { uid: 'alpha', product_name: 'Alpha', status: 'open', applicant_count: 4 },
  { uid: 'beta', product_name: 'Beta', status: 'testing', applicant_count: 3 },
  { uid: 'gamma', product_name: 'Gamma', status: 'closed', applicant_count: 2 },
] };

function worker(user, o = {}) {
  const { detail = () => response(DETAIL), programmes = () => response(PROGRAMMES), write = null } = o;
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return write ? write(path, method, options) : never();
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return response({ program: 'product-testing', rows: [], next_before: null, not_audited: null });
    if (path === '/api/admin/programs/product-testing') return detail();
    if (path === '/api/admin/testing/programmes') return user.is_super_admin ? programmes() : response({ detail: 'Super Admin only' }, 403);
    return never();
  };
}

/** Stands in for the HQ page, so the test sees which route an HQ address lands on. */
const HqStub = () => h('div', { 'data-testid': 'hq-product-testing' });
/** The routes as the app has them: the HQ page's three App.jsx paths, this task's module, and the registry-backed `:key`. */
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  h(Route, { key: HQ, path: HQ, element: h(HqStub) }),
  h(Route, { key: `${HQ}/:tab`, path: `${HQ}/:tab`, element: h(HqStub) }),
  h(Route, { key: `${HQ}/programs/:uid`, path: `${HQ}/programs/:uid`, element: h(HqStub) }),
  adminProgramsProductTestingRoutes({ guard: (_roles, element) => element }),
  adminProgramsGenericRoutes({ guard: (_roles, element) => element })));

const tick = () => new Promise((r) => setImmediate(r));
async function mounted(url, handle, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}${l.hash}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Table), h(Probe)))));
  const flush = () => act(async () => { for (let i = 0; i < 60; i += 1) await tick(); });
  for (let i = 0; !container.childNodes?.length && i < 400; i += 1) await act(async () => { await tick(); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const hrefs = () => nodes().map((n) => props(n).href).filter(Boolean);
  return {
    requests, at, hrefs, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

const TABS = PAGES['product-testing'].tabs;
const SHELL = TABS.filter((t) => !t.outside);
/** Each tab and the one section only it draws. */
const SECTION = {
  overview: 'programs-testing-home', how: 'programs-testing-how', availability: 'programs-generic-availability',
  participation: 'programs-testing-participation', activity: 'programs-testing-activity', settings: 'programs-generic-settings',
};

test('the strip is the shell\'s six core sections in PG03\'s order and words, with Applications linking out to the HQ page', () => {
  assert.deepEqual(TABS.map((t) => [t.key, t.label, t.path]), [
    ['overview', 'Overview', BASE], ['how', 'Playbook', `${BASE}/how-it-runs`],
    ['availability', 'Availability & grants', `${BASE}/availability`], ['participation', 'Participation', `${BASE}/participation`],
    ['applications', 'Applications', HQ],
    ['activity', 'History', `${BASE}/activity`], ['settings', 'Settings', `${BASE}/settings`],
  ]);
  assert.equal(PRODUCT_TESTING_PATH, HQ, 'the HQ page keeps its home');
  const mod = TABS.find((t) => t.module);
  assert.deepEqual([mod.module, mod.outside, mod.hqOnly], ['applications', true, true]);
  // The module's door is MODULE_PATHS', for a Super Admin only.
  assert.deepEqual(moduleRows('product-testing', { modules: ['applications'] }, { superAdmin: true }).rows, [{ key: 'applications', label: 'Applications', path: HQ }]);
  assert.deepEqual(moduleRows('product-testing', { modules: ['applications'] }).rows, [{ key: 'applications', label: 'Applications', path: null, note: MODULE_HQ_ONLY }]);
  assert.deepEqual(shellModules('product-testing', { status: 'error' }, { superAdmin: true }), { state: 'unreadable', rows: [] });
  // Another program's modules are as they were.
  assert.deepEqual(moduleRows('influencer', { modules: ['applications'] }).rows, [{ key: 'applications', label: 'Applications', path: '/admin/programs/influencer/applications' }]);
  // The strip's literal doors equal the model's.
  const strip = read('frontend/src/pages/admin/programs/ProgramTabs.jsx');
  const body = strip.slice(strip.indexOf('export function ProductTestingTabs'));
  assert.deepEqual([...body.matchAll(/<Tab to="([^"]+)"[^>]*>([^<]+)<\/Tab>/g)].map((m) => [m[1], m[2].replace('&amp;', '&')]), TABS.map((t) => [t.path, t.label]));
  assert.match(body, /\{superAdmin \? <Tab to="\/admin\/platform\/product-testing"/, 'the Applications tab is a Super Admin\'s');
  for (const t of SHELL) {
    assert.deepEqual(routeFor(t.path), { program: 'product-testing', tab: t.key });
    assert.deepEqual(routeFor(`${t.path}/`), { program: 'product-testing', tab: t.key });
  }
  assert.deepEqual(routeFor(HQ), { program: null, tab: 'catalogue' }, 'the HQ page is never the shell\'s');
});

test('the shell addresses are literal routes onto ProgramPage under the admin guard; the HQ page keeps its three hqOnly lines', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of [HQ, `${HQ}/:tab`, `${HQ}/programs/:uid`]) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], hqOnly(<ProductTestingHqPage />))} />`), `${p} stays in App.jsx, hqOnly`);
  }
  assert.doesNotMatch(app, /\/admin\/programs\/product-testing/, 'App.jsx gains no line');
  const mod = read('frontend/src/routes/adminProgramsProductTesting.jsx');
  const routes = readRoutesSource();
  for (const t of SHELL) {
    assert.ok(mod.includes(`<Route path="${t.path}" element={guard(['admin'], <AdminProgramPage />)} />`), t.path);
    assert.ok(routes.includes(`path="${t.path}" element={guard(['admin'], <`), t.path);
  }
  assert.doesNotMatch(mod, /hqOnly\(|Navigate/, 'no route is HQ-only, and none redirects');
});

test('each shell address opens its own section with its tab lit; the HQ addresses still open the HQ page; nothing redirects', async () => {
  const cases = [
    ...SHELL.map((t) => [t.path, t.key]),
    [`${BASE}?source=catalogue#top`, 'overview'],
    [`${BASE}/how-it-runs#purpose`, 'how'],
    [`${BASE}/settings/`, 'settings'],
    [`${BASE}/activity?x=1`, 'activity'],
  ];
  for (const [url, key] of cases) {
    const view = await mounted(url, worker(SUPER), SUPER);
    try {
      assert.ok(view.has('programs-page-product-testing'), `${url}: the Product testing page`);
      assert.ok(view.has('admin-board-program') && !view.has('admin-board-program-generic'), `${url}: ProgramPage, not the registry-backed page`);
      assert.ok(view.has(SECTION[key]), `${url}: ${SECTION[key]}`);
      for (const other of Object.keys(SECTION).filter((k) => k !== key)) assert.ok(!view.has(SECTION[other]), `${url}: not ${other}`);
      for (const t of TABS) assert.equal(view.props(`programs-tab-${t.key}`)['aria-current'], t.key === key ? 'page' : undefined, `${url}: tab ${t.key}`);
      for (const t of TABS) assert.equal(view.textOf(`programs-tab-${t.key}`), t.label, `${url}: tab ${t.key}`);
      assert.equal(view.at.path, url, `${url}: no redirect`);
    } finally { await view.close(); }
  }
  for (const url of [HQ, `${HQ}/review`, `${HQ}/programs`, `${HQ}/programs/alpha`, `${HQ}/programs/alpha?tab=applicants`, `${HQ}/pool#rows`]) {
    const view = await mounted(url, worker(SUPER), SUPER);
    try {
      assert.ok(view.has('hq-product-testing') && !view.has('programs-page-product-testing'), `${url}: the HQ page, not the shell`);
      assert.equal(view.at.path, url, `${url}: no redirect`);
    } finally { await view.close(); }
  }
});

test('a Super Admin gets the Applications tab, the door onto the HQ page and the module\'s door', async () => {
  const view = await mounted(BASE, worker(SUPER), SUPER);
  try {
    assert.equal(view.props('programs-tab-applications').href, HQ);
    assert.equal(view.props('programs-testing-open').href, HQ);
    assert.equal(view.props('programs-testing-home-open').href, HQ);
    assert.match(view.textOf('programs-generic-module-applications'), /Applications/);
    assert.ok(view.hrefs().filter((x) => x === HQ).length >= 4, 'tab, header, Where it runs and the module');
    assert.ok(!view.has('programs-testing-hq-only'));
  } finally { await view.close(); }
});

test('HQ-only stays HQ-only: an Admin sees no figure, no door onto the HQ page, and makes no read the Worker keeps for HQ', async () => {
  for (const url of SHELL.map((t) => t.path)) {
    const view = await mounted(url, worker(ADMIN), ADMIN);
    try {
      assert.ok(view.has('programs-page-product-testing'), `${url}: an Admin opens the shell`);
      assert.ok(!view.has('programs-tab-applications'), `${url}: no Applications tab`);
      assert.ok(!view.has('programs-testing-open'), `${url}: no header door`);
      assert.ok(!view.hrefs().some((x) => x.startsWith(HQ)), `${url}: no door onto the HQ page`);
      assert.ok(!view.requests.some((r) => r.url.startsWith('/api/admin/testing')), `${url}: no HQ read`);
    } finally { await view.close(); }
  }
  const overview = await mounted(BASE, worker(ADMIN), ADMIN);
  try {
    assert.equal(overview.textOf('programs-testing-hq-only'), PRODUCT_TESTING_HQ_ONLY);
    assert.equal(overview.textOf('programs-generic-module-applications'), `Applications · ${MODULE_HQ_ONLY}`);
  } finally { await overview.close(); }
  const part = await mounted(`${BASE}/participation`, worker(ADMIN), ADMIN);
  try {
    assert.equal(part.textOf('programs-testing-participation-hq-only'), `HQ only${PRODUCT_TESTING_HQ_ONLY}`);
    assert.ok(!part.has('programs-tile-participation-applications'), 'no figure');
    assert.doesNotMatch(part.textOf('programs-testing-participation'), /\d/);
  } finally { await part.close(); }
  assert.match(PRODUCT_TESTING_FOOT, /for HQ only/);
});

test('Participation: R11\'s applications not withdrawn, "Could not be read" on a failed read, members Not recorded, never 0', async () => {
  const view = await mounted(`${BASE}/participation`, worker(SUPER), SUPER);
  try {
    assert.equal(view.textOf('programs-tile-participation-applications-value'), '9');
    assert.match(view.textOf('programs-tile-participation-applications'), /Across 3 programs, 2 open or testing\./);
    assert.match(view.textOf('programs-tile-participation-members'), /Not recorded/);
    assert.ok(view.textOf('programs-tile-participation-members').includes(TESTING_MEMBERS_UNRECORDED));
    assert.ok(view.requests.some((r) => r.url === '/api/admin/testing/programmes'));
  } finally { await view.close(); }
  const down = await mounted(`${BASE}/participation`, worker(SUPER, { programmes: () => response({ detail: 'down' }, 503) }), SUPER);
  try {
    assert.match(down.textOf('programs-tile-participation-applications'), /Could not be read/);
    assert.ok(!down.has('programs-tile-participation-applications-value'), 'no figure from a failed read');
    assert.match(down.textOf('programs-tile-participation-members'), /Not recorded/);
  } finally { await down.close(); }
  // The model: an empty store is a measured 0; a count the read did not carry is unreadable, never 0.
  assert.equal(testingParticipationTiles({ status: 'ready', data: { items: [] } })[0].value, '0');
  assert.equal(testingParticipationTiles({ status: 'ready', data: { items: [{ status: 'open' }] } })[0].state, 'unreadable');
  assert.equal(testingParticipationTiles({ status: 'ready', data: {} })[0].state, 'unreadable');
  assert.equal(testingParticipationTiles({ status: 'loading' })[0].state, 'loading');
  assert.equal(testingParticipationTiles({ status: 'ready', data: PROGRAMMES })[1].state, 'placeholder');
});

test('Settings and Availability are the shell\'s: HQ sets member access; a failed registry read marks only those sections and the modules', async () => {
  const writes = [];
  const write = (path, method, options) => { writes.push({ path, method, body: JSON.parse(options.body) }); return response({ program: { ...DETAIL.program, member_access: 'invite' } }); };
  const hq = await mounted(`${BASE}/settings`, worker(SUPER, { write }), SUPER);
  try {
    assert.equal(hq.props('programs-generic-access').value, 'apply');
    await hq.change('programs-generic-access', 'invite');
    await hq.click('programs-generic-access-save');
    assert.deepEqual(writes, [{ path: '/api/admin/programs/product-testing', method: 'PATCH', body: { member_access: 'invite' } }]);
  } finally { await hq.close(); }
  const admin = await mounted(`${BASE}/settings`, worker(ADMIN), ADMIN);
  try {
    assert.equal(admin.textOf('programs-generic-access-value'), 'Apply');
    assert.ok(!admin.has('programs-generic-access'), 'an Admin reads member access');
  } finally { await admin.close(); }
  for (const url of [`${BASE}/settings`, `${BASE}/availability`]) {
    const view = await mounted(url, worker(SUPER, { detail: () => response({ error: 'down' }, 503) }), SUPER);
    try {
      assert.ok(view.has('programs-page-product-testing'), `${url}: the page still draws`);
      assert.ok(view.has('programs-shell-registry-failed'), `${url}: says the program could not be read`);
      assert.ok(!view.has('programs-generic-access') && !view.has('programs-generic-availability'), `${url}: nothing from a failed read`);
    } finally { await view.close(); }
  }
  const down = await mounted(BASE, worker(SUPER, { detail: () => response({ error: 'down' }, 503) }), SUPER);
  try {
    assert.ok(down.has('programs-testing-home'), 'Where it runs still draws');
    assert.match(down.textOf('programs-generic-modules'), /Could not be read/);
  } finally { await down.close(); }
});

test('History reads the program\'s activity, and the catalogue card opens the shell', async () => {
  const view = await mounted(`${BASE}/activity`, worker(ADMIN), ADMIN);
  try {
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/admin/programs/product-testing/activity')));
  } finally { await view.close(); }
  const catalogue = read('frontend/src/pages/admin/programs/ProgramsCatalogue.jsx');
  const card = catalogue.slice(catalogue.indexOf("case 'product-testing'"), catalogue.indexOf('default:', catalogue.indexOf("case 'product-testing'")));
  assert.match(card, /door: <Link to="\/admin\/programs\/product-testing" /, 'one door, for both, onto the shell');
  assert.match(card, /figures: superAdmin \?/, 'the figures stay the Super Admin\'s');
});
