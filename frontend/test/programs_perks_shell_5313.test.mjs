/**
 * D5313 (#5313) — Perks in the generic program shell (PG03a), the first of the nine built-in programs to move.
 *
 * What is pinned:
 *   · the shell's six core sections (Overview, Playbook, Availability & grants, Participation, History, Settings) in
 *     PG03's order and words, with the Perk queue module between Participation and History at MODULE_PATHS' `/queue`;
 *   · every Perks address (the four D953 and D962 gave it, and the shell's three new ones) is a literal route onto the
 *     one ProgramPage, and each opens its own section with its tab lit, a query, a hash or a trailing slash included;
 *   · the registry-backed `/admin/programs/:key/…` page still serves the other eight's new sections;
 *   · Participation: claims are a recorded figure, the members behind them are "Not recorded", never 0;
 *   · a failed registry read marks only the sections that need it.
 * Every name and id is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_perks_shell_5313.test.mjs
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
import adminProgramsPerksRoutes from '../src/routes/adminProgramsPerks.jsx';
// Loaded first, so a route's first mount does not wait on a cold import (as programs_generic_4808 does).
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import '../src/pages/admin/programs/GenericProgramPage.jsx';
import { PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import { genericTabs, moduleRows, shellModules } from '../src/pages/admin/programs/genericProgramModel.js';
import { PERK_MEMBERS_UNRECORDED, perkParticipationTiles } from '../src/pages/admin/programs/programPagesModel.js';

const h = React.createElement;
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const NOW = Date.now();
const d1 = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

const DETAIL = {
  program: { key: 'perks', group: 'Rewards', name: 'Perks', purpose: 'Partner discounts for members.', who: 'Founders', join_method: 'Open', status: 'live', position: 3, updated_at: '2026-11-07T10:00:00Z', studio_only: null, member_access: 'open', modules: ['perk_queue'] },
  playbook: { published: true, version: 1, published_at: '2026-10-01 10:00:00', sections: [{ key: 'purpose', title: 'Purpose', body: 'Partner discounts for members.', computed: false, template_keys: [] }] },
  draft: null,
  grant: { state: 'granted_to', granted_count: 3 }, grantable: true, approved_proposal: null, capabilities: [],
};
const listing = (uid, status) => ({ uid, status, offer: `Offer ${uid}`, partner_name: `Partner ${uid}`, kind: 'credits', credits: 200, required_tier: null, price_cents: null, review_note: null, featured: 0, editorial_note: null, created_at: d1(NOW - 50 * 3_600_000), updated_at: d1(NOW - 30 * 3_600_000) });
const CLAIMS = { from: '2026-08-03', by_listing: [{ uid: 'p2', offer: 'Offer p2', partner_name: 'Partner p2', claims: 4, redeemed: 3 }], by_week: [{ week: '2026-10-19', kind_at_claim: 'credits', claims: 4, redeemed: 3 }], totals: {} };

function worker(user, o = {}) {
  const { detail = () => response(DETAIL), claims = () => response(CLAIMS), write = null } = o;
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return write ? write(path, method, options) : never();
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return response({ program: 'perks', rows: [], next_before: null, not_audited: null });
    if (path === '/api/admin/programs/perks') return detail();
    if (path === '/api/admin/programs/learning') return response({ ...DETAIL, program: { ...DETAIL.program, key: 'learning', name: 'Learning', modules: ['learners'] } });
    if (path === '/api/perks/admin/listings') return response({ items: [listing('p1', 'in_review'), listing('p3', 'in_review')], total: 2 });
    if (path === '/api/perks/admin/claims') return claims();
    if (path === '/api/perks') return response({ items: [{ uid: 'live1' }] });
    return never();
  };
}

/** The routes as the app has them: Perks' four literal lines (as `App.jsx` writes them), this task's module, and `:key`. */
const APP_PERKS = ['/admin/programs/perks', '/admin/programs/perks/how-it-runs', '/admin/programs/perks/queue', '/admin/programs/perks/activity'];
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  ...APP_PERKS.map((p) => h(Route, { key: p, path: p, element: h(ProgramPage) })),
  adminProgramsPerksRoutes({ guard: (_roles, element) => element }),
  adminProgramsGenericRoutes({ guard: (_roles, element) => element })));

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
  const flush = () => act(async () => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 5)); });
  for (let waited = 0; !container.childNodes?.length && waited < 5000; waited += 25) {
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, at, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model and the wiring
 * ------------------------------------------------------------------ */

const TABS = PAGES.perks.tabs;
/** Each tab and the section it opens. */
const SECTION = {
  overview: 'programs-perks-overview', how: 'programs-perks-how', availability: 'programs-generic-availability',
  participation: 'programs-perks-participation', queue: 'programs-perks-queue', activity: 'programs-perks-activity', settings: 'programs-generic-settings',
};

test('the strip is the shell\'s: the six core sections in PG03\'s order and words, and the Perk queue module at its MODULE_PATHS address', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Overview', 'Playbook', 'Availability & grants', 'Participation', 'Perk queue', 'History', 'Settings']);
  // The core six are the generic shell's own, address for address and word for word.
  const core = genericTabs('perks').map(({ label, path }) => ({ label, path }));
  assert.deepEqual(TABS.filter((t) => !t.module).map(({ label, path }) => ({ label, path })), core);
  // The module tab is where the registry's `perk_queue` module says its screen runs.
  const [mod] = moduleRows('perks', { modules: ['perk_queue'] }).rows;
  assert.deepEqual(TABS.filter((t) => t.module).map(({ module, label, path }) => ({ key: module, label, path })), [mod]);
  // Every address Perks had keeps its path.
  for (const p of APP_PERKS) assert.ok(TABS.some((t) => t.path === p), p);
  for (const t of TABS) {
    assert.deepEqual(routeFor(t.path), { program: 'perks', tab: t.key }, t.path);
    assert.deepEqual(routeFor(`${t.path}/`), { program: 'perks', tab: t.key }, `${t.path}/`);
  }
});

