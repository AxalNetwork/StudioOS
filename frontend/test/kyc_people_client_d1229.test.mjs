/**
 * D1229 (#3237) — the people queue's client: one module under lib/api/,
 * re-exported by one line in api.js (D527), sending only the keys the Worker
 * reads, and each write to the route the Worker mounts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/kyc_people_client_d1229.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kycPeopleApi, kycPeopleQuery } from '../src/lib/api/kycPeople.js';

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

test('the query sends only the Worker\'s keys, and no empty value', () => {
  assert.equal(kycPeopleQuery({}), '');
  assert.equal(kycPeopleQuery({ status: 'pending', q: '  ', page: 2, page_size: 25, junk: 'x', country: null }), '?status=pending&page=2&page_size=25');
  assert.equal(kycPeopleQuery({ q: 'a&b', assignee: 'me' }), '?q=a%26b&assignee=me', 'a value is encoded, never spliced');
});

test('each call goes to the route the Worker mounts', async () => {
  const sent = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { sent.push([String(url), init.method || 'GET', init.body || null]); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' }; };
  try {
    await kycPeopleApi.people({ status: 'needs_info' });
    await kycPeopleApi.figures();
    await kycPeopleApi.caseOf(5);
    await kycPeopleApi.assign(5, null);
    await kycPeopleApi.addNote(5, 'Checked');
    await kycPeopleApi.needsInfo(5, 'Send the back');
    await kycPeopleApi.recheck(5, 'Verify again');
    await kycPeopleApi.approve(5);
  } finally { globalThis.fetch = prev; }
  const paths = sent.map(([u, m, b]) => [u.replace(/^.*\/api/, ''), m, b]);
  assert.deepEqual(paths, [
    ['/kyc/admin/people?status=needs_info', 'GET', null],
    ['/kyc/admin/figures', 'GET', null],
    ['/kyc/admin/5/case', 'GET', null],
    ['/kyc/admin/5/assign', 'PATCH', '{"assignee_id":null}'],
    ['/kyc/admin/5/notes', 'POST', '{"body":"Checked"}'],
    ['/kyc/admin/5/needs-info', 'PATCH', '{"message":"Send the back"}'],
    ['/kyc/admin/5/recheck', 'PATCH', '{"message":"Verify again"}'],
    ['/kyc/admin/5/approve', 'PATCH', '{}'],
  ]);
});

test('api.js re-exports the module in its alphabetical block (D527)', () => {
  const api = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /export \* from '\.\/api\/interviewSessions\.js';\nexport \* from '\.\/api\/kycPeople\.js';\nexport \* from '\.\/api\/labOperations\.js';/);
});
