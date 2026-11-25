/**
 * D5887 (#5887) — Learning in the generic program shell (PG03a), the second of the nine built-in programs to move,
 * on the pattern D5313 set with Perks.
 *
 * What is pinned:
 *   · the shell's six core sections (Overview, Playbook, Availability & grants, Participation, History, Settings) in
 *     PG03's order and words, with the Learners module between Participation and History at MODULE_PATHS' `/people`;
 *   · every Learning address (the four D953 and D962 gave it, and the shell's three new ones) is a literal route onto
 *     the one ProgramPage, and each opens its own section with only its tab lit, a query, a hash or a trailing slash
 *     included;
 *   · Participation: active enrolments and enrolments in the window are recorded figures, the people behind them are
 *     "Not recorded", never 0;
 *   · a failed registry read marks only the sections that need it; Learning's own reads still draw.
 * Every name and id is made up. No real clock: fixed stamps, and the flush yields with setImmediate, never a sleep.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_learning_shell_5887.test.mjs
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
import adminProgramsLearningRoutes from '../src/routes/adminProgramsLearning.jsx';
// Loaded first, so a route's first mount does not wait on a cold import (as programs_perks_shell_5313 does).
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import '../src/pages/admin/programs/GenericProgramPage.jsx';
import { PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import { genericTabs, moduleRows, shellModules } from '../src/pages/admin/programs/genericProgramModel.js';
import { LEARNING_PEOPLE_UNRECORDED, learningParticipationTiles } from '../src/pages/admin/programs/programPagesModel.js';

const h = React.createElement;
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});

const DETAIL = {
  program: { key: 'learning', group: 'Learning', name: 'Learning', purpose: 'Courses for a region.', who: 'Founders', join_method: 'Open', status: 'live', position: 4, updated_at: '2026-11-07T10:00:00Z', studio_only: null, member_access: 'open', modules: ['learners'] },
  playbook: { published: true, version: 1, published_at: '2026-10-01 10:00:00', sections: [{ key: 'purpose', title: 'Purpose', body: 'Courses for a region.', computed: false, template_keys: [] }] },
  draft: null,
  grant: { state: 'granted_to', granted_count: 2 }, grantable: true, approved_proposal: null, capabilities: [],
};
// Two published programs (2 + 3 enrolments) and a draft whose 9 enrolments are not counted.
const PROGRAMS = { programs: [
  { uid: 'l1', name: 'Founder basics', region: 'Lisbon', status: 'published', enrolment: 'open', learners: 2, contents: 2, admins: 1 },
  { uid: 'l2', name: 'Pitch clinic', region: 'Porto', status: 'published', enrolment: 'invite', learners: 3, contents: 4, admins: 2 },
  { uid: 'l3', name: 'Draft course', region: null, status: 'draft', enrolment: 'open', learners: 9, contents: 1, admins: 0 },
] };
const WEEKLY = { weeks: 12, by_week: [{ week: '2026-10-19', count: 4, to_date: false }, { week: '2026-10-26', count: 3, to_date: true }], total: 7, programs: [] };
const COMPLETION = { programs: [{ uid: 'l1', learners: 2, finished: 1 }, { uid: 'l2', learners: 3, finished: 0 }], unreadable: [], capped: false, max: 50 };
const LEARNERS = { learners: [{ uid: 'u1', name: 'Lea Learner', enrolled_at: '2026-10-02 09:00:00', completion: [] }], total: 1 };

function worker(user, o = {}) {
  const { detail = () => response(DETAIL), learning = () => response(PROGRAMS), weekly = () => response(WEEKLY), write = null } = o;
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return write ? write(path, method, options) : never();
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return response({ program: 'learning', rows: [], next_before: null, not_audited: null });
    if (path === '/api/admin/programs/learning') return detail();
    // Referral partners has not moved: it stands for the programs whose new sections are still the registry-backed page.
    if (path === '/api/admin/programs/referral-partners') return response({ ...DETAIL, program: { ...DETAIL.program, key: 'referral-partners', name: 'Referral partners', modules: ['referral_queue'] } });
    if (path === '/api/learning/programs/mine') return learning();
    if (path === '/api/learning/programs/mine/enrolments') return weekly();
    if (path === '/api/learning/programs/mine/completion') return response(COMPLETION);
    if (/^\/api\/learning\/programs\/[^/]+\/learners$/.test(path)) return response(LEARNERS);
    return never();
  };
}

/** The routes as the app has them: Learning's four literal lines (as `App.jsx` writes them), the shell modules, and `:key`. */
const APP_LEARNING = ['/admin/programs/learning', '/admin/programs/learning/how-it-runs', '/admin/programs/learning/people', '/admin/programs/learning/activity'];
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  ...APP_LEARNING.map((p) => h(Route, { key: p, path: p, element: h(ProgramPage) })),
  adminProgramsPerksRoutes({ guard: (_roles, element) => element }),
  adminProgramsLearningRoutes({ guard: (_roles, element) => element }),
  adminProgramsGenericRoutes({ guard: (_roles, element) => element })));