test('every Perks address is a literal route onto ProgramPage under the admin guard, never hqOnly; the old four stay in App.jsx', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of APP_PERKS) assert.ok(app.includes(`\n      <Route path="${p}" element={guard(['admin'], <AdminProgramPage />)} />`), p);
  const routes = readRoutesSource(root);
  for (const t of TABS) assert.ok(routes.includes(`<Route path="${t.path}" element={guard(['admin'], <AdminProgramPage />)} />`), t.path);
  const mod = read('frontend/src/routes/adminProgramsPerks.jsx');
  assert.match(mod, /const AdminProgramPage = lazy\(\(\) => import\('\.\.\/pages\/admin\/programs\/ProgramPage'\)\);/);
  assert.doesNotMatch(mod, /hqOnly\(/);
});

test('the model: modules from the page\'s own read; Participation\'s members are Not recorded, never 0, whatever the claims say', () => {
  assert.equal(shellModules('perks', { status: 'loading' }).state, 'loading');
  assert.equal(shellModules('perks', { status: 'error', error: {} }).state, 'unreadable', 'a failed read is not "none"');
  assert.deepEqual(shellModules('perks', { status: 'ready', data: DETAIL }).rows.map((r) => r.key), ['perk_queue']);
  assert.equal(shellModules('perks', { status: 'ready', data: {} }).state, 'pending');

  const [claims, members] = perkParticipationTiles({ status: 'ready', data: CLAIMS });
  assert.deepEqual([claims.state, claims.value], ['ready', '4 · 3 redeemed']);
  assert.deepEqual([members.state, members.word, members.reason], ['placeholder', 'Not recorded', PERK_MEMBERS_UNRECORDED]);
  const none = perkParticipationTiles({ status: 'ready', data: { by_listing: [], by_week: [] } });
  assert.equal(none[0].value, '0 · 0 redeemed', 'zero claims is a measured zero');
  assert.equal(none[1].word, 'Not recorded', 'members are still not recorded');
  const failed = perkParticipationTiles({ status: 'error', error: {} });
  assert.equal(failed[0].state, 'unreadable');
  assert.equal(failed[1].word, 'Not recorded');
});

/* ------------------------------------------------------------------ *
 * Mounted on the route table
 * ------------------------------------------------------------------ */

test('each Perks address opens the shell with its own section and its own tab lit; old addresses and deep links still resolve', async () => {
  const cases = [
    ...TABS.map((t) => [t.path, t.key]),
    ['/admin/programs/perks/queue?status=in_review#rows', 'queue'],
    ['/admin/programs/perks/queue/', 'queue'],
    ['/admin/programs/perks/how-it-runs#purpose', 'how'],
    ['/admin/programs/perks/settings?x=1', 'settings'],
  ];
  for (const [url, key] of cases) {
    const view = await mounted(url, worker(SUPER), SUPER);
    try {
      assert.ok(view.has('programs-page-perks'), `${url}: the Perks page`);
      assert.ok(view.has('admin-board-program') && !view.has('admin-board-program-generic'), `${url}: ProgramPage, not the registry-backed page`);
      assert.ok(view.has(SECTION[key]), `${url}: ${SECTION[key]}`);
      for (const other of Object.keys(SECTION).filter((k) => k !== key)) assert.ok(!view.has(SECTION[other]), `${url}: not ${other}`);
      for (const t of TABS) assert.equal(view.props(`programs-tab-${t.key}`)['aria-current'], t.key === key ? 'page' : undefined, `${url}: tab ${t.key}`);
      // The strip draws the shell's words (the module tab adds its count).
      for (const t of TABS) assert.ok(view.textOf(`programs-tab-${t.key}`).startsWith(t.label), `${url}: tab ${t.key} reads ${t.label}`);
      assert.equal(view.at.path, url, `${url}: no redirect`);
    } finally { await view.close(); }
  }
});

