/**
 * D1540 (#3791, deck v2 B15) — recourse and pricing on the founder's side.
 *
 *   · the report client posts a reason and an optional note to the Worker's
 *     route, and HQ's queue and resolve go to theirs;
 *   · a proposed result on `AreaResults.jsx` carries a small Report control:
 *     a reason, an optional note, Send; it changes nothing on the card;
 *   · the plan gate's link goes to the plans page and carries no lightbox to
 *     come back to, so a founder returns to the page and its AIRail;
 *   · the one-click build sends back the quote it showed (`quote_uid`), and a
 *     stale quote asks for the price again.
 *
 * Every venture, card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDocument } from './_contracts_dom.mjs';
import { DECK_REPORT_REASONS, deckReportsApi } from '../src/lib/api/deckReports.js';
import * as apiIndex from '../src/lib/api.js';
import AreaResults from '../src/pages/raise/pitch/AreaResults.jsx';
import { PLANS_PATH, refusalOf } from '../src/pages/raise/pitch/newDeckModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(resolve(root, f), 'utf8');

test('the report client: one module, re-exported by api.js, on the Worker\'s routes', async () => {
  assert.equal(apiIndex.deckReportsApi, deckReportsApi);
  assert.deepEqual(DECK_REPORT_REASONS.map((r) => r.id), ['wrong_figure', 'poor_writing', 'wrong_place', 'bad_image', 'unsafe', 'other']);
  const sent = [];
  const before = globalThis.fetch;
  const restore = installDocument();
  globalThis.fetch = async (url, init) => { sent.push([String(url), init?.method || 'GET', init?.body ?? null]); return Response.json({ ok: true }); };
  try {
    await deckReportsApi.report('rp/1', { reason: 'wrong_figure', note: 'Not ours.' });
    await deckReportsApi.report('rp-2', { reason: 'other' });
    await deckReportsApi.queue();
    await deckReportsApi.resolve('dr_1', { outcome: 'no_fault' });
  } finally { globalThis.fetch = before; restore(); }
  const paths = sent.map(([u, m, b]) => [u.replace(/^.*\/api/, '/api'), m, b]);
  assert.deepEqual(paths, [
    ['/api/decks/proposals/rp%2F1/report', 'POST', JSON.stringify({ reason: 'wrong_figure', note: 'Not ours.' })],
    ['/api/decks/proposals/rp-2/report', 'POST', JSON.stringify({ reason: 'other' })],
    ['/api/admin/deck-reports?status=open', 'GET', null],
    ['/api/admin/deck-reports/dr_1/resolve', 'POST', JSON.stringify({ outcome: 'no_fault' })],
  ]);
});

async function mountResults(results, report) {
  const original = deckReportsApi.report;
  const calls = [];
  deckReportsApi.report = async (...a) => { calls.push(a); return report(...a); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const r = createRoot(container);
  const placed = [];
  await act(async () => { r.render(h(AreaResults, { results, card: { title: 'Synthetic', blocks: [] }, model: null, onPlace: (c) => placed.push(c) })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((x) => setTimeout(x, 0)); });
  return {
    calls, placed, by, pr,
    text: (n) => text(n).replace(/\s+/g, ' ').trim(),
    press: async (n) => { await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    change: async (n, value) => { await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    close: async () => { await act(async () => r.unmount()); restore(); deckReportsApi.report = original; },
  };
}

const RESULT = { key: 'b2', uid: 'rp-syn-1', status: 'proposed', kind: 'text', label: 'Body', before: 'Synthetic before', after: 'Synthetic after', charges: true, charged: 700 };

test('a proposed result can be reported with a reason and a short note; the card is untouched', async () => {
  const m = await mountResults([RESULT, { ...RESULT, key: 'img', uid: null, kind: 'image', imageUid: 'im1', image: { url: '/x.png', alt: '' } }], async () => ({ report: { uid: 'dr_1' } }));
  try {
    assert.equal(m.by('pitch-area-result-img-report'), undefined, 'a result with no proposal uid has no Report');
    await m.press(m.by('pitch-area-result-b2-report'));
    const send = m.by('pitch-area-result-b2-report-send');
    assert.equal(m.pr(send).disabled, true, 'Send waits for a reason');
    await m.change(m.by('pitch-area-result-b2-report-reason'), 'wrong_figure');
    await m.change(m.by('pitch-area-result-b2-report-note'), '  Not our figure.  ');
    await m.press(m.by('pitch-area-result-b2-report-send'));
    assert.deepEqual(m.calls, [['rp-syn-1', { reason: 'wrong_figure', note: 'Not our figure.' }]]);
    assert.match(m.text(m.by('pitch-area-result-b2-reported')), /^Reported\. HQ will look at it/);
    assert.deepEqual(m.placed, [], 'reporting places nothing');
    assert.ok(m.by('pitch-area-result-b2-accept'), 'Accept and Discard are still there');
  } finally { await m.close(); }
});

test('a result already reported reads as reported; another refusal shows the Worker\'s sentence', async () => {
  const already = Object.assign(new Error('You already reported this result. HQ will look at it.'), { status: 409, code: 'already_reported', data: { error: 'already_reported' } });
  const m = await mountResults([RESULT, { ...RESULT, key: 'b3', uid: 'rp-syn-2' }], async (uid) => {
    if (uid === 'rp-syn-1') throw already;
    throw Object.assign(new Error('That result is not one of yours.'), { status: 404, code: 'not_found', data: {} });
  });
  try {
    for (const key of ['b2', 'b3']) {
      await m.press(m.by(`pitch-area-result-${key}-report`));
      await m.change(m.by(`pitch-area-result-${key}-report-reason`), 'other');
      await m.press(m.by(`pitch-area-result-${key}-report-send`));
    }
    assert.ok(m.by('pitch-area-result-b2-reported'));
    assert.match(m.text(m.by('pitch-area-result-b3-report-error')), /That result is not one of yours\./);
  } finally { await m.close(); }
});

test('the plan gate\'s upgrade link returns to the AIRail, never the lightbox', () => {
  const r = refusalOf(Object.assign(new Error('Part of a paid plan.'), { status: 402, code: 'tier_required', data: { error: 'tier_required' } }));
  assert.equal(r.link.href, PLANS_PATH);
  assert.equal(r.link.href, '/pricing', 'no return address into a dialog');
  assert.equal(r.topUp, null);
  // The lightbox is never addressable: nothing in the pitch pages reopens it from the URL.
  for (const f of ['AreaLightbox.jsx', 'newDeckModel.js']) assert.ok(!/lightbox=|return_to|returnTo/.test(read(`frontend/src/pages/raise/pitch/${f}`)), f);
});

test('the one-click build sends back the quote it showed, and a stale quote asks for the price again', () => {
  const src = read('frontend/src/pages/raise/pitch/OneClickBuild.jsx');
  assert.match(src, /quote\?\.quote_uid \? \{ quote_uid: quote\.quote_uid \}/);
  assert.match(src, /why\?\.code === 'quote_stale'\) \{ setQuote\(null\); setRequote/);
  assert.match(src, /roundRef, exKey, requote\]/);
});
