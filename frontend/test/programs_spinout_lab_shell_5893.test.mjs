/**
 * D5893 (#5893) — Spin-Out Lab in the generic program shell (PG03a), the eighth built-in program to move (D5313).
 *
 * What is pinned:
 *   · the strip: the shell's six core sections in PG03's order and words, Applications, Cohorts and Hosts as module
 *     tabs at MODULE_PATHS['spinout-lab'], and the Lab's own Participants, Formation and Graduation before History;
 *   · every Lab address (the thirteen in `App.jsx` and the two this task adds in a route module) opens the one
 *     AdminLab with only its tab lit, deep links (`/applications/:id`, `/cohorts/:ym`, `/participants/:uid`, a query,
 *     a hash, a trailing slash) included, and the registry-backed `:key` page still serves the other programs;
 *   · Participation is the Lab's own records, and a count a read did not carry is "Not recorded", never 0;
 *   · Settings keeps its sections and gains the shell's member-access editor;
 *   · a failed registry read marks only the shell's sections; the Lab's own reads still draw.
 * Every name and id is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_spinout_lab_shell_5893.test.mjs
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
import adminProgramsSpinoutLabRoutes from '../src/routes/adminProgramsSpinoutLab.jsx';
// Loaded first, so a route's first mount does not wait on a cold import (as programs_perks_shell_5313 does).
import AdminLab from '../src/pages/admin/lab/AdminLab.jsx';
import '../src/pages/admin/programs/GenericProgramPage.jsx';
import { COHORT_COUNT_UNRECORDED, LAB_PATH, PARTICIPANTS_UNREAD, TABS, labParticipation, tabOf } from '../src/pages/admin/lab/labModel.js';
import { genericTabs, moduleRows } from '../src/pages/admin/programs/genericProgramModel.js';

const h = React.createElement;
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});

const DETAIL = {
  program: { key: 'spinout-lab', group: 'Ventures', name: 'Spin-Out Lab', purpose: 'Idea to company in 28 days.', who: 'Founders', join_method: 'By application', status: 'paused', position: 1, updated_at: '2026-11-07T10:00:00Z', studio_only: null, member_access: 'apply', modules: ['applications', 'cohorts', 'hosts'] },
  playbook: { published: true, version: 1, published_at: '2026-10-01 10:00:00', sections: [] }, draft: null,
  grant: { state: 'granted_to', granted_count: 2 }, grantable: true, approved_proposal: null, capabilities: [],
};
const STANDING = { everyone: 31, on_track: 14, at_risk: 3, grace: 2, failed: 1, graduated: 6, not_in_cohort: 3, needs_decision: 6, not_read: 2 };
const TIMELINE = { cycles: [
  { id: 7, year: 2026, month: 11, status: 'active', start_at: '2026-11-01 04:00:00', end_at: '2026-11-29 05:00:00', windows: [], participant_count: 19 },
  { id: 6, year: 2026, month: 10, status: 'completed', start_at: '2026-10-01 04:00:00', end_at: '2026-10-29 04:00:00', windows: [], participant_count: null },
], server_time: '2026-11-14T12:00:00.000Z' };

function worker(user, o = {}) {
  const { detail = () => response(DETAIL), people = () => response({ available: true, items: [], total: 0, standing: STANDING }), timeline = () => response(TIMELINE), write = null } = o;
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return write ? write(path, method, options) : never();
    if (path === '/api/admin/programs/spinout-lab') return detail();
    if (path === '/api/admin/programs/learning') return response({ ...DETAIL, program: { ...DETAIL.program, key: 'learning', name: 'Learning', modules: ['learners'] } });
    if (path === '/api/admin/cohort/participants') return people();
    if (path === '/api/admin/cohort/timeline') return timeline();
    if (path === '/api/admin/cohort/settings') return response({ settings: { min: 3, max: 25 } });
    if (path === '/api/admin/lab-hosts') return response({ items: [], counts: { pending: 4 } });
    if (path === '/api/admin/studio/glance') return response({ tier: 'hq', approvals: { lanes: [{ key: 'cohort', count: 5 }] } });
    return never();
  };
}

/** The routes as the app has them: the Lab's thirteen literal lines (as `App.jsx` writes them), this task's module, and `:key`. */
const APP_LAB = ['', '/applications', '/applications/:id', '/cohorts', '/cohorts/:ym', '/participants', '/participants/:uid', '/hosts', '/formation', '/graduation', '/how-it-runs', '/settings', '/activity'].map((p) => `${LAB_PATH}${p}`);
const impersonate = () => {};
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  ...APP_LAB.map((p) => h(Route, { key: p, path: p, element: h(AdminLab, { onImpersonate: impersonate }) })),
  adminProgramsSpinoutLabRoutes({ guard: (_roles, element) => element }),
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
  const lit = () => nodes().filter((n) => /^lab-tab-/.test(props(n)['data-testid'] || '') && props(n)['aria-current'] === 'page').map((n) => props(n)['data-testid']);
  return {
    requests, at, lit, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The strip and the wiring
 * ------------------------------------------------------------------ */

test('the strip is the shell\'s six core sections in PG03\'s order and words, the three modules at MODULE_PATHS, and the Lab\'s own three before History', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Overview', 'Playbook', 'Availability & grants', 'Participation', 'Applications', 'Cohorts', 'Hosts', 'Participants', 'Formation', 'Graduation', 'History', 'Settings']);
  const core = genericTabs('spinout-lab').map(({ label, path }) => ({ label, path }));
  const own = new Set(['participants', 'formation', 'graduation']);
  assert.deepEqual(TABS.filter((t) => !t.module && !own.has(t.key)).map(({ label, path }) => ({ label, path: `${LAB_PATH}${path}` })), core);
  const mods = moduleRows('spinout-lab', { modules: ['applications', 'cohorts', 'hosts'] }).rows;
  assert.deepEqual(TABS.filter((t) => t.module).map(({ module, label, path }) => ({ key: module, label, path: `${LAB_PATH}${path}` })), mods);
  // The Lab's own tabs carry no module: no registry key names them.
  assert.ok(TABS.filter((t) => own.has(t.key)).every((t) => !t.module));
  for (const t of TABS) {
    assert.equal(tabOf(`${LAB_PATH}${t.path}`), t.key, t.path);
    assert.equal(tabOf(`${LAB_PATH}${t.path}/`), t.key, `${t.path}/`);
  }
  // The header's literal doors are the same tabs, in the same order and words.
  const src = read('frontend/src/pages/admin/lab/AdminLab.jsx');
  const doors = [...src.matchAll(/<HeaderTab to="([^"]+)"[^>]*>([^<]+)<\/HeaderTab>/g)].map((m) => ({ path: m[1], label: m[2].replace('&amp;', '&') }));
  assert.deepEqual(doors, TABS.map((t) => ({ path: `${LAB_PATH}${t.path}`, label: t.label })));
});

