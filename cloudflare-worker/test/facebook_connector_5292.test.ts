import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { getProviderImpl } from '../src/integrations/registry.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { facebookReady, listFacebookPages } from '../src/integrations/providers/facebook.ts';
import deletion from '../src/routes/meta_data_deletion.ts';
import { fakeMetaGraph } from './_meta_graph_fake.mjs';
import type { Env } from '../src/types.ts';

const env = { WHATSAPP_APP_ID: '123', WHATSAPP_APP_SECRET: 'fixture', FACEBOOK_LOGIN_CONFIG_ID: '456', FACEBOOK_APP_APPROVED: '1', JWT_SECRET: 'synthetic-test-secret-used-only-in-tests' } as Env;
const scopes = ['pages_show_list', 'pages_read_engagement', 'read_insights'];

test('Facebook waits for App Review and uses the separate Business Login configuration', async () => {
  assert.equal(facebookReady({ ...env, FACEBOOK_APP_APPROVED: '0' }), false);
  const provider = getProviderImpl('facebook')!;
  const url = new URL(await provider.buildAuthorizeUrl!({ env, req: { header: () => undefined } } as never, {} as never, 'state'));
  assert.equal(url.searchParams.get('config_id'), '456');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.equal(url.searchParams.has('scope'), false);
});

test('Page listing follows Graph pagination and exposes only Page IDs and names', async t => {
  fakeMetaGraph(t, url => {
    if (url.pathname.endsWith('/permissions')) return { data: scopes.map(permission => ({ permission, status: 'granted' })) };
    if (!url.searchParams.has('after')) return { data: [{ id: '12', name: 'First', access_token: 'fixture' }], paging: { next: 'ignored', cursors: { after: 'cursor' } } };
    return { data: [{ id: '13', name: 'Second' }] };
  });
  const credentials_enc = await encryptCredentials(env, 'row', { access_token: 'fixture' });
  const row = { uid: 'row', credentials_enc } as never;
  assert.deepEqual(await listFacebookPages(env, row), [{ id: '12', name: 'First' }, { id: '13', name: 'Second' }]);
});

test('Meta deletion requires a signed request and deletes only matching Facebook data', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE integrations (id INTEGER, provider_key TEXT, external_account_id TEXT);
    CREATE TABLE integration_companies (integration_id INTEGER);
    CREATE TABLE integration_logs (integration_id INTEGER, provider_key TEXT);
    INSERT INTO integrations VALUES (1, 'facebook', '123'), (2, 'whatsapp', '123'), (3, 'facebook', '456');
    INSERT INTO integration_companies VALUES (1),(2),(3);
    INSERT INTO integration_logs VALUES (1,'facebook'),(2,'whatsapp'),(3,'facebook');`);
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/meta/data-deletion', deletion);
  const bindings = { ...env, DB: {
    prepare: (sql: string) => ({ bind: (id: string) => () => db.prepare(sql).run(id) }),
    batch: async (statements: Array<() => unknown>) => statements.map(run => run()),
  } } as unknown as Env;
  const post = (value: string) => app.request('/api/meta/data-deletion', { method: 'POST', body: new URLSearchParams({ signed_request: value }) }, bindings);
  assert.equal((await post('bad')).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM integrations').get()?.n, 3);
  const data = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: Math.floor(Date.now() / 1000), user_id: '123' })).toString('base64url');
  const signature = createHmac('sha256', 'fixture').update(data).digest('base64url');
  const result = await post(`${signature}.${data}`);
  assert.equal(result.status, 200);
  const { url, confirmation_code } = await result.json() as { url: string; confirmation_code: string };
  assert.equal(new URL(url).pathname.split('/').at(-1), confirmation_code);
  assert.equal((await app.request(new URL(url).pathname, {}, bindings)).status, 200);
  assert.deepEqual(db.prepare('SELECT id FROM integrations ORDER BY id').all().map(r => r.id), [2, 3]);
  assert.deepEqual(db.prepare('SELECT integration_id FROM integration_logs ORDER BY integration_id').all().map(r => r.integration_id), [2, 3]);
});

test('Facebook refuses excess grants and revokes only its named read permissions', async t => {
  const calls = fakeMetaGraph(t, url => {
    if (url.pathname.endsWith('/oauth/access_token')) return { access_token: 'fixture' };
    if (url.pathname.endsWith('/me/permissions')) return { data: [...scopes, 'pages_manage_posts'].map(permission => ({ permission, status: 'granted' })) };
    return { success: true };
  });
  await assert.rejects(getProviderImpl('facebook')!.connect({ env, req: { header: () => undefined } } as never, {} as never, { oauth_code: 'fixture' }), { code: 'scope_overreach' });
  assert.deepEqual(calls.filter(c => c.method === 'DELETE').map(c => c.path.split('/').at(-1)), scopes);
});

test('a Page outside the directory is refused before any selection is written', async t => {
  fakeMetaGraph(t, url => url.pathname.endsWith('/permissions')
    ? { data: scopes.map(permission => ({ permission, status: 'granted' })) }
    : { data: [{ id: '12', name: 'First' }] });
  const credentials_enc = await encryptCredentials(env, 'row', { access_token: 'fixture' });
  const context = {
    env: { ...env, DB: { prepare: () => ({ bind: () => ({ first: async () => ({ ok: 1 }) }) }) } },
    req: { method: 'POST', header: (name: string) => name === 'X-Company-Id' ? '1' : undefined },
  };
  await assert.rejects(getProviderImpl('facebook')!.action!(context as never, { id: 1 } as never,
    { id: 1, uid: 'row', credentials_enc, status: 'active' } as never, 'choose_pages', { page_ids: ['99'] }), { code: 'facebook_page_not_granted' });
});

test('a support session cannot start Facebook OAuth or manage Pages', async () => {
  const jwt = await new SignJWT({ user_id: 1, impersonated_by: 2 })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
  const c = { env, req: { header: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${jwt}` : undefined } } as never;
  const facebook = getProviderImpl('facebook')!;
  await assert.rejects(facebook.buildAuthorizeUrl!(c, {} as never, 'state'), { code: 'support_session_refused' });
  await assert.rejects(facebook.action!(c, {} as never, {} as never, 'list_pages', null), { code: 'support_session_refused' });
});