/** Yields to the event loop `n` times: every mocked read answers at once, so this settles the page with no clock. */
const turns = async (n) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

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
  const flush = () => act(async () => { await turns(60); });
  for (let i = 0; !container.childNodes?.length && i < 200; i += 1) await act(async () => { await turns(5); });
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

const TABS = PAGES.learning.tabs;
/** Each tab and the section it opens. */
const SECTION = {
  overview: 'programs-learning-overview', how: 'programs-learning-how', availability: 'programs-generic-availability',
  participation: 'programs-learning-participation', people: 'programs-learning-people', activity: 'programs-learning-activity', settings: 'programs-generic-settings',
};

test('the strip is the shell\'s: the six core sections in PG03\'s order and words, and the Learners module at its MODULE_PATHS address', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Overview', 'Playbook', 'Availability & grants', 'Participation', 'Learners', 'History', 'Settings']);
  // The core six are the generic shell's own, address for address and word for word.
  const core = genericTabs('learning').map(({ label, path }) => ({ label, path }));
  assert.deepEqual(TABS.filter((t) => !t.module).map(({ label, path }) => ({ label, path })), core);
  // The module tab is where the registry's `learners` module says its screen runs.
  const [mod] = moduleRows('learning', { modules: ['learners'] }).rows;
  assert.deepEqual(TABS.filter((t) => t.module).map(({ module, label, path }) => ({ key: module, label, path })), [mod]);
  // Every address Learning had keeps its path.
  for (const p of APP_LEARNING) assert.ok(TABS.some((t) => t.path === p), p);
  for (const t of TABS) {
    assert.deepEqual(routeFor(t.path), { program: 'learning', tab: t.key }, t.path);
    assert.deepEqual(routeFor(`${t.path}/`), { program: 'learning', tab: t.key }, `${t.path}/`);
  }
  // The strip in ProgramTabs.jsx writes the same tabs, in the same order, as literal doors.
  const strip = /export function LearningTabs\(\) \{[\s\S]*?<\/Strip>/.exec(read('frontend/src/pages/admin/programs/ProgramTabs.jsx'))[0];
  const doors = [...strip.matchAll(/<Tab to="([^"]+)"[^>]*testId="programs-tab-([a-z]+)">([^<]+)<\/Tab>/g)].map(([, to, key, label]) => ({ to, key, label: label.replace('&amp;', '&') }));
  assert.deepEqual(doors, TABS.map((t) => ({ to: t.path, key: t.key, label: t.label })));
});

test('every Learning address is a literal route onto ProgramPage under the admin guard, never hqOnly; the old four stay in App.jsx', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of APP_LEARNING) assert.ok(app.includes(`\n      <Route path="${p}" element={guard(['admin'], <AdminProgramPage />)} />`), p);
  const routes = readRoutesSource(root);
  for (const t of TABS) assert.ok(routes.includes(`<Route path="${t.path}" element={guard(['admin'], <AdminProgramPage />)} />`), t.path);
  const mod = read('frontend/src/routes/adminProgramsLearning.jsx');
  assert.match(mod, /const AdminProgramPage = lazy\(\(\) => import\('\.\.\/pages\/admin\/programs\/ProgramPage'\)\);/);
  assert.doesNotMatch(mod, /hqOnly\(/);
});

