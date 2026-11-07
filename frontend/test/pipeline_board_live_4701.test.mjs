/**
 * #4701 — the real Pipeline board, mounted, with a fake socket and stubbed
 * `api` methods: the states a reader can tell apart, and live state that
 * converges after a local move and after a reconnect.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_board_live_4701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import PipelinePage from '../src/pages/PipelinePage.jsx';

const h = React.createElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function stub(methods) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = api[k]; api[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete api[k]; else api[k] = v; } };
}

/** A socket the test drives by hand. */
class FakeWS {
  constructor() { this.readyState = 0; FakeWS.all.push(this); }
  send() {}
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  say(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}
FakeWS.OPEN = 1;
FakeWS.all = [];
function installSocket() {
  const prev = globalThis.WebSocket;
  FakeWS.all = [];
  globalThis.WebSocket = FakeWS;
  return () => { globalThis.WebSocket = prev; };
}
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await act(async () => { await tick(); }); }
}

const deal = (id, name, stage) => ({
  id, name, sector: 'saas', pipeline_stage: stage,
  task_counts: { todo: 0, in_progress: 0, done: 0 }, latest_metrics: null, latest_gate: null,
});
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

function boardOf(m) {
  const cols = m.nodes().filter((n) => m.props(n)?.onDrop);
  const card = (name) => m.nodes().find((n) => m.props(n)?.draggable && textOf(n).includes(name));
  const transfer = () => { const store = {}; return { dataTransfer: { effectAllowed: '', dropEffect: '', setData: (k, v) => { store[k] = v; }, getData: (k) => store[k] || '' } }; };
  return {
    drag(name, colIndex) {
      const t = transfer();
      m.props(card(name)).onDragStart({ ...t, preventDefault() {} });
      m.props(cols[colIndex]).onDrop({ ...t, preventDefault() {} });
    },
    columnOf: (name) => { const c = card(name); for (let p = c; p; p = p.parentNode) { const i = cols.indexOf(p); if (i >= 0) return i; } return -1; },
    hasCard: (name) => Boolean(card(name)),
  };
}
const byTestId = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);

async function mountBoard(methods) {
  const restoreApi = stub({
    getCurrentUser: async () => ({ id: 1, role: 'admin' }),
    getVotes: async () => { throw new Error('no votes'); },
    pipelineDealDetail: async (id) => ({ id, current_stage: 'idea', project: { name: `Deal ${id}`, status: 'active' }, tasks: [], metrics: [], gates: [], stages: [] }),
    ...methods,
  });
  const restoreWs = installSocket();
  const m = await mountContracts(h(PipelinePage, { embedded: true }));
  await m.flush();
  return { m, restore: () => { restoreWs(); restoreApi(); } };
}

test('a board whose first read fails says it could not be read — it is not an empty board — and Try again reads it', async () => {
  let fail = true;
  const { m, restore } = await mountBoard({
    pipelineActive: async () => { if (fail) throw new Error('boom-internal-detail'); return [deal(1, 'Alpha', 'idea')]; },
  });
  try {
    assert.ok(byTestId(m, 'pipeline-unreadable'), 'a failed first read drew a board');
    assert.doesNotMatch(m.text(), /boom-internal-detail/);
    assert.doesNotMatch(m.text(), /\bEmpty\b/, 'the unreadable board drew empty columns');
    fail = false;
    const retry = m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Try again');
    await act(async () => { m.props(retry).onClick({}); });
    await m.flush();
    assert.equal(byTestId(m, 'pipeline-unreadable'), undefined);
    assert.ok(boardOf(m).hasCard('Alpha'));
  } finally { await m.unmount(); restore(); }
});

test('a refresh that fails keeps the cards and says so; a board that answered nothing is just empty', async () => {
  let reads = 0;
  const { m, restore } = await mountBoard({
    pipelineActive: async () => { reads += 1; if (reads > 1) throw new Error('x'); return [deal(1, 'Alpha', 'idea')]; },
  });
  try {
    FakeWS.all[0].open();
    FakeWS.all[0].say({ type: 'stage_advanced', deal_id: 1 });
    await m.flush();
    assert.equal(reads, 2);
    assert.ok(boardOf(m).hasCard('Alpha'), 'a failed refresh blanked the board');
    assert.ok(byTestId(m, 'pipeline-refresh-error'));
  } finally { await m.unmount(); restore(); }
  const empty = await mountBoard({ pipelineActive: async () => [] });
  try {
    assert.equal(byTestId(empty.m, 'pipeline-unreadable'), undefined, 'an answered-empty board must not read as unreadable');
    assert.equal(byTestId(empty.m, 'pipeline-refresh-error'), undefined);
  } finally { await empty.m.unmount(); empty.restore(); }
});

