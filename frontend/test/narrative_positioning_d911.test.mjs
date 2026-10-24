/**
 * D911 (#2695) — Investor narrative › Positioning: NAR4's core and "This
 * version", NAR5's proposal lightbox, NAR18's moved notice and the redirect
 * from /raise/pitch/positioning. Mounted on the real CycleRoute over a stubbed
 * `fetch`, so every read and write goes through the real client to a URL.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_positioning_d911.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import PitchPositioningRedirect from '../src/pages/raise/narrative/PitchPositioningRedirect.jsx';
import {
  MOVED_NOTICE, POSITIONING_PATH, REMOVED_LINE, coreRows, movedHref, proposalRows, provenance, saveLine, versionRows,
} from '../src/pages/raise/narrative/narrativeModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const CORE = [
  { kind: 'one_liner', position: 0, text: 'Close the month in a day, not a week.', version: null, source: { kind: 'eadwyn', ref: 'ai_rail_proposals:u', label: null } },
  { kind: 'line', position: 0, text: 'The month-end tool for small teams', version: null, source: null },
  { kind: 'category', position: 0, text: 'Close management software', version: null, source: null },
];
const OVERRIDES = [{ kind: 'category', position: 0, text: 'Finance tooling for seed funds', version: 4, source: null }];
const OPEN = { uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'wedge', position: 0, text: 'Teams too small for an enterprise suite', version: null };
const RUN = {
  proposals: [
    { uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'one_liner', position: 0, text: 'Month-end close for teams with no time to spare.', version: null },
    { uid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', kind: 'line', position: 0, text: 'Every difference explained before you ask', version: null },
  ],
  removed: 1, withheld: 1, read_from: ['Validate › Segments', 'Validate › Competitors'],
};
const OPTIONS = { versions: [{ value: '4', label: 'v4 · seed fund' }] };
const MODULE = { module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: '' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function worker({ failPositioning = false, failRun = null } = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET');
    if (url.includes('/narrative/positioning/proposals/')) return response({ decision: JSON.parse(options.body).decision, proposal: {} });
    if (url.includes('/narrative/positioning/draft')) {
      if (method === 'POST') return failRun ? response(failRun.body, failRun.status) : response(RUN);
      return response({ read_from: ['Validate › Segments'], segments: { state: 'ok', items: ['Finance teams of one to five', 'Agency bookkeepers'] }, competitors: { state: 'unreadable' }, withheld: 0, proposals: { state: 'ok', items: [OPEN] } });
    }
    if (url.includes('/narrative/positioning')) {
      if (method === 'PUT') return response({ version: null, positioning: { core: CORE, overrides: [], effective: CORE } });
      if (failPositioning) return response({ detail: 'down', code: 'unreadable' }, 503);
      const v = new URL(url, 'http://x').searchParams.get('version');
      return response({ version: v ? Number(v) : null, core: CORE, overrides: v ? OVERRIDES : [], effective: CORE });
    }
    if (url.includes('/form-options')) return response(OPTIONS);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, handle = worker()) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body, headers: options.headers || {} }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  let where = null;
  function Spy() { const l = useLocation(); where = `${l.pathname}${l.search}${l.hash}`; return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/pitch/positioning', element: h(PitchPositioningRedirect) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ), h(Spy))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, where: () => where,
    text: () => text(container),
    textOf: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return text(n); },
    has: (id) => Boolean(byId(id)),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); await act(async () => { await p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(id, value) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id}`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const URL3 = `${POSITIONING_PATH}?project_id=3`;

// ---------------------------------------------------------------- the model

test('the model: provenance in the canvas\'s words, the core rows, this version\'s rows and what a Save says', () => {
  assert.equal(provenance({ kind: 'eadwyn' }), 'Proposed by Eadwyn, accepted');
  assert.equal(provenance(null), 'Typed');
  assert.equal(provenance({ kind: null, label: 'typed' }), 'Typed');
  const rows = coreRows(CORE);
  assert.deepEqual(rows.map((r) => [r.label, r.text]), [
    ['One-liner', CORE[0].text], ['Elevator pitch', null], ['Line 1', CORE[1].text], ['Line 2', null],
    ['Category', CORE[2].text], ['Wedge', null], ['For whom', null], ['Instead of', null],
  ]);
  assert.equal(rows[3].add, true, 'one empty slot to add a line');
  const v = versionRows(CORE, OVERRIDES);
  assert.deepEqual(v.map((r) => [r.label, r.adjusted, r.text]), [
    ['One-liner', false, CORE[0].text], ['Line 1', false, CORE[1].text], ['Category', true, 'Finance tooling for seed funds'],
  ]);
  assert.match(saveLine({ label: 'One-liner' }), /core one-liner\. Every version uses it/);
  assert.match(saveLine({ label: 'Category', version: '4' }), /for version 4 only/);
  assert.match(saveLine({ label: 'Category', version: '4', clearing: true }), /uses the core category again/);
  assert.equal(movedHref('?project_id=3&moved=x', '#top'), `${POSITIONING_PATH}?project_id=3&moved=positioning#top`);
  assert.deepEqual(proposalRows([OPEN, { uid: 'x', kind: 'nope', text: 'y' }, { kind: 'line', text: 'no uid' }]).map((r) => r.label), ['Wedge']);
});

// ---------------------------------------------------------------- NAR4

test('NAR4: the core with each field\'s provenance, For whom from Validate, and a part that failed says so', async () => {
  const view = await mounted(URL3);
  try {
    assert.ok(view.requests.some((r) => r.url === '/api/cycles/raise/narrative/positioning?project=3&version=4'), 'the chosen version\'s positioning');
    assert.ok(view.requests.some((r) => r.url === '/api/cycles/raise/narrative/positioning/draft?project=3'));
    assert.match(view.textOf('positioning-core-one_liner-0'), /Close the month in a day, not a week\..*Proposed by Eadwyn, accepted/s);
    assert.match(view.textOf('positioning-core-line-0'), /Typed/);
    assert.match(view.textOf('positioning-core-elevator-0'), /Not recorded/);
    assert.match(view.textOf('positioning-from-segments'), /Finance teams of one to five.*Agency bookkeepers/s);
    assert.match(view.textOf('positioning-from-competitors'), /Could not be read/);
    assert.match(view.textOf('positioning-version-category-0'), /Adjusted for this version/);
    assert.match(view.textOf('positioning-version-one_liner-0'), /Uses the core wording/);
    assert.match(view.textOf('positioning-open-proposals'), /Eadwyn proposed 1 line that waits for you/);
    assert.ok(!view.requests.some((r) => r.url.includes('/decks/positioning')), 'the old generator is not called');
  } finally { await view.close(); }
});

test('NAR4: a Save opens a dialog that says what it changes, and writes one field', async () => {
  const view = await mounted(URL3);
  try {
    await view.click('positioning-edit-one_liner-0');
    assert.match(view.textOf('positioning-save'), /This changes the core one-liner\. Every version uses it unless it adjusts it\./);
    await view.change('positioning-save-text', 'Close the books before lunch.');
    await view.click('positioning-save-go');
    const put = view.requests.find((r) => r.method === 'PUT');
    assert.equal(put.url, '/api/cycles/raise/narrative/positioning?project=3');
    assert.deepEqual(JSON.parse(put.body), { kind: 'one_liner', position: 0, text: 'Close the books before lunch.' });
    assert.ok(!view.has('positioning-save'), 'the dialog closes on save');
    // Adjust: on words it for this version only; off uses the core again.
    await view.change('positioning-adjust-one_liner-0', true);
    assert.match(view.textOf('positioning-save'), /for version 4 only\. The core stays as it is\./);
    await view.change('positioning-save-text', 'For seed funds: close in a day.');
    await view.click('positioning-save-go');
    const adj = view.requests.filter((r) => r.method === 'PUT').at(-1);
    assert.equal(adj.url, '/api/cycles/raise/narrative/positioning?project=3&version=4');
    await view.change('positioning-adjust-category-0', false);
    assert.match(view.textOf('positioning-save'), /Version 4 uses the core category again/);
    await view.click('positioning-save-go');
    assert.deepEqual(JSON.parse(view.requests.filter((r) => r.method === 'PUT').at(-1).body), { kind: 'category', position: 0, text: null });
  } finally { await view.close(); }
});

// ---------------------------------------------------------------- NAR5

test('NAR5: Ask Eadwyn runs on its own option, the lightbox lists each line to accept or discard, and a dropped line says so', async () => {
  const view = await mounted(URL3);
  try {
    await view.click('positioning-ask');
    const post = view.requests.find((r) => r.method === 'POST' && r.url.includes('/positioning/draft'));
    assert.equal(post.url, '/api/cycles/raise/narrative/positioning/draft?project=3', 'proposals are for the core');
    assert.equal(post.headers['X-Rail-Option'], encodeURIComponent('draft:narrative/positioning'));
    assert.match(view.textOf('positioning-proposal'), /Proposed by Eadwyn.*Positioning proposal.*Nothing lands until you accept it/s);
    assert.match(view.textOf('positioning-proposal-rows'), /One-liner.*Month-end close.*Line 1.*Every difference/s);
    assert.match(view.textOf('positioning-read-from'), /Validate › Segments.*Validate › Competitors.*No figures are read/s);
    assert.equal(view.textOf('positioning-removed'), REMOVED_LINE);
    assert.ok(view.has('positioning-withheld'));
    assert.ok(!/Accept all|Discard all/.test(view.text()), 'one at a time until S1 answers');
    await view.click('positioning-accept-one_liner-0');
    const decide = view.requests.find((r) => r.url.includes('/proposals/'));
    assert.equal(decide.url, `/api/cycles/raise/narrative/positioning/proposals/${RUN.proposals[0].uid}?project=3`);
    assert.deepEqual(JSON.parse(decide.body), { decision: 'accept' });
    await view.click('positioning-discard-line-0');
    assert.deepEqual(JSON.parse(view.requests.filter((r) => r.url.includes('/proposals/')).at(-1).body), { decision: 'discard' });
    assert.ok(view.has('positioning-proposal-done'));
    await view.click('positioning-proposal-close');
    assert.ok(!view.has('positioning-proposal'));
  } finally { await view.close(); }
});

test('NAR5: open proposals from an earlier run are reviewed in the same lightbox; a refused run says why', async () => {
  let view = await mounted(URL3);
  try {
    await view.click('positioning-review');
    assert.match(view.textOf('positioning-proposal-rows'), /Wedge.*Teams too small/s);
  } finally { await view.close(); }
  view = await mounted(URL3, worker({ failRun: { status: 422, body: { code: 'nothing_to_read', detail: 'There is nothing in Validate or Build to propose from yet.' } } }));
  try {
    await view.click('positioning-ask');
    assert.ok(!view.has('positioning-proposal'));
    assert.ok(view.has('positioning-ask-error'));
  } finally { await view.close(); }
  view = await mounted(URL3, worker({ failPositioning: true }));
  try {
    assert.match(view.textOf('positioning-core'), /This is not a claim that none is written\./);
  } finally { await view.close(); }
});

// ---------------------------------------------------------------- NAR18 and the move

test('NAR18: the old address redirects with its query and hash, and the notice shows once and dismisses', async () => {
  const view = await mounted('/raise/pitch/positioning?project_id=3#lines');
  try {
    assert.equal(view.where(), `${POSITIONING_PATH}?project_id=3&moved=positioning#lines`);
    assert.equal(view.textOf('positioning-moved'), `${MOVED_NOTICE}×`);
    await view.click('positioning-moved-dismiss');
    assert.equal(view.where(), `${POSITIONING_PATH}?project_id=3#lines`, 'only moved is taken off');
    assert.ok(!view.has('positioning-moved'));
  } finally { await view.close(); }
  const plain = await mounted(URL3);
  try { assert.ok(!plain.has('positioning-moved')); } finally { await plain.close(); }
});

test('the move: the route, the redirect inventory, the rail option, and every link to the old page', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes('<Route path="/raise/pitch/positioning" element={<PitchPositioningRedirect />} />'));
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/raise\/pitch\/positioning' \}/);
  const rail = read('frontend/src/lib/railOptions/founder.js');
  assert.match(rail, /page: 'Founder · Raise · Investor narrative', key: 'draft:narrative\/positioning'/);
  assert.doesNotMatch(rail, /key: 'draft:positioning'/);
  const matrix = read('cloudflare-worker/src/services/ai/railMatrix.json');
  assert.ok(matrix.includes('"optionKey": "draft:narrative/positioning"'), 'the matrix was rebuilt');
  assert.ok(!matrix.includes('"optionKey": "draft:positioning"'));
  for (const f of ['frontend/src/pages/cycles/CycleRoute.jsx', 'frontend/src/pages/SpinoutLabMarketPage.jsx', 'frontend/src/pages/cycles/founderToolNavigation.js', 'frontend/src/pages/PitchWorkspacePage.jsx']) {
    assert.doesNotMatch(read(f), /(?:to|href|path)[=:] ?['"`]\/raise\/pitch\/positioning/, `${f} still links the old page`);
  }
  // Every write is the store's, one field at a time; there is no bulk decision.
  const tab = read('frontend/src/pages/raise/narrative/PositioningTab.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(tab, /Accept all|decideAll|Promise\.all\(/);
});
