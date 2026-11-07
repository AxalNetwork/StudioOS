/**
 * D4607 — a Research detail editor answers only the record its route names.
 *
 * These mount the real pages (`CompanyAnalysis`, `CompanyCandidate`) under a
 * router, move the route while reads are still in flight, and answer those
 * reads out of order with deferred promises. What is asserted is what a member
 * would see and what Save would send.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import CompanyAnalysis from '../src/pages/research/CompanyAnalysis.jsx';
import CompanyCandidate from '../src/pages/research/CompanyCandidate.jsx';
import FundDossier from '../src/pages/research/FundDossier.jsx';
import BenchmarkDetail from '../src/pages/research/BenchmarkDetail.jsx';
import { createRecordGate, recordKey, sameRecord } from '../src/pages/research/recordGate.js';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const analysisOf = (id, extra = {}) => ({
  id, title: `Analysis ${id}`, status: 'complete', inputs: {},
  output: { market_summary: `Summary of ${id}`, gaps: [], next_actions: [], notes: '' },
  candidates: [], sources: [], signals: [], ...extra,
});

/** Stubs `api.competitors`; every `get` waits on a deferred the test answers. */
function stub() {
  const real = { ...api.competitors };
  const gets = [];
  const writes = [];
  api.competitors.get = (id) => { const d = deferred(); gets.push({ id, ...d }); return d.promise; };
  api.competitors.save = async (id, body) => { writes.push({ op: 'save', id, body }); return analysisOf(id, { title: body.title ?? `Analysis ${id}` }); };
  api.competitors.candidateUpdate = async (aid, cid, body) => {
    writes.push({ op: 'candidateUpdate', aid, cid, body });
    return analysisOf(aid, { candidates: [{ id: cid, name: body.name ?? cid, origin: 'manual', category: 'direct' }] });
  };
  return {
    gets, writes,
    restore() { Object.assign(api.competitors, real); },
  };
}

async function mount(url) {
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let go;
  function Probe() { go = useNavigate(); return null; }
  const routes = h(Routes, null,
    h(Route, { path: '/research/companies/:id', element: h(CompanyAnalysis, { role: 'founder' }) }),
    h(Route, { path: '/research/companies/:analysisId/:candidateId', element: h(CompanyCandidate, { role: 'founder' }) }));
  const ui = await mountContracts(h(React.Fragment, null, h(Probe), routes), url, { id: 1, role: 'founder' });
  await ui.flush();
  const byLabel = (label) => ui.nodes().find((n) => ['TEXTAREA', 'INPUT'].includes(n.tagName) && ui.props(n)?.['aria-label'] === label);
  return {
    ui,
    text: () => ui.text(),
    go: async (to) => { await act(async () => go(to)); await ui.flush(); },
    settle: async (fn) => { await act(async () => { fn(); }); await ui.flush(); },
    type: async (label, value) => { await act(async () => ui.props(byLabel(label)).onChange({ target: { value } })); },
    buttons: (label) => ui.nodes().filter((n) => n.tagName === 'BUTTON' && collect(n).trim() === label),
    close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; },
  };
}
function collect(node) { return node.childNodes?.length ? node.childNodes.map(collect).join('') : (node.textContent || ''); }

test('the gate: only the latest read is fresh; invalidate makes every read stale; writes need the loaded record', () => {
  const gate = createRecordGate();
  const a = gate.begin(); const b = gate.begin();
  assert.equal(a(), false); assert.equal(b(), true);
  gate.invalidate(); assert.equal(b(), false);
  assert.equal(sameRecord(recordKey('A'), recordKey('A')), true);
  assert.equal(sameRecord(recordKey('A'), recordKey('B')), false);
  assert.equal(sameRecord(null, recordKey('A')), false, 'nothing loaded writes nothing');
  assert.equal(recordKey('A', undefined), null);
  assert.notEqual(recordKey('A', 'c1'), recordKey('A', 'c2'));
});