test('every Lab address is a literal route onto AdminLab under the admin guard, never hqOnly; the thirteen stay in App.jsx with onImpersonate', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of APP_LAB) assert.ok(app.includes(`\n      <Route path="${p}" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />`), p);
  const routes = readRoutesSource(root);
  for (const p of ['availability', 'participation']) assert.ok(routes.includes(`<Route path="${LAB_PATH}/${p}" element={guard(['admin'], <AdminLab />)} />`), p);
  const mod = read('frontend/src/routes/adminProgramsSpinoutLab.jsx');
  assert.match(mod, /const AdminLab = lazy\(\(\) => import\('\.\.\/pages\/admin\/lab\/AdminLab'\)\);/);
  assert.doesNotMatch(mod, /hqOnly\(/);
  assert.equal((mod.match(/<Route /g) || []).length, 2, 'Settings stays the Lab\'s own App.jsx line');
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('Participation is the Lab\'s own records: everyone and this week\'s standing, by cohort, and "Not recorded" for a count a read did not carry', () => {
  const ready = labParticipation({ status: 'ready', data: { standing: STANDING } }, { status: 'ready', data: TIMELINE });
  assert.equal(ready.founders.state, 'ready');
  assert.equal(ready.founders.value, '31');
  assert.deepEqual(ready.founders.rows.map((r) => [r.key, r.value]), [['on_track', '14'], ['at_risk', '3'], ['grace', '2'], ['failed', '1'], ['graduated', '6'], ['not_in_cohort', '3']]);
  assert.match(ready.founders.notRead, /2 founders’ weeks could not be read/);
  assert.deepEqual(ready.cohorts.rows.map((r) => [r.key, r.label, r.value, r.unrecorded]), [['2026-11', 'Nov 2026', '19', null], ['2026-10', 'Oct 2026', null, COHORT_COUNT_UNRECORDED]]);
  // A standing key the read did not carry is null (drawn "Not recorded"), never 0.
  const thin = labParticipation({ status: 'ready', data: { standing: { everyone: 4 } } }, { status: 'loading' });
  assert.ok(thin.founders.rows.every((r) => r.value === null));
  assert.equal(thin.founders.notRead, null);
  assert.equal(thin.cohorts.state, 'loading');
  // A failed read, or one with no standing, is unreadable with its reason; each part answers alone.
  const failed = labParticipation({ status: 'error', data: null }, { status: 'ready', data: TIMELINE });
  assert.deepEqual(failed.founders, { state: 'unreadable', reason: PARTICIPANTS_UNREAD });
  assert.equal(failed.cohorts.state, 'ready');
  assert.equal(labParticipation({ status: 'ready', data: {} }, null).founders.state, 'unreadable');
  assert.equal(labParticipation({ status: 'ready', data: { standing: STANDING, unreadable: { weeks: true } } }, null).founders.partial !== null, true);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const SECTION = {
  overview: 'lab-overview', 'how-it-runs': null, availability: 'programs-generic-availability', participation: 'lab-participation',
  applications: null, cohorts: null, hosts: null, participants: null, formation: null, graduation: null, activity: null, settings: 'lab-settings',
};

test('each of the fifteen addresses and the deep links opens the Lab with only its own tab lit, and no redirect', async () => {
  const cases = [
    ...TABS.map((t) => [`${LAB_PATH}${t.path}`, t.key]),
    [`${LAB_PATH}/applications/42`, 'applications'], [`${LAB_PATH}/cohorts/2026-11`, 'cohorts'], [`${LAB_PATH}/participants/u-7`, 'participants'],
    [`${LAB_PATH}/participation?from=mail#top`, 'participation'], [`${LAB_PATH}/availability/`, 'availability'],
  ];
  for (const [url, key] of cases) {
    const m = await mounted(url, worker(ADMIN), ADMIN);
    try {
      assert.ok(m.has('admin-lab'), `${url} draws the Lab`);
      assert.ok(!m.has('programs-generic-page'), `${url} is not the registry-backed page`);
      // NavLink's `end` does not light a tab on a trailing slash (HeaderTab, every admin page); no other tab is lit then.
      if (url.endsWith('/')) assert.ok(m.lit().every((id) => id === `lab-tab-${key}`), `${url} lights no other tab`);
      else assert.deepEqual(m.lit(), [`lab-tab-${key}`], `${url} lights only ${key}`);
      if (SECTION[key]) assert.ok(m.has(SECTION[key]), `${url} draws ${SECTION[key]}`);
      assert.equal(m.at.path, url, 'no redirect');
    } finally { await m.close(); }
  }
});

test('Overview adds Capability modules from the registry read; the header\'s status is the registry\'s', async () => {
  const m = await mounted(LAB_PATH, worker(ADMIN), ADMIN);
  try {
    assert.ok(m.has('lab-overview'));
    assert.ok(m.has('programs-generic-module-applications'));
    assert.ok(m.has('programs-generic-module-cohorts'));
    assert.ok(m.has('programs-generic-module-hosts'));
    assert.equal(m.textOf('lab-status'), 'Paused', 'the registry says paused, so the header does not say Live');
  } finally { await m.close(); }
});

test('a failed registry read marks only the shell\'s sections; the Lab\'s own reads still draw', async () => {
  const down = { detail: () => response({ detail: 'down' }, 503) };
  const o = await mounted(LAB_PATH, worker(ADMIN, down), ADMIN);
  try {
    assert.match(o.textOf('programs-generic-modules'), /Could not be read/);
    assert.ok(!o.has('lab-status'), 'no status is said when none was read');
    assert.ok(o.has('lab-overview'), 'the Lab\'s Overview still draws');
    assert.match(o.textOf('lab-tab-participants'), /31/, 'the header\'s own counts still read');
  } finally { await o.close(); }
  const a = await mounted(`${LAB_PATH}/availability`, worker(ADMIN, down), ADMIN);
  try {
    assert.ok(a.has('programs-shell-registry-failed'));
    assert.ok(!a.has('programs-generic-availability'));
  } finally { await a.close(); }
  const s = await mounted(`${LAB_PATH}/settings`, worker(SUPER, down), SUPER);
  try {
    assert.ok(s.has('programs-shell-registry-failed'), 'member access says it could not be read');
    assert.ok(!s.has('programs-generic-settings'));
    assert.equal(s.textOf('lab-size-min'), '3', 'the cohort size is its own read');
  } finally { await s.close(); }
});

test('Participation draws the Lab\'s figures, and a failed participants read costs only its own card', async () => {
  const m = await mounted(`${LAB_PATH}/participation`, worker(ADMIN), ADMIN);
  try {
    assert.equal(m.textOf('lab-participation-everyone'), '31');
    assert.equal(m.textOf('lab-participation-on_track'), '14');
    assert.match(m.textOf('lab-participation-not-read'), /2 founders’ weeks/);
    assert.equal(m.textOf('lab-participation-cohort-2026-11'), 'Nov 202619');
    assert.match(m.textOf('lab-participation-cohort-2026-10'), /Not recorded/);
    assert.doesNotMatch(m.textOf('lab-participation-cohort-2026-10'), /\b0\b/);
    assert.ok(!m.has('programs-generic-participation'), 'not the shell\'s "no store" line: the Lab records participants');
    assert.ok(m.requests.some((r) => r.url.startsWith('/api/admin/cohort/timeline')));
  } finally { await m.close(); }
  const f = await mounted(`${LAB_PATH}/participation`, worker(ADMIN, { people: () => response({ error: 'lab_participants_unreadable' }, 503) }), ADMIN);
  try {
    assert.ok(f.has('lab-participation-founders-unreadable'));
    assert.ok(!f.has('lab-participation-everyone'));
    assert.equal(f.textOf('lab-participation-cohort-2026-11'), 'Nov 202619', 'the calendar is its own read');
  } finally { await f.close(); }
});

test('Settings keeps its sections and gains the member-access editor: a Super Admin saves on spinout-lab, an Admin reads it', async () => {
  const writes = [];
  const write = (path, method, options) => { writes.push({ path, method, body: JSON.parse(options.body) }); return response({ program: { ...DETAIL.program, member_access: 'invite' } }); };
  const m = await mounted(`${LAB_PATH}/settings`, worker(SUPER, { write }), SUPER);
  try {
    assert.ok(m.has('lab-settings'));
    assert.equal(m.textOf('lab-size-min'), '3', 'the cohort size is still drawn');
    assert.ok(m.has('lab-grant-terms'), 'the grant terms are still drawn');
    assert.ok(m.has('lab-member-access'));
    await m.change('programs-generic-access', 'invite');
    await m.click('programs-generic-access-save');
    assert.deepEqual(writes, [{ path: '/api/admin/programs/spinout-lab', method: 'PATCH', body: { member_access: 'invite' } }]);
  } finally { await m.close(); }
  const a = await mounted(`${LAB_PATH}/settings`, worker(ADMIN), ADMIN);
  try {
    assert.ok(!a.has('programs-generic-access'), 'an Admin has no editor');
    assert.match(a.textOf('programs-generic-access-value'), /\w/);
  } finally { await a.close(); }
});

test('another program\'s /availability still opens the registry-backed page', async () => {
  const m = await mounted('/admin/programs/learning/availability', worker(ADMIN), ADMIN);
  try {
    assert.ok(!m.has('admin-lab'));
    assert.ok(m.has('programs-generic-availability'));
  } finally { await m.close(); }
});
