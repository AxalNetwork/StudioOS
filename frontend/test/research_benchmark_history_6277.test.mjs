/**
 * D6277 — the benchmark page's Restatement history card.
 *
 * `historyRows` is pure and read directly. The card is checked on the real
 * `BenchmarkDetail` with `api.research` stubbed: rows newest first as text
 * with their unit, the empty sentence, and Unavailable for a history the
 * Worker could not read while the rest of the page still loads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import BenchmarkDetail from '../src/pages/research/BenchmarkDetail.jsx';
import { HISTORY_EMPTY, historyRows, replacedOn } from '../src/pages/research/benchmarkRead.js';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;

const ITEM = {
  uid: 'b1', metric: 'Months of runway at close', our_value: '22 months', peer_value: '18 months',
  peer_source: 'Peer survey B', peer_sample_size: 8, peer_as_of: '2026 Q2', is_comparison: true, reading: 'Later read',
};
// Newest first, as the Worker sends it: each entry is the row as it was before a change.
const HISTORY = [
  { ...ITEM, our_value: '20 months', changed_at: '2026-11-12T14:20:00.000Z' },
  { ...ITEM, our_value: '20 months', peer_sample_size: 6, reading: null, changed_at: '2026-11-09T09:00:00.000Z' },
];

test('each field a restatement replaced is a row, newest first, compared with what replaced it', () => {
  const rows = historyRows(ITEM, HISTORY);
  assert.deepEqual(rows.map((r) => [r.field, r.earlier, r.replaced]), [
    ['Ours', '20 months', '12 Nov 2026'],
    ['Sample size (n)', '6', '9 Nov 2026'],
    ['Reading', null, '9 Nov 2026'],
  ]);
  // Values stay text with their unit; the sample is "6", never 6.0 or a bar.
  assert.equal(typeof rows[1].earlier, 'string');
});

test('an empty history is no rows, and an unreadable one is null, not empty', () => {
  assert.deepEqual(historyRows(ITEM, []), []);
  assert.equal(historyRows(ITEM, null), null);
  assert.equal(historyRows(ITEM, undefined), null);
  assert.equal(HISTORY_EMPTY, 'No earlier version is recorded.');
});

test('a blank and a missing value are the same value, so neither is a change', () => {
  const item = { ...ITEM, peer_as_of: null };
  assert.deepEqual(historyRows(item, [{ ...item, peer_as_of: '', changed_at: '2026-11-12T00:00:00Z' }]), []);
  assert.equal(replacedOn('not a date'), 'not a date');
  assert.equal(replacedOn(null), null);
});

async function mount(detail) {
  const real = { ...api.research };
  api.research.benchmarkGet = async () => detail;
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const ui = await mountContracts(h(Routes, null,
    h(Route, { path: '/research/benchmarking/:uid', element: h(BenchmarkDetail) })), '/research/benchmarking/b1', { id: 1, role: 'investor' });
  await ui.flush();
  const card = () => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === 'benchmark-history');
  const textOf = (n) => (n.childNodes?.length ? n.childNodes.map(textOf).join('') : (n.textContent || ''));
  const within = (root, pred) => {
    const out = [];
    const walk = (n) => { if (pred(n)) out.push(n); (n.childNodes || []).forEach(walk); };
    walk(root);
    return out;
  };
  return {
    ui, card, textOf, within,
    close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; Object.assign(api.research, real); },
  };
}

test('the card lists what each save replaced, newest first, as text and with no chart', async () => {
  const m = await mount({ item: ITEM, constituents: [], thin: true, history: HISTORY });
  try {
    const card = m.card();
    assert.ok(card, 'the History card is drawn');
    const text = m.textOf(card);
    assert.match(text, /Restatement history/);
    assert.match(text, /Field.*Earlier value.*Replaced/);
    const rows = m.within(card, (n) => n.tagName === 'TR').slice(1).map((r) => m.textOf(r));
    assert.equal(rows.length, 3);
    assert.match(rows[0], /^Ours20 months12 Nov 2026$/);
    assert.match(rows[1], /^Sample size \(n\)69 Nov 2026$/);
    assert.match(rows[2], /^Reading.*Not recorded.*9 Nov 2026$/);
    assert.doesNotMatch(text, new RegExp(HISTORY_EMPTY.replace('.', '\\.')));
    // No chart: the only drawing in the card is the Not recorded mark's 11px glyph.
    const drawn = m.within(card, (n) => /^(SVG|CANVAS)$/i.test(n.tagName || ''));
    assert.ok(drawn.every((n) => /^svg$/i.test(n.tagName) && m.ui.props(n)?.['aria-hidden'] === 'true' && String(m.ui.props(n)?.width) === '11'),
      'no chart is drawn');
    assert.equal(drawn.length, 1);
  } finally { await m.close(); }
});

test('an empty history says no earlier version is recorded', async () => {
  const m = await mount({ item: ITEM, constituents: [], thin: false, history: [] });
  try {
    const text = m.textOf(m.card());
    assert.match(text, /No earlier version is recorded\./);
    assert.doesNotMatch(text, /Unavailable/);
    assert.equal(m.within(m.card(), (n) => n.tagName === 'TABLE').length, 0);
  } finally { await m.close(); }
});

test('a history the Worker could not read says Unavailable, and the rest of the page still loads', async () => {
  const m = await mount({ item: ITEM, constituents: [{ uid: 'c1', name: 'Fund One', value: '19 months', as_of: null }], thin: false, history: null });
  try {
    const text = m.textOf(m.card());
    assert.match(text, /Unavailable/);
    assert.match(text, /The earlier versions of this benchmark could not be read\./);
    assert.doesNotMatch(text, /No earlier version is recorded/);
    const page = m.ui.text();
    assert.match(page, /Months of runway at close/);
    assert.match(page, /22 months/);
    assert.match(page, /Fund One/);
    assert.ok(m.ui.nodes().some((n) => m.ui.props(n)?.['data-testid'] === 'benchmark-comparison'));
  } finally { await m.close(); }
});
