/**
 * D1591 (#3858): slugsApi.check calls the Worker's GET /api/account/slug-check
 * with its query, sends no body, and is re-exported by api.js (D527).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { slugsApi } = await import('../src/lib/api/slugs.js');
const { slugsApi: viaApi } = await import('../src/lib/api.js');

test('the check: path, query, verb and no body', async () => {
  // Mutation checked: `company` dropped from the query → the second path differs; target 0 skipped → the third differs.
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ?? null]);
    return new Response('{"available":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await slugsApi.check({ kind: 'company', slug: 'Harbor Ledger' });
    await slugsApi.check({ kind: 'project', slug: 'ledgerline', company: 'co-north', target: 10 });
    await slugsApi.check({ kind: 'project', slug: 'x', target: 0 });
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['GET', '/api/account/slug-check?kind=company&slug=Harbor+Ledger', null],
    ['GET', '/api/account/slug-check?kind=project&slug=ledgerline&company=co-north&target=10', null],
    ['GET', '/api/account/slug-check?kind=project&slug=x&target=0', null],
  ]);
  assert.equal(viaApi, slugsApi, 'api.js re-exports the module (D527)');
});
