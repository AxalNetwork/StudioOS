/**
 * D1587 (#3834): the deck grants client calls the Worker routes
 * `deck_grants_d1587.test.ts` holds, with these paths and verbs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_grants_api_d1587.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { deckGrantsApi } = await import('../src/lib/api/deckGrants.js');
const { deckGrantsApi: viaApi } = await import('../src/lib/api.js');

test('the investor read and the founder\'s grants: paths, verbs and bodies', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await deckGrantsApi.deck(9);
    await deckGrantsApi.grants(9);
    await deckGrantsApi.grant(9, { deck_id: 70, investor_user_id: 1 });
    await deckGrantsApi.grant(9, { deck_id: 70, investor_user_id: 1, include: { figures: false } });
    await deckGrantsApi.withdraw(9, 'a b/c');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['GET', '/api/deals/9/deck', null],
    ['GET', '/api/deals/9/deck-grants', null],
    ['POST', '/api/deals/9/deck-grants', { deck_id: 70, investor_user_id: 1 }],
    ['POST', '/api/deals/9/deck-grants', { deck_id: 70, investor_user_id: 1, include: { figures: false } }],
    ['DELETE', '/api/deals/9/deck-grants/a%20b%2Fc', null],
  ]);
  assert.equal(viaApi, deckGrantsApi, 'api.js re-exports the module (D527)');
});
