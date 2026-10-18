/**
 * D722 — `verifyGoogleIdToken`, one mutation at a time.
 *
 * Every case below starts from a token that passes and changes ONE thing, so a
 * failing case names the check that let it through. The keys are real RS256
 * pairs from jose; the key set is a local JWKS for the claim checks and a
 * stubbed `fetch` of Google's certs URL for the remote half (caching, the
 * timeout signal, an unknown `kid`).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/google_id_token_d722.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';

import {
  verifyGoogleIdToken, googleJwks, GOOGLE_CERTS_URL, GOOGLE_CLOCK_SKEW_SEC, GOOGLE_TOKEN_MAX_AGE_SEC,
  __testing,
} from '../src/services/googleIdToken.ts';

const CLIENT = 'test-client-id';
const NOW = 1_800_000_000;
const KID = 'kid-d722-a';

const pair = await generateKeyPair('RS256', { extractable: true });
const other = await generateKeyPair('RS256', { extractable: true });
const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
const JWKS = createLocalJWKSet({ keys: [publicJwk] });

function base(): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    azp: CLIENT,
    sub: '109876543210987654321',
    email: 'Founder.D722@Example.test',
    email_verified: true,
    name: 'A Founder',
    iat: NOW - 5,
    exp: NOW + 3595,
  };
}

async function mint(claims: Record<string, unknown>, { key = pair.privateKey, kid = KID } = {}) {
  const body = { ...claims };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return new SignJWT(body).setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' }).sign(key);
}

const check = async (claims: Record<string, unknown>, opts: { key?: any; kid?: string } = {}) =>
  verifyGoogleIdToken(await mint(claims, opts), CLIENT, { jwks: JWKS, now: NOW });

test('the untouched token passes, with the email lower-cased', async () => {
  const r = await check(base());
  assert.deepEqual(r, {
    ok: true,
    claims: { sub: '109876543210987654321', email: 'founder.d722@example.test', name: 'A Founder' },
  });
  // The bare issuer spelling Google also documents.
  assert.equal((await check({ ...base(), iss: 'accounts.google.com' })).ok, true);
  // No `azp` at all is fine; a different one is not (below).
  assert.equal((await check({ ...base(), azp: undefined })).ok, true);
  // Older tokens carried the flag as a string.
  assert.equal((await check({ ...base(), email_verified: 'true' })).ok, true);
});

test('a token signed by another key is refused', async () => {
  const r = await check(base(), { key: other.privateKey });
  assert.deepEqual(r, { ok: false, code: 'token_invalid', reason: 'signature' });
});

test('a kid the key set does not hold is refused', async () => {
  const r = await check(base(), { key: other.privateKey, kid: 'kid-nobody-published' });
  assert.deepEqual(r, { ok: false, code: 'token_invalid', reason: 'unknown_kid' });
});

test('an HS256 token is refused whatever it claims', async () => {
  const t = await new SignJWT(base()).setProtectedHeader({ alg: 'HS256', kid: KID })
    .sign(new TextEncoder().encode('x'.repeat(48)));
  const r = await verifyGoogleIdToken(t, CLIENT, { jwks: JWKS, now: NOW });
  assert.equal(r.ok, false);
  assert.equal((r as any).code, 'token_invalid');
});

test('each claim is checked: iss, aud, azp, sub, email', async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['wrong iss', { iss: 'https://accounts.example.test' }, 'claim_iss'],
    ['foreign aud', { aud: 'someone-elses-client' }, 'claim_aud'],
    ['foreign azp', { azp: 'someone-elses-client' }, 'claim_azp'],
    ['missing sub', { sub: undefined }, 'claim_sub'],
    ['empty sub', { sub: '' }, 'claim_sub'],
    ['overlong sub', { sub: '1'.repeat(256) }, 'claim_sub'],
    ['missing email', { email: undefined }, 'claim_email'],
  ];
  for (const [label, over, reason] of cases) {
    const r = await check({ ...base(), ...over });
    assert.deepEqual(r, { ok: false, code: 'token_invalid', reason }, label);
  }
});

test('an email Google has not verified is its own refusal', async () => {
  for (const flag of [false, 'false', undefined]) {
    const r = await check({ ...base(), email_verified: flag });
    assert.deepEqual(r, { ok: false, code: 'email_unverified', reason: 'email_unverified' }, String(flag));
  }
});

test('the clock: exp and a future iat get the skew, and nothing older than the max age passes', async () => {
  const S = GOOGLE_CLOCK_SKEW_SEC;
  const A = GOOGLE_TOKEN_MAX_AGE_SEC;
  assert.equal(S, 300);
  assert.equal(A, 900);
  // exp: inside the skew passes, past it fails.
  assert.equal((await check({ ...base(), exp: NOW - S + 1 })).ok, true);
  assert.deepEqual(await check({ ...base(), exp: NOW - S - 1 }), { ok: false, code: 'token_invalid', reason: 'expired' });
  // iat in the future: inside the skew passes, past it fails.
  assert.equal((await check({ ...base(), iat: NOW + S - 1 })).ok, true);
  assert.deepEqual(await check({ ...base(), iat: NOW + S + 1 }), { ok: false, code: 'token_invalid', reason: 'iat_future' });
  // iat in the past: up to the max age passes, beyond it fails even with exp ahead.
  assert.equal((await check({ ...base(), iat: NOW - A + 1 })).ok, true);
  assert.deepEqual(await check({ ...base(), iat: NOW - A - 1 }), { ok: false, code: 'token_invalid', reason: 'too_old' });
  // Both are required.
  assert.equal((await check({ ...base(), exp: undefined })).ok, false);
  assert.equal((await check({ ...base(), iat: undefined })).ok, false);
});

test('a token that is not a token, or no client id, is refused without throwing', async () => {
  for (const t of ['', 'abc', 'a.b.c', 'x'.repeat(20)]) {
    const r = await verifyGoogleIdToken(t, CLIENT, { jwks: JWKS, now: NOW });
    assert.equal(r.ok, false, t);
  }
  const r = await verifyGoogleIdToken(await mint(base()), '', { jwks: JWKS, now: NOW });
  assert.deepEqual(r, { ok: false, code: 'token_invalid', reason: 'missing' });
});

// ─────────────────────────────────────────────── the remote key set ──

function stubCerts(respond: () => Response) {
  const calls: Array<{ url: string; init: any }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    assert.equal(url, GOOGLE_CERTS_URL, `unexpected outbound call to ${url}`);
    calls.push({ url, init });
    return respond();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const certs = () => new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'content-type': 'application/json' } });
const fresh = () => ({ ...base(), iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 3595 });

test('the certs are fetched once per isolate, under a timeout signal', async () => {
  __testing.resetJwks();
  const s = stubCerts(certs);
  try {
    assert.equal((await verifyGoogleIdToken(await mint(fresh()), CLIENT)).ok, true);
    assert.equal((await verifyGoogleIdToken(await mint(fresh()), CLIENT)).ok, true);
    assert.equal(s.calls.length, 1, 'the second check refetched the certs');
    assert.ok(s.calls[0].init?.signal instanceof AbortSignal, 'the certs fetch carries no signal — a hung connection would hang sign-in');
    assert.equal(googleJwks(), googleJwks(), 'one key set per isolate');
  } finally { s.restore(); __testing.resetJwks(); }
});

test('an unknown kid refetches once (key rotation), then refuses', async () => {
  __testing.resetJwks();
  const s = stubCerts(certs);
  try {
    assert.equal((await verifyGoogleIdToken(await mint(fresh()), CLIENT)).ok, true);
    // The cooldown has not passed, so jose does not refetch inside it; move
    // the clock past it to see the rotation refetch.
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;
    try {
      const r = await verifyGoogleIdToken(await mint(fresh(), { key: other.privateKey, kid: 'kid-rotated' }), CLIENT);
      assert.deepEqual(r, { ok: false, code: 'token_invalid', reason: 'unknown_kid' });
    } finally { Date.now = realNow; }
    assert.equal(s.calls.length, 2, 'an unknown kid must trigger exactly one refetch');
  } finally { s.restore(); __testing.resetJwks(); }
});

test('certs that do not answer are named apart from a bad token', async () => {
  __testing.resetJwks();
  const down = stubCerts(() => new Response('upstream', { status: 503 }));
  try {
    const r = await verifyGoogleIdToken(await mint(fresh()), CLIENT);
    assert.deepEqual(r, { ok: false, code: 'token_invalid', reason: 'jwks_unavailable' });
  } finally { down.restore(); __testing.resetJwks(); }
  const thrown = stubCerts(() => { throw new TypeError('fetch failed'); });
  try {
    const r = await verifyGoogleIdToken(await mint(fresh()), CLIENT);
    assert.deepEqual(r, { ok: false, code: 'token_invalid', reason: 'jwks_unavailable' });
  } finally { thrown.restore(); __testing.resetJwks(); }
});
