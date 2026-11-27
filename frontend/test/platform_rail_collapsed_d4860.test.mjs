/**
 * D4860 part 2 (#4860, finding 14, canvas PL-12) — on the operations screens
 * the Eadwyn rail starts collapsed, opens when asked, and stays open where the
 * viewer pinned it. No other rail changes.
 *
 * WHAT IS RENDERED. The real `WorkerRail`, mounted in `_appDom.mjs`'s
 * document inside a MemoryRouter at `/admin/platform`, every request answered
 * `{}`. Clicks go through the element's React props, because the document
 * dispatches no events. The pure rules in `ui/railOperations.js` are run on
 * their own as well.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_rail_collapsed_d4860.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAppDom, select } from './_appDom.mjs';
import {
  RAIL_PINNED_KEY, pinPage, pinnedPages, isPinned, withPin, railCollapsed,
} from '../src/ui/railOperations.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const propsOf = (node) => (node && Object.entries(node).find(([k]) => k.startsWith('__reactProps$'))?.[1]) || {};

/* ── the rules ──────────────────────────────────────────────────────── */

test('an operations rail is collapsed unless opened this visit; the shared preference is not read', () => {
  assert.equal(railCollapsed({ operations: true }), true);
  assert.equal(railCollapsed({ operations: true, stored: false }), true, 'a member who keeps the rail open elsewhere still sees Platform collapsed');
  assert.equal(railCollapsed({ operations: true, stored: true, visitOpen: true }), false, 'asked or pinned opens it, whatever the shared preference');
  assert.equal(railCollapsed({ operations: true, visitOpen: true, sheetOpen: true }), true, 'a detail sheet still takes the spine (D1317)');
  // Every other rail is unchanged.
  assert.equal(railCollapsed({ stored: false }), false);
  assert.equal(railCollapsed({ stored: true }), true);
  assert.equal(railCollapsed({ stored: false, visitOpen: false }), false, 'visitOpen means nothing to a rail that is not an operations rail');
  assert.equal(railCollapsed({ stored: false, sheetOpen: true }), true);
});

test('pins are per page, by path, and a bad stored value is no pins', () => {
  assert.equal(pinPage('/admin/platform/'), '/admin/platform');
  assert.equal(pinPage('/'), '/');
  assert.equal(pinPage(''), null);
  assert.deepEqual(pinnedPages('nope'), []);
  assert.deepEqual(pinnedPages(['/a', 3, null, 'b', '/a']), ['/a']);
  const one = withPin([], '/admin/platform', true);
  assert.deepEqual(one, ['/admin/platform']);
  assert.equal(isPinned(one, '/admin/platform/'), true);
  assert.equal(isPinned(one, '/admin/platform/switches'), false, 'pinning Platform does not pin Switches');
  assert.deepEqual(withPin(one, '/admin/platform', true), ['/admin/platform'], 'pinning twice keeps one entry');
  assert.deepEqual(withPin(['/monitoring', '/admin/platform'], '/admin/platform', false), ['/monitoring']);
  assert.deepEqual(withPin({ junk: 1 }, '', true), []);
});

