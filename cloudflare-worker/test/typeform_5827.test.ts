/**
 * D5827 (#5827) — Typeform, read only, and the one form each venture reads.
 * Typeform is a fake serving both data centers: no test reaches a real host.
 * Every id, token and form is invented.
 *
 *  1. Consent asks for forms:read, responses:read and offline on the chosen
 *     region's origin; the record, scope and page hold it.
 *  2. Not ready without the owner's approval flag.
 *  3. Sign in end to end, US and EU: the region rides in the signed state, not
 *     the callback's query; every later request goes to that region only.
 *  4. Denied consent, a stale or replayed state and another member's state
 *     connect nothing; a grant with no refresh token is refused.
 *  5. The paginated picker; field identities without titles in the binding;
 *     an empty account is an empty page, not an error.
 *  6. Malformed, unknown and mismatched forms bind nothing; no request leaves
 *     for a malformed id.
 *  7. Two members, two ventures; a teammate's binding is never replaced.
 *  8. The check tells a revoked grant, a missing scope and a deleted form apart.
 *  9. Rotating refresh: one refresh under concurrency, the rotated token kept,
 *     a spent refresh token never sent again.
 * 10. A support session, a stranger and an unswitched company are refused.
 * 11. Disconnect removes the bindings; no token or form content in logs or responses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import integrations from '../src/routes/integrations.ts';
import typeform from '../src/routes/typeform.ts';
import { typeformSession } from '../src/integrations/providers/typeform.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import { TYPEFORM_READ_SCOPES, isFormId, typeformAuthorizeUrl } from '../src/integrations/typeformOAuth.ts';
import { personalFixture } from './_mercury_personal_d713.ts';

const COMPANY = 77;
const KEY = 'typeform';
const MIGRATION = readFileSync(`cloudflare-worker/sql/migrations/${readdirSync('cloudflare-worker/sql/migrations').find((f) => /^\d{12}_5827_typeform_form_bindings\.sql$/.test(f))}`, 'utf8');
const ORIGIN = { us: 'https://api.typeform.com', eu: 'https://api.eu.typeform.com' } as const;
const SECRET_TITLE = 'Confidential pricing survey';

type Region = 'us' | 'eu';
interface Form { id: string; title: string; fields: unknown[] }

function form(id: string): Form {
  return {
    id, title: `${SECRET_TITLE} ${id}`,
    fields: [
      { id: 'fldEmail01', ref: 'email_ref', type: 'email', title: 'Your work email?' },
      { id: 'fldGroup01', ref: 'group_ref', type: 'group', title: 'About you',
        properties: { fields: [{ id: 'fldRole001', ref: 'role_ref', type: 'multiple_choice', title: 'Your role?' }] } },
      { id: 'bad id!', type: 'short_text', title: 'dropped' },
    ],
  };
}

function typeformFake() {
  const s = {
    forms: { us: [form('UsForm01'), form('UsForm02'), form('UsForm03')], eu: [form('EuForm01')] } as Record<Region, Form[]>,
    refresh: true,
    scope: TYPEFORM_READ_SCOPES.join(' ') as string | null,
    revoked: false,
    scopeMissing: false,
    mismatch: false,
    issued: 0,
    /** Refresh tokens Typeform has accepted once; a second use is refused, as rotation requires. */
    spent: new Set<string>(),
    calls: [] as Array<{ origin: string; path: string; search: string; method: string; body: string | null; auth: string | null }>,
  };
  const regionOf = (origin: string): Region => (origin === ORIGIN.eu ? 'eu' : 'us');
  const fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.origin !== ORIGIN.us && url.origin !== ORIGIN.eu) throw new Error(`unexpected origin ${url.origin}`);
    const region = regionOf(url.origin);
    const body = init.body ? String(init.body) : null;
    const auth = init.headers?.Authorization ?? null;
    s.calls.push({ origin: url.origin, path: url.pathname, search: url.search, method: init.method ?? 'GET', body, auth });
    if (url.pathname === '/oauth/token') {
      const f = new URLSearchParams(body ?? '');
      if (s.revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (f.get('grant_type') === 'refresh_token') {
        const rt = f.get('refresh_token')!;
        if (s.spent.has(rt) || !rt.startsWith(`tf-${region}-refresh`)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        s.spent.add(rt);
      } else if (f.get('code') !== 'fixture-code') {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      const n = ++s.issued;
      return Response.json({
        access_token: `tf-${region}-access-${n}`, token_type: 'bearer', expires_in: 604800,
        ...(s.scope === null ? {} : { scope: s.scope }),
        ...(s.refresh ? { refresh_token: `tf-${region}-refresh-${n}` } : {}),
      });
    }
    if (s.revoked || !String(auth).startsWith(`Bearer tf-${region}-access`)) return Response.json({ code: 'AUTHENTICATION_FAILED' }, { status: 401 });
    if (s.scopeMissing) return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
    if (url.pathname === '/forms') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const size = Number(url.searchParams.get('page_size') ?? 10);
      const all = s.forms[region];
      return Response.json({
        total_items: all.length, page_count: Math.ceil(all.length / size),
        items: all.slice((page - 1) * size, page * size).map((f) => ({ id: f.id, title: f.title, last_updated_at: '2026-11-01T00:00:00Z' })),
      });
    }
    const m = /^\/forms\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (m) {
      const f = s.forms[region].find((x) => x.id === m[1]);
      if (!f) return Response.json({ code: 'FORM_NOT_FOUND' }, { status: 404 });
      return Response.json(s.mismatch ? { ...f, id: 'OtherForm' } : f);
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return Object.assign(s, { fetch });
}

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(env0: Record<string, string> = {}) {
  _clearOauthCredsCache();
  const { db, env } = await personalFixture();
  db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
  db.exec(`UPDATE projects SET company_id = ${COMPANY}`);
  db.exec("INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Fixture cofounder', 'cofounder@example.test', 100)");
  db.exec(`INSERT INTO user_company_links (user_id, company_id) VALUES (10, ${COMPANY}), (11, ${COMPANY})`);
  db.exec(MIGRATION);
  Object.assign(env, {
    RATE_LIMITS: memoryKv(), OAUTH_CALLBACK_BASE_URL: 'https://app.example.test',
    TYPEFORM_APP_APPROVED: '1', TYPEFORM_CLIENT_ID: 'fixture-typeform-client', TYPEFORM_CLIENT_SECRET: 'fixture-typeform-secret', ...env0,
  });
  const tf = typeformFake();
  const app = new Hono<any>();
  app.route('/api/connectors', integrations);
  app.route('/api/typeform', typeform);
  app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));
  return { db, env, tf, app };
}
type T = Awaited<ReturnType<typeof setup>>;

