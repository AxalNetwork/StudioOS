/**
 * D983 (#2774) — the program requests' three clients on `programGrantsApi`:
 * HQ's list and its two answers. What the Worker answers is tested in
 * cloudflare-worker/test/program_requests_d983.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_requests_client_d983.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const seen = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url).replace(/^https?:\/\/[^/]+/, ''), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { programGrantsApi } = await import('../src/lib/api.js');

test('the list, approve and decline call their routes with exactly what they are given', async () => {
  seen.length = 0;
  await programGrantsApi.requests();
  await programGrantsApi.requests('open');
  await programGrantsApi.approveRequest('esc 1', { reason: 'Approved at the review.', terms: { capacity_cap: 60 } });
  await programGrantsApi.declineRequest('esc_2', { reason: 'Not this year.' });
  assert.deepEqual(seen, [
    { url: '/api/admin/program-grants/requests', method: 'GET', body: null },
    { url: '/api/admin/program-grants/requests?status=open', method: 'GET', body: null },
    { url: '/api/admin/program-grants/requests/esc%201/approve', method: 'POST', body: { reason: 'Approved at the review.', terms: { capacity_cap: 60 } } },
    { url: '/api/admin/program-grants/requests/esc_2/decline', method: 'POST', body: { reason: 'Not this year.' } },
  ]);
});
