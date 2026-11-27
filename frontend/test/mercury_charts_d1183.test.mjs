import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { adminMercuryApi } from '../src/lib/api/adminMercury.js';

test('chart clients use the mounted GET reads, encode filters and keep the default range', async () => {
  const restore = installDocument(), previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ ok: true, items: [] });
  };
  try {
    await adminMercuryApi.balances();
    await adminMercuryApi.balances({ account: 'synthetic account', range: '12m' });
    await adminMercuryApi.monthly();
    await adminMercuryApi.monthly({ entity: 'holdings' });
    assert.deepEqual(calls.map(c => c.url.replace(/^.*\/api\//, '/api/')), [
      '/api/admin/mercury/balances?range=90d', '/api/admin/mercury/balances?account=synthetic+account&range=12m',
      '/api/admin/mercury/monthly', '/api/admin/mercury/monthly?entity=holdings',
    ]);
    for (const c of calls) { assert.equal(c.options.method ?? 'GET', 'GET'); assert.equal(c.options.body, undefined); }
  } finally { globalThis.fetch = previous; restore(); }
});
