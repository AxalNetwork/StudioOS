/**
 * #3932: `companyLegalApi.setDefaultCurrency` sends the code (or null) to
 * PATCH /api/company/:uid, the route `cloudflare-worker/test/company_default_currency_3932.test.ts`
 * holds, and api.js re-exports it through the module (D527).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { companyLegalApi } = await import('../src/lib/api/companyLegal.js');
const { companyLegalApi: viaApi } = await import('../src/lib/api.js');

test('setDefaultCurrency: PATCH the company, with the code or null, and nothing else', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await companyLegalApi.setDefaultCurrency('co north', 'EUR');
    await companyLegalApi.setDefaultCurrency('co north', null);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['PATCH', '/api/company/co%20north', { default_currency: 'EUR' }],
    ['PATCH', '/api/company/co%20north', { default_currency: null }],
  ]);
  assert.equal(viaApi.setDefaultCurrency, companyLegalApi.setDefaultCurrency, 'api.js re-exports the same module');
});
