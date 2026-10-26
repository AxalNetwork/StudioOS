/**
 * D1029 (#2866, part 14 of #2432) — the old Cap table pages are retired.
 *
 *   - Each old address forwards into the tool, its query and hash kept and
 *     `?project=` read as `?project_id=`: `/raise/capital/cap-table` and
 *     `/raise/cap-table/variants` with a moved notice, `/build/captable` with no
 *     chain, and a variant to its scenario.
 *   - The tool shows the notice once and Dismiss drops `moved`, nothing else.
 *   - Each address is on `REDIRECT_ROUTES` for #2319's count, none kept.
 *   - The reachability walk: no source in the SPA or the Worker links an old
 *     address, and every tab of the tool is reached from its home.
 *   - The old pages, their panels and the Capital tab are gone; the Lab's copy stays.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/captable_retire_d1029.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import CapTableMovedRedirect, { capTableMovedTo } from '../src/pages/raise/captable/CapTableMovedRedirect.jsx';
import { CapTableTabBar } from '../src/pages/raise/captable/CapTableTool.jsx';
import { MOVED_NOTICES, TABS } from '../src/pages/raise/captable/capTableModel.js';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor } from '../src/lib/redirectBeacon.js';

const h = React.createElement;
const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const APP = read('frontend/src/App.jsx');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const MODULE = { module: { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' }, card: { state: 'empty', reason: 'No holders yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };
const handler = (url) => (url.includes('/cycles/raise/modules/') ? response(MODULE) : response({}));

// The four redirects as App.jsx mounts them (pinned against App.jsx below), and the tool behind them.
const OLD = [
  ['/build/captable', { to: '/raise/cap-table' }],
  ['/raise/capital/cap-table', { to: '/raise/cap-table', moved: 'cap-table' }],
  ['/raise/cap-table/variants', { to: '/raise/cap-table/scenarios', moved: 'variants' }],
  ['/raise/cap-table/variants/:variant', { to: '/raise/cap-table/scenarios' }],
];

function Landed() {
  const loc = useLocation();
  return h('output', { 'data-testid': 'landed', 'data-path': loc.pathname, 'data-search': loc.search, 'data-hash': loc.hash });
}

async function mounted(url, { tool = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => handler(String(u));
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null; // a hash scrolls to its anchor; there is none here
  const container = document.createElement('div'); document.body.appendChild(container);
  const r = createRoot(container);
  const dest = (props) => h(React.Fragment, null, h(Landed), tool ? h(CycleRoute, props) : null);
  await act(async () => r.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    ...OLD.map(([path, props]) => h(Route, { key: path, path, element: h(CapTableMovedRedirect, props) })),
    h(Route, { path: '/raise/cap-table/scenarios/:scenario', element: dest({ cycle: 'raise', slug: 'cap-table', capTableScenario: true }) }),
    h(Route, { path: '/raise/:slug', element: dest({ cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: dest({ cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((res) => setTimeout(res, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    flush, by, text: (n) => text(n || container),
    landed: () => { const p = props(by('landed')); return { path: p['data-path'], search: p['data-search'], hash: p['data-hash'] }; },
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async click(n) { await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => r.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The redirects
 * ------------------------------------------------------------------ */

test('the address: ?project= becomes ?project_id=, the rest of the query kept, moved added last', () => {
  assert.deepEqual(capTableMovedTo('/raise/cap-table', '?project=3&tab=x', 'cap-table'), { pathname: '/raise/cap-table', search: '?tab=x&project_id=3&moved=cap-table' });
  assert.deepEqual(capTableMovedTo('/raise/cap-table', '?project_id=4&project=3'), { pathname: '/raise/cap-table', search: '?project_id=4' }, 'project_id wins, never two ventures');
  assert.deepEqual(capTableMovedTo('/raise/cap-table', ''), { pathname: '/raise/cap-table', search: '' });
  assert.deepEqual(capTableMovedTo('/raise/cap-table/scenarios', '?project=3', 'variants'), { pathname: '/raise/cap-table/scenarios', search: '?project_id=3&moved=variants' });
});

