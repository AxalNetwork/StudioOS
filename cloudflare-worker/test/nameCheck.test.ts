// Task #10 — Company-name availability check.
//
// Locks in the pure logic (normalization, exact-vs-fuzzy decisioning,
// jurisdiction routing) and the dispatcher's hard contract: every failure
// mode degrades to `status: 'unavailable'` (never throws), definitive results
// are cached, and "unavailable" is never cached.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeName,
  decideFromCandidates,
  checkCompanyName,
  JURISDICTION_REGISTRY,
  type NameCheckResult,
} from '../src/services/nameCheck.ts';

// ---- a tiny in-memory KV that mirrors the bits of KVNamespace we use ----
function fakeKV() {
  const m = new Map<string, string>();
  let puts = 0;
  return {
    get: async (k: string) => (m.has(k) ? m.get(k)! : null),
    put: async (k: string, v: string) => { puts++; m.set(k, v); },
    delete: async (k: string) => { m.delete(k); },
    _map: m,
    get _puts() { return puts; },
  };
}

function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

test('normalizeName strips suffixes, diacritics, punctuation and case', () => {
  assert.equal(normalizeName('Stripe, Inc.'), 'stripe');
  assert.equal(normalizeName('Acme LLC'), 'acme');
  assert.equal(normalizeName('Acme Pte Ltd'), 'acme');
  assert.equal(normalizeName('Café & Co'), 'cafe and');
  assert.equal(normalizeName('Tervise OÜ'), 'tervise');
  assert.equal(normalizeName('   Multiple   Spaces  Limited '), 'multiple spaces');
  // A name that is only a suffix collapses to empty (treated as "too generic").
  assert.equal(normalizeName('Inc.'), '');
});

test('decideFromCandidates: taken only on EXACT normalized match', () => {
  const taken = decideFromCandidates('stripe', ['STRIPE, INC.', 'Stripe Payments Ltd']);
  assert.equal(taken.status, 'taken');
  assert.deepEqual(taken.matches, ['STRIPE, INC.']);

  const avail = decideFromCandidates('zynqualox', ['Zynqualox Holdings Ltd', 'Other Co']);
  assert.equal(avail.status, 'available');
  // Overlapping names are surfaced as informational near-matches, not conflicts.
  assert.ok(avail.matches.includes('Zynqualox Holdings Ltd'));

  const none = decideFromCandidates('totallyunique', []);
  assert.equal(none.status, 'available');
  assert.deepEqual(none.matches, []);
});

test('both Delaware entity types route to the DE register', () => {
  assert.equal(JURISDICTION_REGISTRY.us_de_ccorp, 'de');
  assert.equal(JURISDICTION_REGISTRY.us_de_llc, 'de');
  assert.equal(JURISDICTION_REGISTRY.uk_ltd, 'uk');
  assert.equal(JURISDICTION_REGISTRY.sg_pte, 'sg');
  assert.equal(JURISDICTION_REGISTRY.ee_oy, 'ee');
});

test('unknown jurisdiction degrades to unavailable (never throws)', async () => {
  const env = { RATE_LIMITS: fakeKV() } as never;
  const r = await checkCompanyName(env, 'mars_inc', 'Stripe Inc');
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'unknown_jurisdiction');
});

test('Delaware without OpenCorporates key → verify manually', async () => {
  const env = { RATE_LIMITS: fakeKV() } as never;
  const r = await checkCompanyName(env, 'us_de_ccorp', 'Stripe Inc');
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'de_register_requires_manual_check');
  assert.equal(r.source, 'none');
});

test('Delaware with key: exact match → taken, novel name → available', async () => {
  const kv = fakeKV();
  const env = { RATE_LIMITS: kv, OPENCORPORATES_API_KEY: 'test-token' } as never;

  const taken = await checkCompanyName(env, 'us_de_ccorp', 'Stripe Inc', {
    fetchImpl: jsonFetch({ results: { companies: [{ company: { name: 'STRIPE, INC.' } }] } }),
  });
  assert.equal(taken.status, 'taken');
  assert.equal(taken.source, 'rest');
  assert.deepEqual(taken.matches, ['STRIPE, INC.']);

  const avail = await checkCompanyName(env, 'us_de_llc', 'Zynqualox LLC', {
    fetchImpl: jsonFetch({ results: { companies: [] } }),
  });
  assert.equal(avail.status, 'available');
});

test('UK with Companies House key parses items', async () => {
  const env = { RATE_LIMITS: fakeKV(), COMPANIES_HOUSE_API_KEY: 'ch-key' } as never;
  const r = await checkCompanyName(env, 'uk_ltd', 'Monzo Ltd', {
    fetchImpl: jsonFetch({ items: [{ title: 'MONZO LTD' }, { title: 'MONZO BANK LIMITED' }] }),
  });
  assert.equal(r.status, 'taken');
  assert.deepEqual(r.matches, ['MONZO LTD']);
});

test('non-200 from the registry degrades to unavailable', async () => {
  const env = { RATE_LIMITS: fakeKV(), OPENCORPORATES_API_KEY: 'test-token' } as never;
  const r = await checkCompanyName(env, 'us_de_ccorp', 'Stripe Inc', {
    fetchImpl: jsonFetch({ error: 'rate limited' }, 429),
  });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'opencorporates_http_429');
});

test('definitive results are cached; second call is a cache hit', async () => {
  const kv = fakeKV();
  const env = { RATE_LIMITS: kv, OPENCORPORATES_API_KEY: 'test-token' } as never;
  let calls = 0;
  const counting: typeof fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ results: { companies: [{ company: { name: 'STRIPE, INC.' } }] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const first = await checkCompanyName(env, 'us_de_ccorp', 'Stripe Inc', { fetchImpl: counting });
  assert.equal(first.cached, false);
  assert.equal(first.status, 'taken');

  const second = await checkCompanyName(env, 'us_de_ccorp', 'Stripe Inc', { fetchImpl: counting });
  assert.equal(second.cached, true);
  assert.equal(second.status, 'taken');
  assert.equal(calls, 1, 'registry only hit once; the second lookup is served from cache');
});

test('unavailable results are NOT cached', async () => {
  const kv = fakeKV();
  const env = { RATE_LIMITS: kv } as never; // no DE key → unavailable
  await checkCompanyName(env, 'us_de_ccorp', 'Stripe Inc');
  assert.equal(kv._puts, 0, 'no cache write for an unavailable result');
});

test('EE without a browser binding → verify manually', async () => {
  const env = { RATE_LIMITS: fakeKV() } as never;
  const r: NameCheckResult = await checkCompanyName(env, 'ee_oy', 'Tervise OÜ');
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'ee_requires_browser');
});

test('Singapore without a configured resource id → verify manually', async () => {
  const env = { RATE_LIMITS: fakeKV() } as never;
  const r = await checkCompanyName(env, 'sg_pte', 'Grab Pte Ltd');
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'sg_register_not_configured');
});
