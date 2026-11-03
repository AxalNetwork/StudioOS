/**
 * D1600 (#3879): the deck batches client's retry, banner and seen calls reach
 * the Worker routes `deck_batch_retry_d1600.test.ts` holds, with these paths,
 * verbs, bodies and the Idempotency-Key; the adapter answers through them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_batches_retry_d1600.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { deckBatchesApi } = await import('../src/lib/api/deckBatches.js');
const { deckBatchesApi: viaApi } = await import('../src/lib/api.js');
const adapter = await import('../src/pages/raise/pitch/deckV2Adapter.js');

const UID = '00000000-0000-4000-8000-000000000001';

test('retryFailed, unseenBatches and markSeen: paths, verbs, bodies and the Idempotency-Key', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null, headers.get('Idempotency-Key')]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await deckBatchesApi.retryFailed(UID, {}, 'retry-key-0001');
    await deckBatchesApi.retryFailed(UID, { areas: ['a5'] }, 'retry-key-0002');
    await deckBatchesApi.unseenBatches(7);
    await deckBatchesApi.markSeen(UID);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['POST', `/api/decks/areas/batches/${UID}/retry-failed`, {}, 'retry-key-0001'],
    ['POST', `/api/decks/areas/batches/${UID}/retry-failed`, { areas: ['a5'] }, 'retry-key-0002'],
    ['GET', '/api/decks/7/batches?state=done&unseen=1', null, null],
    ['POST', `/api/decks/areas/batches/${UID}/seen`, null, null],
  ]);
  assert.equal(viaApi, deckBatchesApi, 'api.js re-exports the module (D527)');
});

test('the adapter answers through the client: a value, and 402 hold_exhausted as unreadable with its code and quote', async () => {
  const orig = globalThis.fetch;
  const replies = [
    [200, { batches: [{ batch_uid: UID, finished_at: '2026-11-02 10:00:00', cards_waiting: 12 }] }],
    [402, { error: 'hold_exhausted', message: 'What is left of this build\'s hold cannot cover the retry.', quote: { microusd: 2000 }, hold_remaining_microusd: 800 }],
  ];
  globalThis.fetch = async () => { const [status, body] = replies.shift(); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); };
  try {
    const banner = await adapter.unseenBatches(7);
    assert.deepEqual(banner, { available: true, value: { batches: [{ batch_uid: UID, finished_at: '2026-11-02 10:00:00', cards_waiting: 12 }] } });
    const refused = await adapter.retryFailed(UID, {}, 'retry-key-0003');
    assert.deepEqual([refused.available, refused.unreadable, refused.status, refused.code], [false, true, 402, 'hold_exhausted']);
    assert.deepEqual([refused.data.quote, refused.data.hold_remaining_microusd], [{ microusd: 2000 }, 800], 'the page reads the new quote to confirm');
    assert.equal(adapter.SWAPPED.includes('retryFailed') && adapter.SWAPPED.includes('unseenBatches') && adapter.SWAPPED.includes('markSeen'), true);
  } finally { globalThis.fetch = orig; }
});
