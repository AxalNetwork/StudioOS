/**
 * D1136 (#3016): the Account › Companies and projects clients call the Worker
 * routes the Worker test holds, with these paths and verbs, and none sends a body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { accountCompaniesApi } = await import('../src/lib/api/accountCompanies.js');
const { accountCompaniesApi: viaApi } = await import('../src/lib/api.js');

test('the reads and the answers: paths, verbs and no body', async () => {
  // Mutation checked: the uid left unencoded → the company path differs; decline sent to accept → the last path differs.
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ?? null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await accountCompaniesApi.companies();
    await accountCompaniesApi.projects();
    await accountCompaniesApi.invitations();
    await accountCompaniesApi.acceptCompanyInvitation('a b/c');
    await accountCompaniesApi.acceptProjectInvitation(7);
    await accountCompaniesApi.declineProjectInvitation(7);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['GET', '/api/account/companies', null],
    ['GET', '/api/account/projects', null],
    ['GET', '/api/account/invitations', null],
    ['POST', '/api/company/invitations/a%20b%2Fc/accept', null],
    ['POST', '/api/projects/invitations/7/accept', null],
    ['POST', '/api/projects/invitations/7/decline', null],
  ]);
  assert.equal(viaApi, accountCompaniesApi, 'api.js re-exports the module (D527)');
});
