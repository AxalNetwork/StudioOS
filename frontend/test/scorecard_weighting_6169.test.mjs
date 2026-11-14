/**
 * #6169 (under #5905) — the deal page's Scorecard tab draws the investor's
 * real weighting (`GET /api/venture-scores/weights`, D1258, D4635) where it
 * used to say "not stored yet": the word (Equal or Your own), Edit weighting
 * opening the same dialog as Deal flow, and one line saying it changes the
 * sort only. A failed read says it could not be read with Try again, never
 * Equal. Staff (Admin, Operating Partner) see no control on this tab; Deal
 * flow's peek keeps it on the toolbar.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/scorecard_weighting_6169.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import VentureScorecard from '../src/components/scoring/scorecard/Scorecard.jsx';
import { NOT_YET, WAITS, WEIGHTING_LINE } from '../src/components/scoring/scorecard/scorecardModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const AT = '2026-10-27T09:40:00Z';
const SCOPES = ['team', 'market', 'pmf', 'technical', 'traction', 'financial', 'risk', 'geographic', 'political', 'governance', 'legal_ip'];
const OPEN = {
  project_id: 7, deal_id: 4, locked: false, nda: true, model: '1.0', masked_reason: null,
  scopes: SCOPES.map((scope) => ({ scope, state: 'scored', value: 60, band: 'Fair', confidence_word: 'Medium', confidence: 0.6, coverage: 0.8, model: '1.0', computed_at: AT, masked: false, review: null, inputs: [] })),
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(el, { deal = () => OPEN, weights = () => json({ weights: null }) } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const p = new URL(String(u), 'http://x').pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', path: p, body });
    if (p === '/api/client-error') return json({});
    if (p === '/api/venture-scores/deal/4') return json(deal());
    if (p === '/api/venture-scores/weights') return (init.method || 'GET') === 'PUT' ? json({ weights: body.weights }) : weights();
    return json({ detail: 'Not found' }, 404);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/deals/4/scorecard'] }, el)));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const byText = (t) => walk(container).find((n) => n.tagName === 'BUTTON' && text(n).trim() === t);
  return {
    calls, by, has: (id) => Boolean(by(id)),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    page: () => text(container).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async press(t) { const n = byText(t); assert.ok(n, `no button ${t}`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const panel = (extra = {}) => h(VentureScorecard, { dealId: 4, ndaHref: '/deals/4/documents', ...extra });

test('the old wait is gone from the model and the tab', () => {
  assert.equal(WAITS.weighting, undefined);
  assert.equal(WEIGHTING_LINE, 'Your weighting changes your sort on Deal flow only. It never changes a score.');
  const src = read('frontend/src/components/scoring/scorecard/Scorecard.jsx');
  assert.doesNotMatch(src, /ScorecardWait id="weighting"/);
});

test('an investor sees Equal, the line, and edits their weighting in the existing dialog from the tab', async () => {
  const v = await mount(panel());
  try {
    assert.ok(v.calls.some((c) => c.method === 'GET' && c.path === '/api/venture-scores/weights'), 'the weights are read');
    assert.equal(v.of('scorecard-weighting-word'), 'Equal');
    assert.equal(v.of('scorecard-weighting-note'), WEIGHTING_LINE);
    assert.ok(!v.page().includes(NOT_YET), 'no "Not read here yet" on this tab');
    assert.ok(!v.has('scorecard-wait-weighting'));
    await v.click('scorecard-weighting-edit');
    assert.ok(v.has('scorecard-weighting-reset'), 'the dialog is the one Deal flow opens');
    await v.click('scorecard-weighting-go');
    const put = v.calls.filter((c) => c.method === 'PUT' && c.path === '/api/venture-scores/weights');
    assert.equal(put.length, 1);
  } finally { await v.close(); }
  const own = await mount(panel(), { weights: () => json({ weights: Object.fromEntries(SCOPES.map((s, i) => [s, i % 5 + 1])) }) });
  try { assert.equal(own.of('scorecard-weighting-word'), 'Your own'); } finally { await own.close(); }
});

test('a failed weights read says it could not be read, with Try again, never Equal', async () => {
  let n = 0;
  const v = await mount(panel(), { weights: () => { n += 1; return n === 1 ? json({ code: 'scorecard_unreadable', message: 'x' }, 503) : json({ weights: null }); } });
  try {
    assert.equal(v.of('scorecard-weighting-word'), 'Could not be read');
    assert.doesNotMatch(v.of('scorecard-weighting-control'), /Equal/);
    assert.ok(!v.has('scorecard-weighting-edit'), 'nothing to edit until it reads');
    await v.press('Try again');
    assert.equal(v.of('scorecard-weighting-word'), 'Equal');
  } finally { await v.close(); }
});

test('staff see no weighting control on the tab, and are not asked for weights', async () => {
  const v = await mount(panel(), { deal: () => ({ ...OPEN, viewer: 'staff', read_only: false }) });
  try {
    assert.ok(v.has('scorecard-scopes'), 'the scorecard itself draws');
    assert.ok(!v.has('scorecard-weighting') && !v.has('scorecard-weighting-control'));
    assert.ok(!v.calls.some((c) => c.path === '/api/venture-scores/weights'));
  } finally { await v.close(); }
});

test('Deal flow’s peek leaves the weighting to the toolbar, whose sort re-reads it on save', async () => {
  const v = await mount(panel({ weighting: false }));
  try {
    assert.ok(v.has('scorecard-scopes') && !v.has('scorecard-weighting-control'));
  } finally { await v.close(); }
  assert.match(read('frontend/src/pages/investor/dealflow/PeekDrawer.jsx'), /<VentureScorecard dealId=\{row\.id\} weighting=\{false\} \/>/);
  assert.match(read('frontend/src/pages/investor/dealflow/DealFlow.jsx'), /\{scope !== 'new' && <WeightingControl onSaved=\{onWeightsSaved\} \/>\}/);
});