test('analysis: B answers before A after an A-to-B move, and only B is drawn', async () => {
  const s = stub(); const m = await mount('/research/companies/A');
  try {
    await m.go('/research/companies/B');
    assert.deepEqual(s.gets.map((g) => g.id), ['A', 'B']);
    await m.settle(() => s.gets[1].resolve(analysisOf('B')));
    assert.match(m.text(), /Analysis B/);
    // Mutation checked: without the generation check the late A replaces B here.
    await m.settle(() => s.gets[0].resolve(analysisOf('A')));
    assert.match(m.text(), /Analysis B/);
    assert.doesNotMatch(m.text(), /Analysis A/);
  } finally { await m.close(); s.restore(); }
});

test('analysis: a late failed A cannot replace B with an error or clear it', async () => {
  const s = stub(); const m = await mount('/research/companies/A');
  try {
    await m.go('/research/companies/B');
    await m.settle(() => s.gets[1].resolve(analysisOf('B')));
    await m.settle(() => s.gets[0].reject(Object.assign(new Error('boom'), { status: 500 })));
    assert.match(m.text(), /Analysis B/);
    assert.doesNotMatch(m.text(), /Your saved analyses could not be read/);
  } finally { await m.close(); s.restore(); }
});

test('analysis: while B loads nothing of A can be saved; once B is loaded Save goes to B with B\'s fields', async () => {
  const s = stub(); const m = await mount('/research/companies/A');
  try {
    await m.settle(() => s.gets[0].resolve(analysisOf('A')));
    await m.type('Market summary', 'A edited, unsaved');
    assert.ok(m.buttons('Save').length > 0, 'A has a Save');
    await m.go('/research/companies/B');
    // Mutation checked: keep A's editor on screen while B loads → a Save button is here and would send A's text to B.
    assert.equal(m.buttons('Save').length, 0, 'no editor, so no Save, while B loads');
    assert.doesNotMatch(m.text(), /A edited, unsaved/);
    assert.equal(s.writes.length, 0);
    await m.settle(() => s.gets[1].resolve(analysisOf('B')));
    await m.type('Market summary', 'B edited');
    await m.settle(() => m.ui.props(m.buttons('Save')[0]).onClick({ stopPropagation() {} }));
    assert.equal(s.writes.length, 1);
    assert.equal(s.writes[0].id, 'B');
    assert.equal(s.writes[0].body.output.market_summary, 'B edited');
    assert.ok(!JSON.stringify(s.writes[0]).includes('A edited'), 'nothing of A travels');
  } finally { await m.close(); s.restore(); }
});

test('analysis: editing and saving the current record still works', async () => {
  const s = stub(); const m = await mount('/research/companies/A');
  try {
    await m.settle(() => s.gets[0].resolve(analysisOf('A')));
    await m.type('Market summary', 'New summary for A');
    await m.settle(() => m.ui.props(m.buttons('Save')[0]).onClick({ stopPropagation() {} }));
    assert.deepEqual(s.writes.map((w) => [w.op, w.id, w.body.output.market_summary]), [['save', 'A', 'New summary for A']]);
    assert.match(m.text(), /Saved\./);
  } finally { await m.close(); s.restore(); }
});

test('analysis: unmounting with a read in flight drops it', async () => {
  const s = stub(); const m = await mount('/research/companies/A');
  const errors = []; const oldError = console.error; console.error = (...a) => errors.push(a.join(' '));
  try {
    await m.close();
    await act(async () => { s.gets[0].resolve(analysisOf('A')); await Promise.resolve(); });
    assert.deepEqual(errors, []);
  } finally { console.error = oldError; s.restore(); }
});

const twoCandidates = (aid) => analysisOf(aid, {
  candidates: [
    { id: 'c1', name: 'Company One', origin: 'manual', category: 'direct', summary: 'One summary' },
    { id: 'c2', name: 'Company Two', origin: 'manual', category: 'direct', summary: 'Two summary' },
  ],
});

