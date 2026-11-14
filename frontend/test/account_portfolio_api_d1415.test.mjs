/**
 * D1415 (#3697, part 2): the Portfolio clients call the Worker routes
 * `cloudflare-worker/test/account_portfolio_d1415.test.ts` and
 * `portfolio_slugs_d1415.test.ts` hold, with these paths, verbs and bodies, and
 * api.js re-exports the module (D527).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { accountPortfolioApi } = await import('../src/lib/api/accountPortfolio.js');
const { accountPortfolioApi: viaApi } = await import('../src/lib/api.js');

test('every call: path, verb and body', async () => {
  // Mutations checked: the resolve path left unencoded → its query differs; an empty company still sent → the
  // project-only query differs; the slug sent as POST → its verb differs.
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await accountPortfolioApi.switcher();
    await accountPortfolioApi.settingsScope({ company: 'co north' });
    await accountPortfolioApi.settingsScope({ company: 'co-north', project: 10 });
    await accountPortfolioApi.settingsScope({ project: 11 });
    await accountPortfolioApi.resolve('/c/northwind/p/venture?tab=1');
    await accountPortfolioApi.setProjectSlug(10, 'venture');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['GET', '/api/account/switcher', null],
    ['GET', '/api/account/settings-scope?company=co+north', null],
    ['GET', '/api/account/settings-scope?company=co-north&project=10', null],
    ['GET', '/api/account/settings-scope?project=11', null],
    ['GET', '/api/account/resolve?path=%2Fc%2Fnorthwind%2Fp%2Fventure%3Ftab%3D1', null],
    ['PUT', '/api/projects/10/slug', { slug: 'venture' }],
  ]);
  assert.equal(viaApi, accountPortfolioApi, 'api.js re-exports the module (D527)');
});
