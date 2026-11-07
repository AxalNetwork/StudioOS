/**
 * #4571 (Security S2) — negative tests for two perimeter controls, synthetic
 * only: no real key, token, object or account.
 *
 *   A. One-time signed downloads (`services/signedDownload.ts`, `/api/files/dl`):
 *      the TTL is clamped to five minutes; a token names exactly one object and
 *      cannot be re-pointed; a tampered, expired or replayed token is refused
 *      with the same generic 403; a KV failure while consuming refuses.
 *   B. The Cloudflare Access middleware (`middleware/cfAccess.ts`): unconfigured
 *      it is an explicit no-op (production today, GOTCHAS (h)); configured, a
 *      missing, unsigned, wrong-audience or unverifiable assertion is refused,
 *      and an unreachable JWKS refuses too (fail closed).
 *   C. Coverage (R2-02): every admin route that serves KYC or KYB document bytes
 *      is either behind `requireCfAccess()` or listed as awaiting the owner's
 *      route matrix, and every one of them runs its own `requireAdmin` — the
 *      application check never depends on the edge layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { mintDownloadToken, verifyAndConsumeToken } from '../src/services/signedDownload.ts';
import files from '../src/routes/files.ts';
import { requireCfAccess } from '../src/middleware/cfAccess.ts';
import { CF_ACCESS_PATHS } from '../src/services/topology.ts';

const SECRET = 'test-test-test-test-test-test-test-test';
const read = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

function kv(opts: { failGet?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    put: async (k: string, v: string) => { m.set(k, v); },
    get: async (k: string) => { if (opts.failGet) throw new Error('kv down'); return m.get(k) ?? null; },
    delete: async (k: string) => { m.delete(k); },
  };
}
const b64urlJson = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const parts = (token: string) => { const [p, s] = token.split('.'); return { payload: JSON.parse(Buffer.from(p, 'base64url').toString()), sig: s }; };

// ── A · one-time signed downloads ────────────────────────────────────────────

test('A1: the TTL is clamped to five minutes, however long the caller asks for', async () => {
  // Mutation checked: MAX_TTL_SEC raised to 3600.
  const env: any = { JWT_SECRET: SECRET, TOKENS: kv() };
  const before = Math.floor(Date.now() / 1000);
  const { token } = await mintDownloadToken(env, { key: 'synthetic/a.pdf', ttlSec: 86_400, audience: 'test' });
  assert.ok(parts(token).payload.exp - before <= 301, 'never more than 300 seconds');
  const { token: zero } = await mintDownloadToken(env, { key: 'synthetic/a.pdf', ttlSec: 0, audience: 'test' });
  assert.ok(parts(zero).payload.exp - before >= 1, 'at least one second, never an already-expired token');
});

test('A2: a token names one object; re-pointing it, tampering or expiry is refused', async () => {
  const env: any = { JWT_SECRET: SECRET, TOKENS: kv() };
  const { token } = await mintDownloadToken(env, { key: 'synthetic/mine.pdf', audience: 'test' });
  const { payload, sig } = parts(token);
  // The same signature on a payload naming another object.
  const moved = `${b64urlJson({ ...payload, key: 'synthetic/theirs.pdf' })}.${sig}`;
  assert.deepEqual(await verifyAndConsumeToken(env, moved), { error: 'invalid' });
  // A payload signed with another key.
  const other: any = { JWT_SECRET: 'another-another-another-another-another', TOKENS: env.TOKENS };
  const { token: foreign } = await mintDownloadToken(other, { key: 'synthetic/mine.pdf', audience: 'test' });
  assert.deepEqual(await verifyAndConsumeToken(env, foreign), { error: 'invalid' });
  // Expired: the payload's exp in the past, re-signed honestly would need the key, so a past exp with a valid
  // signature is made by minting and then moving the clock.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 301_000;
    assert.deepEqual(await verifyAndConsumeToken(env, token), { error: 'expired' });
  } finally { Date.now = realNow; }
  for (const junk of ['', '.', 'abc', 'abc.', '.abc', 'a.b.c']) {
    assert.ok('error' in (await verifyAndConsumeToken(env, junk)), JSON.stringify(junk));
  }
});

test('A3: a token works once; a replay, and a KV failure while consuming, are refused', async () => {
  // Mutation checked: the consume step's catch returning the payload (fail open).
  const store = kv();
  const env: any = { JWT_SECRET: SECRET, TOKENS: store };
  const { token } = await mintDownloadToken(env, { key: 'synthetic/once.pdf', audience: 'test' });
  const first = await verifyAndConsumeToken(env, token);
  assert.equal((first as any).key, 'synthetic/once.pdf');
  assert.deepEqual(await verifyAndConsumeToken(env, token), { error: 'consumed' });
  const broken: any = { JWT_SECRET: SECRET, TOKENS: kv({ failGet: true }) };
  const { token: t2 } = await mintDownloadToken({ JWT_SECRET: SECRET, TOKENS: kv() } as any, { key: 'synthetic/x.pdf', audience: 'test' });
  assert.deepEqual(await verifyAndConsumeToken(broken, t2), { error: 'invalid' }, 'a KV error refuses');
});

test('A4: the download route answers every refusal with the same 403, streams only the named object, once', async () => {
  const objects = new Map([['synthetic/doc.pdf', 'SYNTHETIC-BYTES'], ['synthetic/other.pdf', 'OTHER']]);
  const env: any = {
    JWT_SECRET: SECRET, TOKENS: kv(),
    FILES: { get: async (k: string) => (objects.has(k) ? { body: objects.get(k), httpMetadata: { contentType: 'application/pdf' } } : null) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  };
  const app = new Hono<any>().route('/api/files', files);
  const { token } = await mintDownloadToken(env, { key: 'synthetic/doc.pdf', audience: 'test' });
  const ok = await app.request(`/api/files/dl/${token}`, {}, env);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'SYNTHETIC-BYTES');
  assert.match(ok.headers.get('cache-control') || '', /no-store/);
  const bodies = new Set<string>();
  for (const t of [token, `${token}x`, 'nope.nope']) {
    const r = await app.request(`/api/files/dl/${t}`, {}, env);
    assert.equal(r.status, 403, t);
    bodies.add(await r.text());
  }
  assert.equal(bodies.size, 1, 'replayed, tampered and malformed tokens are indistinguishable to the caller');
});

// ── B · the Access middleware ────────────────────────────────────────────────

async function accessApp(env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.use('/gated/*', requireCfAccess());
  app.get('/gated/doc', (c) => c.json({ ok: true }));
  return (headers: Record<string, string> = {}) => app.request('/gated/doc', { headers }, env as any);
}

test('B1: unconfigured, the middleware is an explicit no-op (GOTCHAS (h): production today)', async () => {
  const call = await accessApp({});
  assert.equal((await call()).status, 200, 'the application check behind it is the whole gate; see C');
  const half = await accessApp({ CF_ACCESS_TEAM_DOMAIN: 'synthetic.cloudflareaccess.com' });
  assert.equal((await half()).status, 200, 'half a configuration is still unconfigured — recorded as SC-05');
});

test('B2: configured, a missing, foreign, wrong-audience or unverifiable assertion is refused; a JWKS outage refuses', async () => {
  // Mutation checked: the verify catch calling next() (fail open).
  const TEAM = 'synthetic-4571.cloudflareaccess.com';
  const AUD = 'synthetic-aud-4571';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const realFetch = globalThis.fetch;
  let jwksUp = true;
  globalThis.fetch = (async (url: string) => {
    if (String(url) === `https://${TEAM}/cdn-cgi/access/certs` && jwksUp) return new Response(JSON.stringify({ keys: [jwk] }));
    return new Response('down', { status: 503 });
  }) as any;
  const sign = (claims: Record<string, unknown>, key = privateKey, kid = 'k1') => new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid }).setIssuedAt().setExpirationTime('5m').sign(key);
  try {
    const call = await accessApp({ CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
    const good = await sign({ aud: AUD, iss: `https://${TEAM}`, email: 'synthetic@example.invalid' });
    assert.equal((await call({ 'Cf-Access-Jwt-Assertion': good })).status, 200);
    assert.equal((await call()).status, 403, 'no assertion');
    assert.equal((await call({ 'Cf-Access-Jwt-Assertion': await sign({ aud: 'other', iss: `https://${TEAM}` }) })).status, 403, 'wrong audience');
    assert.equal((await call({ 'Cf-Access-Jwt-Assertion': await sign({ aud: AUD, iss: 'https://evil.example.invalid' }) })).status, 403, 'wrong issuer');
    const stranger = (await generateKeyPair('RS256')).privateKey;
    assert.equal((await call({ 'Cf-Access-Jwt-Assertion': await sign({ aud: AUD, iss: `https://${TEAM}` }, stranger) })).status, 403, 'signed by another key under the same kid');
    assert.equal((await call({ 'Cf-Access-Jwt-Assertion': await sign({ aud: AUD, iss: `https://${TEAM}` }, privateKey, 'unknown') })).status, 403, 'unknown kid');
    // A fresh team domain (no cached keys) with the JWKS down refuses rather than letting the request through.
    jwksUp = false;
    const TEAM2 = 'synthetic-4571-b.cloudflareaccess.com';
    const call2 = await accessApp({ CF_ACCESS_TEAM_DOMAIN: TEAM2, CF_ACCESS_AUD: AUD });
    assert.equal((await call2({ 'Cf-Access-Jwt-Assertion': good })).status, 403, 'JWKS unreachable: fail closed');
  } finally { globalThis.fetch = realFetch; }
});

// ── C · coverage of the document routes (R2-02) ─────────────────────────────

/**
 * Admin routes that serve KYC/KYB document bytes and are NOT behind requireCfAccess().
 * Each waits on the owner's route-by-route matrix (SC-01 in the register): adding a
 * worker mount also obliges the Access app to carry the path, or admins get 403 (GOTCHAS (h)).
 */
