// #4701 — Pipeline retrieval on the client: every page is read (or the screen
// says it could not be), an unreadable source is not an empty one, an answer
// belongs to the period/company/generation it was asked for, and a live event
// or a reconnect that lands during a local move is reconciled afterwards.
//
// Driven with stubbed clients (the real API module cannot load in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readAllPages, readAllLeadPages } from '../src/lib/pagedRead.js';
import useKeyedRead from '../src/hooks/useKeyedRead.js';
import useBoardSync from '../src/pages/pipeline/useBoardSync.js';
import { routeBoardEvent, acceptTally, mergePushedTally, BOARD_EVENTS } from '../src/pages/pipeline/liveEvents.js';
import { installDocument } from './_contracts_dom.mjs';

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// ── pagedRead ────────────────────────────────────────────────────────────────

test('readAllPages follows next_cursor to the end and keeps the first page totals', async () => {
  const pages = { null: { items: [1, 2], next_cursor: 'a', total: 5, open_count: 5 }, a: { items: [3, 4], next_cursor: 'b' }, b: { items: [5], next_cursor: null } };
  const asked = [];
  const r = await readAllPages(async (c) => { asked.push(c); return pages[c]; });
  assert.deepEqual(asked, [null, 'a', 'b']);
  assert.deepEqual(r.items, [1, 2, 3, 4, 5]);
  assert.equal(r.complete, true);
  assert.equal(r.remainder_error, false);
  assert.equal(r.open_count, 5, 'the first page totals survive');
});

test('a later page that fails keeps the rows read and says the rest is missing', async () => {
  const r = await readAllPages(async (c) => {
    if (c === null) return { items: [1, 2], next_cursor: 'a', total: 9 };
    throw new Error('D1 down');
  });
  assert.deepEqual(r.items, [1, 2]);
  assert.equal(r.complete, false);
  assert.equal(r.remainder_error, true);
  assert.equal(r.has_more, true);
});

test('a first page that fails throws: nothing was read, so nothing is shown as empty', async () => {
  await assert.rejects(() => readAllPages(async () => { throw new Error('nope'); }), /nope/);
});

test('a cursor that moves nowhere is a failure, not an infinite loop', async () => {
  let calls = 0;
  const r = await readAllPages(async (c) => { calls += 1; return c === null ? { items: [1], next_cursor: 'x' } : { items: [], next_cursor: 'x' }; }, { maxPages: 50 });
  assert.equal(r.remainder_error, true);
  assert.ok(calls <= 3);
});

test('readAllLeadPages pages leads and passes independently', async () => {
  const log = [];
  const r = await readAllLeadPages(async (c, p) => {
    log.push([c, p]);
    if (!c && !p) return { items: [1], next_cursor: 'L', passed: ['a'], passed_next_cursor: 'P', open_count: 3, passed_count: 2 };
    return { items: c ? [2, 3] : [], next_cursor: null, passed: p ? ['b'] : [], passed_next_cursor: null };
  });
  assert.deepEqual(r.items, [1, 2, 3]);
  assert.deepEqual(r.passed, ['a', 'b']);
  assert.equal(r.complete, true);
  assert.equal(r.open_count, 3);
});

// ── useKeyedRead ─────────────────────────────────────────────────────────────

function KeyedProbe({ keyed, read, out }) {
  const r = useKeyedRead(keyed, read);
  out.current = r;
  (out.renders ||= []).push([keyed, r.data]);
  return React.createElement('div', null, `${r.status}:${JSON.stringify(r.data)}`);
}
async function mountKeyed(initialKey, read) {
  const restore = installDocument();
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const out = { current: null };
  const render = (k) => act(async () => { root.render(React.createElement(KeyedProbe, { keyed: k, read, out })); });
  await render(initialKey);
  return { out, render, unmount: async () => { await act(async () => root.unmount()); restore(); } };
}

