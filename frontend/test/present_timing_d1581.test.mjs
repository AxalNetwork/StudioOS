/**
 * D1581 (#3828, deck v2 F2) — Present's per-card budgets and its phone remote.
 *
 *   1. The budget is Rehearse's one split (`cardBudgetsMs`): this card's
 *      "0:42 of 0:30", amber when over, from the marks.
 *   2. A remote step moves Present as its keys do, or to a card by number;
 *      anything else changes nothing.
 *   3. The wiring: the presenter view draws the budget and listens on the
 *      remote's socket; it draws no pairing screen (needs-design); the client
 *      calls only routes the Worker mounts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PITCH_SECONDS, PITCH_CHOICES, presentBudget, remoteMove, remoteSocketPath } from '../src/pages/raise/pitch/presentTimingModel.js';
import { cardBudgetsMs } from '../src/pages/raise/pitch/rehearseModel.js';
import { deckRemoteApi } from '../src/lib/api/deckRemote.js';

const read = (p) => readFileSync(p, 'utf8');

test('1. the budget: Rehearse\'s split, this card\'s time against it, amber when over', () => {
  // Mutation checked: a second split (pitch ÷ cards, rounded) → the 7-card 3-minute shares differ.
  assert.equal(DEFAULT_PITCH_SECONDS, 180);
  assert.deepEqual(PITCH_CHOICES.map((c) => c.seconds), [120, 180, 300]);
  const marks = [{ card: 1, at_ms: 0 }, { card: 2, at_ms: 20_000 }];
  // 7 cards in 3 minutes: 26, 26, 26, 26, 26, 25, 25 seconds (the first take the leftover).
  assert.deepEqual(cardBudgetsMs(180, 7), [26000, 26000, 26000, 26000, 26000, 25000, 25000]);
  assert.deepEqual(presentBudget(marks, 62_000, 7, 1, 180), { spent: 42_000, budget: 26_000, line: '0:42 of 0:26', over: true });
  assert.deepEqual(presentBudget(marks, 30_000, 7, 1, 180), { spent: 10_000, budget: 26_000, line: '0:10 of 0:26', over: false });
  assert.equal(presentBudget(marks, 30_000, 7, 0, 180).line, '0:20 of 0:26', 'card 1 keeps the time it had');
  // 6 cards in 3 minutes: 0:30 each.
  assert.equal(presentBudget([{ card: 4, at_ms: 0 }], 42_000, 6, 3, 180).line, '0:42 of 0:30');
  assert.equal(presentBudget([], 1000, 6, 0, 180), null, 'nothing before a card has come up');
  assert.equal(presentBudget(marks, 1000, 0, 0, 180), null);
});

test('2. a remote step moves Present as its keys do, or to a card by number', () => {
  assert.deepEqual(['next', 'prev', 'first', 'last'].map((s) => remoteMove(3, s, 8)), [4, 2, 0, 7]);
  assert.equal(remoteMove(7, 'next', 8), 7, 'the last card stays');
  assert.equal(remoteMove(3, { card: 6 }, 8), 5, '1-based card number');
  assert.equal(remoteMove(3, { card: 9 }, 8), 3, 'a card the deck does not have changes nothing');
  assert.equal(remoteMove(3, 'exit', 8), 3, 'Esc is the presenter\'s alone');
  assert.equal(remoteMove(3, null, 8), 3);
  assert.equal(remoteSocketPath(42), '/api/decks/42/remote/ws');
});

test('3. the wiring: the presenter view draws the budget and obeys the remote; no pairing screen; the client calls mounted routes', () => {
  // Mutation checked: Present ignoring the `step` frame → the onRemote line no longer matches.
  const src = read('frontend/src/pages/raise/pitch/PitchPresent.jsx');
  assert.match(src, /<Budget marks=\{marks\}/);
  assert.match(src, /presentBudget\(marks, Date\.now\(\), n, i, pitchSeconds\)/);
  assert.match(src, /frame\?\.type !== 'step' \|\| view === 'rehearse'/);
  assert.match(src, /remoteMove\(at\.card, frame\.step, n\)/);
  assert.match(src, /useWebSocket\(status === 'ok' && deck\?\.id && !phone \? remoteSocketPath\(deck\.id\)/);
  assert.doesNotMatch(src, /deckRemoteApi|remote\/pair|Pair a phone/i, 'the pairing screen waits on design');
  assert.doesNotMatch(read('frontend/src/pages/raise/pitch/presentTimingModel.js'), /\/ n\b|Math\.round\(pitch/, 'no second split');
  // The client's paths are the Worker's: each client call names a route deck_remote.ts mounts.
  const client = read('frontend/src/lib/api/deckRemote.js');
  const worker = read('cloudflare-worker/src/routes/deck_remote.ts');
  const pairs = [
    ["/remote/pair`, { method: 'POST' }", "deckRemote.post('/:id{[0-9]+}/remote/pair'"],
    ["/remote`)", "deckRemote.get('/:id{[0-9]+}/remote'"],
    ["/remote`, { method: 'DELETE' }", "deckRemote.delete('/:id{[0-9]+}/remote'"],
    ["request('/decks/remote/join', { method: 'POST'", "deckRemote.post('/remote/join'"],
    ["/remote/step`, { method: 'POST'", "deckRemote.post('/:id{[0-9]+}/remote/step'"],
  ];
  for (const [c, w] of pairs) { assert.ok(client.includes(c), `client: ${c}`); assert.ok(worker.includes(w), `worker: ${w}`); }
  assert.ok(worker.includes("deckRemote.get('/:id{[0-9]+}/remote/ws'"));
  assert.deepEqual(Object.keys(deckRemoteApi).sort(), ['join', 'pair', 'state', 'step', 'unpair']);
});
