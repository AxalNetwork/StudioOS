/**
 * D5073 (#5073) — Evidence cannot show another venture's read; bulk actions are one request with one outcome per row;
 * the pipeline's open investor and picks are resolved by stable id against the latest read.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_batch_reconcile_5073.test.mjs
 */
import './_cycleSteps.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { useEvidence } from '../src/pages/cycles/evidence/RaiseEvidence.jsx';
import { decideMany } from '../src/pages/cycles/evidence/EvidenceReview.jsx';
import { acceptAllScope } from '../src/pages/cycles/evidence/evidenceView.js';
import CapRelPipeline from '../src/pages/raise/caprel/CapRelPipeline.jsx';
import CapRelProposals from '../src/pages/raise/caprel/CapRelProposals.jsx';

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const tick = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });

async function mount(element, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u, o = {}) => { calls.push({ url: String(u).replace(/^.*\/api/, ''), method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : undefined }); return handle(String(u), o); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const render = (el) => act(async () => root.render(el));
  await render(element);
  await tick();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    calls, render, tick, by, prop: (id, k) => props(by(id))[k], has: (id) => !!by(id), of: (id) => text(by(id)),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await tick(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------ Evidence: the stale-request race ------------------------------ */

function Probe({ projectId }) {
  const { state } = useEvidence(projectId);
  return h('div', { 'data-testid': 'probe', 'data-status': state.status, 'data-project': String(state.read?.venture ?? '') }, state.status);
}

test('A starts, switch to B, B resolves, A resolves: B stays; A\'s answer is never drawn, not even while B loads', async () => {
  const pending = {};
  const handle = (url) => new Promise((resolve) => { const id = /project=(\d+)/.exec(url)[1]; pending[id] = (body) => resolve(response(body)); });
  const v = await mount(h(Probe, { projectId: 1 }), handle);
  try {
    assert.ok(pending[1], 'A\'s read started');
    await v.render(h(Probe, { projectId: 2 }));
    assert.ok(pending[2], 'B\'s read started');
    assert.equal(v.of('probe'), 'loading', 'B is loading; A\'s state is not drawn for B');
    pending[2]({ venture: 'B', permissions: { can_decide: true } }); await v.tick();
    assert.deepEqual([v.of('probe')], ['ready']);
    pending[1]({ venture: 'A', permissions: { can_decide: true } }); await v.tick();
    assert.equal(v.prop('probe', 'data-project'), 'B', 'the slower answer for A did not replace B');
  } finally { await v.close(); }
});

test('a read that fails for A after B started is dropped too', async () => {
  const pending = {};
  const handle = (url) => new Promise((resolve) => { const id = /project=(\d+)/.exec(url)[1]; pending[id] = (status, body) => resolve(response(body, status)); });
  const v = await mount(h(Probe, { projectId: 1 }), handle);
  try {
    await v.render(h(Probe, { projectId: 2 }));
    pending[2](200, { venture: 'B' }); await v.tick();
    pending[1](403, { detail: 'nope' }); await v.tick();
    assert.equal(v.of('probe'), 'ready', 'A\'s refusal does not turn B into Forbidden');
  } finally { await v.close(); }
});

/* ------------------------------ Evidence: one request, one outcome per row ------------------------------ */

test('decideMany sends ONE request for the whole press and returns an outcome per proposal, in order', async () => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => { calls.push({ url: String(u).replace(/^.*\/api/, ''), body: JSON.parse(o.body) });
    return response({ results: [{ id: 'a', ok: true }, { id: 'b', ok: false, code: 'changed' }, { id: 'c', ok: true }] }); };
  try {
    const rows = [{ uid: 'a', snapshot_hash: 'ha' }, { uid: 'b', snapshot_hash: 'hb' }, { uid: 'c', snapshot_hash: 'hc' }];
    const out = await decideMany(7, rows, 'accept');
    assert.equal(calls.length, 1, 'one request, not three');
    assert.deepEqual(calls[0], { url: '/cycles/raise/evidence/items/batch?project=7', body: { action: 'accept', items: [{ id: 'a', snapshot_hash: 'ha' }, { id: 'b', snapshot_hash: 'hb' }, { id: 'c', snapshot_hash: 'hc' }] } });
    assert.deepEqual(out, [{ uid: 'a', ok: true, code: null }, { uid: 'b', ok: false, code: 'changed' }, { uid: 'c', ok: true, code: null }]);
    // The request failing as a whole reports every row as not saved; nothing is called accepted that the server did not say.
    globalThis.fetch = async () => response({ detail: 'x' }, 503);
    assert.deepEqual((await decideMany(7, rows, 'dismiss')).map((r) => r.ok), [false, false, false]);
    // A row missing from the answer is not accepted.
    globalThis.fetch = async () => response({ results: [{ id: 'a', ok: true }] });
    assert.deepEqual((await decideMany(7, rows, 'accept')).map((r) => r.ok), [true, false, false]);
  } finally { globalThis.fetch = previous; }
});

test('Accept all says what it covers: the loaded page, the cap, what is left, and whether the server holds more', () => {
  const p = (uid) => ({ uid, source_label: 'connector', provider: 'mercury', can_accept: true, snapshot_hash: `h${uid}` });
  const many = Array.from({ length: 60 }, (_, i) => p(String(i)));
  const offer = { source: 'connector', provider: 'mercury' };
  assert.equal(acceptAllScope(many, offer, false), 'Applies to the 50 loaded proposals from this source, at most 50 per press. 10 more loaded ones wait for the next press. Each outcome is listed after.');
  assert.match(acceptAllScope([p('1')], offer, true), /Applies to the 1 loaded proposal from this source.*More are waiting on the server beyond this page; look again after this press to load them\./);
});

/* ------------------------------ Capital relationships: proposals in one request ------------------------------ */

test('Accept all on a note is ONE request with the note\'s proposal uids; a refused one is counted, the rest stand', async () => {
  const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  const proposals = [1, 2, 3].map((n) => ({ uid: U(n), investor: 'Bluefern Capital', payload: { prospect_id: 41, event_id: 5, type: 'next_step', text: `Step ${n}`, note_on: '2026-10-20', note: 'Good meeting' } }));
  const handle = (url, o = {}) => {
    if (/proposals\/accept-batch/.test(url)) return response({ requested: 3, applied: 2, failed: 1, results: [{ uid: U(1), ok: true }, { uid: U(2), ok: false, code: 'unknown_proposal' }, { uid: U(3), ok: true }] });
    if (/capital-relationships\/proposals/.test(url) && (o.method || 'GET') === 'GET') return response({ proposals, drafts: [] });
    return response({});
  };
  const v = await mount(h(MemoryRouter, null, h(CapRelProposals, { projectId: 3, onClose() {} })), handle);
  try {
    await v.click('caprel-proposals-all');
    await v.click('caprel-proposals-all-go');
    const posts = v.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1, 'one request, not one per proposal');
    assert.deepEqual(posts[0], { url: '/cycles/raise/capital-relationships/proposals/accept-batch?project=3', method: 'POST', body: { uids: [U(1), U(2), U(3)] } });
    assert.match(v.of('caprel-proposals'), /1\s+could not be accepted\. They are still listed\./);
  } finally { await v.close(); }
});