const ROLES: Record<number, string> = { 10: 'founder', 11: 'founder', 30: 'investor' };

async function req(t: T, who: number, path: string, o: { method?: string; body?: unknown; impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(o.impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(t.env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'X-Company-Id': String(COMPANY) };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const real = globalThis.fetch;
  globalThis.fetch = t.tf.fetch;
  try {
    const res = await t.app.request(path, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) }, t.env);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a redirect */ }
    return { status: res.status, body, text, location: res.headers.get('Location') };
  } finally { globalThis.fetch = real; }
}

const row = (t: T, user = 10) => t.db.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').get(user, KEY) as any;
const start = (t: T, who = 10, region?: Region) => req(t, who, `/api/connectors/oauth/${KEY}/start${region ? `?region=${region}` : ''}`);
const callback = (t: T, who: number, state: string, extra = '') =>
  req(t, who, `/api/connectors/oauth/${KEY}/callback?code=fixture-code&state=${encodeURIComponent(state)}${extra}`);

async function connected(t: T, who = 10, region: Region = 'us') {
  const s = await start(t, who, region);
  assert.equal(s.status, 200, s.text);
  const back = await callback(t, who, s.body.state);
  assert.doesNotMatch(back.location ?? '', /error/, back.location ?? back.text);
  return row(t, who).id as number;
}

const FORMS = '/api/typeform/forms';
const BIND = '/api/typeform/form';
const CHECK = '/api/typeform/form/check';
const leak = (text: string) => {
  assert.doesNotMatch(text, /tf-(us|eu)-(access|refresh)|fixture-typeform-secret/, 'no token or secret');
};