test('period responses that complete out of order never overwrite the newer selection', async () => {
  // Mutation checked: dropping the generation/key guard leaves the slow first
  // answer ("quarter") on screen under the "ytd" chip.
  const slow = deferred(), fast = deferred();
  const read = (k) => (k === 'quarter' ? slow.promise : fast.promise);
  let key = 'quarter';
  const v = await mountKeyed(key, () => read(key));
  try {
    key = 'ytd';
    await v.render('ytd');
    await act(async () => { fast.resolve('YTD-FIGURES'); });
    await tick();
    assert.equal(v.out.current.data, 'YTD-FIGURES');
    await act(async () => { slow.resolve('QUARTER-FIGURES'); });
    await tick();
    assert.equal(v.out.current.data, 'YTD-FIGURES', 'the older period overwrote the newer one');
    assert.equal(v.out.current.status, 'ready');
  } finally { await v.unmount(); }
});

test('a different company or period is loading, never the previous key\'s figures', async () => {
  const gate = deferred();
  let n = 0;
  const v = await mountKeyed('quarter|1', () => (n++ === 0 ? Promise.resolve('CO1') : gate.promise));
  try {
    await tick();
    assert.equal(v.out.current.data, 'CO1');
    await v.render('quarter|2');
    assert.equal(v.out.current.status, 'loading');
    assert.equal(v.out.current.data, null, 'company 1\'s figures were shown for company 2');
    // Not even for one render: the frame before the effect runs is on screen too.
    assert.equal(v.out.renders.some(([k, d]) => k === 'quarter|2' && d === 'CO1'), false,
      'a render drew the previous key\'s data under the new key');
  } finally { await v.unmount(); }
});

test('an unreadable first read is "unreadable", and a failed refresh keeps what was on screen', async () => {
  let mode = 'fail';
  const v = await mountKeyed('k', async () => { if (mode === 'fail') throw new Error('boom'); return 'DATA'; });
  try {
    await tick();
    assert.equal(v.out.current.status, 'unreadable');
    assert.equal(v.out.current.data, null);
    mode = 'ok';
    await act(async () => { v.out.current.reload(); });
    await tick();
    assert.equal(v.out.current.status, 'ready');
    mode = 'fail';
    await act(async () => { v.out.current.reload(); });
    await tick();
    assert.equal(v.out.current.status, 'ready', 'a failed background refresh blanked the view');
    assert.equal(v.out.current.data, 'DATA');
    assert.equal(v.out.current.refreshError, true);
  } finally { await v.unmount(); }
});

// ── useBoardSync ─────────────────────────────────────────────────────────────

function BoardProbe({ load, out }) {
  out.current = useBoardSync(load);
  return React.createElement('div', null, out.current.status);
}
async function mountBoard(load) {
  const restore = installDocument();
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const out = { current: null };
  await act(async () => { root.render(React.createElement(BoardProbe, { load, out })); });
  return { out, unmount: async () => { await act(async () => root.unmount()); restore(); } };
}
const deal = (id, stage = 'idea') => ({ id, name: `D${id}`, pipeline_stage: stage });

test('a board whose first read fails is unreadable, not an empty board', async () => {
  const b = await mountBoard(async () => { throw new Error('x'); });
  try {
    await tick();
    assert.equal(b.out.current.status, 'unreadable');
    assert.deepEqual(b.out.current.deals, []);
  } finally { await b.unmount(); }
});

test('initial loading, background refresh, empty and partial are four different states', async () => {
  const gate = deferred();
  let n = 0;
  const b = await mountBoard(() => (n++ === 0 ? Promise.resolve({ items: [], total: 0, complete: true }) : gate.promise));
  try {
    await tick();
    assert.equal(b.out.current.status, 'ready');
    assert.equal(b.out.current.deals.length, 0, 'an answered-empty board is ready, not unreadable');
    await act(async () => { b.out.current.reload(); });
    assert.equal(b.out.current.refreshing, true);
    assert.equal(b.out.current.status, 'ready', 'a refresh must not look like first load');
    await act(async () => { gate.resolve({ items: [deal(1)], total: 4, complete: false }); });
    await tick();
    assert.equal(b.out.current.partial, true);
    assert.equal(b.out.current.total, 4);
  } finally { await b.unmount(); }
});

test('a failed re-read keeps the rows already on the board', async () => {
  let n = 0;
  const b = await mountBoard(async () => { if (n++ === 0) return { items: [deal(1), deal(2)], complete: true }; throw new Error('x'); });
  try {
    await tick();
    await act(async () => { b.out.current.reload(); });
    await tick();
    assert.equal(b.out.current.status, 'ready');
    assert.equal(b.out.current.deals.length, 2);
    assert.equal(b.out.current.refreshError, true);
  } finally { await b.unmount(); }
});

