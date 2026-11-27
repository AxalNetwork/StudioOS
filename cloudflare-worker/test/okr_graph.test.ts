/**
 * The roadmap dependency rules, exercised by calling them.
 *
 * `services/okrGraph.ts` is pure for this reason: the cycle check and the
 * blocked rule are where FB3 can be subtly wrong in a way no fixture would
 * notice, so they are tested as arithmetic rather than through a route.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the last one: that no state is
 * unreachable. An earlier draft of `statesFor` carried an `at_risk` state
 * derived as "downstream of something blocked, but not itself blocked", which is
 * provably empty — every item a blocked item blocks has that blocked item as an
 * unresolved direct upstream, so the direct rule claims it first. A state that
 * can never appear is the live-but-empty failure this whole change exists to
 * fix, and it nearly shipped one file from its own fix.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *        --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/okr_graph.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  indexEdges, isResolved, statesFor, wouldCycle, scenarioDiff, STATE_LABELS,
} from '../src/services/okrGraph.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, '../src/services/okrGraph.ts'), 'utf8');

const node = (id: number, kanban_status: string | null, quarter: string | null = null) =>
  ({ id, kanban_status, quarter });
const edge = (okr_id: number, blocks_okr_id: number) => ({ okr_id, blocks_okr_id });

// ── isResolved ────────────────────────────────────────────────────────────────

test('only `done` resolves a dependency, whatever its casing or padding', () => {
  assert.equal(isResolved(node(1, 'done')), true);
  assert.equal(isResolved(node(1, 'DONE')), true);
  assert.equal(isResolved(node(1, '  done ')), true);
  for (const status of ['now', 'next', 'later', 'shipped', 'complete', '', null]) {
    assert.equal(isResolved(node(1, status)), false, `"${status}" must not resolve a dependency`);
  }
  // `shipped` and `complete` are the tempting synonyms, and refusing them is
  // deliberate: `kanban_status` is written by the roadmap editor, whose only
  // terminal column is `done`. Accepting a word the editor cannot produce would
  // silently unblock nothing.
  assert.equal(isResolved(undefined), false, 'a missing node must not resolve a dependency');
});

// ── indexEdges ────────────────────────────────────────────────────────────────

test('an edge naming an id the node set does not have is dropped, not counted', () => {
  // A DANGLING EDGE MUST NOT BLOCK ANYTHING. Left in, it would mark its
  // neighbour blocked by an item that is not on screen — a warning the founder
  // cannot act on or clear.
  const nodes = [node(1, 'now'), node(2, 'now')];
  const { blockedBy, blocks } = indexEdges(nodes, [edge(1, 2), edge(99, 2), edge(1, 98)]);
  assert.deepEqual(blockedBy.get(2), [1]);
  assert.deepEqual(blocks.get(1), [2]);
  assert.equal(blockedBy.has(98), false);
  assert.equal(blocks.has(99), false);
  assert.equal(statesFor(nodes, [edge(99, 2)]).get(2), 'in_flight',
    'a dangling edge left item 2 blocked by something that does not exist');
});

test('a self-edge is dropped rather than blocking its own item forever', () => {
  const nodes = [node(1, 'now')];
  const { blockedBy } = indexEdges(nodes, [edge(1, 1)]);
  assert.equal(blockedBy.has(1), false);
  assert.equal(statesFor(nodes, [edge(1, 1)]).get(1), 'in_flight');
});

test('ids that arrive as strings still match — D1 and node:sqlite disagree on that', () => {
  const nodes = [{ id: 1, kanban_status: 'now' }, { id: 2, kanban_status: 'now' }];
  const states = statesFor(nodes, [{ okr_id: '1', blocks_okr_id: '2' } as never]);
  assert.equal(states.get(2), 'blocked', 'a string id stopped the edge from being read');
});

// ── statesFor ─────────────────────────────────────────────────────────────────

test('an item with an unresolved upstream is blocked; a resolved one frees it', () => {
  const nodes = [node(1, 'now'), node(2, 'now')];
  assert.equal(statesFor(nodes, [edge(1, 2)]).get(2), 'blocked');
  assert.equal(statesFor([node(1, 'done'), node(2, 'now')], [edge(1, 2)]).get(2), 'in_flight');
  // The blocker itself is not blocked by blocking.
  assert.equal(statesFor(nodes, [edge(1, 2)]).get(1), 'in_flight');
});

test('one unresolved upstream is enough, even beside several resolved ones', () => {
  const nodes = [node(1, 'done'), node(2, 'done'), node(3, 'next'), node(4, 'now')];
  const states = statesFor(nodes, [edge(1, 4), edge(2, 4), edge(3, 4)]);
  assert.equal(states.get(4), 'blocked', 'two done blockers hid one that is not');
});

test('a finished item is never blocked, however tangled its upstream', () => {
  const states = statesFor([node(1, 'now'), node(2, 'done')], [edge(1, 2)]);
  assert.equal(states.get(2), 'done', 'a warning was put on work nobody has to do again');
});

test('the stored column decides everything the graph does not', () => {
  const nodes = [node(1, 'now'), node(2, 'next'), node(3, 'later'), node(4, null), node(5, 'weird')];
  const states = statesFor(nodes, []);
  assert.equal(states.get(1), 'in_flight');
  // Everything that is not `now` and not `done` is not yet committed. An
  // unrecognised column reads as provisional rather than as in flight, which is
  // the conservative direction: it under-claims what is being worked on.
  for (const id of [2, 3, 4, 5]) assert.equal(states.get(id), 'provisional', `item ${id}`);
});

test('a long chain leaves every unresolved link blocked and the root free', () => {
  const nodes = [node(1, 'now'), node(2, 'next'), node(3, 'next'), node(4, 'later')];
  const states = statesFor(nodes, [edge(1, 2), edge(2, 3), edge(3, 4)]);
  assert.equal(states.get(1), 'in_flight', 'the root of the chain is the one nothing blocks');
  for (const id of [2, 3, 4]) assert.equal(states.get(id), 'blocked', `item ${id} in the chain`);
});

test('every state the labels declare is reachable — none is decoration', () => {
  // THE ONE THIS FILE IS FOR. A state in `STATE_LABELS` that no input can produce
  // is a chip that draws and never fills, which is the bug FB3 exists to fix.
  const nodes = [node(1, 'now'), node(2, 'now'), node(3, 'later'), node(4, 'done')];
  const seen = new Set(statesFor(nodes, [edge(1, 2)]).values());
  assert.deepEqual([...seen].sort(), ['blocked', 'done', 'in_flight', 'provisional']);
  assert.deepEqual(Object.keys(STATE_LABELS).sort(), ['blocked', 'done', 'in_flight', 'provisional'],
    'a label was added without an input that produces it — or a state lost its label');
});

test('the file does not quietly regrow an at_risk state', () => {
  // The proof that it cannot be occupied is in the docblock; this stops the
  // identifier coming back with a different derivation nobody re-checks. A
  // mention in PROSE is exactly what should survive, so the code is read without
  // it — the same treatment `_codeOnly` gives every other banned word here.
  const code = SRC.replace(/^\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/^\s*\*[^\n]*$/gm, '');
  assert.ok(!/at_risk/.test(code),
    'at_risk is back in okrGraph.ts — read the header before deriving it again');
});

// ── wouldCycle ────────────────────────────────────────────────────────────────

test('a cycle is refused, at one hop and at several', () => {
  assert.equal(wouldCycle([], 1, 1), true, 'an item cannot block itself');
  assert.equal(wouldCycle([edge(2, 1)], 1, 2), true, 'A→B refused because B→A exists');
  assert.equal(wouldCycle([edge(2, 3), edge(3, 1)], 1, 2), true, 'a three-item loop was allowed');
  assert.equal(wouldCycle([edge(2, 3), edge(3, 4), edge(4, 1)], 1, 2), true, 'a four-item loop was allowed');
});

test('a diamond is not a cycle, and neither is a second edge to the same item', () => {
  // A blocks B and C; both block D. Nothing is circular, and refusing it would
  // make the commonest real shape unrecordable.
  const edges = [edge(1, 2), edge(1, 3), edge(2, 4)];
  assert.equal(wouldCycle(edges, 3, 4), false, 'a diamond was refused as a cycle');
  assert.equal(wouldCycle(edges, 1, 4), false, 'a shortcut edge alongside a path was refused');
});

test('the cycle walk terminates on a graph that already contains one', () => {
  // Defensive: migration 254 has no constraint that can stop a loop reaching the
  // table by some other path, and a walk that hangs is worse than one that
  // answers wrongly.
  const looped = [edge(1, 2), edge(2, 1), edge(2, 3)];
  assert.equal(wouldCycle(looped, 3, 1), true);
  assert.equal(wouldCycle(looped, 5, 6), false);
});

// ── scenarioDiff ──────────────────────────────────────────────────────────────

test('a scenario reports only the items it actually moves', () => {
  const nodes = [node(1, 'now', 'Q3 2026'), node(2, 'next', 'Q4 2026'), node(3, 'later', null)];
  const moves = scenarioDiff(nodes, [
    { okr_id: 1, quarter: 'Q4 2026' },   // moved
    { okr_id: 2, quarter: 'Q4 2026' },   // same as live — not a move
    { okr_id: 3, quarter: 'Q1 2027' },   // from nothing to something
    { okr_id: 99, quarter: 'Q1 2027' },  // not an item on this roadmap
  ]);
  assert.deepEqual(moves, [
    { okr_id: 1, from: 'Q3 2026', to: 'Q4 2026' },
    { okr_id: 3, from: null, to: 'Q1 2027' },
  ]);
});

test('an empty string quarter is the same as none, on either side', () => {
  // `Number('')`'s cousin: a blank from a form and a NULL from the table are the
  // same fact, and reporting "moved from  to " as a move would put a row in
  // front of a founder that says nothing changed.
  const nodes = [node(1, 'now', ''), node(2, 'now', 'Q3 2026')];
  assert.deepEqual(scenarioDiff(nodes, [{ okr_id: 1, quarter: null }]), []);
  assert.deepEqual(scenarioDiff(nodes, [{ okr_id: 2, quarter: '' }]),
    [{ okr_id: 2, from: 'Q3 2026', to: null }]);
});

test('an item the scenario says nothing about is absent, not blank', () => {
  const nodes = [node(1, 'now', 'Q3 2026'), node(2, 'now', 'Q4 2026')];
  assert.deepEqual(scenarioDiff(nodes, [{ okr_id: 1, quarter: 'Q1 2027' }]),
    [{ okr_id: 1, from: 'Q3 2026', to: 'Q1 2027' }],
    'item 2 has no scenario row, so the scenario must not claim to move it');
});
