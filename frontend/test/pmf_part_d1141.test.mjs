// D1141 (#2433) — Product-market fit on Fundraising readiness: the part says
// the stored score, and Validate's overview opens the readiness page
// (RD12). Nothing here draws a number. D1146 (#3032) moved RD4 and RD12's chip
// to reads of their own: `pmf_method_d1146.test.mjs` holds them.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pmf_part_d1141.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { NOT_YET, readinessHref, validateHref } from '../src/pages/cycles/pmfModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const MODULE = (slug, name) => ({ module: { slug, name, records_title: 'Readiness items' }, card: { state: 'empty', reason: 'Nothing scored yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } });
const OVERVIEW = { figures: [], cards: [{ slug: 'customer-research', state: 'empty', reason: 'No interviews yet.' }] };

function handler(url) {
  if (url.includes('/cycles/raise/modules/fundraising-readiness')) return response(MODULE('fundraising-readiness', 'Fundraising readiness'));
  if (url.includes('/cycles/raise/modules/pitch-deck')) return response(MODULE('pitch-deck', 'Pitch deck'));
  if (url.includes('/cycles/validate/overview')) return response(OVERVIEW);
  return response({});
}

async function mounted(url) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return handler(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/validate', element: h(CycleRoute, { cycle: 'validate' }) }),
    h(Route, { path: '/build', element: h(CycleRoute, { cycle: 'build' }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  ))));
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  const within = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, text: () => text(container), testIds: ids,
    textOf: (id) => text(within(id)),
    count: (id) => ids().filter((x) => x === id).length,
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('every link keeps the venture, and only a real venture id', () => {
  assert.equal(validateHref('demand-signals', '?project_id=3&q=x'), '/validate/demand-signals?project_id=3');
  assert.equal(validateHref(null, '?project=4'), '/validate?project_id=4');
  assert.equal(validateHref('experiments', '?project_id=0'), '/validate/experiments');
  assert.equal(validateHref('experiments', ''), '/validate/experiments');
  assert.equal(readinessHref('?project_id=3'), '/raise/fundraising-readiness?project_id=3');
  assert.equal(readinessHref('?project_id=abc'), '/raise/fundraising-readiness');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('a missing PMF part stays Unreadable while the stored-model dialog remains available', async () => {
  const t = await mounted('/raise/fundraising-readiness?project_id=3');
  try {
    assert.equal(t.count('pmf-part'), 1);
    assert.equal(t.count('pmf-not-yet'), 0);
    assert.equal(t.count('pmf-unreadable'), 1);
    assert.equal(t.count('pmf-method-open'), 1, 'RD4 opens from the part (D1146)');
    const part = t.textOf('pmf-part');
    assert.ok(!part.includes(NOT_YET));
    assert.ok(!/\b(Strong|Fair|Weak)\b/.test(part), 'no band is given');
    assert.ok(!/\d+\s*(\/|of|out of)\s*100/.test(part), 'no score is drawn');
    assert.ok(!t.requests.some((u) => u.includes('/pmf/model')), 'RD4 reads only after opening');
    assert.equal(t.count('pmf-model'), 0, 'no static model fold is drawn');
  } finally { await t.close(); }
});

test('the part is on Fundraising readiness only', async () => {
  const t = await mounted('/raise/pitch-deck?project_id=3');
  try { assert.equal(t.count('pmf-part'), 0); } finally { await t.close(); }
});

test('Validate\'s overview opens Fundraising readiness, keeping the venture; Build\'s does not', async () => {
  let t = await mounted('/validate?project_id=3');
  try {
    assert.equal(t.count('pmf-chip'), 1, 'D1146: the door is the header chip');
    assert.equal(t.count('pmf-door'), 0, 'the older door is replaced by the header chip');
    assert.ok(t.hrefs().includes('/raise/fundraising-readiness?project_id=3'));
    assert.equal(t.count('pmf-part'), 0, 'the overview carries the door, not the part');
  } finally { await t.close(); }
  t = await mounted('/build?project_id=3');
  try { assert.equal(t.count('pmf-chip'), 0); } finally { await t.close(); }
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the score part beside From Mercury, the Validate chip, read-only history and the canvas', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /import \{ PmfPart \} from '\.\/PmfPart';/);
  assert.match(route, /'fundraising-readiness': \(data, ctx\) => \(\s*<>\s*<PmfPart part=\{data\?\.parts\?\.pmf\} card=\{data\?\.card\} records=\{data\?\.records\} projectId=\{ctx\.projectId\} reload=\{ctx\.reload\} \/>\s*\{mercuryPart\('fundraising-readiness', data, ctx\)\}/);
  assert.match(route, /chip=\{cycle === 'validate' && projectId \? <PmfChip projectId=\{projectId\} search=\{q\} \/> : null\}/);
  const part = read('frontend/src/pages/cycles/PmfPart.jsx') + read('frontend/src/pages/cycles/pmfModel.js');
  assert.ok(!/fetch\(|method: 'POST'|\.rescore\(/.test(part), 'the part writes nothing');
  assert.deepEqual([...part.matchAll(/cyclesWrite\.raise\.(\w+)/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i), ['pmfHistory']);
  for (const f of ['Fundraising Readiness Page.dc.html', 'Fundraising readiness · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  const boards = read('design/incoming/Fundraising readiness · Boards.dc.html');
  assert.ok(boards.includes('Fundraising Readiness Page'), 'the boards import the page by name');
  assert.ok(existsSync('documentation/architecture/decisions/D1141.md'));
  assert.ok(existsSync('documentation/audits/READINESS_MAP_2026-10-25.md'));
});