test('1. consent asks for the three scopes on the region\'s origin; the record holds them', () => {
  for (const [region, origin] of Object.entries(ORIGIN) as Array<[Region, string]>) {
    const url = new URL(typeformAuthorizeUrl(region, 'client-x', 'https://app.example.test/cb', 'signed+state='));
    assert.equal(url.origin + url.pathname, `${origin}/oauth/authorize`);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      client_id: 'client-x', redirect_uri: 'https://app.example.test/cb', state: 'signed+state=',
      scope: 'forms:read responses:read offline', response_type: 'code',
    });
  }
  const d = getDescriptor(KEY)!;
  assert.equal(d.auth_type, 'oauth2');
  assert.deepEqual(d.oauth_scopes, ['forms:read', 'responses:read', 'offline']);
  assert.ok(CONNECTOR_METADATA[KEY] && CONNECTOR_PAGES[KEY]);
  assert.equal(writesProjectData(KEY), true);
  for (const ok of ['UsForm01', 'a1', 'Z'.repeat(64)]) assert.equal(isFormId(ok), true, ok);
  for (const bad of ['', 'a/b', '../me', 'a b', 'Z'.repeat(65), 'x?y', 7, null]) assert.equal(isFormId(bad), false, String(bad));
});

test('2. not ready without the approval flag: nothing is sent to Typeform', async () => {
  const t = await setup({ TYPEFORM_APP_APPROVED: '' });
  assert.equal(await getProviderImpl(KEY)!.ready!(t.env), false);
  assert.equal((await start(t)).status, 503);
  assert.equal(t.tf.calls.length, 0);
});

test('3. sign in end to end, US and EU; the region comes from the signed state only', async () => {
  const us = await setup();
  const s = await start(us);
  assert.equal(new URL(s.body.authorize_url).origin, ORIGIN.us, 'US by default');
  assert.equal(new URL(s.body.authorize_url).searchParams.get('redirect_uri'), `https://app.example.test/api/integrations/oauth/${KEY}/callback`);
  // A forged `region=eu` on the callback is ignored: the state said US.
  await callback(us, 10, s.body.state, '&region=eu');
  const r = row(us);
  assert.equal(r.status, 'active');
  const creds = await decryptCredentials(us.env, r.uid, r.credentials_enc);
  assert.equal(creds!.region, 'us');
  assert.deepEqual(JSON.parse(r.scopes_json), ['forms:read', 'responses:read', 'offline']);
  assert.ok(us.tf.calls.every((c) => c.origin === ORIGIN.us));

  const eu = await setup();
  const e = await start(eu, 10, 'eu');
  assert.equal(new URL(e.body.authorize_url).origin, ORIGIN.eu);
  await callback(eu, 10, e.body.state);
  assert.equal((await decryptCredentials(eu.env, row(eu).uid, row(eu).credentials_enc))!.region, 'eu');
  const pick = await (async () => { eu.db.prepare('UPDATE integration_companies SET enabled = 1').run(); return req(eu, 10, `${FORMS}?project=1`); })();
  assert.deepEqual(pick.body.forms.items.map((f: any) => f.id), ['EuForm01']);
  assert.ok(eu.tf.calls.every((c) => c.origin === ORIGIN.eu), 'an EU token never goes to the US origin');
});

test('4. denied consent, stale or foreign state, and an offline-less grant connect nothing', async () => {
  const t = await setup();
  const s = await start(t);
  const denied = await req(t, 10, `/api/connectors/oauth/${KEY}/callback?error=access_denied&state=${encodeURIComponent(s.body.state)}`);
  assert.match(denied.location ?? '', /oauth=error.*reason=access_denied/);
  assert.equal(row(t), undefined);
  const replay = await callback(t, 10, s.body.state);
  assert.equal(replay.status, 400, 'a consumed state is stale');
  const theirs = await start(t, 11);
  const foreign = await callback(t, 10, theirs.body.state);
  assert.equal(foreign.status, 400, 'another member\'s state is refused');
  assert.equal(row(t), undefined);
  assert.equal(t.tf.calls.filter((c) => c.path === '/oauth/token').length, 0, 'no code was exchanged');

  const online = await setup();
  online.tf.refresh = false;
  const o = await start(online);
  const back = await callback(online, 10, o.body.state);
  assert.match(back.location ?? '', /error/);
  assert.equal(row(online), undefined);

  const broad = await setup();
  broad.tf.scope = 'forms:read responses:read offline forms:write';
  const b = await start(broad);
  assert.match((await callback(broad, 10, b.body.state)).location ?? '', /reason=scope_overreach/);
  assert.equal(row(broad), undefined);
});