test('/raise/capital/cap-table → /raise/cap-table?moved=cap-table, the query, the hash and ?project= kept', async () => {
  const v = await mounted('/raise/capital/cap-table?project=3&utm=a#holders');
  try { assert.deepEqual(v.landed(), { path: '/raise/cap-table', search: '?utm=a&project_id=3&moved=cap-table', hash: '#holders' }); } finally { await v.close(); }
});

test('/build/captable → /raise/cap-table, no chain through the old page and no notice', async () => {
  const v = await mounted('/build/captable?project=5&x=1#top');
  try { assert.deepEqual(v.landed(), { path: '/raise/cap-table', search: '?x=1&project_id=5', hash: '#top' }); } finally { await v.close(); }
  assert.match(APP, /<Route path="\/build\/captable" element=\{<CapTableMovedRedirect to="\/raise\/cap-table" \/>\} \/>/);
});

test('/raise/cap-table/variants → /raise/cap-table/scenarios?moved=variants, the query, the hash and ?project= kept', async () => {
  const v = await mounted('/raise/cap-table/variants?project=3&q=1#list');
  try { assert.deepEqual(v.landed(), { path: '/raise/cap-table/scenarios', search: '?q=1&project_id=3&moved=variants', hash: '#list' }); } finally { await v.close(); }
});

test('/raise/cap-table/variants/:variant → /raise/cap-table/scenarios/:variant (its uid is the scenario id)', async () => {
  const v = await mounted('/raise/cap-table/variants/v%20one?project=3#inputs');
  try { assert.deepEqual(v.landed(), { path: '/raise/cap-table/scenarios/v%20one', search: '?project_id=3', hash: '#inputs' }); } finally { await v.close(); }
});

test('App.jsx mounts exactly these four, unguarded (the tool\'s own routes guard), and the old pages are gone', () => {
  for (const [path, { to, moved }] of OLD) {
    const line = APP.split('\n').find((l) => l.includes(`<Route path="${path}" element=`)) || '';
    assert.equal(line.trim(), `<Route path="${path}" element={<CapTableMovedRedirect to="${to}"${moved ? ` moved="${moved}"` : ''} />} />`, path);
  }
  assert.doesNotMatch(APP, /CapTableVariantsPage/);
  for (const gone of ['frontend/src/pages/CapTablePage.jsx', 'frontend/src/pages/CapTableVariantsPage.jsx', 'frontend/src/pages/captable']) assert.equal(existsSync(resolve(root, gone)), false, gone);
  assert.ok(existsSync(resolve(root, 'frontend/src/pages/SpinoutLabCapTablePage.jsx')), 'the Lab\'s copy stays until #2297\'s Lab redesign');
  const ws = read('frontend/src/pages/CapitalWorkspacePage.jsx');
  assert.doesNotMatch(codeOnly(ws), /cap-table|CapTablePage/, 'Capital has no Cap Table tab');
});

test('each old address is counted for #2319, and none is kept past the 90 days', () => {
  for (const [path] of OLD) {
    const row = REDIRECT_ROUTES.find((r) => r.path === path);
    assert.ok(row, `${path} is not on REDIRECT_ROUTES`);
    assert.equal(row.keep, undefined, `${path} is kept`);
  }
  assert.equal(redirectPatternFor('/raise/capital/cap-table'), '/raise/capital/cap-table');
  assert.equal(redirectPatternFor('/raise/cap-table/variants'), '/raise/cap-table/variants');
  assert.equal(redirectPatternFor('/raise/cap-table/variants/v1'), '/raise/cap-table/variants/:variant');
  assert.equal(redirectPatternFor('/raise/cap-table'), null, 'the tool itself is no redirect');
});

/* ------------------------------------------------------------------ *
 * The moved notices
 * ------------------------------------------------------------------ */

test('the notices are the issue\'s two sentences', () => {
  assert.deepEqual(MOVED_NOTICES, {
    'cap-table': 'Cap table has a new address. Update your bookmark.',
    variants: 'Draft variants is now Scenarios, under Cap table.',
  });
});

