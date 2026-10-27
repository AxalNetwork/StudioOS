/**
 * D1194 (#3128, part 6 of #2457) — the old investor pipeline and Investor match
 * are retired into Capital relationships.
 *
 *   - `/raise/capital/pipeline`, `/raise/capital-match` and `/grow/capital-match`
 *     forward straight to the tool's Pipeline or Match tab, the venture, the rest
 *     of the query and the hash kept, `?project=` read as `?project_id=`, with
 *     the moved notice (CRL13).
 *   - Each address is on `REDIRECT_ROUTES` for #2319's count, none kept.
 *   - The module's tool link and the founder's tool navigation open the tool.
 *   - The reachability walk: no source in the SPA or the Worker links an old
 *     address, and every tab of the tool is reached from its home.
 *   - The two old pages and their tests are gone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_redirects_d1194.test.mjs
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
import CapRelMovedRedirect from '../src/pages/raise/caprel/CapRelMovedRedirect.jsx';
import { MOVED, TABS, capRelMovedTo } from '../src/pages/raise/caprel/capRelModel.js';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { moduleToolLinks } from '../src/pages/cycles/founderToolNavigation.js';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor } from '../src/lib/redirectBeacon.js';

const h = React.createElement;
const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const APP = read('frontend/src/App.jsx');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const MODULE = {
  module: { slug: 'capital-relationships', name: 'Capital relationships', records_title: 'Investors' },
  card: { state: 'empty', reason: 'No investors yet.' },
  records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 },
};
const handler = (url) => {
  if (/\/api\/projects(\?|$)/.test(url)) return response([{ id: 3, uid: 'p3', name: 'Fixture Robotics' }, { id: 5, uid: 'p5', name: 'Fixture Two' }]);
  if (/\/contacts\/raise-prospects\?/.test(url)) return response({ items: [] });
  if (/capital-relationships\/match/.test(url)) return response({ items: [], total: 0, limit: 25, offset: 0, facets: {} });
  if (url.includes('/cycles/raise/modules/')) return response(MODULE);
  return response({});
};

// The three redirects as App.jsx mounts them (pinned against App.jsx below).
const OLD = [
  ['/raise/capital/pipeline', { tab: 'pipeline', moved: 'pipeline' }],
  ['/raise/capital-match', { tab: 'match', moved: 'match' }],
  ['/grow/capital-match', { tab: 'match', moved: 'match' }],
];

function Landed() {
  const loc = useLocation();
  return h('output', { 'data-testid': 'landed', 'data-path': loc.pathname, 'data-search': loc.search, 'data-hash': loc.hash });
}

async function mounted(url) {
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
  const dest = (props) => h(React.Fragment, null, h(Landed), h(CycleRoute, props));
  await act(async () => r.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    ...OLD.map(([path, props]) => h(Route, { key: path, path, element: h(CapRelMovedRedirect, props) })),
    h(Route, { path: '/raise/:slug', element: dest({ cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: dest({ cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((res) => setTimeout(res, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    by, text: (n) => text(n || container),
    landed: () => { const p = props(by('landed')); return { path: p['data-path'], search: p['data-search'], hash: p['data-hash'] }; },
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async click(n) { await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => r.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The redirects
 * ------------------------------------------------------------------ */

test('the address: the tab\'s path, ?project= becomes ?project_id=, the rest of the query kept, moved added last', () => {
  assert.deepEqual(capRelMovedTo('pipeline', '?project=3&utm=a', 'pipeline'), { pathname: '/raise/capital-relationships/pipeline', search: '?utm=a&project_id=3&moved=pipeline' });
  assert.deepEqual(capRelMovedTo('match', '?project_id=4&project=3', 'match'), { pathname: '/raise/capital-relationships/match', search: '?project_id=4&moved=match' }, 'project_id wins, never two ventures');
  assert.deepEqual(capRelMovedTo('match', ''), { pathname: '/raise/capital-relationships/match', search: '' });
  assert.deepEqual(capRelMovedTo('overview', '?project_id=7'), { pathname: '/raise/capital-relationships', search: '?project_id=7' });
});

for (const [from, { tab, moved }] of OLD) {
  test(`${from} → the tool's ${tab} tab with the venture, the query, the hash and the moved notice`, async () => {
    const v = await mounted(`${from}?project=3&utm=a#top`);
    try {
      assert.deepEqual(v.landed(), { path: `/raise/capital-relationships/${tab}`, search: `?utm=a&project_id=3&moved=${moved}`, hash: '#top' });
      assert.ok(v.by(`caprel-${tab}-page`), `on the ${tab} tab`);
      assert.equal(v.text(v.by('caprel-moved')).replace('Dismiss', ''), MOVED[moved]);
      await v.click(v.by('caprel-moved-dismiss'));
      assert.equal(v.by('caprel-moved'), undefined, 'dismissed');
    } finally { await v.close(); }
  });
}

