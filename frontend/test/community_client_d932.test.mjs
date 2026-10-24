/**
 * D932 (#2716) — the Community client: one module (D527), one route, and a
 * query that carries only what was asked. What the Worker answers is tested in
 * cloudflare-worker/test/community_activity_d932.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_client_d932.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const seen = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.fetch = async (url) => {
  seen.push(String(url));
  return new Response(JSON.stringify({ rows: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { communityApi } = await import('../src/lib/api.js');

test('activity calls GET /api/admin/community/activity with only the filters that are set', async () => {
  seen.length = 0;
  assert.deepEqual(await communityApi.activity(), { rows: [], total: 0 });
  await communityApi.activity({ kind: 'admin', from: '2026-10-01', to: '2026-10-24', q: 'Demo Night', limit: 25, offset: 0 });
  await communityApi.activity({ kind: '', q: null, offset: 10 });
  assert.deepEqual(seen.map((u) => u.replace(/^https?:\/\/[^/]+/, '')), [
    '/api/admin/community/activity',
    '/api/admin/community/activity?kind=admin&from=2026-10-01&to=2026-10-24&q=Demo+Night&limit=25&offset=0',
    '/api/admin/community/activity?offset=10',
  ]);
});

test('the module is one line in api.js\'s alphabetical block, and calls only its one route', () => {
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  const lines = block.split('\n').filter((l) => l.startsWith('export * from'));
  assert.ok(lines.includes("export * from './api/community.js';"));
  assert.deepEqual(lines, [...lines].sort(), 'alphabetical');
  const client = read('frontend/src/lib/api/community.js');
  assert.deepEqual([...client.matchAll(/request\(`([^`$]+)/g)].map((m) => m[1]), ['/admin/community/activity']);
});