test('Overview keeps Perks\' screen and adds the shell\'s Capability modules; the module tab carries the count waiting for review', async () => {
  const view = await mounted('/admin/programs/perks', worker(ADMIN), ADMIN);
  try {
    assert.equal(view.textOf('programs-tile-waiting-value'), '2');
    assert.equal(view.textOf('programs-tile-claims-value'), '4 · 3 redeemed');
    assert.ok(view.has('programs-generic-module-perk_queue'));
    assert.equal(view.textOf('programs-tab-queue'), 'Perk queue2, Listings in review');
    assert.match(view.props('programs-tab-queue-count').className, /amber/);
    assert.equal(view.props('programs-perks-review').href, '/admin/programs/perks/queue', 'the header names the queue, as PG03a does');
  } finally { await view.close(); }
  // The header's status is the registry's, as on the shell, not the frontend constant's ("Live").
  const paused = await mounted('/admin/programs/perks', worker(ADMIN, { detail: () => response({ ...DETAIL, program: { ...DETAIL.program, status: 'paused' } }) }), ADMIN);
  try { assert.match(paused.textOf('programs-header-status'), /Paused$/); } finally { await paused.close(); }
  const queue = await mounted('/admin/programs/perks/queue', worker(ADMIN), ADMIN);
  try { assert.ok(!queue.has('programs-perks-review'), 'no door to the page already open'); } finally { await queue.close(); }
});

test('Participation: claims are counted in their window; the members behind them read Not recorded, never 0', async () => {
  const view = await mounted('/admin/programs/perks/participation', worker(ADMIN), ADMIN);
  try {
    assert.equal(view.textOf('programs-tile-participation-claims-value'), '4 · 3 redeemed');
    assert.match(view.textOf('programs-tile-participation-claims'), /The last 12 weeks/);
    assert.match(view.textOf('programs-tile-participation-members'), /^Members taking partNot recorded/);
    assert.doesNotMatch(view.textOf('programs-tile-participation-members'), /\b0\b/);
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/perks/admin/claims')), 'Participation reads the claims');
    assert.ok(!view.has('programs-generic-participation'), 'not the generic "no store" section: Perks records its claims');
  } finally { await view.close(); }
  const down = await mounted('/admin/programs/perks/participation', worker(ADMIN, { claims: () => response({ error: 'down' }, 503) }), ADMIN);
  try {
    assert.match(down.textOf('programs-tile-participation-claims'), /Could not be read/);
    assert.match(down.textOf('programs-tile-participation-members'), /^Members taking partNot recorded/);
  } finally { await down.close(); }
});

test('Settings and Availability are the shell\'s: HQ sets member access on perks; a failed registry read marks only those sections', async () => {
  const writes = [];
  const write = (path, method, options) => { writes.push({ path, method, body: JSON.parse(options.body) }); return response({ program: { ...DETAIL.program, member_access: 'request' } }); };
  const hq = await mounted('/admin/programs/perks/settings', worker(SUPER, { write }), SUPER);
  try {
    assert.equal(hq.props('programs-generic-access').value, 'open');
    await hq.change('programs-generic-access', 'request');
    await hq.click('programs-generic-access-save');
    assert.deepEqual(writes, [{ path: '/api/admin/programs/perks', method: 'PATCH', body: { member_access: 'request' } }]);
  } finally { await hq.close(); }
  const avail = await mounted('/admin/programs/perks/availability', worker(ADMIN), ADMIN);
  try {
    assert.match(avail.textOf('programs-generic-availability'), /can be offered to studios/);
    assert.ok(avail.has('programs-generic-manage-grants'));
  } finally { await avail.close(); }

  const down = () => response({ error: 'down' }, 503);
  for (const url of ['/admin/programs/perks/settings', '/admin/programs/perks/availability']) {
    const view = await mounted(url, worker(SUPER, { detail: down }), SUPER);
    try {
      assert.ok(view.has('programs-page-perks'), `${url}: the page still draws`);
      assert.ok(view.has('programs-shell-registry-failed'), `${url}: says the program could not be read`);
      assert.ok(!view.has('programs-generic-access') && !view.has('programs-generic-availability'), `${url}: draws nothing from a read that failed`);
    } finally { await view.close(); }
  }
  const overview = await mounted('/admin/programs/perks', worker(ADMIN, { detail: down }), ADMIN);
  try {
    assert.equal(overview.textOf('programs-tile-waiting-value'), '2', 'Perks\' own reads still draw');
    assert.match(overview.textOf('programs-generic-modules'), /Could not be read/, 'never "None yet"');
    assert.ok(!overview.has('programs-generic-modules-none'));
  } finally { await overview.close(); }
});

test('only Perks moved: another built-in program\'s new sections still open the registry-backed page', async () => {
  const view = await mounted('/admin/programs/learning/settings', worker(ADMIN), ADMIN);
  try {
    assert.ok(view.has('admin-board-program-generic'));
    assert.ok(view.has('programs-generic-settings'));
    assert.ok(!view.has('programs-page-perks'));
  } finally { await view.close(); }
});