test('5. the paginated picker, field identities without titles, and an empty account', async () => {
  const t = await setup();
  t.tf.forms.us = Array.from({ length: 53 }, (_, i) => form(`Form${String(i).padStart(3, '0')}`));
  await connected(t);
  const p1 = await req(t, 10, `${FORMS}?project=1`);
  assert.equal(p1.status, 200, p1.text);
  leak(p1.text);
  assert.deepEqual(p1.body.capability, { connected: true, company_enabled: true, can_bind: true });
  assert.equal(p1.body.forms.items.length, 50);
  assert.deepEqual([p1.body.forms.page, p1.body.forms.page_count, p1.body.forms.total_items], [1, 2, 53]);
  const p2 = await req(t, 10, `${FORMS}?project=1&page=2`);
  assert.deepEqual(p2.body.forms.items.map((f: any) => f.id), ['Form050', 'Form051', 'Form052']);
  const fields = await req(t, 10, `${FORMS}/Form001/fields?project=1`);
  assert.deepEqual(fields.body.fields, [
    { id: 'fldEmail01', ref: 'email_ref', type: 'email' },
    { id: 'fldGroup01', ref: 'group_ref', type: 'group' },
    { id: 'fldRole001', ref: 'role_ref', type: 'multiple_choice' },
  ], 'stable ids and types, nested fields included, a malformed one dropped');
  const bound = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'Form001' } });
  assert.equal(bound.status, 200, bound.text);
  assert.equal(bound.body.binding.form_id, 'Form001');
  assert.equal(bound.body.binding.fields.length, 3);
  const stored = t.db.prepare('SELECT fields_json FROM typeform_form_bindings').get().fields_json;
  assert.doesNotMatch(stored, /work email|Your role|About you|Confidential/, 'no field or form title is stored');

  const empty = await setup();
  empty.tf.forms.us = [];
  await connected(empty);
  const e = await req(empty, 10, `${FORMS}?project=1`);
  assert.deepEqual(e.body.forms.items, []);
  assert.equal(e.body.forms_error, null, 'an empty account is not an error');
});

test('6. malformed, unknown and mismatched forms bind nothing', async () => {
  const t = await setup();
  await connected(t);
  const before = t.tf.calls.length;
  for (const bad of ['../me', 'a b', { id: 'UsForm01' }, 7]) {
    const r = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'form_malformed');
  }
  assert.equal((await req(t, 10, `${FORMS}/..%2Fme/fields?project=1`)).status, 400);
  assert.equal(t.tf.calls.length, before, 'no request leaves for a malformed id');
  const unknown = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'NotMine01' } });
  assert.equal(unknown.body.error, 'form_not_found');
  t.tf.mismatch = true;
  const mm = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm01' } });
  assert.equal(mm.body.error, 'form_mismatch');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM typeform_form_bindings').get().n, 0);
});

