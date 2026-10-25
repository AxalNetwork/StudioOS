/**
 * D1132 (#3012) — the clients for the inbox's filters, one inbox item and one
 * co-marketing pitch. `fetch` is stubbed; nothing leaves the test.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/approvals_gaps_clients_d1132.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminApprovalsApi } from '../src/lib/api/adminApprovals.js';
import { api } from '../src/lib/api.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

async function seen(run) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    urls.push(`${u.pathname}${u.search}`);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = original; }
  return urls;
}

test('the inbox sends the page, then only the filters given', async () => {
  assert.deepEqual(await seen(() => adminApprovalsApi.inbox()), ['/api/admin/approvals?page=1']);
  assert.deepEqual(await seen(() => adminApprovalsApi.inbox(2, {
    q: 'design', lane: 'jobs', group: '', age: null, assigned: 'me', sort: 'newest', other: 'x',
  })), ['/api/admin/approvals?page=2&q=design&lane=jobs&assigned=me&sort=newest']);
});

test('one item and one pitch read their own addresses', async () => {
  assert.deepEqual(await seen(async () => {
    await adminApprovalsApi.item('jobs', 101);
    await api.adminCoMarketingPitch('pitch a');
  }), ['/api/admin/approvals/items/jobs/101', '/api/comarketing/admin/pitches/pitch%20a']);
});