test('a pages-after-the-first failure is shown as a partial board, not as the whole list', async () => {
  const { m, restore } = await mountBoard({
    pipelineActive: async () => ({ items: [deal(1, 'Alpha', 'idea')], total: 130, complete: false, remainder_error: true }),
  });
  try {
    const note = byTestId(m, 'pipeline-partial');
    assert.ok(note, 'a truncated board gave no sign of it');
    assert.match(textOf(note), /Showing 1 of 130 projects/);
  } finally { await m.unmount(); restore(); }
});

test('an event that lands during a local move is applied when the move settles, not dropped', async () => {
  // Mutation checked: dropping the event while a move is in flight (the old
  // behaviour) leaves the board on one read.
  let reads = 0;
  let serverBeta = 'idea';
  let serverAlpha = 'idea';
  const advance = deferred();
  const { m, restore } = await mountBoard({
    pipelineActive: async () => { reads += 1; return [deal(1, 'Alpha', serverAlpha), deal(2, 'Beta', serverBeta)]; },
    pipelineAdvance: () => advance.promise,
  });
  try {
    assert.equal(reads, 1);
    FakeWS.all[0].open();
    const b = boardOf(m);
    await act(async () => { b.drag('Alpha', 1); });
    // Someone else moves Beta while Alpha's write is in flight.
    serverBeta = 'traction_review';
    await act(async () => { FakeWS.all[0].say({ type: 'stage_advanced', deal_id: 2 }); });
    await m.flush();
    assert.equal(reads, 1, 'a re-read ran in the middle of a local move');
    serverAlpha = 'mvp_dev'; // the server took our move
    await act(async () => { advance.resolve({}); });
    await m.flush(); await m.flush();
    assert.equal(reads, 2, 'the event that arrived during the move was dropped');
    const after = boardOf(m);
    assert.equal(after.columnOf('Alpha'), 1, 'our confirmed move was undone');
    assert.equal(after.columnOf('Beta'), 2, 'the other person\'s move never arrived');
  } finally { await m.unmount(); restore(); }
});

test('a socket that drops and comes back re-reads the board', async () => {
  let reads = 0;
  let stage = 'idea';
  const { m, restore } = await mountBoard({
    pipelineActive: async () => { reads += 1; return [deal(1, 'Alpha', stage)]; },
  });
  try {
    FakeWS.all[0].open();
    await m.flush();
    assert.equal(reads, 1, 'the first connection must not re-read');
    stage = 'decision_gate'; // moved while the socket was down
    FakeWS.all[0].drop();
    await until(() => FakeWS.all.length === 2);
    await act(async () => { FakeWS.all[1].open(); });
    await m.flush();
    assert.equal(reads, 2, 'a reconnect did not re-read');
    assert.equal(boardOf(m).columnOf('Alpha'), 3);
  } finally { await m.unmount(); restore(); }
});

test('a pushed vote tally updates the card and keeps the viewer\'s own vote', async () => {
  const tally = (n, mine) => ({
    total_voters: n, total_weight: n * 3, strong_buy_pct: 0, threshold_reached: false,
    by_type: { Strong_Buy: { count: 0, weight: 0 }, Buy: { count: 0, weight: 0 }, Hold: { count: n, weight: n * 3 }, Pass: { count: 0, weight: 0 } },
    ...(mine ? { my_vote: { vote_type: 'Hold' } } : {}),
  });
  const { m, restore } = await mountBoard({
    pipelineActive: async () => [deal(1, 'Alpha', 'idea')],
    getVotes: async () => tally(1, true),
  });
  try {
    await m.flush();
    assert.match(m.text(), /1 voter\b/);
    assert.ok(m.nodes().some((n) => m.props(n)?.title === 'Hold (your vote)'));
    FakeWS.all[0].open();
    // The broadcast is the public aggregate: no my_vote.
    await act(async () => { FakeWS.all[0].say({ type: 'vote_updated', deal_id: 1, tally: tally(4, false), ts: 10 }); });
    await m.flush();
    assert.match(m.text(), /4 voters/);
    assert.ok(m.nodes().some((n) => m.props(n)?.title === 'Hold (your vote)'), 'someone else\'s vote erased the viewer\'s own');
  } finally { await m.unmount(); restore(); }
});

test('a tally that cannot be read says so instead of drawing nothing', async () => {
  const { m, restore } = await mountBoard({ pipelineActive: async () => [deal(1, 'Alpha', 'idea')] });
  try {
    await m.flush();
    assert.match(m.text(), /Votes unavailable right now/);
  } finally { await m.unmount(); restore(); }
});