test('7. two members, two ventures; a teammate never replaces a binding', async () => {
  const t = await setup();
  await connected(t, 10);
  await connected(t, 11);
  assert.equal((await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm01' } })).status, 200);
  assert.equal((await req(t, 11, BIND, { method: 'PUT', body: { project: 2, form_id: 'UsForm02' } })).status, 200);
  const rows = t.db.prepare('SELECT project_id, form_id, bound_by FROM typeform_form_bindings ORDER BY project_id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.project_id, r.form_id, r.bound_by]), [[1, 'UsForm01', 10], [2, 'UsForm02', 11]]);
  const theirs = await req(t, 11, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm03' } });
  assert.equal(theirs.body.error, 'venture_served');
  assert.equal((await req(t, 11, BIND, { method: 'PUT', body: { project: 1, form_id: null } })).body.error, 'venture_served');
  const seen = await req(t, 11, `${FORMS}?project=1`);
  assert.equal(seen.body.capability.can_bind, false);
  assert.equal(seen.body.served_by.name, 'Founder');
  assert.equal((await req(t, 11, CHECK, { method: 'POST', body: { project: 1 } })).body.error, 'not_your_binding');
  assert.equal((await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: null } })).status, 200);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM typeform_form_bindings').get().n, 1);
});

test('8. the check tells a deleted form, a missing scope and a revoked grant apart', async () => {
  const t = await setup();
  await connected(t);
  await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm02' } });
  const check = async () => (await req(t, 10, CHECK, { method: 'POST', body: { project: 1 } })).body.binding;
  t.tf.scopeMissing = true;
  assert.deepEqual([(await check()).access_state, (await check()).lost_reason], ['lost', 'scope_missing']);
  t.tf.scopeMissing = false;
  assert.deepEqual([(await check()).access_state, (await check()).lost_reason], ['ok', null]);
  t.tf.forms.us = t.tf.forms.us.filter((f) => f.id !== 'UsForm02');
  assert.equal((await check()).lost_reason, 'form_deleted');
  t.tf.revoked = true;
  assert.equal((await check()).lost_reason, 'grant_revoked');
  const pick = await req(t, 10, `${FORMS}?project=1`);
  assert.equal(pick.body.forms, null);
  assert.equal(pick.body.forms_error.code, 'sign_in_again', 'a lost grant is not an empty account');
  const logged = t.db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'typeform_%' ORDER BY id").all().map((r: any) => r.action);
  assert.deepEqual(logged, ['typeform_form_bound', 'typeform_form_lost_scope_missing', 'typeform_form_lost_form_deleted']);
});

test('9. rotating refresh: one refresh under concurrency, the rotated token kept, a spent one never resent', async () => {
  const t = await setup();
  const id = await connected(t);
  const expire = async () => {
    const r = row(t);
    const creds = await decryptCredentials(t.env, r.uid, r.credentials_enc);
    t.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(await encryptCredentials(t.env, r.uid, { ...creds!, expires_at: 1 }), id);
  };
  await expire();
  const real = globalThis.fetch;
  globalThis.fetch = t.tf.fetch;
  let results: PromiseSettledResult<unknown>[];
  try { results = await Promise.allSettled([typeformSession(t.env, row(t)), typeformSession(t.env, row(t))]); }
  finally { globalThis.fetch = real; }
  const refreshes = t.tf.calls.filter((c) => c.path === '/oauth/token' && new URLSearchParams(c.body!).get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1, 'one refresh for two callers');
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  for (const r of results) if (r.status === 'rejected') assert.equal((r.reason as Error).message, 'typeform_refresh_busy');
  const after = await decryptCredentials(t.env, row(t).uid, row(t).credentials_enc);
  assert.equal(after!.refresh_token, 'tf-us-refresh-2', 'the rotated refresh token is stored');
  await expire();
  const pick = await req(t, 10, `${FORMS}?project=1`);
  assert.equal(pick.status, 200);
  assert.equal(pick.body.forms_error, null, pick.text);
  const sent = t.tf.calls.filter((c) => c.path === '/oauth/token' && c.body?.includes('grant_type=refresh_token')).map((c) => new URLSearchParams(c.body!).get('refresh_token'));
  assert.deepEqual(sent, ['tf-us-refresh-1', 'tf-us-refresh-2'], 'each refresh token is sent once');
});

test('10. a support session, a stranger and an unswitched company are refused', async () => {
  const t = await setup();
  await connected(t);
  t.db.prepare('UPDATE integration_companies SET enabled = 0').run();
  assert.equal((await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm01' } })).body.error, 'company_not_enabled');
  assert.deepEqual((await req(t, 10, `${FORMS}?project=1`)).body.capability, { connected: true, company_enabled: false, can_bind: false });
  t.db.prepare('UPDATE integration_companies SET enabled = 1').run();
  const before = t.tf.calls.length;
  const support = await req(t, 10, `${FORMS}?project=1`, { impersonated: true });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  assert.equal(t.tf.calls.length, before);
  assert.equal((await req(t, 30, `${FORMS}?project=1`)).status, 403);
  assert.equal((await req(t, 11, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm01' } })).body.error, 'not_connected');
  assert.equal((await req(t, 10, `${FORMS}?project=x`)).status, 400);
});

test('11. disconnect removes the bindings; no token or form content in logs or responses', async (tt) => {
  const t = await setup();
  const logs: string[] = [];
  tt.mock.method(console, 'warn', (...a: unknown[]) => { logs.push(JSON.stringify(a)); });
  tt.mock.method(console, 'log', (...a: unknown[]) => { logs.push(JSON.stringify(a)); });
  await connected(t);
  const b = await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm01' } });
  leak(b.text);
  t.tf.revoked = true;
  await req(t, 10, `${FORMS}?project=1`);
  t.tf.revoked = false;
  const del = await req(t, 10, `/api/connectors/${row(t).uid}`, { method: 'DELETE' });
  assert.equal(del.status, 200, del.text);
  assert.equal(row(t), undefined);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM typeform_form_bindings').get().n, 0);
  const all = logs.join('\n') + JSON.stringify(t.db.prepare('SELECT * FROM activity_logs').all()) + JSON.stringify(t.db.prepare('SELECT * FROM integration_logs').all());
  leak(all);
  assert.doesNotMatch(all, new RegExp(SECRET_TITLE), 'no form title in logs');
  // Reconnect starts clean, and the next bind is verified again.
  await connected(t);
  assert.equal((await req(t, 10, BIND, { method: 'PUT', body: { project: 1, form_id: 'UsForm01' } })).status, 200);
});
