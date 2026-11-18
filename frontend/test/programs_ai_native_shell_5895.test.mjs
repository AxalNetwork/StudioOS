/**
 * D5895 (#5895) — AI-native Venture in the generic program shell (PG03a), D5313's pattern.
 *
 * What is pinned:
 *   · the shell's six core sections (Overview, Playbook, Availability & grants, Participation, History, Settings) in
 *     PG03's order and words, with no module tab (MODULE_PATHS has no entry for it);
 *   · its address stays in App.jsx; the five new ones are literal routes onto the one ProgramPage, and each opens its
 *     own section with its tab lit, a query, a hash or a trailing slash included, never the registry-backed page;
 *   · the existing address still shows the tiles, the playbook editor and, for an Admin, the foot line, with the same
 *     test ids, and adds Capability modules: "None yet" on a good read, "Could not be read" on a failed one;
 *   · Participation is "Not recorded", never 0;
 *   · Availability and Settings mark only themselves on a failed registry read.
 * Every name and id is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_ai_native_shell_5895.test.mjs
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
import adminProgramsAiNativeRoutes from '../src/routes/adminProgramsAiNative.jsx';
// Loaded first, so a route's first mount does not wait on a cold import.
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import '../src/pages/admin/programs/GenericProgramPage.jsx';
import { AI_NATIVE_FOOT, PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import { NO_MODULES, PARTICIPATION_UNRECORDED, moduleRows } from '../src/pages/admin/programs/genericProgramModel.js';

const h = React.createElement;
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const BASE = '/admin/programs/ai-native-venture';

const DETAIL = {
  program: { key: 'ai-native-venture', group: 'Ventures', name: 'AI-native Venture', purpose: 'Founders build an AI-native company.', who: 'Founders', join_method: 'By application', status: 'proposed', position: 2, updated_at: '2026-11-07T10:00:00Z', studio_only: null, member_access: 'apply', modules: [] },
  playbook: { published: false, version: null, published_at: null, sections: [] },
  draft: { sections: [{ key: 'thesis', title: 'Thesis', body: null, computed: false, template_keys: [] }], edited_at: null, differs: false },
  grant: { state: 'not_granted', granted_count: 0 }, grantable: false, approved_proposal: null, capabilities: [],
};

function worker(user, o = {}) {
  const { detail = () => response(DETAIL), write = null } = o;
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return write ? write(path, method, options) : never();
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return response({ program: 'ai-native-venture', rows: [], next_before: null, not_audited: null });
    if (path === '/api/admin/programs/ai-native-venture') return detail();
    if (path === '/api/admin/programs/learning') return response({ ...DETAIL, program: { ...DETAIL.program, key: 'learning', name: 'Learning', modules: ['learners'] } });
    return never();
  };
}

/** The routes as the app has them: the one App.jsx line, this task's module, and the registry-backed `:key`. */
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  h(Route, { key: BASE, path: BASE, element: h(ProgramPage) }),
  adminProgramsAiNativeRoutes({ guard: (_roles, element) => element }),
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
  return {
    requests, at, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

const TABS = PAGES['ai-native-venture'].tabs;
/** Each tab and the one section only it draws. */
const SECTION = {
  overview: 'programs-ai-native-tiles', availability: 'programs-generic-availability', participation: 'programs-generic-participation',
  activity: 'programs-ai-native-activity', settings: 'programs-generic-settings',
};

test('the strip is the shell\'s six core sections in PG03\'s order and words, with no module tab', () => {
  assert.deepEqual(TABS.map((t) => [t.key, t.label, t.path]), [
    ['overview', 'Overview', BASE], ['how', 'Playbook', `${BASE}/how-it-runs`],
    ['availability', 'Availability & grants', `${BASE}/availability`], ['participation', 'Participation', `${BASE}/participation`],
    ['activity', 'History', `${BASE}/activity`], ['settings', 'Settings', `${BASE}/settings`],
  ]);
  assert.ok(TABS.every((t) => !t.module), 'no module tab');
  assert.deepEqual(moduleRows('ai-native-venture', { modules: [] }), { state: 'ready', rows: [] });
  // The strip's literal doors equal the model's.
  const strip = read('frontend/src/pages/admin/programs/ProgramTabs.jsx');
  const body = strip.slice(strip.indexOf('export function AiNativeTabs'));
  assert.deepEqual([...body.matchAll(/<Tab to="([^"]+)"[^>]*>([^<]+)<\/Tab>/g)].map((m) => [m[1], m[2].replace('&amp;', '&')]), TABS.map((t) => [t.path, t.label]));
  for (const t of TABS) {
    assert.deepEqual(routeFor(t.path), { program: 'ai-native-venture', tab: t.key });
    assert.deepEqual(routeFor(`${t.path}/`), { program: 'ai-native-venture', tab: t.key });
  }
});

test('every address is a literal route onto ProgramPage under the admin guard, never hqOnly; the old one stays in App.jsx', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`\n      <Route path="${BASE}" element={guard(['admin'], <AdminProgramPage />)} />`));
  const mod = read('frontend/src/routes/adminProgramsAiNative.jsx');
  const routes = readRoutesSource();
  for (const t of TABS.slice(1)) {
    assert.ok(mod.includes(`<Route path="${t.path}" element={guard(['admin'], <AdminProgramPage />)} />`), t.path);
    assert.ok(routes.includes(`path="${t.path}" element={guard(['admin'], <`), t.path);
  }
  assert.doesNotMatch(mod, /hqOnly\(/, 'no route is HQ-only');
});

