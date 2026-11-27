/**
 * D1032 (#2873): the clients for My events part 2 call the Worker routes the
 * Worker test holds, with these paths, verbs and bodies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { eventsApi } = await import('../src/lib/eventsApi.js');
const { eventsPublic } = await import('../src/lib/api.js');

async function calls(run) {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return seen;
}

test('the list pages Past; invitations are read and answered signed in; the host cancels with a note', async () => {
  // Mutation checked: `past_offset` sent as `offset` → the second path differs; the note dropped → the first cancel's body differs.
  assert.deepEqual(await calls(async () => {
    await eventsApi.list();
    await eventsApi.list({ pastLimit: 10, pastOffset: 20 });
    await eventsApi.invitations();
    await eventsApi.answerInvitation(7, 'accept');
    await eventsApi.cancel(7, 'Venue fell through');
    await eventsApi.cancel(8);
  }), [
    ['GET', '/api/events', null],
    ['GET', '/api/events?past_limit=10&past_offset=20', null],
    ['GET', '/api/events/invitations', null],
    ['POST', '/api/events/7/invitation', { action: 'accept' }],
    ['POST', '/api/events/7/cancel', { note: 'Venue fell through' }],
    ['POST', '/api/events/8/cancel', {}],
  ]);
});

test('Discover sends format and price only when chosen', async () => {
  assert.deepEqual((await calls(async () => {
    await eventsPublic.list({ format: 'in_person', price: 'free' });
    await eventsPublic.list({});
  })).map(([, path]) => path), [
    '/api/public/events?limit=20&offset=0&format=in_person&price=free',
    '/api/public/events?limit=20&offset=0',
  ]);
});
