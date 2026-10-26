// D1146 (#3032) — Product-market fit part 5: RD4, "How Product-market fit is
// scored", drawn from the stored model (`GET /api/cycles/raise/pmf/model`),
// and RD12, Validate's header chip with the latest stored band and
// confidence (`GET /api/cycles/raise/pmf/history?limit=1`).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pmf_method_d1146.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { chipOf, methodOf } from '../src/pages/cycles/pmfModel.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/** A stored model in the Worker's shape, deliberately not v1's figures, so a static copy cannot pass. */
const STORED = {
  version: '1.0', stored: true, scored_with: true, published_at: '2026-10-25',
  grades: { measured: 1, reviewed: 0.9, sourced: 0.7, stated: 0.4, not_recorded: 0 },
  model: {
    version: '1.0', published: '2026-10-25', floor: 0.3,
    confidence: [[0.45, 'Medium'], [0.7, 'High'], [0.3, 'Low']],
    bands: [[0, 'Weak'], [65, 'Strong'], [35, 'Fair']],
    freshness_days: { records: 365, connector: 90 },
    inputs: [
      { key: 'icp_interviews', label: 'ICP interviews held', group: 'who', weight: 30, rule: { kind: 'count', full: 20 }, reads: 'Held interviews: 5 points each.', freshness: 'records', module: 'customer-research' },
      { key: 'paying_demand', label: 'Paying demand', group: 'demand', weight: 45, rule: { kind: 'steps', steps: [[1, 40]] }, reads: 'Paid deposits and pilots.', freshness: 'records', module: 'demand-signals' },
      { key: 'product_pull', label: 'Product pull', group: 'demand', weight: 25, rule: { kind: 'marks', marks: { activation: 0.4 } }, reads: 'Activation and retention.', freshness: 'connector', module: 'product-roadmap' },
    ],
  },
};
const POINT = (over = {}) => ({ id: 9, value: 52, band: 'Fair', confidence: 0.57, confidence_word: 'Medium', coverage: { present: 8, applies: 9 }, model: '1.0', trigger: 'module_read', computed_at: '2026-10-24 09:40:00', ...over });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('RD4 lists exactly the stored model\'s inputs and weights, and its own bands, confidence and floor', () => {
  // Mutation checked: methodOf reading a static list → the stored labels and weights are missing;
  // the bands not sorted → "Weak 0 or more".
  const m = methodOf({ status: 'ready', data: STORED });
  assert.equal(m.state, 'ready');
  assert.deepEqual(m.inputs.map((i) => [i.key, i.name, i.weight]), [['icp_interviews', 'ICP interviews held', 30], ['paying_demand', 'Paying demand', 45], ['product_pull', 'Product pull', 25]]);
  assert.equal(m.total, 100);
  assert.deepEqual(m.inputs.map((i) => i.module), ['customer-research', 'demand-signals', null], 'product use is not a Validate module');
  assert.equal(m.title, 'Model v1.0');
  assert.equal(m.status, 'Published 25 Oct 2026 · the model this venture’s latest score used');
  assert.equal(m.bands, 'Strong 65 or more · Fair 35–64 · Weak under 35');
  assert.equal(m.confidence, 'High 0.70 or more · Medium 0.45–0.69 · Low 0.30–0.44');
  assert.equal(m.floor, 'Below 0.30 confidence it shows "Not enough recorded" and no number.');
  assert.deepEqual(m.grades.map((g) => [g.label, g.factor]), [['Measured', '1.00'], ['Reviewed', '0.90'], ['Sourced', '0.70'], ['Stated', '0.40'], ['Not recorded', '0.00']]);
  assert.match(m.freshness, /365 days \(records\) or 90 days \(a connector figure\)/);
  const before = methodOf({ status: 'ready', data: { ...STORED, stored: false, scored_with: false, published_at: null } });
  assert.match(before.status, /^Not stored on this database yet\. It is stored with the venture’s first score/);
  assert.equal(methodOf({ status: 'error' }).state, 'unreadable');
  assert.equal(methodOf({ status: 'refused' }).state, 'refused');
  assert.equal(methodOf({ status: 'loading' }).state, 'loading');
});

