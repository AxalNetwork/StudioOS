import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { encryptString } from '../src/services/cryptoBox.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';
import { getFreshAccessToken } from '../src/routes/admin_x.ts';
import { buildAuthorizeUrl, getMe, uploadMedia, XError } from '../src/services/xClient.ts';

test('X consent includes the scope needed to upload media', () => {
  const url = new URL(buildAuthorizeUrl({ clientId: 'client', redirectUri: 'https://axal.vc/callback', state: 's', codeChallenge: 'c' }));
  assert.deepEqual(url.searchParams.get('scope')?.split(' '), [
    'tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access',
  ]);
});

test('image upload uses the v2 JSON endpoint and returns its media id in the existing shape', async () => {
  const before = globalThis.fetch;
  let request: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    request = { url: String(input), init: init! };
    return new Response(JSON.stringify({ data: { id: 'media-v2-1', size: 3, media_key: '13_media-v2-1' } }), { status: 200 });
  }) as any;
  try {
    const uploaded = await uploadMedia({ accountId: 'media-test-account', accessToken: 'opaque', bytes: new Uint8Array([1, 2, 3]) });
    assert.equal(request?.url, 'https://api.x.com/2/media/upload');
    const headers = new Headers(request?.init.headers);
    assert.equal(headers.get('authorization'), 'Bearer opaque');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(request?.init.body)), { media: 'AQID', media_category: 'tweet_image' });
    assert.deepEqual(uploaded, { media_id_string: 'media-v2-1', size: 3 });
  } finally { globalThis.fetch = before; }
});

test('a failing account breaker does not pause another account', async () => {
  const before = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    calls += 1;
    if (new Headers(init?.headers).get('authorization') === 'Bearer broken') return new Response('upstream', { status: 503 });
    return new Response(JSON.stringify({ data: { id: '2', name: 'HQ', username: 'axal' } }), { status: 200 });
  }) as any;
  try {
    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => getMe('broken', 'breaker-broken-2412'), (e: unknown) => e instanceof XError && e.code === 'x_upstream');
    }
    assert.equal((await getMe('healthy', 'breaker-healthy-2412')).data.id, '2');
    const beforeBlockedCall = calls;
    await assert.rejects(() => getMe('broken', 'breaker-broken-2412'), (e: unknown) => e instanceof XError && e.code === 'x_breaker_open');
    assert.equal(calls, beforeBlockedCall, 'an open breaker still called X');
  } finally { globalThis.fetch = before; }
});

test('simultaneous expired-token callers refresh an X account once and share the rotated token', async () => {
  const db = new DatabaseSync(':memory:');
  const env: any = {
    DB: d1Over(db), RATE_LIMITS: memKV(), ENVIRONMENT: 'development',
    X_CLIENT_ID: 'fixture-client', X_CLIENT_SECRET: 'fixture-secret',
    JWT_SECRET: 'x-client-hardening-fixture-secret-0123456789',
  };
  const before = globalThis.fetch;
  let calls = 0;
  let releaseResponse!: () => void;
  const hold = new Promise<void>((resolve) => { releaseResponse = resolve; });
  try {
    await ensureXSchema(env);
    const accessTokenCt = await encryptString(env, 'old-access');
    const refreshTokenCt = await encryptString(env, 'old-refresh');
    await db.prepare(`INSERT INTO x_accounts (id, handle, access_token_ct, refresh_token_ct, expires_at, enabled)
      VALUES (73, 'fixture-hq', ?, ?, '2000-01-01T00:00:00.000Z', 1)`).run(accessTokenCt, refreshTokenCt);
    const stale = await env.DB.prepare('SELECT id, access_token_ct, refresh_token_ct, expires_at FROM x_accounts WHERE id = ?').bind(73).first();
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      assert.equal(String(input), 'https://api.twitter.com/2/oauth2/token');
      calls += 1;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('refresh_token'), 'old-refresh');
      await hold;
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), { status: 200 });
    }) as any;
    const first = getFreshAccessToken(env, stale);
    const second = getFreshAccessToken(env, stale);
    await new Promise((resolve) => setTimeout(resolve, 30));
    releaseResponse();
    assert.deepEqual(await Promise.all([first, second]), ['new-access', 'new-access']);
    assert.equal(calls, 1);
    const stored = await env.DB.prepare('SELECT access_token_ct, refresh_token_ct FROM x_accounts WHERE id = ?').bind(73).first();
    assert.equal(await (await import('../src/services/cryptoBox.ts')).decryptString(env, stored.access_token_ct), 'new-access');
    assert.equal(await (await import('../src/services/cryptoBox.ts')).decryptString(env, stored.refresh_token_ct), 'new-refresh');
  } finally {
    globalThis.fetch = before;
    db.close();
  }
});
