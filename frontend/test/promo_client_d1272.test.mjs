/**
 * D1272 (#3298) — the client for Promo codes part 2: the paged list, the
 * lifecycle and Replace, against routes/admin_promos.ts; and today's
 * `api.adminListPromos`, which walks the pages so the console and the product
 * lightbox still see every code. Stubbed fetch only; behaviour is the Worker
 * test's (cloudflare-worker/test/promo_lifecycle_d1272.test.ts).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/promo_client_d1272.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { adminPromosApi } from '../src/lib/api/adminPromos.js';

async function seen(run, answer = () => ({})) {
  const restoreDoc = installDocument();
  const out = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    out.push([opts.method || 'GET', path, opts.body ? JSON.parse(opts.body) : undefined]);
    return new Response(JSON.stringify(answer(path)), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let result;
  try { result = await run(); } finally { globalThis.fetch = prev; restoreDoc(); }
  return { out, result };
}

test('the list sends only the filters given; change and replace name their code', async () => {
  const { out } = await seen(async () => {
    await adminPromosApi.list();
    await adminPromosApi.list({ q: 'spr', state: 'paused', applies: '', sort: 'code', page: 2, page_size: 25, other: 'x' });
    await adminPromosApi.change('promo 1', { action: 'end', reason: 'Over.' });
    await adminPromosApi.replace('promo_1', { type: 'percent', code: 'NEW15', percent_off: 15, reason: 'More off.' });
  });
  assert.deepEqual(out, [
    ['GET', '/admin/promos', undefined],
    ['GET', '/admin/promos?q=spr&state=paused&sort=code&page=2&page_size=25', undefined],
    ['PATCH', '/admin/promos/promo%201', { action: 'end', reason: 'Over.' }],
    ['POST', '/admin/promos/promo_1/replace', { type: 'percent', code: 'NEW15', percent_off: 15, reason: 'More off.' }],
  ]);
});

test('adminListPromos walks the pages until the total, so no code is cut off', async () => {
  const rows = Array.from({ length: 230 }, (_, i) => ({ id: `p${i}` }));
  const { out, result } = await seen(() => api.adminListPromos(), (path) => {
    const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
    return { promos: rows.slice((page - 1) * 100, page * 100), total: rows.length };
  });
  assert.deepEqual(out.map((c) => c[1]), ['/admin/promos?page=1&page_size=100', '/admin/promos?page=2&page_size=100', '/admin/promos?page=3&page_size=100']);
  assert.equal(result.promos.length, 230);
  const empty = await seen(() => api.adminListPromos(), () => ({ promos: [], total: 0 }));
  assert.equal(empty.out.length, 1, 'no codes is one read');
});
