/**
 * D812 (#2258) — the product-testing API module: each method's path, verb and
 * body, against routes/testing.ts. Stubbed fetch only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_api_d812.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { adminTestingApi, partnerTestingApi, productTestingApi } from '../src/lib/api/productTesting.js';
import * as api from '../src/lib/api.js';

async function seen(run) {
  const restoreDoc = installDocument();
  const out = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    out.push([opts.method || 'GET', String(url).replace(/^.*\/api/, ''), opts.body ? JSON.parse(opts.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = prev; restoreDoc(); }
  return out;
}

test('a member lists, applies with consent only as the literal true, withdraws and reads the summary', async () => {
  // Mutation checked: send consent_email as given → a truthy string "yes" goes out as consent.
  const calls = await seen(async () => {
    await productTestingApi.programmes();
    await productTestingApi.myApplications();
    await productTestingApi.apply('p 1', { answers: ['Spreadsheets'], availability: 'Evenings', consentEmail: true });
    await productTestingApi.apply('p1', { answers: [], consentEmail: 'yes' });
    await productTestingApi.withdraw('a1');
    await productTestingApi.summary();
  });
  assert.deepEqual(calls, [
    ['GET', '/testing/programmes', null],
    ['GET', '/testing/applications/mine', null],
    ['POST', '/testing/programmes/p%201/apply', { answers: ['Spreadsheets'], availability: 'Evenings', consent_email: true }],
    ['POST', '/testing/programmes/p1/apply', { answers: [], availability: null, consent_email: false }],
    ['POST', '/testing/applications/a1/withdraw', null],
    ['GET', '/testing/summary', null],
  ]);
});

test('a partner and HQ reach their own routes', async () => {
  const calls = await seen(async () => {
    await partnerTestingApi.programmes();
    await partnerTestingApi.create({ product_name: 'X' });
    await partnerTestingApi.edit('p1', { summary: 'Y' });
    await partnerTestingApi.submit('p1');
    await partnerTestingApi.applicants('p1');
    await partnerTestingApi.pick('a1');
    await partnerTestingApi.decline('a1');
    await adminTestingApi.programmes('submitted');
    await adminTestingApi.programmes();
    await adminTestingApi.approve('p1');
    await adminTestingApi.reject('p1', 'Add the dates');
    await adminTestingApi.open('p1');
    await adminTestingApi.close('p1');
    await adminTestingApi.pick('a1');
  });
  assert.deepEqual(calls, [
    ['GET', '/partner/testing/programmes', null],
    ['POST', '/partner/testing/programmes', { product_name: 'X' }],
    ['PATCH', '/partner/testing/programmes/p1', { summary: 'Y' }],
    ['POST', '/partner/testing/programmes/p1/submit', null],
    ['GET', '/partner/testing/programmes/p1/applicants', null],
    ['POST', '/partner/testing/applications/a1/pick', null],
    ['POST', '/partner/testing/applications/a1/decline', null],
    ['GET', '/admin/testing/programmes?status=submitted', null],
    ['GET', '/admin/testing/programmes', null],
    ['POST', '/admin/testing/programmes/p1/approve', { note: null }],
    ['POST', '/admin/testing/programmes/p1/reject', { note: 'Add the dates' }],
    ['POST', '/admin/testing/programmes/p1/open', null],
    ['POST', '/admin/testing/programmes/p1/close', null],
    ['POST', '/admin/testing/applications/a1/pick', null],
  ]);
  assert.throws(() => adminTestingApi.programmes('nope'), /Unknown programme status/);
});

test('api.js re-exports the module (D527)', () => {
  assert.equal(api.productTestingApi, productTestingApi);
  assert.equal(api.partnerTestingApi, partnerTestingApi);
  assert.equal(api.adminTestingApi, adminTestingApi);
});
