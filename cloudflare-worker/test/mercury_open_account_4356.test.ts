/**
 * #4356 (D4356): `GET /api/mercury/personal/status` names `open_account_url`,
 * where Incorporate's bank step sends a founder to open a Mercury account.
 *
 *   · the owner's referral link (`MERCURY_REFERRAL_URL`) when it is https on
 *     mercury.com or a subdomain, with no credentials; else Mercury's public site;
 *   · named whether or not the caller is connected; the frontend names no Mercury host (D715).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_open_account_4356.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MERCURY_PUBLIC_URL, mercuryOpenAccountUrl } from '../src/routes/mercury_personal.ts';
import { personalFixture, connected, req } from './_mercury_personal_d713.ts';

test('the referral link only when it is https on mercury.com; else the public site', () => {
  assert.equal(MERCURY_PUBLIC_URL, 'https://mercury.com/');
  assert.equal(mercuryOpenAccountUrl(undefined), MERCURY_PUBLIC_URL, 'unset');
  assert.equal(mercuryOpenAccountUrl('  '), MERCURY_PUBLIC_URL);
  assert.equal(mercuryOpenAccountUrl(' https://mercury.com/r/axal-example '), 'https://mercury.com/r/axal-example');
  assert.equal(mercuryOpenAccountUrl('https://app.mercury.com/signup?ref=x'), 'https://app.mercury.com/signup?ref=x');
  for (const bad of ['http://mercury.com/r/x', 'https://mercury.com.evil.example/r', 'https://evilmercury.com/', 'javascript:alert(1)', 'https://u:p@mercury.com/', 'not a url']) {
    assert.equal(mercuryOpenAccountUrl(bad), MERCURY_PUBLIC_URL, `${bad} is never named`);
  }
});

test('GET /status names open_account_url, connected or not, from the Worker\'s config', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 20);
  const plain = await req(env, 10, 'GET', '/api/mercury/personal/status');
  assert.equal(plain.status, 200, plain.text);
  assert.deepEqual([plain.body.connected, plain.body.open_account_url], [false, MERCURY_PUBLIC_URL]);
  const withRef = { ...env, MERCURY_REFERRAL_URL: 'https://mercury.com/r/axal-example' };
  const ref = await req(withRef, 10, 'GET', '/api/mercury/personal/status');
  assert.equal(ref.body.open_account_url, 'https://mercury.com/r/axal-example');
  const conn = await req(withRef, 20, 'GET', '/api/mercury/personal/status');
  assert.deepEqual([conn.body.connected, conn.body.open_account_url], [true, 'https://mercury.com/r/axal-example']);
  const off = await req({ ...env, MERCURY_REFERRAL_URL: 'https://evil.example/r' }, 10, 'GET', '/api/mercury/personal/status');
  assert.equal(off.body.open_account_url, MERCURY_PUBLIC_URL, 'an off-site value is never named');
});
