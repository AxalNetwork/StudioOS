import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { getProviderImpl, REGISTRY } from '../src/integrations/registry.ts';
import { encryptCredentials, decryptCredentials } from '../src/integrations/secrets.ts';
import { refreshAndPersist } from '../src/integrations/providers/carta.ts';

const scopes = ['read_issuer_info', 'read_issuer_stakeholders', 'read_issuer_securities'];
for (const isDemo of [true, false]) {
  test(`Carta ${isDemo ? 'playground' : 'production'}: authorize, exchange, refresh and revoke stay in the chosen environment`, async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE oauth_state_tokens(state TEXT, extra_json TEXT);
      CREATE TABLE integrations(id INTEGER PRIMARY KEY, credentials_enc TEXT, last_error TEXT, last_error_at TEXT, updated_at TEXT);`);
    const env: any = { DB: d1Over(db), RATE_LIMITS: memKV(), ENVIRONMENT: 'development',
      JWT_SECRET: 'test'.repeat(10), CARTA_CLIENT_ID: 'test-client', CARTA_CLIENT_SECRET: 'test-secret' };
    const auth = isDemo ? 'https://login.playground.carta.team' : 'https://login.app.carta.com';
    const api = isDemo ? 'https://api.playground.carta.team' : 'https://api.carta.com';
    db.prepare('INSERT INTO oauth_state_tokens VALUES (?, ?)').run('state-fixture', JSON.stringify({ is_demo: isDemo, challenge: 'challenge-fixture' }));
    const impl = getProviderImpl('carta')!;
    const c = { env } as any, user = { id: 17, role: 'founder' } as any;
    const url = new URL(await impl.buildAuthorizeUrl!(c, user, 'state-fixture'));
    assert.equal(url.origin + url.pathname, `${auth}/o/authorize/`);
    assert.deepEqual(url.searchParams.get('scope')?.split(' '), scopes);
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-fixture');
    assert.deepEqual(REGISTRY.find(p => p.key === 'carta')?.oauth_scopes, scopes);
    const before = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: any, init: any) => {
      const target = String(input); calls.push(target);
      if (target === `${auth}/o/access_token/` || target === `${auth}/o/revoke_token/`) {
        assert.equal(new Headers(init.headers).get('authorization'), `Basic ${btoa('test-client:test-secret')}`);
        const body = new URLSearchParams(init.body);
        assert.equal(body.has('client_secret'), false);
        if (target.endsWith('/revoke_token/')) {
          assert.equal(body.get('token_type_hint'), 'refresh_token');
          return new Response('{}');
        }
        if (body.get('grant_type') === 'authorization_code') assert.equal(body.get('code_verifier'), 'verifier-fixture');
        else assert.equal(body.get('refresh_token'), 'refresh-fixture');
        return new Response(JSON.stringify({ access_token: 'access-fixture', refresh_token: 'refresh-fixture', expires_in: 3600, scope: scopes.join(' ') }));
      }
      if (target.startsWith(`${api}/v1alpha1/issuers/issuer-fixture/`)) {
        assert.ok(['stakeholders', 'securities', 'vesting-schedules'].includes(new URL(target).pathname.split('/').at(-1)!));
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer access-fixture');
        return new Response(JSON.stringify({ results: [] }));
      }
      assert.equal(target, `${api}/v1alpha1/issuers`);
      return new Response(JSON.stringify({ issuers: [{ id: 'issuer-fixture' }] }));
    }) as any;
    try {
      const result = await impl.connect(c, user, { oauth_code: 'code-fixture', config: { is_demo: isDemo, pkce_verifier: 'verifier-fixture' } });
      assert.equal(result.config?.is_demo, isDemo);
      const enc = await encryptCredentials(env, 'connection-fixture', result.credentials);
      db.prepare('INSERT INTO integrations(id, credentials_enc) VALUES (1, ?)').run(enc);
      const row: any = { id: 1, user_id: 17, uid: 'connection-fixture', config_json: JSON.stringify(result.config), credentials_enc: enc };
      assert.equal(await refreshAndPersist(env, row), 'access-fixture');
      const stored = db.prepare('SELECT credentials_enc FROM integrations WHERE id=1').get() as any;
      assert.equal((await decryptCredentials(env, row.uid, stored.credentials_enc))?.refresh_token, 'refresh-fixture');
      assert.equal((await impl.sync!(c, user, row)).counts?.pulled, 0);
      await impl.revokeGranted!(env, result);
      assert.deepEqual(calls, [`${auth}/o/access_token/`, `${api}/v1alpha1/issuers`, `${auth}/o/access_token/`, ...['stakeholders', 'securities', 'vesting-schedules'].map(path => `${api}/v1alpha1/issuers/issuer-fixture/${path}`), `${auth}/o/revoke_token/`]);
    } finally { globalThis.fetch = before; db.close(); }
  });
}

for (const accepted of ['playground', 'production']) {
  test(`the HQ credential probe recognises a ${accepted} app using documented token endpoints`, async () => {
    const { testOauthCreds } = await import('../src/services/providerOauthTest.ts');
    const before = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: any, init: any) => {
      const url = new URL(String(input)); calls.push(url.origin);
      assert.equal(url.pathname, '/o/access_token/');
      assert.ok(['https://login.playground.carta.team', 'https://login.app.carta.com'].includes(url.origin));
      assert.equal(new Headers(init.headers).get('authorization'), `Basic ${btoa('test-client:test-secret')}`);
      assert.equal(new URLSearchParams(init.body).get('code'), 'axal-probe-invalid-code');
      const recognised = url.hostname.includes('playground') === (accepted === 'playground');
      return new Response(JSON.stringify({ error: recognised ? 'invalid_grant' : 'invalid_client' }), { status: 400 });
    }) as any;
    try {
      const result = await testOauthCreds({ CARTA_CLIENT_ID: 'test-client', CARTA_CLIENT_SECRET: 'test-secret' } as any, 'carta');
      assert.equal(result.ok, true);
      assert.match(result.detail, new RegExp(accepted, 'i'));
      assert.equal(calls.length, accepted === 'playground' ? 1 : 2);
    } finally { globalThis.fetch = before; }
  });
}
