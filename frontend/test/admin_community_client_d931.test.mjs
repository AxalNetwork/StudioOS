/**
 * D931 (#2715) — the Community client: one module (D527), one route, and a
 * query that carries only the weeks asked for. What the Worker answers is
 * tested in cloudflare-worker/test/admin_community_d931.test.ts.
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
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url), method: init.method || 'GET' });
  return new Response(JSON.stringify({ weeks: 4 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { communityApi } = await import('../src/lib/api.js');

test('overview calls GET /api/admin/community/overview, with weeks only when it is set', async () => {
  seen.length = 0;
  assert.deepEqual(await communityApi.overview(), { weeks: 4 });
  await communityApi.overview({ weeks: 12 });
  await communityApi.overview({ weeks: 52 });
  assert.deepEqual(seen.map((s) => [s.method, s.url.replace(/^https?:\/\/[^/]+/, '')]), [
    ['GET', '/api/admin/community/overview'],
    ['GET', '/api/admin/community/overview?weeks=12'],
    ['GET', '/api/admin/community/overview?weeks=52'],
  ]);
});

test('the module is one line in api.js\'s alphabetical block, and calls only its one route', () => {
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  const lines = block.split('\n').filter((l) => l.startsWith('export * from'));
  assert.ok(lines.includes("export * from './api/community.js';"));
  assert.deepEqual(lines, [...lines].sort(), 'alphabetical');
  const client = read('frontend/src/lib/api/community.js');
  assert.deepEqual([...client.matchAll(/request\(`([^`$?]+)/g)].map((m) => m[1]), ['/admin/community/overview']);
});
