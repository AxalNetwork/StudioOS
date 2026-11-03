// D1434 (#3703 part 3): HQ › Payments › Move to live.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIRM_WORD, canMove, clearLines, cutoverView, movedText } from '../src/pages/admin/payments/cutoverModel.js';
import { MoveToLiveDialog } from '../src/pages/admin/payments/StripeDialogs.jsx';
import { stripeCutoverApi } from '../src/lib/api/stripeCutover.js';

const W = { customers: 3, subscriptions: 2, plans: 1, mirror_rows: 12, packs: 4 };

test('the keys go first: sandbox keys say so and offer no move', () => {
  assert.equal(cutoverView({ mode: 'test', stored_mode: 'test', would_clear: W }).state, 'keys_test');
  assert.match(cutoverView({ mode: 'test' }).line, /live secret key and the live webhook signing secret/);
  assert.equal(cutoverView({ mode: 'unconfigured' }).state, 'unconfigured');
  assert.equal(cutoverView(null).state, 'unreadable');
  assert.equal(canMove(cutoverView({ mode: 'test' }), 'go', 'live'), false);
});

test('live keys with sandbox records are ready; live records are done', () => {
  assert.equal(cutoverView({ mode: 'live', stored_mode: 'test' }).state, 'ready');
  assert.equal(cutoverView({ mode: 'live', stored_mode: null }).state, 'ready', 'never moved yet');
  assert.equal(cutoverView({ mode: 'live', stored_mode: 'live' }).state, 'done');
});

test('the move needs a reason and the word typed exactly', () => {
  const ready = cutoverView({ mode: 'live', stored_mode: 'test' });
  assert.equal(CONFIRM_WORD, 'live');
  assert.equal(canMove(ready, 'Owner approved', 'live'), true);
  assert.equal(canMove(ready, '  ', 'live'), false, 'no reason');
  // D1434: the word in any case (the owner typed LIVE), still nothing else.
  assert.equal(canMove(ready, 'x', 'Live'), true, 'any case');
  assert.equal(canMove(ready, 'x', ' LIVE '), true, 'any case, trimmed');
  assert.equal(canMove(ready, 'x', 'lives'), false, 'the word, not a longer one');
  assert.equal(canMove(ready, 'x', 'test'), false, 'not the other mode');
  assert.equal(canMove(ready, 'x', ''), false);
});

test('what changes is counted, and an unreadable count is never 0', () => {
  const lines = clearLines(W);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^1 paid plan goes back to free/);
  assert.match(lines[1], /^2 sandbox subscriptions are cleared/);
  assert.match(lines[3], /^4 sandbox token packs are archived/);
  assert.equal(clearLines({ ...W, packs: null }), null);
  assert.equal(clearLines(null), null);
});

test('the dialog draws the counts and keeps Move to live off until it may send', () => {
  const html = renderToStaticMarkup(React.createElement(MoveToLiveDialog, { view: cutoverView({ mode: 'live', stored_mode: 'test' }), wouldClear: W, onClose() {}, onDone() {} }));
  assert.match(html, /data-testid="pay-move-live-lines"/);
  assert.match(html, /1 paid plan goes back to free/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="pay-move-live-send"/, 'off until a reason and the word');
  const unread = renderToStaticMarkup(React.createElement(MoveToLiveDialog, { view: cutoverView({ mode: 'live' }), wouldClear: null, onClose() {}, onDone() {} }));
  assert.match(unread, /could not be counted, so it cannot run/);
});

test('the answer after a move, and the client sends to_mode, reason and confirm', async () => {
  assert.equal(movedText({ plans_reset: 2, members_notified: 2, catalog_synced: 9 }), 'Moved to live. 2 plans reset, 2 members told. 9 live products read into the price list.');
  assert.match(movedText({ plans_reset: 0, members_notified: 0, catalog_synced: null }), /refreshes on the next read/);
  const calls = [];
  const before = globalThis.fetch;
  const store = new Map();
  globalThis.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.fetch = async (url, init) => { calls.push([String(url), init]); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try { await stripeCutoverApi.run('live', 'Owner approved', 'live'); } finally { globalThis.fetch = before; }
  assert.match(calls[0][0], /\/api\/admin\/stripe\/cutover$/);
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { to_mode: 'live', reason: 'Owner approved', confirm: 'live' });
});
