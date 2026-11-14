/**
 * D1197 (#3147) — the client for HQ's two new Product testing reads: each
 * path and query against routes/testing.ts. Stubbed fetch only. Behaviour is
 * the Worker test's (cloudflare-worker/test/product_testing_reads_d1197.test.ts).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_reads_d1197.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { adminTestingApi } from '../src/lib/api/productTesting.js';

async function seen(run) {
  const restoreDoc = installDocument();
  const out = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    out.push([opts.method || 'GET', String(url).replace(/^.*\/api/, '')]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = prev; restoreDoc(); }
  return out;
}

test('a programme\'s history is paged; applications send only the filters given', async () => {
  const calls = await seen(async () => {
    await adminTestingApi.events('p 1');
    await adminTestingApi.events('p1', { page: 2, pageSize: 50 });
    await adminTestingApi.applications();
    await adminTestingApi.applications({ programme: 'p1', owner: 'partner:3', status: 'all', role: '', consented: 'no', tester: 'yes', q: 'fr', sort: 'name', page: 2, page_size: 25, other: 'x' });
    await adminTestingApi.applicants('p1');
  });
  assert.deepEqual(calls, [
    ['GET', '/admin/testing/programmes/p%201/events?page=1'],
    ['GET', '/admin/testing/programmes/p1/events?page=2&page_size=50'],
    ['GET', '/admin/testing/applications'],
    ['GET', '/admin/testing/applications?programme=p1&owner=partner%3A3&status=all&consented=no&tester=yes&q=fr&sort=name&page=2&page_size=25'],
    ['GET', '/admin/testing/programmes/p1/applicants'],
  ]);
});
