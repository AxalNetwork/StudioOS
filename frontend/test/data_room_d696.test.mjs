/**
 * D696 (#1658) PR 3: the data room by mode, its two tool doors, and the
 * record crumb.
 *
 *  11. `/raise/data-room` answers by mode, investor first; for a founder the
 *      bare address is the Data room module page, which links the read's own
 *      Add, the read-only access view and "Open the files tool"; the files
 *      door is an admin's and a founder's on every tier, and nobody else's;
 *      `?mode=access` draws the access view with its return to the module.
 *  12. In record mode the rail's crumbs read section › module › record, and
 *      leaving the record drops it.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_d696.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { fixture } from './_record_d696.mjs';
import { routeBlock } from './_routes.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import FounderModuleBackLink from '../src/pages/founder/FounderModuleBackLink.jsx';
import { moduleToolLinks } from '../src/pages/cycles/founderToolNavigation.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const APP = codeOnly(read('frontend/src/App.jsx'));
const FOUNDER = { id: 9, role: 'founder', name: 'Example Founder', email: 'founder@example.test', subscription_tier: 'free' };
const ACCESS = 'Open the access view: grants, NDA state and recent access';
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const moduleRead = (add) => ({
  module: { name: 'Data room' },
  records: { cols: [{ key: 'name', label: 'File' }], rows: [], total: 0, add: { text: 'Upload a file', href: add } },
});
const record = () => ({ ...fixture(), module: 'data-room', id: 'f-1', title: 'Example deck.pdf', sub: 'One file in the room.', actions: [] });

/** Mounts the app's Raise routes for the founder, with `fetch` answering from `reads`. */
async function mounted(url, reads) {
  const restore = installDocument();
  const store = new Map([['user', JSON.stringify(FOUNDER)]]);
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, localStorage: globalThis.localStorage };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }, key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
  };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return response(reads(String(u))); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const out = {};
  function Capture() { out.navigate = useNavigate(); return null; }
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Capture), h(Routes, null,
    // The module arm of App's /raise/data-room, and the generic record route.
    h(Route, { path: '/raise/data-room', element: h(CycleRoute, { cycle: 'raise', slug: 'data-room' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  )))));
  await settle();
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const by = (testid) => walk(container).filter((n) => props(n)['data-testid'] === testid);
  const links = (testid) => by(testid).map((n) => ({ href: props(n).href ?? props(n).to, text: text(n) }));
  return {
    requests, links, by, text, settle,
    go: (to) => act(async () => { out.navigate(to); }).then(settle),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// --- 11. The route ---------------------------------------------------------------

test('11. /raise/data-room has its four arms, investor first, then the files tool, the access view and the module page', () => {
  const block = routeBlock(APP, '/raise/data-room');
  assert.match(block, /guard\(\['admin', 'founder', 'investor'\],/);
  const at = (re) => { const m = block.match(re); assert.ok(m, String(re)); return m.index; };
  const investor = at(/effectiveRole === 'investor'\s*\?\s*<Navigate to="\/research\/diligence" replace \/>/);
  const workspace = at(/get\('mode'\) === 'workspace'\s*\?\s*founderWorkspace\('raise', founderEditor\(<DataRoomPage user=\{user\} \/>\)\)/);
  const access = at(/get\('mode'\) === 'access'\s*\?\s*founderEditor\(<FounderRaiseDataRoom \/>\)/);
  const module = at(/:\s*<CycleRoute cycle="raise" slug="data-room" \/>\)\}/);
  assert.ok(investor < workspace && workspace < access && access < module, 'the arms run in decision 12\'s order');
  assert.equal((block.match(/<CycleRoute\b/g) || []).length, 1);
});

// --- 11. The module page -----------------------------------------------------------

for (const [what, add] of [
  ["#1699's Add, the files tool", '/raise/data-room?mode=workspace'],
  ["#1657's Upload form", '/raise/data-room/new?project=3'],
]) {
  test(`11. for a founder the bare address is the module page, with the access view and the files tool (${what})`, async () => {
    const view = await mounted('/raise/data-room?project_id=3', (u) => (u.includes('/auth/me') ? FOUNDER
      : u.includes('/cycles/raise/modules/data-room') ? moduleRead(add) : {}));
    try {
      assert.ok(view.requests.some((u) => u.includes('/cycles/raise/modules/data-room')), 'the module read is made');
      assert.deepEqual(view.by('cycle-module').length, 1);
      // #1657's Upload form is registered (D695), so the Add is the form's own address,
      // whatever the read's `records.add` points at.
      assert.deepEqual(view.links('records-add').map((l) => l.href), ['/raise/data-room/new?project_id=3'], 'the Add opens the Upload form');
      assert.deepEqual(view.links('cycle-module-tool'), [
        { href: '/raise/data-room?mode=access&project_id=3', text: ACCESS },
        { href: '/raise/data-room?mode=workspace&project_id=3', text: 'Open the files tool' },
      ]);
      // No add or tool on the page points back at the bare room.
      for (const l of [...view.links('records-add'), ...view.links('cycle-module-tool')]) {
        assert.doesNotMatch(l.href, /^\/raise\/data-room(\?project_id=3)?$/, l.href);
      }
    } finally { await view.close(); }
  });
}