test('the model: modules from the page\'s own read; Participation\'s people are Not recorded, never 0, whatever the enrolments say', () => {
  assert.equal(shellModules('learning', { status: 'error', error: {} }).state, 'unreadable', 'a failed read is not "none"');
  assert.deepEqual(shellModules('learning', { status: 'ready', data: DETAIL }).rows.map((r) => [r.key, r.path]), [['learners', '/admin/programs/learning/people']]);

  const [enrolments, enrolled, people] = learningParticipationTiles({ status: 'ready', data: PROGRAMS }, { status: 'ready', data: WEEKLY });
  assert.deepEqual([enrolments.state, enrolments.value], ['ready', '5'], 'published programs only: the draft\'s 9 are not counted');
  assert.match(enrolments.sub, /A person in two programs is two enrolments/);
  assert.deepEqual([enrolled.state, enrolled.value], ['ready', '7']);
  assert.match(enrolled.sub, /The last 12 weeks/);
  assert.deepEqual([people.state, people.word, people.reason], ['placeholder', 'Not recorded', LEARNING_PEOPLE_UNRECORDED]);
  const none = learningParticipationTiles({ status: 'ready', data: { programs: [] } }, { status: 'ready', data: { weeks: 12, by_week: [], total: 0 } });
  assert.deepEqual([none[0].value, none[1].value], ['0', '0'], 'no enrolment is a measured zero');
  assert.equal(none[2].word, 'Not recorded', 'people are still not recorded');
  const failed = learningParticipationTiles({ status: 'error', error: {} }, { status: 'error', error: {} });
  assert.deepEqual(failed.map((t) => t.state), ['unreadable', 'unreadable', 'placeholder']);
  assert.ok(failed.every((t) => t.value === undefined), 'a failed read draws no figure, never 0');
});

/* ------------------------------------------------------------------ *
 * Mounted on the route table
 * ------------------------------------------------------------------ */

test('each Learning address opens the shell with its own section and only its tab lit; old addresses and deep links still resolve', async () => {
  const cases = [
    ...TABS.map((t) => [t.path, t.key]),
    ['/admin/programs/learning/people?program=l1#learners', 'people'],
    ['/admin/programs/learning/people/', 'people'],
    ['/admin/programs/learning/how-it-runs#purpose', 'how'],
    ['/admin/programs/learning/activity/', 'activity'],
    ['/admin/programs/learning/settings?x=1', 'settings'],
  ];
  for (const [url, key] of cases) {
    const view = await mounted(url, worker(SUPER), SUPER);
    try {
      assert.ok(view.has('programs-page-learning'), `${url}: the Learning page`);
      assert.ok(view.has('admin-board-program') && !view.has('admin-board-program-generic'), `${url}: ProgramPage, not the registry-backed page`);
      assert.ok(view.has(SECTION[key]), `${url}: ${SECTION[key]}`);
      for (const other of Object.keys(SECTION).filter((k) => k !== key)) assert.ok(!view.has(SECTION[other]), `${url}: not ${other}`);
      for (const t of TABS) assert.equal(view.props(`programs-tab-${t.key}`)['aria-current'], t.key === key ? 'page' : undefined, `${url}: tab ${t.key}`);
      for (const t of TABS) assert.equal(view.textOf(`programs-tab-${t.key}`), t.label, `${url}: tab ${t.key} reads ${t.label}`);
      assert.equal(view.at.path, url, `${url}: no redirect`);
    } finally { await view.close(); }
  }
});

test('Overview keeps Learning\'s screen and adds the shell\'s Capability modules; the header\'s status is the registry\'s', async () => {
  const view = await mounted('/admin/programs/learning', worker(ADMIN), ADMIN);
  try {
    assert.equal(view.textOf('programs-tile-enrolments-value'), '5');
    assert.ok(view.has('programs-learning-row-l1'));
    assert.ok(view.has('programs-generic-module-learners'));
    assert.match(view.textOf('programs-header-status'), /Live$/);
  } finally { await view.close(); }
  const paused = await mounted('/admin/programs/learning', worker(ADMIN, { detail: () => response({ ...DETAIL, program: { ...DETAIL.program, status: 'paused' } }) }), ADMIN);
  try { assert.match(paused.textOf('programs-header-status'), /Paused$/); } finally { await paused.close(); }
});

