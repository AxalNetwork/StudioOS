/**
 * D1158 (#3065) — the clients for the three fund admin reads: the LP roster's
 * query string (empty filters dropped, a flag sent as 1), and the positions
 * and quarterly history paths. `fetch` is stubbed; nothing leaves the test.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_reads_clients_d1158.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fundAdminApi } from '../src/lib/api/fundAdmin.js';
import { fundPerformanceApi } from '../src/lib/api/fundPerformance.js';

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

test('lps sends only the filters given, a flag as 1, and nothing for false or empty', async () => {
  assert.deepEqual(await seen(() => fundAdminApi.lps()), ['/api/fund-admin/lps']);
  assert.deepEqual(await seen(() => fundAdminApi.lps({
    fund: 3, lpa: 'signed', identity: '', booklet: null, outstanding: true, overdue: false, q: 'bravo', sort: 'called', dir: 'desc', page: 2, per_page: 25,
  })), ['/api/fund-admin/lps?fund=3&lpa=signed&outstanding=1&q=bravo&sort=called&dir=desc&page=2&per_page=25']);
});

test('positions and history read the fund\'s own paths, history by quarter', async () => {
  assert.deepEqual(await seen(async () => { await fundPerformanceApi.positions(4); await fundPerformanceApi.history(4); }),
    ['/api/fund-performance/4/positions', '/api/fund-performance/4/history?step=quarter']);
});