test('11. the files door is an admin\'s and a founder\'s on every tier, and nobody else\'s; other doors are unchanged', () => {
  const files = (user, search = '?project_id=3') => moduleToolLinks('raise', 'data-room', user, search);
  const door = [{ label: 'Open the files tool', href: '/raise/data-room?mode=workspace&project_id=3' }];
  for (const user of [{ role: 'admin' }, { role: 'founder', subscription_tier: 'free' }, { role: 'founder', subscription_tier: 'growth' },
    { role: 'founder', subscription_tier: 'studio' }, { role: 'founder', spinout_lab_active: 1 }]) {
    assert.deepEqual(files(user), door, JSON.stringify(user));
  }
  for (const user of [{ role: 'partner' }, { role: 'investor' }, null]) assert.deepEqual(files(user), [], JSON.stringify(user));
  assert.deepEqual(files({ role: 'founder' }, ''), [{ label: 'Open the files tool', href: '/raise/data-room?mode=workspace' }], 'no venture: the door alone');
  assert.deepEqual(files({ role: 'founder' }, '?project_id=evil%23x&mode=access'), [{ label: 'Open the files tool', href: '/raise/data-room?mode=workspace' }]);
  // A door with no query keeps today's href.
  assert.deepEqual(moduleToolLinks('raise', 'capital-relationships', { role: 'founder' }, '?project_id=3'),
    [{ label: 'Open investor match', href: '/raise/capital-match?project_id=3' }]);
});

test('11. ?mode=access is the access view with its return to the module page, and its Open workspace links the files tool', () => {
  const back = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/raise/data-room?mode=access&project_id=3'] },
    h(FounderModuleBackLink, { user: FOUNDER })));
  assert.match(back, /href="\/raise\/data-room\?project_id=3"[^>]*>← Raise › Data room</);
  assert.match(read('frontend/src/pages/founder/FounderRaiseDataRoom.jsx'),
    /<Link to=\{`\/raise\/data-room\?mode=workspace\$\{project\.id \? `&project_id=\$\{project\.id\}` : ''\}`\} data-testid="link-open-data-room-workspace">/);
});

test('11. the four cycle files still never spell mode=workspace', () => {
  for (const f of ['CycleRoute.jsx', 'CycleOverview.jsx', 'CycleModulePage.jsx', 'cycleModel.js']) {
    assert.ok(!read(`frontend/src/pages/cycles/${f}`).includes('mode=workspace'), f);
  }
});

// --- 12. The record crumb ------------------------------------------------------------

test('12. a record adds its title to the rail\'s crumbs, and leaving it drops the title', async () => {
  const view = await mounted('/raise/data-room/f-1?project_id=3', (u) => (u.includes('/auth/me') ? FOUNDER
    : u.includes('/records/f-1/activity') ? { items: [], total: 0 }
      : u.includes('/records/f-1') ? record()
        : u.includes('/cycles/raise/modules/data-room') ? moduleRead('/raise/data-room?mode=workspace') : {}));
  const crumbs = () => view.by('text-worker-rail-crumbs').map((n) => view.text(n)).join(' | ');
  try {
    // The rail draws its separators between the crumbs without spaces.
    assert.equal(crumbs(), 'Raise›Data room›Example deck.pdf');
    await view.go('/raise/data-room?project_id=3');
    assert.equal(crumbs(), 'Raise›Data room', 'the module page drops the record');
  } finally { await view.close(); }
});

test('12. the crumb is set inside the provider, from the record\'s own title, and cleared on leave', () => {
  const src = codeOnly(read('frontend/src/pages/cycles/CycleRoute.jsx'));
  // D768 adds the record's `type` and `id`, which name it for the run (`ref`).
  // D906 (2026-10-24, #2454): a narrative tab word is no record, so it names none.
  // D1015 and D1101 (#2456): nor is a Cap table or Data room tab word.
  assert.match(src, /<RecordCrumb title=\{record && recordState\.status === 'ready' \? recordState\.data\?\.title : null\} type=\{`\$\{cycle\}\/\$\{slug\}`\} id=\{narrativeTab \|\| capTableTab \|\| dataRoomTab \? null : recordId \?\? null\} \/>\s*<\/RailFrame>\s*<\/RailCrumbsProvider>/);
  assert.match(src, /setCrumbs\(\{ record: title \|\| null, ref: title && type && id != null \? \{ type, id \} : null \}\);\s*return \(\) => setCrumbs\(\{ record: null \}\);/);
});
