// D1300 (#3396) — `api.adminListUsers` passes All accounts' filters, sort and
// scope through to `GET /api/admin/users`, a list as "any of", and asks
// exactly what it always asked when given none: today's callers keep working.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/accounts_list_client_d1300.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';

async function asked(opts) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  let url = null;
  globalThis.fetch = async (u) => {
    url = new URL(String(u), 'http://x');
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' };
  };
  try { await api.adminListUsers(opts); } finally { globalThis.fetch = previous; restore(); }
  return url;
}

test('with no filter, the request is the one today\'s callers make', async () => {
  assert.equal((await asked()).search, '');
  assert.equal((await asked({ envelope: 1, q: 'ana' })).search, '?q=ana&envelope=1');
  assert.equal((await asked({ q: 'ana', limit: 8 })).search, '?q=ana&limit=8');
});

test('every filter, the sort and the scope reach the Worker; a list is joined, empties are dropped', async () => {
  const u = await asked({
    envelope: 1, limit: 25, offset: 50,
    profile: ['founder', 'investor'], sub: 'lp', status: 'active', email: 'unverified', identity: ['pending', 'needs_info'],
    limited: 'on', plan: ['growth'], country: ['France', 'India'], persona: 'p_builder', program: ['lab', 'testing'],
    trust: 'under_50', joined: '30d', active: 'over_30d', sort: 'trust_asc', scope: 'hq',
    joined_from: '', joined_to: null,
  });
  const p = Object.fromEntries(u.searchParams);
  assert.equal(u.pathname, '/api/admin/users');
  assert.deepEqual(p, {
    envelope: '1', limit: '25', offset: '50',
    profile: 'founder,investor', sub: 'lp', status: 'active', email: 'unverified', identity: 'pending,needs_info',
    limited: 'on', plan: 'growth', country: 'France,India', persona: 'p_builder', program: 'lab,testing',
    trust: 'under_50', joined: '30d', active: 'over_30d', sort: 'trust_asc', scope: 'hq',
  });
  assert.equal((await asked({ profile: [] })).search, '', 'an empty list asks nothing');
  assert.equal((await asked({ program: ['lab', '', null] })).search, '?program=lab', 'an empty item is not a value');
  assert.equal((await asked({ joined_from: '2026-03-01', joined_to: '2026-03-31' })).search, '?joined_from=2026-03-01&joined_to=2026-03-31');
});