test('the operations group from finding 12 opts in, and only through the prop', () => {
  for (const [file, host] of [
    ['frontend/src/pages/hq/PlatformPage.jsx', /workspace="Platform"\s+role="super_admin"\s+operations\n/],
    ['frontend/src/pages/hq/PlatformTopologyPage.jsx', /workspace="Topology"\s+role="super_admin"\s+operations\n/],
    ['frontend/src/pages/hq/PlatformSwitchesPage.jsx', /workspace="Switches"\s+role="super_admin"\s+operations\n/],
    ['frontend/src/pages/MonitoringPage.jsx', /const railProps = \{ operations: true,/],
  ]) assert.match(read(file), host, `${file} mounts an operations rail`);
  const rail = read('frontend/src/ui/WorkerRail.jsx');
  assert.match(rail, /operations = false,/, 'off unless a host asks for it');
  // The shared preference's writes are untouched (worker_rail_collapse.test.mjs pins them too).
  assert.match(rail, /safeWriteJSON\(RAIL_COLLAPSED_KEY, next\)/);
});

/* ── the real rail ──────────────────────────────────────────────────── */

async function mountRail({ operations = true, pinned = null, shared = null } = {}) {
  const dom = installAppDom({ fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), url: 'http://localhost/admin/platform' });
  localStorage.setItem('user', JSON.stringify({ id: 9106, role: 'admin', is_super_admin: 1, name: 'HQ' }));
  if (pinned) localStorage.setItem(RAIL_PINNED_KEY, JSON.stringify(pinned));
  if (shared != null) localStorage.setItem('worker_rail_collapsed', JSON.stringify(shared));
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { WorkerRail } = await import('../src/ui/index.js');
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/platform'] },
        React.createElement(WorkerRail, { workspace: 'Platform', role: 'super_admin', operations, 'data-testid': 'rail' })));
    });
    for (let i = 0; i < 10; i += 1) await act(() => new Promise((r) => setImmediate(r)));
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const one = (id) => select(host, `[data-testid="${id}"]`)[0] || null;
  return {
    one,
    collapsed: () => one('rail').getAttribute('data-collapsed'),
    root: () => dom.document.documentElement.getAttribute('data-worker-rail'),
    stored: (k) => localStorage.getItem(k),
    act: async (fn) => { await act(async () => { fn(); }); },
    async close() { await act(async () => root.unmount()); dom.timers.clear(); dom.restore(); },
  };
}

test('Platform opens on the spine, whatever the shared preference says', async () => {
  const r = await mountRail({ shared: false });
  try {
    assert.equal(r.collapsed(), 'true');
    assert.equal(r.one('rail').getAttribute('data-operations'), 'true');
    assert.equal(r.root(), 'collapsed', 'the frame narrows its track to the spine');
    assert.equal(r.one('checkbox-worker-rail-pin'), null, 'the pin is offered only on the open rail');
    assert.equal(r.one('button-worker-rail-toggle').getAttribute('title'), 'Open Eadwyn: Ask about Platform');
  } finally { await r.close(); }
});

test('asked: the toggle opens it for the visit, offers the pin, and writes no shared preference', async () => {
  const r = await mountRail();
  try {
    await r.act(() => propsOf(r.one('button-worker-rail-toggle')).onClick());
    assert.equal(r.collapsed(), 'false');
    assert.equal(r.root(), null);
    assert.equal(r.stored('worker_rail_collapsed'), null, 'collapsing Platform never collapses the founder desks');
    const pin = r.one('checkbox-worker-rail-pin');
    assert.ok(pin, 'Pin open on this page');
    assert.equal(propsOf(pin).checked, false);
    await r.act(() => propsOf(pin).onChange({ target: { checked: true } }));
    assert.deepEqual(JSON.parse(r.stored(RAIL_PINNED_KEY)), ['/admin/platform']);
    assert.equal(propsOf(r.one('checkbox-worker-rail-pin')).checked, true);
    await r.act(() => propsOf(r.one('checkbox-worker-rail-pin')).onChange({ target: { checked: false } }));
    assert.deepEqual(JSON.parse(r.stored(RAIL_PINNED_KEY)), []);
    await r.act(() => propsOf(r.one('button-worker-rail-toggle')).onClick());
    assert.equal(r.collapsed(), 'true');
  } finally { await r.close(); }
});

test('pinned: the rail opens on its own page', async () => {
  const r = await mountRail({ pinned: ['/admin/platform'], shared: true });
  try {
    assert.equal(r.collapsed(), 'false', 'the pin wins over a shared collapsed preference on this page');
    assert.equal(propsOf(r.one('checkbox-worker-rail-pin')).checked, true);
  } finally { await r.close(); }
  const other = await mountRail({ pinned: ['/monitoring'] });
  try {
    assert.equal(other.collapsed(), 'true', 'a pin on another page does not open this one');
  } finally { await other.close(); }
});

test('every other rail keeps the shared preference and draws no pin', async () => {
  const r = await mountRail({ operations: false, shared: false });
  try {
    assert.equal(r.collapsed(), 'false');
    assert.equal(r.one('rail').getAttribute('data-operations'), null);
    assert.equal(r.one('checkbox-worker-rail-pin'), null);
    await r.act(() => propsOf(r.one('button-worker-rail-toggle')).onClick());
    assert.equal(r.stored('worker_rail_collapsed'), 'true', 'the shared toggle still writes the shared preference');
  } finally { await r.close(); }
});
