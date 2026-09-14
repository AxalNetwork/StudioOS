/**
 * D104 — a branch session never leaves its host.
 *
 * Two facts drive every assertion here. HQ's cookies are set for `.axal.vc`,
 * so the browser sends them to every branch subdomain as well; and when two
 * cookies share one name on one host, their order in the Cookie header is
 * the user agent's choice (RFC 6265 §5.4), not ours. So a branch Worker
 * must (1) never set a registrable-domain cookie, or its sessions would
 * travel to HQ and to every other branch, and (2) read cookie NAMES that
 * carry its own code, so HQ's `studioos_auth` — present on the branch host
 * whatever we do — is never mistaken for a branch session or a branch CSRF
 * token. The order-independence tests are the ones that pin (2): a lookup by
 * the plain name passes them only when the browser happens to put the
 * branch's cookie first.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_cookies.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { branchOf, authCookieName, csrfCookieName } from '../src/util/branch.ts';
import { setAuthCookies, clearAuthCookies, extractJwtCandidates } from '../src/auth.ts';
import { csrfMiddleware } from '../src/middleware/csrf.ts';
import { expectedOrigins } from '../src/util/webauthn.ts';

/** The slice of a Hono context the cookie code touches. */
function ctx(env: Record<string, unknown>, headers: Record<string, string>, method = 'POST') {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const setCookies: string[] = [];
  return {
    env,
    req: { header: (n: string) => lower[n.toLowerCase()], method, path: '/api/anything' },
    header: (_name: string, value: string) => { setCookies.push(value); },
    json: (body: unknown, status?: number) => ({ body, status }),
    setCookies,
  } as any;
}

const HQ = { APP_URL: 'https://axal.vc', STAGE: 'production' };
const FR = { APP_URL: 'https://fr.axal.vc', PUBLIC_BASE_URL: 'https://fr.axal.vc', BRANCH_CODE: 'fr', STAGE: 'production' };

test('branchOf: unset is HQ, a code is lower-cased, anything malformed throws rather than reading as HQ', () => {
  assert.equal(branchOf({}), null);
  assert.equal(branchOf({ BRANCH_CODE: '' }), null);
  assert.equal(branchOf({ BRANCH_CODE: '  ' }), null);
  assert.equal(branchOf({ BRANCH_CODE: 'fr' }), 'fr');
  assert.equal(branchOf({ BRANCH_CODE: 'DACH' }), 'dach');
  for (const bad of ['a', '-fr', 'fr.axal', 'fr axal', 'studioos-fr-very-long-code-name', '1fr']) {
    assert.throws(() => branchOf({ BRANCH_CODE: bad }), /not a branch code/, `${bad} must be refused`);
  }
  assert.equal(authCookieName(HQ), 'studioos_auth');
  assert.equal(csrfCookieName(HQ), 'studioos_csrf');
  assert.equal(authCookieName(FR), 'studioos_auth_fr');
  assert.equal(csrfCookieName(FR), 'studioos_csrf_fr');
});

test('HQ still sets the registrable-domain cookies the app.axal.vc OAuth callback relies on', () => {
  const c = ctx(HQ, { host: 'app.axal.vc' });
  setAuthCookies(c, 'JWT', 'CSRF');
  assert.equal(c.setCookies.length, 2);
  const [auth, csrf] = c.setCookies;
  assert.ok(auth.startsWith('studioos_auth=JWT;'), auth);
  assert.ok(csrf.startsWith('studioos_csrf=CSRF;'), csrf);
  assert.ok(auth.includes('Domain=.axal.vc'), 'HQ keeps the shared domain until the Google redirect URI moves to the apex (D104)');
  assert.ok(auth.includes('HttpOnly') && !csrf.includes('HttpOnly'), 'only the session cookie is HttpOnly; the SPA must read the CSRF one');
});

