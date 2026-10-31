/**
 * D1415 (#3697, part 1): the company legal-record clients call the Worker
 * routes `cloudflare-worker/test/company_legal_d1415.test.ts` holds, with these
 * paths, verbs and bodies, and api.js re-exports the module (D527).
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

test('every call: path, verb and body', async () => {
  // Mutations checked: the uid left unencoded → every path differs; `full` dropped → the tax-id read loses ?full=1;
  // cease sent as PATCH → its verb differs; the tax ID sent as `taxId` → the body differs.
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const u = 'co north';
  try {
    await companyLegalApi.legal(u);
    await companyLegalApi.saveLegal(u, { legal_form: 'llc' });
    await companyLegalApi.taxId(u);
    await companyLegalApi.taxId(u, { full: true });
    await companyLegalApi.saveTaxId(u, 'ein', '12-3456789');
    await companyLegalApi.officers(u);
    await companyLegalApi.addOfficer(u, { name: 'Ada Made-up', office: 'officer', title: 'CEO' });
    await companyLegalApi.editOfficer(u, 'o/1', { title: 'CFO' });
    await companyLegalApi.ceaseOfficer(u, 'o/1', '2026-06-30');
    await companyLegalApi.ceaseOfficer(u, 'o/1');
    await companyLegalApi.locations(u);
    await companyLegalApi.addLocation(u, { kind: 'office', country: 'GB' });
    await companyLegalApi.editLocation(u, 'l 1', { city: 'Leeds' });
    await companyLegalApi.closeLocation(u, 'l 1');
    await companyLegalApi.setCompanySlug(u, 'northwind');
  } finally { globalThis.fetch = orig; }
  const b = '/api/company/co%20north';
  assert.deepEqual(seen, [
    ['GET', `${b}/legal`, null],
    ['PUT', `${b}/legal`, { legal_form: 'llc' }],
    ['GET', `${b}/tax-id`, null],
    ['GET', `${b}/tax-id?full=1`, null],
    ['PUT', `${b}/tax-id`, { kind: 'ein', tax_id: '12-3456789' }],
    ['GET', `${b}/officers`, null],
    ['POST', `${b}/officers`, { name: 'Ada Made-up', office: 'officer', title: 'CEO' }],
    ['PATCH', `${b}/officers/o%2F1`, { title: 'CFO' }],
    ['POST', `${b}/officers/o%2F1/cease`, { ceased_on: '2026-06-30' }],
    ['POST', `${b}/officers/o%2F1/cease`, {}],
    ['GET', `${b}/locations`, null],
    ['POST', `${b}/locations`, { kind: 'office', country: 'GB' }],
    ['PATCH', `${b}/locations/l%201`, { city: 'Leeds' }],
    ['POST', `${b}/locations/l%201/close`, {}],
    ['PUT', `${b}/slug`, { slug: 'northwind' }],
  ]);
  assert.equal(viaApi, companyLegalApi, 'api.js re-exports the module (D527)');
});