test('an older re-read that lands after a newer one is dropped', async () => {
  const first = deferred(), second = deferred(), third = deferred();
  const gates = [first, second, third];
  let n = 0;
  const b = await mountBoard(() => gates[n++].promise);
  try {
    await act(async () => { first.resolve({ items: [deal(1)], complete: true }); });
    await tick();
    await act(async () => { b.out.current.reload(); });   // second
    await act(async () => { b.out.current.reload(); });   // third supersedes it
    await act(async () => { third.resolve({ items: [deal(1, 'decision_gate')], complete: true }); });
    await tick();
    await act(async () => { second.resolve({ items: [deal(1, 'idea')], complete: true }); });
    await tick();
    assert.equal(b.out.current.deals[0].pipeline_stage, 'decision_gate', 'a stale read overwrote a newer one');
  } finally { await b.unmount(); }
});

test('a board event during a local move is queued, and reconciled once the move settles', async () => {
  // Mutation checked: dropping the event (the old behaviour) leaves one read.
  let reads = 0;
  let serverStage = 'idea';
  const b = await mountBoard(async () => { reads += 1; return { items: [deal(1, serverStage), deal(2)], complete: true }; });
  try {
    await tick();
    assert.equal(reads, 1);
    assert.equal(b.out.current.beginMove(1), true);
    assert.equal(b.out.current.beginMove(1), false, 'a second move on the same card must be refused');
    await act(async () => { b.out.current.setDeals((d) => d.map((x) => (x.id === 1 ? { ...x, pipeline_stage: 'mvp_dev' } : x))); });
    // Someone else moves card 2 while ours is in flight.
    await act(async () => { b.out.current.refresh(); });
    await tick();
    assert.equal(reads, 1, 'a re-read ran in the middle of a local move');
    serverStage = 'mvp_dev';
    await act(async () => { b.out.current.endMove(1); });
    await tick();
    assert.equal(reads, 2, 'the event that arrived during the move was dropped');
    assert.equal(b.out.current.deals.find((d) => d.id === 1).pipeline_stage, 'mvp_dev');
  } finally { await b.unmount(); }
});

test('a read dropped while another move is still in flight is replaced when the last one settles', async () => {
  // Mutation checked: removing the generation bump lets the stale read land;
  // removing the stale mark leaves the board on "refreshing" with no re-read.
  const stale = deferred();
  let n = 0;
  const b = await mountBoard(() => {
    n += 1;
    if (n === 1) return Promise.resolve({ items: [deal(1), deal(2)], complete: true });
    if (n === 2) return stale.promise;
    return Promise.resolve({ items: [deal(1, 'mvp_dev'), deal(2, 'mvp_dev')], complete: true });
  });
  try {
    await tick();
    await act(async () => { b.out.current.refresh(); });      // read #2, in flight
    b.out.current.beginMove(1); b.out.current.beginMove(2);
    await act(async () => { b.out.current.endMove(1); });      // card 2 still moving
    await act(async () => { stale.resolve({ items: [deal(1, 'iterate'), deal(2, 'iterate')], complete: true }); });
    await tick();
    assert.equal(b.out.current.deals[0].pipeline_stage, 'idea', 'a read that predates the settled move landed');
    await act(async () => { b.out.current.endMove(2); });
    await tick();
    assert.equal(n, 3, 'the dropped read was never replaced');
    assert.equal(b.out.current.deals[0].pipeline_stage, 'mvp_dev');
    assert.equal(b.out.current.refreshing, false);
  } finally { await b.unmount(); }
});

test('a re-read that began before a move settled is dropped and replaced', async () => {
  const stale = deferred();
  let n = 0;
  const b = await mountBoard(() => {
    n += 1;
    if (n === 1) return Promise.resolve({ items: [deal(1)], complete: true });
    if (n === 2) return stale.promise;            // began before the move settled
    return Promise.resolve({ items: [deal(1, 'mvp_dev')], complete: true });
  });
  try {
    await tick();
    await act(async () => { b.out.current.refresh(); });  // read #2 in flight
    b.out.current.beginMove(1);
    await act(async () => { b.out.current.endMove(1); });  // move settles: #2 may predate it
    await tick();
    await act(async () => { stale.resolve({ items: [deal(1, 'idea')], complete: true }); });
    await tick();
    assert.equal(b.out.current.deals[0].pipeline_stage, 'mvp_dev', 'a read that predates the move landed over it');
  } finally { await b.unmount(); }
});