test('RD12\'s chip reads the stored band and confidence; nothing stored, too little recorded and a failed read each say so', () => {
  // Mutation checked: the chip ignoring the band → "Fair" missing; not_enough drawn as a band → "Not enough recorded" missing.
  const ok = chipOf({ status: 'ready', data: { items: [POINT()] } });
  assert.deepEqual([ok.state, ok.text, ok.label, ok.when], ['scored', 'Product-market fit · ◐ Fair · ●●○ Medium', 'Product-market fit: Fair, Medium confidence', '24 Oct 2026']);
  assert.equal(chipOf({ status: 'ready', data: { items: [POINT({ band: 'Strong', confidence_word: 'High' })] } }).text, 'Product-market fit · ● Strong · ●●● High');
  const low = chipOf({ status: 'ready', data: { items: [POINT({ value: null, band: null, confidence_word: 'Low' })] } });
  assert.deepEqual([low.state, low.text], ['not_enough', 'Product-market fit · Not enough recorded']);
  assert.deepEqual([chipOf({ status: 'ready', data: { items: [] } }).state, chipOf({ status: 'ready', data: { items: [] } }).text], ['none', 'Product-market fit · Not scored yet']);
  assert.equal(chipOf({ status: 'error' }).text, 'Product-market fit · could not be read');
  assert.deepEqual([chipOf({ status: 'refused' }).state, chipOf({ status: 'refused' }).text], ['door', 'Product-market fit'], 'a refusal names no score');
  assert.ok(!/0/.test(chipOf({ status: 'ready', data: { items: [] } }).text), 'never a zero');
});