test('Participation: enrolments are counted, each with its window; the people behind them read Not recorded, never 0', async () => {
  const view = await mounted('/admin/programs/learning/participation', worker(ADMIN), ADMIN);
  try {
    assert.equal(view.textOf('programs-tile-participation-enrolments-value'), '5');
    assert.equal(view.textOf('programs-tile-participation-enrolled-value'), '7');
    assert.match(view.textOf('programs-tile-participation-enrolled'), /The last 12 weeks/);
    assert.match(view.textOf('programs-tile-participation-people'), /^People taking partNot recorded/);
    assert.doesNotMatch(view.textOf('programs-tile-participation-people'), /\b0\b/);
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/learning/programs/mine/enrolments')), 'Participation reads the enrolments per week');
    assert.ok(!view.has('programs-generic-participation'), 'not the generic "no store" section: Learning records its enrolments');
  } finally { await view.close(); }
  const down = () => response({ error: 'down' }, 503);
  const failed = await mounted('/admin/programs/learning/participation', worker(ADMIN, { learning: down, weekly: down }), ADMIN);
  try {
    assert.match(failed.textOf('programs-tile-participation-enrolments'), /Could not be read/);
    assert.match(failed.textOf('programs-tile-participation-enrolled'), /Could not be read/);
    assert.ok(!failed.has('programs-tile-participation-enrolments-value'), 'no figure from a read that failed');
    assert.match(failed.textOf('programs-tile-participation-people'), /^People taking partNot recorded/);
  } finally { await failed.close(); }
});

test('Settings and Availability are the shell\'s: HQ sets member access on learning; a failed registry read marks only those sections', async () => {
  const writes = [];
  const write = (path, method, options) => { writes.push({ path, method, body: JSON.parse(options.body) }); return response({ program: { ...DETAIL.program, member_access: 'request' } }); };
  const hq = await mounted('/admin/programs/learning/settings', worker(SUPER, { write }), SUPER);
  try {
    assert.equal(hq.props('programs-generic-access').value, 'open');
    await hq.change('programs-generic-access', 'request');
    await hq.click('programs-generic-access-save');
    assert.deepEqual(writes, [{ path: '/api/admin/programs/learning', method: 'PATCH', body: { member_access: 'request' } }]);
  } finally { await hq.close(); }
  const avail = await mounted('/admin/programs/learning/availability', worker(ADMIN), ADMIN);
  try {
    assert.match(avail.textOf('programs-generic-availability'), /can be offered to studios/);
    assert.ok(!avail.has('programs-generic-manage-grants'));
    assert.ok(avail.has('studio-program-access'));
  } finally { await avail.close(); }
  const hqAvailability = await mounted('/admin/programs/learning/availability', worker(SUPER), SUPER);
  try {
    assert.ok(hqAvailability.has('programs-generic-manage-grants'));
    assert.ok(!hqAvailability.has('studio-program-access'));
  } finally { await hqAvailability.close(); }

  const down = () => response({ error: 'down' }, 503);
  for (const url of ['/admin/programs/learning/settings', '/admin/programs/learning/availability']) {
    const view = await mounted(url, worker(SUPER, { detail: down }), SUPER);
    try {
      assert.ok(view.has('programs-page-learning'), `${url}: the page still draws`);
      assert.ok(view.has('programs-shell-registry-failed'), `${url}: says the program could not be read`);
      assert.ok(!view.has('programs-generic-access') && !view.has('programs-generic-availability'), `${url}: draws nothing from a read that failed`);
    } finally { await view.close(); }
  }
  const overview = await mounted('/admin/programs/learning', worker(ADMIN, { detail: down }), ADMIN);
  try {
    assert.equal(overview.textOf('programs-tile-enrolments-value'), '5', 'Learning\'s own reads still draw');
    assert.match(overview.textOf('programs-generic-modules'), /Could not be read/, 'never "None yet"');
    assert.ok(!overview.has('programs-generic-modules-none'));
  } finally { await overview.close(); }
  const participation = await mounted('/admin/programs/learning/participation', worker(ADMIN, { detail: down }), ADMIN);
  try {
    assert.equal(participation.textOf('programs-tile-participation-enrolments-value'), '5', 'Participation reads Learning\'s own store, not the registry');
    assert.ok(!participation.has('programs-shell-registry-failed'));
  } finally { await participation.close(); }
});

test('a built-in program not yet moved: its new sections still open the registry-backed page', async () => {
  const view = await mounted('/admin/programs/referral-partners/settings', worker(ADMIN), ADMIN);
  try {
    assert.ok(view.has('admin-board-program-generic'));
    assert.ok(view.has('programs-generic-settings'));
    assert.ok(!view.has('programs-page-learning'));
  } finally { await view.close(); }
});