test('each address opens the shell with its own section and its own tab lit; deep links resolve with no redirect', async () => {
  const cases = [
    ...TABS.map((t) => [t.path, t.key]),
    [`${BASE}?source=catalogue#top`, 'overview'],
    [`${BASE}/how-it-runs#thesis`, 'how'],
    [`${BASE}/settings/`, 'settings'],
    [`${BASE}/activity?x=1`, 'activity'],
  ];
  for (const [url, key] of cases) {
    const view = await mounted(url, worker(ADMIN), ADMIN);
    try {
      assert.ok(view.has('programs-page-ai-native-venture'), `${url}: the AI-native Venture page`);
      assert.ok(view.has('admin-board-program') && !view.has('admin-board-program-generic'), `${url}: ProgramPage, not the registry-backed page`);
      if (SECTION[key]) assert.ok(view.has(SECTION[key]), `${url}: ${SECTION[key]}`);
      for (const other of Object.keys(SECTION).filter((k) => k !== key)) assert.ok(!view.has(SECTION[other]), `${url}: not ${other}`);
      assert.equal(view.has('programs-ai-native-how'), key === 'overview' || key === 'how', `${url}: the playbook only on Overview and Playbook`);
      for (const t of TABS) assert.equal(view.props(`programs-tab-${t.key}`)['aria-current'], t.key === key ? 'page' : undefined, `${url}: tab ${t.key}`);
      for (const t of TABS) assert.equal(view.textOf(`programs-tab-${t.key}`), t.label, `${url}: tab ${t.key}`);
      assert.equal(view.at.path, url, `${url}: no redirect`);
    } finally { await view.close(); }
  }
});

test('the existing address shows what it showed, with the same ids, and adds Capability modules: None yet, or Could not be read', async () => {
  const admin = await mounted(BASE, worker(ADMIN), ADMIN);
  try {
    assert.ok(admin.has('programs-ai-native-tiles'));
    assert.ok(admin.has('programs-ai-native-how'));
    assert.equal(admin.textOf('programs-ai-native-foot'), AI_NATIVE_FOOT, 'an Admin keeps the foot line');
    assert.equal(admin.textOf('programs-generic-modules-none'), NO_MODULES);
  } finally { await admin.close(); }
  const hq = await mounted(BASE, worker(SUPER), SUPER);
  try {
    assert.ok(hq.has('programs-ai-native-how'));
    assert.ok(!hq.has('programs-ai-native-foot'), 'a Super Admin edits, so no foot line');
    assert.match(hq.text(), /How it runs · draft/);
  } finally { await hq.close(); }
  const down = await mounted(BASE, worker(ADMIN, { detail: () => response({ error: 'down' }, 503) }), ADMIN);
  try {
    assert.ok(down.has('programs-ai-native-tiles'), 'the tiles still draw');
    assert.match(down.textOf('programs-generic-modules'), /Could not be read/);
    assert.ok(!down.has('programs-generic-modules-none'), 'never "None yet" on a failed read');
  } finally { await down.close(); }
});

test('Participation is Not recorded, never 0', async () => {
  const view = await mounted(`${BASE}/participation`, worker(ADMIN), ADMIN);
  try {
    assert.match(view.textOf('programs-generic-participation'), /Not recorded/);
    assert.ok(view.textOf('programs-generic-participation').includes(PARTICIPATION_UNRECORDED));
    assert.doesNotMatch(view.textOf('programs-generic-participation'), /\b0\b/);
  } finally { await view.close(); }
});

test('Settings and Availability are the shell\'s: HQ sets member access; a failed registry read marks only those sections', async () => {
  const writes = [];
  const write = (path, method, options) => { writes.push({ path, method, body: JSON.parse(options.body) }); return response({ program: { ...DETAIL.program, member_access: 'invite' } }); };
  const hq = await mounted(`${BASE}/settings`, worker(SUPER, { write }), SUPER);
  try {
    assert.equal(hq.props('programs-generic-access').value, 'apply');
    await hq.change('programs-generic-access', 'invite');
    await hq.click('programs-generic-access-save');
    assert.deepEqual(writes, [{ path: '/api/admin/programs/ai-native-venture', method: 'PATCH', body: { member_access: 'invite' } }]);
  } finally { await hq.close(); }
  const avail = await mounted(`${BASE}/availability`, worker(ADMIN), ADMIN);
  try {
    assert.match(avail.textOf('programs-generic-availability'), /not switched on to be offered to studios/);
  } finally { await avail.close(); }
  for (const url of [`${BASE}/settings`, `${BASE}/availability`]) {
    const view = await mounted(url, worker(SUPER, { detail: () => response({ error: 'down' }, 503) }), SUPER);
    try {
      assert.ok(view.has('programs-page-ai-native-venture'), `${url}: the page still draws`);
      assert.ok(view.has('programs-shell-registry-failed'), `${url}: says the program could not be read`);
      assert.ok(!view.has('programs-generic-access') && !view.has('programs-generic-availability'), `${url}: nothing from a failed read`);
    } finally { await view.close(); }
  }
});

test('History reads the program\'s activity', async () => {
  const view = await mounted(`${BASE}/activity`, worker(ADMIN), ADMIN);
  try {
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/admin/programs/ai-native-venture/activity')));
  } finally { await view.close(); }
});