/* ------------------------------ Capital relationships: reconcile by stable id ------------------------------ */

const P = (id, name, stage, o = {}) => ({ id, name, stage, updated_at: '2026-10-12', ...o });
const at = (url, projectId = 3) => h(MemoryRouter, { initialEntries: [url] }, h(CapRelPipeline, { projectId, search: `?project_id=${projectId}` }));
const prospectsHandler = (byProject, record = { facts: [], main: [], side: [] }) => (url) => {
  if (/\/contacts\/raise-prospects\?/.test(url)) { const id = /project=(\d+)/.exec(url)?.[1] ?? /project_id=(\d+)/.exec(url)?.[1]; return Promise.resolve(response({ items: typeof byProject === 'function' ? byProject(id) : byProject })); }
  if (/\/records\/\d+\?/.test(url)) return Promise.resolve(response(record));
  return Promise.resolve(response({}));
};

test('an open investor comes from the address by stable id and the latest read; a removed investor is "no longer in this view", never a stale sheet', async () => {
  let rows = [P(41, 'Bluefern Capital', 'meeting'), P(42, 'Northwind Ventures', 'to_contact')];
  const v = await mount(at('/raise/capital-relationships/pipeline?project_id=3&investor=41'), prospectsHandler(() => rows));
  try {
    assert.ok(v.has('caprel-investor'), 'the address opens the investor sheet');
    assert.match(v.of('caprel-investor'), /Meeting/);
  } finally { await v.close(); }
  rows = [P(42, 'Northwind Ventures', 'to_contact')];
  const gone = await mount(at('/raise/capital-relationships/pipeline?project_id=3&investor=41'), prospectsHandler(() => rows));
  try {
    assert.ok(!gone.has('caprel-investor'), 'no sheet is drawn from a snapshot');
    assert.ok(gone.has('caprel-investor-gone'), 'an explicit state instead');
    assert.match(gone.of('caprel-investor-gone-line'), /no longer in this pipeline/);
    await gone.click('caprel-investor-gone-close');
    assert.ok(!gone.has('caprel-investor-gone'));
  } finally { await gone.close(); }
});

test('the list is in the address: refresh and Back land on the same view', async () => {
  const v = await mount(at('/raise/capital-relationships/pipeline?project_id=3&view=list'), prospectsHandler([P(41, 'Bluefern Capital', 'meeting')]));
  try {
    assert.ok(v.has('caprel-list') && !v.has('caprel-board'), 'view=list opens the list');
    await v.click('caprel-view-board');
    assert.ok(v.has('caprel-board') && !v.has('caprel-list'));
  } finally { await v.close(); }
});

test('switching ventures never draws the first venture\'s investors under the second', async () => {
  const pending = {};
  const handle = (url) => {
    if (/\/contacts\/raise-prospects\?/.test(url)) return new Promise((resolve) => { const id = /project(?:_id)?=(\d+)/.exec(url)[1]; pending[id] = (items) => resolve(response({ items })); });
    return Promise.resolve(response({}));
  };
  const v = await mount(at('/raise/capital-relationships/pipeline?project_id=3', 3), handle);
  try {
    pending[3]([P(41, 'Bluefern Capital', 'meeting')]); await v.tick();
    assert.match(v.of('caprel-pipeline'), /Bluefern Capital/);
    await v.render(at('/raise/capital-relationships/pipeline?project_id=4', 4));
    assert.ok(!/Bluefern Capital/.test(v.of('caprel-pipeline')), 'the other venture\'s investor is gone the moment the venture changes');
    assert.ok(v.has('caprel-pipeline-loading'));
    pending[4]([P(51, 'Osprey Partners', 'contacted')]); await v.tick();
    assert.match(v.of('caprel-pipeline'), /Osprey Partners/);
    assert.ok(!/Bluefern Capital/.test(v.of('caprel-pipeline')));
  } finally { await v.close(); }
});