test('candidate: moving from c1 to c2 within one analysis, the reads answer out of order, and only c2 is drawn and saved', async () => {
  const s = stub(); const m = await mount('/research/companies/A/c1');
  try {
    await m.go('/research/companies/A/c2');
    assert.equal(s.gets.length, 2, 'the move re-reads');
    await m.settle(() => s.gets[1].resolve(twoCandidates('A')));
    // Mutation checked: without the generation check the late c1 read draws Company One here.
    await m.settle(() => s.gets[0].resolve(twoCandidates('A')));
    assert.match(m.text(), /Company Two/);
    assert.doesNotMatch(m.text(), /Company One/);
    await m.settle(() => m.ui.props(m.buttons('Save')[0]).onClick({ stopPropagation() {} }));
    assert.deepEqual(s.writes.map((w) => [w.aid, w.cid, w.body.name]), [['A', 'c2', 'Company Two']]);
  } finally { await m.close(); s.restore(); }
});

test('candidate: while c2 loads, nothing typed on c1 can be saved to c2', async () => {
  const s = stub(); const m = await mount('/research/companies/A/c1');
  try {
    await m.settle(() => s.gets[0].resolve(twoCandidates('A')));
    assert.ok(m.buttons('Save').length > 0);
    await m.go('/research/companies/A/c2');
    assert.equal(m.buttons('Save').length, 0, 'no Save while c2 loads');
    assert.doesNotMatch(m.text(), /Company One/);
    await m.settle(() => s.gets[1].reject(Object.assign(new Error('gone'), { status: 500 })));
    assert.equal(s.writes.length, 0);
    assert.doesNotMatch(m.text(), /Company One/, 'a failed c2 read does not bring c1 back');
  } finally { await m.close(); s.restore(); }
});

/** One page whose read is `api.research[method]`; the test answers each read when it chooses. */
async function mountResearch(path, Page, method, url) {
  const real = api.research[method];
  const gets = [];
  api.research[method] = (uid) => { const d = deferred(); gets.push({ uid, ...d }); return d.promise; };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let go;
  function Probe() { go = useNavigate(); return null; }
  const ui = await mountContracts(h(React.Fragment, null, h(Probe), h(Routes, null, h(Route, { path, element: h(Page) }))), url, { id: 1, role: 'founder' });
  await ui.flush();
  return {
    gets, text: () => ui.text(),
    go: async (to) => { await act(async () => go(to)); await ui.flush(); },
    settle: async (fn) => { await act(async () => { fn(); }); await ui.flush(); },
    close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; api.research[method] = real; },
  };
}

const FUND = (uid) => ({ uid, name: `Fund ${uid}`, stage_fit: 'seed', path: 'warm', status: 'researching', note: '', thesis: '', pass_reason: '', source_url: '', cheque_min_cents: null, cheque_max_cents: null });
const BENCH = (uid) => ({ item: { uid, metric: `Metric ${uid}`, is_comparison: false, reading: '' }, constituents: [], thin: false });

for (const [label, path, Page, method, make, a, b] of [
  ['fund dossier', '/research/funds/:uid', FundDossier, 'fundGet', FUND, 'Fund A', 'Fund B'],
  ['benchmark', '/research/benchmarking/:uid', BenchmarkDetail, 'benchmarkGet', BENCH, 'Metric A', 'Metric B'],
]) {
  test(`${label}: a late A after an A-to-B move, success or failure, leaves B on screen`, async () => {
    const base = path.replace('/:uid', '');
    const m = await mountResearch(path, Page, method, `${base}/A`);
    try {
      await m.go(`${base}/B`);
      await m.settle(() => m.gets[1].resolve(make('B')));
      // Mutation checked: without the generation check the late A replaces B.
      await m.settle(() => m.gets[0].resolve(make('A')));
      assert.match(m.text(), new RegExp(b));
      assert.doesNotMatch(m.text(), new RegExp(a));
      await m.go(`${base}/A`);
      await m.go(`${base}/B`);
      await m.settle(() => m.gets[3].resolve(make('B')));
      await m.settle(() => m.gets[2].reject(Object.assign(new Error('boom'), { status: 500 })));
      assert.match(m.text(), new RegExp(b), 'a late failed A does not replace B');
    } finally { await m.close(); }
  });
}