test('an old bookmark lands on Overview with its notice; Dismiss drops moved and keeps the venture and the hash', async () => {
  const v = await mounted('/raise/capital/cap-table?project=3#holders', { tool: true });
  try {
    const notice = v.by('captable-moved');
    assert.ok(notice, 'the notice is drawn');
    assert.match(v.text(notice), /Cap table has a new address\. Update your bookmark\./);
    const dismiss = [...(function* walk(n) { yield n; for (const c of n.childNodes || []) yield* walk(c); })(notice)].find((n) => String(n.tagName).toUpperCase() === 'BUTTON');
    await v.click(dismiss);
    assert.equal(v.by('captable-moved'), undefined, 'dismissed');
    assert.deepEqual(v.landed(), { path: '/raise/cap-table', search: '?project_id=3', hash: '#holders' });
  } finally { await v.close(); }
});

test('the variants list lands on Scenarios with its notice; a variant and a plain address show none', async () => {
  const list = await mounted('/raise/cap-table/variants?project=3', { tool: true });
  try {
    assert.match(list.text(list.by('captable-moved')), /Draft variants is now Scenarios, under Cap table\./);
    assert.ok(list.by('captable-scenarios-page'), 'on the Scenarios tab');
  } finally { await list.close(); }
  for (const url of ['/build/captable?project=3', '/raise/cap-table?project_id=3&moved=unknown', '/raise/cap-table/variants/v1?project=3']) {
    const v = await mounted(url, { tool: true });
    try { assert.equal(v.by('captable-moved'), undefined, url); } finally { await v.close(); }
  }
});

/* ------------------------------------------------------------------ *
 * The reachability walk
 * ------------------------------------------------------------------ */

const RETIRED = ['/raise/capital/cap-table', '/build/captable', '/raise/cap-table/variants'];

function sources(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|ts|json)$/.test(f)) out.push(p); } };
  walk(resolve(root, dir));
  return out;
}

test('no SPA or Worker source links a retired address: only the redirects and their inventory name them', () => {
  const allowed = new Set(['frontend/src/App.jsx', 'cloudflare-worker/src/services/redirectRoutes.ts']);
  const hits = [];
  for (const file of [...sources('frontend/src'), ...sources('cloudflare-worker/src')]) {
    const rel = file.slice(root.length + 1);
    if (allowed.has(rel)) continue;
    const src = file.endsWith('.json') ? readFileSync(file, 'utf8') : codeOnly(readFileSync(file, 'utf8'));
    // A link is the address quoted as a whole value, or followed by its query or a sub-path.
    for (const from of RETIRED) {
      if (["'", '"', '`'].some((q) => ["'", '"', '`', '?', '$', '/'].some((end) => src.includes(q + from + end)))) hits.push(`${rel}: ${from}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('from the tool\'s home every tab is one link away, the venture kept', async () => {
  const v = await mounted('/raise/cap-table?project_id=3', { tool: true });
  try {
    const hrefs = v.hrefs();
    for (const tab of TABS.filter((t) => t.path)) assert.ok(hrefs.includes(`/raise/cap-table${tab.path}?project_id=3`), tab.id);
  } finally { await v.close(); }
  assert.ok(CapTableTabBar, 'the tab bar is the door');
});

test('the old doors land in the tool: the zone actions, the cycle doors and the Worker\'s links', () => {
  const zone = read('frontend/src/workspaces/founderZoneActions.js');
  assert.match(zone, /\{ label: 'Export to Carta', to: '\/raise\/cap-table\/import-export'/);
  assert.match(zone, /\{ label: 'Add instrument', to: '\/raise\/cap-table\/instruments' \}/);
  const cycle = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(cycle, /'founding-team': \(q\) => \(\{ label: 'Open the cap table and vesting', href: `\/raise\/cap-table\$\{q \|\| ''\}` \}\)/);
  assert.doesNotMatch(cycle, /'cap-table': \(\) => \(\{ label: 'Open the cap table'/, 'the module page has no door to itself');
  assert.match(read('frontend/src/pages/ProjectDetail.jsx'), /to=\{`\/raise\/cap-table\?project_id=\$\{project\.id\}`\}/);
  assert.match(read('frontend/src/pages/SpinoutLabCapTablePage.jsx'), /<Link to="\/raise\/cap-table\/scenarios"/);
  assert.match(read('cloudflare-worker/src/services/raiseCycle.ts'), /capTable: '\/raise\/cap-table',/);
  assert.match(read('cloudflare-worker/src/routes/assistant.ts'), /url: '\/raise\/cap-table', label: 'Cap table'/);
});