test('a socket reconnect re-reads the board, and a burst of events costs one extra read', async () => {
  const gate = deferred();
  let reads = 0;
  const b = await mountBoard(() => { reads += 1; return reads === 2 ? gate.promise : Promise.resolve({ items: [deal(1)], complete: true }); });
  try {
    await tick();
    assert.equal(reads, 1);
    await act(async () => { b.out.current.reconnected(); });
    assert.equal(reads, 2, 'a reconnect did not re-read');
    await act(async () => { b.out.current.refresh(); b.out.current.refresh(); b.out.current.refresh(); });
    assert.equal(reads, 2, 'events during a read must coalesce, not overlap');
    await act(async () => { gate.resolve({ items: [deal(1)], complete: true }); });
    await tick();
    assert.equal(reads, 3, 'the burst needs exactly one more read');
  } finally { await b.unmount(); }
});

// ── live events ──────────────────────────────────────────────────────────────

test('events route to a refresh or a tally; unknown and malformed messages are ignored', () => {
  const calls = [];
  const sink = { refresh: () => calls.push('refresh'), tally: (...a) => calls.push(['tally', ...a]) };
  for (const type of BOARD_EVENTS) assert.equal(routeBoardEvent({ type }, sink), 'refresh');
  assert.equal(routeBoardEvent({ type: 'vote_updated', deal_id: 7, tally: { total_voters: 2 }, ts: 50 }, sink), 'tally');
  assert.deepEqual(calls.at(-1), ['tally', 7, { total_voters: 2 }, 50]);
  assert.equal(routeBoardEvent({ type: 'vote_updated', deal_id: 7 }, sink), 'ignored', 'a vote event with no tally');
  assert.equal(routeBoardEvent({ type: 'weird' }, sink), 'ignored');
  assert.equal(routeBoardEvent(null, sink), 'ignored');
});

test('an older tally never replaces a newer one, and a pushed tally keeps the viewer\'s own vote', () => {
  let known = {};
  known = acceptTally(known, 7, { total_voters: 3 }, 200);
  known = acceptTally(known, 7, { total_voters: 2 }, 100);
  assert.equal(known[7].tally.total_voters, 3);
  known = acceptTally(known, 7, { total_voters: 4 }, 300);
  assert.equal(known[7].tally.total_voters, 4);
  const merged = mergePushedTally({ total_voters: 1, my_vote: { vote_type: 'Hold' } }, { total_voters: 4, by_type: {} });
  assert.equal(merged.total_voters, 4);
  assert.deepEqual(merged.my_vote, { vote_type: 'Hold' });
  assert.equal(mergePushedTally(null, { total_voters: 1 }).my_vote, null);
});

// ── wiring (the page uses these, not its own copies) ─────────────────────────

test('the board page wires the sync, the reconnect cue and the keyed drawer; the analytics zone is keyed to period and company', () => {
  const page = fs.readFileSync(new URL('../src/pages/PipelinePage.jsx', import.meta.url), 'utf8');
  assert.match(page, /useBoardSync\(/);
  assert.match(page, /onOpen:\s*\(\{ reconnect \}\) => \{ if \(reconnect\) board\.reconnected\(\)/);
  assert.match(page, /routeBoardEvent\(msg/);
  assert.match(page, /useKeyedRead\(dealId/);
  assert.match(page, /data-testid="pipeline-unreadable"/);
  assert.doesNotMatch(page, /pendingDealsRef/, 'the old drop-while-moving ref is back');
  const zone = fs.readFileSync(new URL('../src/pages/partner/pipeline/AnalyticsZone.jsx', import.meta.url), 'utf8');
  assert.match(zone, /useKeyedRead\(`\$\{view\}\|\$\{company\?\.id \?\? 'none'\}`/);
  const ws = fs.readFileSync(new URL('../src/hooks/useWebSocket.js', import.meta.url), 'utf8');
  assert.match(ws, /everOpenedRef/);
  assert.match(ws, /onOpenRef\.current\?\.\(\{ reconnect \}\)/);
});