const AWAITING_MATRIX = Object.freeze(['/api/kyc/admin/:userId/documents/:docId']);

test('C1: every admin document route is Access-mounted or awaiting the matrix, and each runs its own requireAdmin', () => {
  // Mutation checked: requireAdmin removed from the KYC per-document handler.
  const kyc = read('routes/kyc.ts');
  const kyb = read('routes/kyb_admin.ts');
  const routes = [
    ...[...kyc.matchAll(/kyc\.get\('(\/admin\/:userId\/documents?[^']*)'/g)].map((m) => ({ path: `/api/kyc${m[1]}`, src: kyc, at: m.index! })),
    ...[...kyb.matchAll(/kyb\.get\('(\/:id\/documents\/[^']*)'/g)].map((m) => ({ path: `/api/kyc/businesses${m[1]}`, src: kyb, at: m.index! })),
  ];
  assert.ok(routes.length >= 3, `found ${routes.map((r) => r.path).join(', ')}`);
  const covered = (p: string) => (CF_ACCESS_PATHS as readonly string[]).some((m) => m === p || (m.endsWith('/*') && p.startsWith(m.slice(0, -2) + '/')));
  const uncovered = routes.map((r) => r.path).filter((p) => !covered(p));
  assert.deepEqual(uncovered.sort(), [...AWAITING_MATRIX].sort(),
    'a new document route must be Access-mounted or added here with a register row, never silently outside both');
  for (const r of routes) {
    const body = r.src.slice(r.at, r.at + 400);
    assert.match(body, /await requireAdmin\(c\)/, `${r.path} must check the admin role itself, with or without Access`);
  }
});