test('a branch sets host-only cookies whose names carry its code', () => {
  const c = ctx(FR, { host: 'fr.axal.vc' });
  setAuthCookies(c, 'JWT', 'CSRF');
  const [auth, csrf] = c.setCookies;
  assert.ok(auth.startsWith('studioos_auth_fr=JWT;'), auth);
  assert.ok(csrf.startsWith('studioos_csrf_fr=CSRF;'), csrf);
  for (const v of c.setCookies) {
    assert.ok(!/Domain=/i.test(v), `a branch cookie must be host-only, got: ${v}`);
    assert.ok(/Secure; SameSite=Lax; Path=\//.test(v), v);
  }
});

test('a branch clears only its own names, and never with a Domain attribute', () => {
  const c = ctx(FR, { host: 'fr.axal.vc' });
  clearAuthCookies(c);
  assert.ok(c.setCookies.length >= 2);
  for (const v of c.setCookies) {
    assert.ok(!/Domain=/i.test(v), v);
    assert.ok(/^studioos_(auth|csrf)_fr=;/.test(v), `a branch must not touch HQ's cookie names: ${v}`);
    assert.ok(v.includes('Max-Age=0'), v);
  }
});

test('extractJwtCandidates reads the branch cookie and skips HQ\'s, in either order', () => {
  for (const cookieHeader of [
    'studioos_auth=HQ.JWT; studioos_auth_fr=FR.JWT',
    'studioos_auth_fr=FR.JWT; studioos_auth=HQ.JWT',
  ]) {
    assert.equal(extractJwtCandidates(ctx(FR, { Cookie: cookieHeader })).cookie, 'FR.JWT', cookieHeader);
    assert.equal(extractJwtCandidates(ctx(HQ, { Cookie: cookieHeader })).cookie, 'HQ.JWT', cookieHeader);
  }
  assert.equal(extractJwtCandidates(ctx(FR, { Cookie: 'studioos_auth=HQ.JWT' })).cookie, null,
    'HQ\'s session alone is no session on a branch');
});

test('csrfMiddleware on a branch: HQ\'s cookie pair satisfies nothing, the branch\'s own pair is required', async () => {
  const mw = csrfMiddleware();
  const run = async (env: Record<string, unknown>, headers: Record<string, string>) => {
    let passed = false;
    const c = ctx(env, headers);
    const res = await mw(c, async () => { passed = true; });
    return { passed, status: (res as any)?.status };
  };
  // HQ's pair present on the branch host, header mirrors HQ's token: not an
  // authenticated branch request at all, so CSRF has nothing to check — the
  // request goes on to fail at requireAuth, not with a misleading 403.
  assert.deepEqual(await run(FR, { Cookie: 'studioos_auth=HQ; studioos_csrf=abc', 'X-CSRF-Token': 'abc' }), { passed: true, status: undefined });
  // The branch's own pair, in either order beside HQ's.
  for (const cookie of [
    'studioos_auth=HQ; studioos_csrf=abc; studioos_auth_fr=FRJWT; studioos_csrf_fr=tok',
    'studioos_csrf_fr=tok; studioos_auth_fr=FRJWT; studioos_auth=HQ; studioos_csrf=abc',
  ]) {
    assert.deepEqual(await run(FR, { Cookie: cookie, 'X-CSRF-Token': 'tok' }), { passed: true, status: undefined }, cookie);
    assert.deepEqual(await run(FR, { Cookie: cookie, 'X-CSRF-Token': 'abc' }), { passed: false, status: 403 },
      'mirroring HQ\'s token on a branch must fail the double-submit check');
  }
  // And HQ is unchanged.
  assert.deepEqual(await run(HQ, { Cookie: 'studioos_auth=HQ; studioos_csrf=abc', 'X-CSRF-Token': 'abc' }), { passed: true, status: undefined });
  assert.deepEqual(await run(HQ, { Cookie: 'studioos_auth=HQ; studioos_csrf=abc', 'X-CSRF-Token': 'nope' }), { passed: false, status: 403 });
});

test('passkey origins: HQ accepts both canonical hosts, a branch accepts only its own', () => {
  const hq = expectedOrigins(HQ as any);
  assert.ok(hq.includes('https://axal.vc') && hq.includes('https://app.axal.vc'), hq.join(','));
  const fr = expectedOrigins(FR as any);
  assert.deepEqual(fr, ['https://fr.axal.vc'], 'a branch Worker must not accept a ceremony that began on HQ\'s origin');
});