test('the client reads the model with the venture in the query, and the chip asks for one point', async () => {
  const calls = [];
  const api = makeCycleWrites(async (...args) => { calls.push(args); return {}; });
  await api.raise.pmfModel(7);
  assert.deepEqual(calls[0], ['/cycles/raise/pmf/model?project=7']);
  await api.raise.pmfHistory(7, { limit: 1 });
  assert.equal(calls[1][0], '/cycles/raise/pmf/history?project=7&limit=1');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const MODULE = { module: { slug: 'fundraising-readiness', name: 'Fundraising readiness', records_title: 'Readiness items' }, card: { state: 'empty', reason: 'Nothing scored yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };
const OVERVIEW = { figures: [], cards: [{ slug: 'customer-research', state: 'empty', reason: 'No interviews yet.' }] };

async function mounted(url, routes = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => {
    const s = String(u); requests.push(s);
    for (const [frag, fn] of Object.entries(routes)) if (s.includes(frag)) return fn(s);
    if (s.includes('/cycles/raise/modules/fundraising-readiness')) return response(MODULE);
    if (s.includes('/cycles/validate/overview')) return response(OVERVIEW);
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/validate', element: h(CycleRoute, { cycle: 'validate' }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const find = (id) => { const n = nodes().find((x) => props(x)['data-testid'] === id); assert.ok(n, `no ${id}`); return n; };
  return {
    requests,
    has: (id) => nodes().some((x) => props(x)['data-testid'] === id),
    count: (id) => nodes().filter((x) => props(x)['data-testid'] === id).length,
    of: (id) => text(find(id)),
    prop: (id, k) => props(find(id))[k],
    async click(id) { await act(async () => { props(find(id)).onClick(); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('RD4 opens from the readiness part, reads the stored model only then, and lists exactly its inputs and weights', async () => {
  // Mutation checked: the dialog reading on mount → a model read before the click.
  const v = await mounted('/raise/fundraising-readiness?project_id=3', { '/cycles/raise/pmf/model': () => response(STORED) });
  try {
    assert.ok(!v.requests.some((u) => u.includes('/pmf/model')), 'nothing is read until the dialog opens');
    assert.equal(v.prop('pmf-method-open', 'aria-haspopup'), 'dialog');
    await v.click('pmf-method-open');
    assert.ok(v.requests.some((u) => /\/cycles\/raise\/pmf\/model\?project=3$/.test(u)));
    assert.equal(v.count('pmf-method-input'), 3);
    const table = v.of('pmf-method-inputs').replace(/\s+/g, ' ');
    assert.match(table, /ICP interviews held.*30.*Paying demand.*45.*Product pull.*25.*Total.*100/);
    assert.equal(v.of('pmf-method-bands'), 'Strong 65 or more · Fair 35–64 · Weak under 35');
    assert.match(v.of('pmf-method-status'), /Published 25 Oct 2026/);
    await v.click('pmf-method-close');
    assert.ok(!v.has('pmf-method'));
  } finally { await v.close(); }
});

test('RD4\'s failed read is Unreadable with Try again, which reads again', async () => {
  let n = 0;
  const v = await mounted('/raise/fundraising-readiness?project_id=3', { '/cycles/raise/pmf/model': () => { n += 1; return n === 1 ? response({ detail: 'How Product-market fit is scored could not be read' }, 503) : response(STORED); } });
  try {
    await v.click('pmf-method-open');
    assert.ok(v.has('pmf-method-unreadable'));
    assert.ok(!v.has('pmf-method-inputs'), 'no model is drawn in its place');
    assert.match(v.of('pmf-method-unreadable'), /could not be read\. This is not a claim that the score has no model\./);
  } finally { await v.close(); }
});

test('RD12: Validate\'s header chip reads one stored point and opens Fundraising readiness, keeping the venture', async () => {
  // Mutation checked: the chip passed no projectId → no history read.
  const v = await mounted('/validate?project_id=3', { '/cycles/raise/pmf/history': () => response({ items: [POINT()], has_more: true, next_cursor: 8 }) });
  try {
    assert.ok(v.requests.some((u) => /\/cycles\/raise\/pmf\/history\?project=3&limit=1$/.test(u)));
    assert.equal(v.prop('pmf-chip', 'data-state'), 'scored');
    assert.equal(v.of('pmf-chip-link'), 'Product-market fit · ◐ Fair · ●●○ Medium ›');
    assert.equal(v.prop('pmf-chip-link', 'href'), '/raise/fundraising-readiness?project_id=3');
    assert.equal(v.prop('pmf-chip-link', 'aria-label'), 'Product-market fit: Fair, Medium confidence. Open Fundraising readiness');
    assert.ok(!v.requests.some((u) => u.includes('/modules/fundraising-readiness')), 'opening Validate computes nothing');
  } finally { await v.close(); }
});

test('RD12: a failed history read says so with Try again, and a refusal shows the door alone', async () => {
  let n = 0;
  const v = await mounted('/validate?project_id=3', { '/cycles/raise/pmf/history': () => { n += 1; return n === 1 ? response({ detail: 'x' }, 503) : response({ items: [] }); } });
  try {
    assert.equal(v.prop('pmf-chip', 'data-state'), 'unreadable');
    await v.click('pmf-chip-retry');
    assert.equal(v.prop('pmf-chip', 'data-state'), 'none');
    assert.equal(v.of('pmf-chip-link'), 'Product-market fit · Not scored yet ›');
  } finally { await v.close(); }
  const r = await mounted('/validate?project_id=3', { '/cycles/raise/pmf/history': () => response({ detail: 'Forbidden' }, 403) });
  try {
    assert.equal(r.prop('pmf-chip', 'data-state'), 'door');
    assert.equal(r.of('pmf-chip-link'), 'Product-market fit ›');
  } finally { await r.close(); }
});

test('the wiring: the header takes a chip, and the route spells the model read', () => {
  const overview = readFileSync('frontend/src/pages/cycles/CycleOverview.jsx', 'utf8');
  assert.match(overview, /<CycleHeader cycle=\{meta\.key\} cards=\{cards\} action=\{action\} search=\{search\} chip=\{chip\} \/>/);
  const route = readFileSync('cloudflare-worker/src/routes/cycle_raise.ts', 'utf8');
  assert.match(route, /cycleRaise\.get\('\/pmf\/model'/);
});
