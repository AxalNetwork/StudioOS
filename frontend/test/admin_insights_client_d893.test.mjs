/**
 * D893 (#2660, #2661) — the Insights client: one module (D527), the read and the
 * export, and a query that carries only what was asked. What the Worker answers is tested in
 * cloudflare-worker/test/admin_insights_d893.test.ts.
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
const sent = [];
globalThis.fetch = async (url, init = {}) => {
  seen.push(String(url));
  sent.push({ method: init.method || 'GET', body: init.body ?? null });
  return new Response(JSON.stringify({ range: '8w' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { insightsApi } = await import('../src/lib/api.js');

test('adminInsights calls GET /api/admin/insights with only the filters that are set', async () => {
  seen.length = 0;
  assert.deepEqual(await insightsApi.adminInsights(), { range: '8w' });
  await insightsApi.adminInsights({ range: 'year', profile: 'founder', country: 'Côte d\'Ivoire', compare: true, group: '', scope: null });
  await insightsApi.adminInsights({ compare: false, range: 'quarter' });
  const paths = seen.map((u) => u.replace(/^https?:\/\/[^/]+/, ''));
  assert.deepEqual(paths, [
    '/api/admin/insights',
    '/api/admin/insights?range=year&profile=founder&country=C%C3%B4te+d%27Ivoire&compare=1',
    '/api/admin/insights?range=quarter',
  ]);
});

test('the module is one line in api.js\'s alphabetical block, and calls only its one route', () => {
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  const lines = block.split('\n').filter((l) => l.startsWith('export * from'));
  assert.ok(lines.includes("export * from './api/insights.js';"));
  assert.deepEqual(lines, [...lines].sort(), 'alphabetical');
  const client = read('frontend/src/lib/api/insights.js');
  assert.deepEqual([...client.matchAll(/request\([`']([^`'$]+)/g)].map((m) => m[1]), ['/admin/insights', '/admin/insights/export']);
});

test('insightsExport POSTs the body to /api/admin/insights/export (#2661)', async () => {
  seen.length = 0; sent.length = 0;
  const body = { what: 'group', format: 'pdf', range: 'year', group: 'founder' };
  await insightsApi.insightsExport(body);
  assert.deepEqual(seen.map((u) => u.replace(/^https?:\/\/[^/]+/, '')), ['/api/admin/insights/export']);
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual(JSON.parse(sent[0].body), body);
});
