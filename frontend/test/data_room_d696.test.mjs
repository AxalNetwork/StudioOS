/**
 * D696 (#1658) PR 3: the data room by mode, its two tool doors, and the
 * record crumb.
 *
 *  11. `/raise/data-room` answers investor first; for a founder the bare
 *      address is the Data room module page, the tool's Home, which links the
 *      read's own Add. D1109 (#2989) retired the files tool and the access
 *      view: `?mode=workspace` and `?mode=access` forward to the tool's Files
 *      and Access tabs, and the module page has no door to either.
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
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { fixture } from './_record_d696.mjs';
import { routeBlock } from './_routes.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { moduleToolLinks } from '../src/pages/cycles/founderToolNavigation.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const APP = codeOnly(read('frontend/src/App.jsx'));
const FOUNDER = { id: 9, role: 'founder', name: 'Example Founder', email: 'founder@example.test', subscription_tier: 'free' };
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

test('11. /raise/data-room answers investor first, then the retired modes forward, then the module page', () => {
  const block = routeBlock(APP, '/raise/data-room');
  assert.match(block, /guard\(\['admin', 'founder', 'investor'\],/);
  const at = (re) => { const m = block.match(re); assert.ok(m, String(re)); return m.index; };
  const investor = at(/effectiveRole === 'investor'\s*\?\s*<Navigate to="\/research\/diligence" replace \/>/);
  // D1109 (#2989): ?mode=workspace and ?mode=access forward to the tool's Files and Access, counted.
  const moved = at(/movedKind\(location\.search\)\s*\?\s*<DataRoomMovedRedirect kind=\{movedKind\(location\.search\)\} \/>/);
  const module = at(/:\s*<CycleRoute cycle="raise" slug="data-room" \/>\)\}/);
  assert.ok(investor < moved && moved < module, 'the arms run investor, forwards, module');
  assert.equal((block.match(/<CycleRoute\b/g) || []).length, 1);
  assert.doesNotMatch(APP, /DataRoomPage|FounderRaiseDataRoom/, 'a retired page is still mounted');
});

// --- 11. The module page -----------------------------------------------------------

for (const [what, add] of [
  ["#1699's Add, the files tool", '/raise/data-room?mode=workspace'],
  ["#1657's Upload form", '/raise/data-room/new?project=3'],
]) {
  test(`11. for a founder the bare address is the module page, the tool's Home, with no door to a retired page (${what})`, async () => {
    const view = await mounted('/raise/data-room?project_id=3', (u) => (u.includes('/auth/me') ? FOUNDER
      : u.includes('/cycles/raise/modules/data-room') ? moduleRead(add) : {}));
    try {
      assert.ok(view.requests.some((u) => u.includes('/cycles/raise/modules/data-room')), 'the module read is made');
      assert.deepEqual(view.by('cycle-module').length, 1);
      // #1657's Upload form is registered (D695), so the Add is the form's own address,
      // whatever the read's `records.add` points at.
      assert.deepEqual(view.links('records-add').map((l) => l.href), ['/raise/data-room/new?project_id=3'], 'the Add opens the Upload form');
      // D1109: the module page is the tool, so it has no door to the retired files tool or access view.
      assert.deepEqual(view.links('cycle-module-tool'), []);
      // No add or tool on the page points back at the bare room.
      for (const l of [...view.links('records-add'), ...view.links('cycle-module-tool')]) {
        assert.doesNotMatch(l.href, /^\/raise\/data-room(\?project_id=3)?$/, l.href);
      }
    } finally { await view.close(); }
  });
}

test('11. D1109: the files door is gone for everyone; other doors are unchanged', () => {
  for (const user of [{ role: 'admin' }, { role: 'founder', subscription_tier: 'free' }, { role: 'founder', spinout_lab_active: 1 }, { role: 'partner' }, null]) {
    assert.deepEqual(moduleToolLinks('raise', 'data-room', user, '?project_id=3'), [], JSON.stringify(user));
  }
  assert.deepEqual(moduleToolLinks('raise', 'capital-relationships', { role: 'founder' }, '?project_id=3'),
    [{ label: 'Open investor match', href: '/raise/capital-relationships/match?project_id=3' }]);
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
