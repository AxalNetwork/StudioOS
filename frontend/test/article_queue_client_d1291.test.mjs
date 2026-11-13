// D1291 (#3387) — `adminArticles.queue` sends the queue read's new parameters
// and nothing empty; today's page, which passes `status` alone, sends what it
// always did.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/article_queue_client_d1291.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminArticles } from '../src/lib/api.js';

// The client reads the session from storage; an empty one is a signed-out tab.
if (!globalThis.localStorage) {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}

async function urlOf(args) {
  const before = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (u) => { seen = String(u); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ items: [] }), text: async () => '{"items":[]}' }; };
  try { await adminArticles.queue(args); } finally { globalThis.fetch = before; }
  return new URL(seen, 'https://axal.vc');
}

test('today\'s call is unchanged: a status, the limit and the offset', async () => {
  const u = await urlOf({ status: 'submitted' });
  assert.match(u.pathname, /\/api\/admin\/articles\/queue$/);
  assert.deepEqual([...u.searchParams], [['status', 'submitted'], ['limit', '50'], ['offset', '0']]);
  assert.deepEqual([...(await urlOf()).searchParams], [['limit', '50'], ['offset', '0']]);
});

test('the new parameters are sent, and empty ones are left out', async () => {
  const u = await urlOf({
    stage: 'scheduled', q: 'ports', author: 5, profile: 'founder', sector: '', reviewer: null, submitted_from: '2026-10-01',
    submitted_to: '2026-10-31', open_comments: 0, sort: 'goes_out', from: '2026-10-01', to: '2026-10-31', limit: 20, offset: 40, unknown: 'x',
  });
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    stage: 'scheduled', q: 'ports', author: '5', profile: 'founder', submitted_from: '2026-10-01', submitted_to: '2026-10-31',
    open_comments: '0', sort: 'goes_out', from: '2026-10-01', to: '2026-10-31', limit: '20', offset: '40',
  });
});
