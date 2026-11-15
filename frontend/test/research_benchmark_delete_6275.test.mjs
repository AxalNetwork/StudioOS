/**
 * D6275 — a benchmark is deleted from its own page.
 *
 * These mount the real `BenchmarkDetail` and `BenchmarkingZone` under one
 * router, with `api.research` stubbed. What is asserted is what an investor
 * sees and what the page sends: the confirm step names the metric and its
 * constituents, only a delete the Worker answered returns to the list, the
 * list re-reads on that return, and a failure or a 404 keeps the row drawn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import BenchmarkDetail from '../src/pages/research/BenchmarkDetail.jsx';
import BenchmarkingZone from '../src/pages/research/BenchmarkingZone.jsx';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;

const DETAIL = {
  item: {
    uid: 'b1', metric: 'TVPI', our_value: '1.4x', peer_value: '1.2x', peer_source: 'Published cohort table',
    peer_sample_size: 40, peer_as_of: '2026 Q2', is_comparison: true, reading: '',
  },
  constituents: [
    { uid: 'c1', name: 'Fund One', value: '1.1x', as_of: null },
    { uid: 'c2', name: 'Fund Two', value: '1.3x', as_of: null },
  ],
  thin: false,
};
const LIST_ROW = { uid: 'b2', metric: 'DPI', our_value: '0.2x', is_comparison: false, reading: 'Kept row' };

function collect(node) { return node.childNodes?.length ? node.childNodes.map(collect).join('') : (node.textContent || ''); }

/** Mounts both screens; `remove` is what `benchmarkRemove` does when called. */
async function mount(remove, url = '/research/benchmarking/b1') {
  const real = { ...api.research };
  const calls = { remove: [], lists: 0 };
  api.research.benchmarkGet = async () => DETAIL;
  api.research.benchmarkRemove = async (uid) => { calls.remove.push(uid); return remove(uid); };
  api.research.benchmarks = async () => {
    calls.lists += 1;
    return { items: [LIST_ROW], metric_count: 1, comparison_count: 0, unread_count: 0, smallest_sample_size: null, sample_note: null };
  };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let go;
  function Probe() { go = useNavigate(); return null; }
  const ui = await mountContracts(h(React.Fragment, null, h(Probe), h(Routes, null,
    h(Route, { path: '/research/benchmarking', element: h(BenchmarkingZone, { role: 'investor' }) }),
    h(Route, { path: '/research/benchmarking/:uid', element: h(BenchmarkDetail) }))), url, { id: 1, role: 'investor' });
  await ui.flush();
  const button = (label) => ui.nodes().find((n) => n.tagName === 'BUTTON' && collect(n).trim() === label);
  return {
    ui, calls,
    text: () => ui.text(),
    button,
    press: async (label) => {
      const b = button(label);
      assert.ok(b, `no button: ${label}`);
      await act(async () => { await ui.props(b).onClick({ stopPropagation() {} }); });
      await ui.flush();
    },
    go: async (to, opts) => { await act(async () => go(to, opts)); await ui.flush(); },
    close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; Object.assign(api.research, real); },
  };
}

test('Delete asks first, naming the metric and its constituents, and Keep it sends nothing', async () => {
  const m = await mount(async () => ({ ok: true }));
  try {
    assert.ok(m.button('Delete…'), 'the page offers Delete');
    assert.equal(m.button('Delete benchmark'), undefined, 'nothing is deleted on the first press');
    await m.press('Delete…');
    assert.match(m.text(), /Delete “TVPI”\?/);
    assert.match(m.text(), /Its 2 named constituents go with it\./);
    await m.press('Keep it');
    assert.deepEqual(m.calls.remove, []);
    assert.equal(m.button('Delete benchmark'), undefined, 'Keep it closes the confirm step');
    assert.match(m.text(), /Fund One/);
  } finally { await m.close(); }
});

test('a confirmed delete removes the loaded uid, returns to the list, and the list re-reads', async () => {
  const m = await mount(async () => ({ ok: true }));
  try {
    assert.equal(m.calls.lists, 0);
    await m.press('Delete…');
    await m.press('Delete benchmark');
    assert.deepEqual(m.calls.remove, ['b1']);
    assert.ok(!m.text().includes('Peer constituents'), 'the detail page is gone');
    assert.equal(m.calls.lists, 1, 'the list is read on return');
    assert.match(m.text(), /Deleted “TVPI” and the constituents named against it\./);
    assert.match(m.text(), /DPI/);
  } finally { await m.close(); }
});

test('the list re-reads on each arrival, even when it stays mounted', async () => {
  const m = await mount(async () => ({ ok: true }), '/research/benchmarking');
  try {
    assert.equal(m.calls.lists, 1);
    await m.go('/research/benchmarking', { state: { removedBenchmark: 'IRR' } });
    assert.equal(m.calls.lists, 2, 'a new arrival at the same mounted list reads it again');
    assert.match(m.text(), /Deleted “IRR”/);
  } finally { await m.close(); }
});

test('a failed delete says so and keeps the row on screen', async () => {
  const m = await mount(async () => { throw Object.assign(new Error('The server did not answer.'), { status: 500 }); });
  try {
    await m.press('Delete…');
    await m.press('Delete benchmark');
    assert.deepEqual(m.calls.remove, ['b1']);
    assert.match(m.text(), /This benchmark was not deleted\. The server did not answer\./);
    assert.match(m.text(), /Peer constituents/, 'still on the detail page');
    assert.match(m.text(), /Fund One/);
    assert.equal(m.calls.lists, 0, 'the page did not return to the list');
    assert.ok(m.button('Delete…'), 'the delete can be tried again');
  } finally { await m.close(); }
});

test('a 404 reads that the benchmark is not on your list', async () => {
  const m = await mount(async () => { throw Object.assign(new Error('Not found'), { status: 404 }); });
  try {
    await m.press('Delete…');
    await m.press('Delete benchmark');
    assert.match(m.text(), /This benchmark is not on your list\./);
    assert.doesNotMatch(m.text(), /was not deleted/);
    assert.equal(m.calls.lists, 0);
  } finally { await m.close(); }
});

test('the delete controls are 44px targets and full width at phone size', async () => {
  const m = await mount(async () => ({ ok: true }));
  try {
    const cls = (label) => String(m.ui.props(m.button(label)).className);
    assert.match(cls('Delete…'), /\bmin-h-\[44px\]/);
    assert.match(cls('Delete…'), /(^|\s)w-full(\s|$)/);
    await m.press('Delete…');
    for (const label of ['Delete benchmark', 'Keep it']) {
      assert.match(cls(label), /\bmin-h-\[44px\]/, label);
      assert.match(cls(label), /(^|\s)w-full(\s|$)/, label);
      assert.match(cls(label), /\bsm:w-auto\b/, label);
    }
  } finally { await m.close(); }
});