test('a venture already in project_id is kept as it is, and a plain tool address shows no notice', async () => {
  const v = await mounted('/raise/capital-match?project_id=5');
  try { assert.deepEqual(v.landed(), { path: '/raise/capital-relationships/match', search: '?project_id=5&moved=match', hash: '' }); } finally { await v.close(); }
  for (const url of ['/raise/capital-relationships/match?project_id=3', '/raise/capital-relationships/pipeline?project_id=3&moved=unknown']) {
    const plain = await mounted(url);
    try { assert.equal(plain.by('caprel-moved'), undefined, url); } finally { await plain.close(); }
  }
});

test('the notices are the canvas\'s two sentences (CRL13)', () => {
  assert.deepEqual(MOVED, {
    pipeline: 'The investor pipeline is now Capital relationships › Pipeline.',
    match: 'Investor match is now Capital relationships › Match.',
  });
});

test('App.jsx mounts exactly these three, unguarded (the tool\'s own route guards), and the old pages are gone', () => {
  for (const [path, { tab, moved }] of OLD) {
    const line = APP.split('\n').find((l) => l.includes(`<Route path="${path}" element=`)) || '';
    assert.equal(line.trim(), `<Route path="${path}" element={<CapRelMovedRedirect tab="${tab}" moved="${moved}" />} />`, path);
  }
  assert.match(APP, /<Route path="\/raise\/:slug\/:id" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="raise" record \/>\)\} \/>/, 'the tool\'s tabs keep their guard');
  assert.doesNotMatch(codeOnly(APP), /RaisePipelinePage|FounderGrowCapitalMatch/);
  for (const gone of ['frontend/src/pages/RaisePipelinePage.jsx', 'frontend/src/pages/founder/FounderGrowCapitalMatch.jsx']) assert.equal(existsSync(resolve(root, gone)), false, gone);
  const ws = codeOnly(read('frontend/src/pages/CapitalWorkspacePage.jsx'));
  assert.doesNotMatch(ws, /RaisePipelinePage|'pipeline'/, 'Capital has no Pipeline tab');
  // A non-landing founder's bare /raise opens the tool, not the old page.
  assert.match(APP, /: <Navigate to="\/raise\/capital-relationships\/pipeline" replace \/>\} \/>/);
});

test('each old address is counted for #2319, and none is kept past the 90 days', () => {
  for (const [path] of OLD) {
    const row = REDIRECT_ROUTES.find((r) => r.path === path);
    assert.ok(row, `${path} is not on REDIRECT_ROUTES`);
    assert.equal(row.keep, undefined, `${path} is kept`);
    assert.equal(redirectPatternFor(path), path);
  }
  assert.equal(redirectPatternFor('/raise/capital-relationships/match'), null, 'the tool itself is no redirect');
});

/* ------------------------------------------------------------------ *
 * The doors and the reachability walk
 * ------------------------------------------------------------------ */

test('the module\'s tool link and the founder\'s navigation open the tool with the venture', () => {
  const founder = { role: 'founder' };
  assert.deepEqual(moduleToolLinks('raise', 'capital-relationships', founder, '?project_id=3').map((l) => [l.label, l.href]),
    [['Open investor match', '/raise/capital-relationships/match?project_id=3']]);
  assert.equal(moduleToolLinks('grow', 'distribution', founder).some((l) => l.href.includes('capital-match')), false);
  const cycle = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(cycle, /'capital-relationships': \(q\) => \(\{ label: 'Open the investor pipeline', href: `\/raise\/capital-relationships\/pipeline\$\{q \|\| ''\}` \}\)/);
  assert.match(read('frontend/src/lib/siteDoors.js'), /\/raise\/capital-relationships\/match/);
  assert.match(read('cloudflare-worker/src/services/raiseCycle.ts'), /pipeline: '\/raise\/capital-relationships\/pipeline',/);
});

const RETIRED = OLD.map(([path]) => path);

function sources(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|ts|json)$/.test(f)) out.push(p); } };
  walk(resolve(root, dir));
  return out;
}

test('no SPA or Worker source links a retired address: only the redirects and their inventory name them', () => {
  // shellConfig's `legacy` records the address a zone answered at (D119), not a link.
  const allowed = new Set(['frontend/src/App.jsx', 'cloudflare-worker/src/services/redirectRoutes.ts', 'frontend/src/workspaces/shellConfig.js']);
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
  const v = await mounted('/raise/capital-relationships?project_id=3');
  try {
    const hrefs = v.hrefs();
    for (const tab of TABS.filter((t) => t.path)) assert.ok(hrefs.includes(`/raise/capital-relationships${tab.path}?project_id=3`), tab.id);
  } finally { await v.close(); }
});
