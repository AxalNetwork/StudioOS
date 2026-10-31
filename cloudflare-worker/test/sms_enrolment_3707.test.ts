import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import sms from '../src/routes/auth_sms.ts';
import * as gcip from '../src/services/gcip.ts';
import { d1Over } from './_d1_sqlite.mjs';

const PHONE = '+41790000000'; // synthetic, never sent to a live provider
const SECRET = 'synthetic-sms-3707-key-'.repeat(3);
const DEFAULT_COUNTRIES = 'US CA GB IE DE FR NL CH LU ES IT SE NO DK FI EE AE IL IN SG HK JP KR AU NZ BR MX'.split(' ');
async function fixture(t: any) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['277_user_recovery_state.sql', '302_push_subscriptions.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  db.exec("INSERT INTO users(id,email,name,role,country,email_verified) VALUES(1,'sms-fixture@example.test','Fixture','founder','CH',1)");
  const kv = new Map<string, string>();
  const f: any = { db, kv, calls: [], sendError: null, verifyError: null, siteKey: 'synthetic-site-key', cacheOptions: null };
  f.env = { DB: d1Over(db), ENVIRONMENT: 'production', JWT_SECRET: SECRET, KEK_PII: 'synthetic-pii-3707'.repeat(3), GCIP_API_KEY: 'synthetic-api-key', RATE_LIMITS: {
    async get(k: string) { return kv.get(k) ?? null; },
    async put(k: string, v: string, options: any) { kv.set(k, v); if (k === 'gcip-recaptcha-site-key') f.cacheOptions = options; },
    async delete(k: string) { kv.delete(k); },
  } };
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const path = new URL(String(url)).pathname;
    f.calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.endsWith('/recaptchaParams')) return Response.json({ recaptchaSiteKey: f.siteKey });
    const error = path.endsWith(':sendVerificationCode') ? f.sendError : f.verifyError;
    if (error) return Response.json({ error: { message: error } }, { status: 400 });
    if (path.endsWith(':sendVerificationCode')) return Response.json({ sessionInfo: 'synthetic-session' });
    if (path.endsWith(':signInWithPhoneNumber')) return Response.json({ phoneNumber: PHONE, localId: 'synthetic-uid', idToken: 'synthetic-token' });
    throw new Error('Unexpected synthetic provider path');
  });
  const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  f.headers = { Cookie: `studioos_auth=${token}`, 'content-type': 'application/json' };
  return f;
}
async function read(f: any, route = sms) { const r = await route.request('/sms/status', { headers: f.headers }, f.env); return r.json() as Promise<any>; }
async function post(f: any, endpoint: string, body: any, route = sms) {
  const r = await route.request('/sms/' + endpoint, { method: 'POST', headers: f.headers, body: JSON.stringify(body) }, f.env);
  return { status: r.status, body: await r.json() as any };
}
const startBody = { phone: PHONE, country: 'CH', recaptcha_token: 'synthetic-browser-token' };

async function statusRead(t: any, route = sms) {
  const f = await fixture(t);
  const first = await read(f, route), again = await read(f, route);
  assert.deepEqual([first.allowed_countries, first.recaptcha_site_key, first.sms_ready, again.recaptcha_site_key, f.calls.length, f.cacheOptions], [DEFAULT_COUNTRIES, 'synthetic-site-key', true, 'synthetic-site-key', 1, { expirationTtl: 3600 }]);
  f.env.SMS_COUNTRY_ALLOWLIST = '*';
  assert.equal((await read(f, route)).allowed_countries, null);
  f.env.SMS_COUNTRY_ALLOWLIST = ' ch, gb ';
  assert.deepEqual((await read(f, route)).allowed_countries, ['CH', 'GB']);
  f.env.GCIP_API_KEY = '';
  const absent = await read(f, route);
  assert.deepEqual([absent.sms_available, absent.sms_ready, absent.recaptcha_site_key, f.calls.length], [false, false, null, 1]);
}
test('status exposes shared country policy and only the cached public site key', t => statusRead(t));

test('incomplete bot-check setup is unavailable; the site-key read never throws', async t => {
  const f = await fixture(t);
  f.siteKey = null;
  const status = await read(f);
  assert.deepEqual([status.sms_available, status.sms_ready, status.recaptcha_site_key], [true, false, null]);
  f.env.GCIP_RECAPTCHA_TOKEN_FALLBACK = 'synthetic-development-only-fallback';
  assert.equal((await read(f)).sms_ready, true);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('synthetic network outage'); });
  assert.equal(await gcip.getRecaptchaSiteKey(f.env), null);
});

async function forwarding(t: any, service = gcip) {
  const f = await fixture(t);
  const result = await service.sendVerificationCode(f.env, PHONE, 'synthetic-browser-token');
  assert.deepEqual([result.ok, f.calls[0].body], [true, { phoneNumber: PHONE, recaptchaToken: 'synthetic-browser-token' }]);
}
test('the browser token reaches Google in the send body', t => forwarding(t));

async function refusals(t: any, route = sms) {
  const f = await fixture(t);
  const results = [];
  const cases = [
    ['MISSING_RECAPTCHA_TOKEN', 412, 'recaptcha_required'], ['QUOTA_EXCEEDED', 429, 'quota_exceeded'],
    ['OPERATION_NOT_ALLOWED', 503, 'phone_auth_disabled'], ['OPERATION_NOT_ALLOWED: SMS region disabled', 400, 'region_blocked'],
    ['INVALID_PHONE_NUMBER', 400, 'invalid_phone'], ['UNRECOGNIZED', 502, 'upstream_error'],
  ] as const;
  for (const [provider, status, code] of cases) {
    f.kv.clear(); f.sendError = provider + ' PROVIDER_DIAGNOSTIC';
    const r = await post(f, 'start-enrollment', startBody, route);
    results.push([r.status, r.body.error, r.body.message, JSON.stringify(r.body).includes('PROVIDER_DIAGNOSTIC')]);
  }
  assert.deepEqual(results, cases.map(([, status, code]) => [status, code, gcip.GCIP_SENTENCES[code], false]));
  f.sendError = null; f.kv.clear();
  const bad = [];
  for (const body of [{ ...startBody, phone: '079 000 00 00' }, { ...startBody, country: '???' }, { ...startBody, country: 'AQ' }]) {
    const r = await post(f, 'start-enrollment', body, route); bad.push([r.status, r.body.error, typeof r.body.message === 'string']);
  }
  f.env.GCIP_API_KEY = '';
  const unavailable = await post(f, 'start-enrollment', startBody, route);
  assert.deepEqual([bad, unavailable.status, unavailable.body.error], [[[400, 'invalid_phone', true], [400, 'invalid_country', true], [400, 'country_not_allowed', true]], 503, 'sms_unavailable']);
}
test('send refusals have the declared statuses and sentences without provider diagnostics', t => refusals(t));

test('the sixth request is rate limited; success contains a mask and timing, never the destination', async t => {
  const f = await fixture(t), results = [];
  for (let i = 0; i < 6; i++) results.push(await post(f, 'start-enrollment', startBody));
  assert.deepEqual(results.map(r => r.status), [200, 200, 200, 200, 200, 429]);
  assert.deepEqual(results[0].body, { session_info: 'synthetic-session', last4: '0000', resend_after_s: 60, expires_in_s: 600 });
  assert.deepEqual([JSON.stringify(results[0].body).includes(PHONE), results[5].body.message], [false, 'Too many codes asked for. Wait a minute and try again.']);
});

async function confirmation(t: any, route = sms) {
  const f = await fixture(t), results = [];
  await post(f, 'start-enrollment', startBody, route);
  for (const error of ['INVALID_CODE', 'SESSION_EXPIRED', 'CODE_EXPIRED']) {
    f.verifyError = error;
    const r = await post(f, 'confirm-enrollment', { session_info: 'synthetic-session', code: '123456' }, route);
    results.push([r.status, r.body.error, r.body.message]);
  }
  const missing = await post(f, 'confirm-enrollment', { session_info: 'missing-session', code: '123456' }, route);
  const malformed = await post(f, 'confirm-enrollment', { session_info: 'synthetic-session', code: '12' }, route);
  f.verifyError = null;
  const success = await post(f, 'confirm-enrollment', { session_info: 'synthetic-session', code: '123456' }, route);
  const status = await read(f, route);
  const removal = await post(f, 'disable', {}, route);
  assert.deepEqual(results, [[401, 'invalid_code', gcip.GCIP_SENTENCES.invalid_code], [410, 'session_expired', gcip.GCIP_SENTENCES.session_expired], [410, 'session_expired', gcip.GCIP_SENTENCES.session_expired]]);
  assert.deepEqual([missing.status, missing.body.error, malformed.status, malformed.body.error], [410, 'session_expired', 400, 'code_required']);
  assert.deepEqual([success.body, status.configured, status.factors.includes('sms'), removal.status, removal.body.error], [{ ok: true, last4: '0000', country: 'CH' }, true, true, 412, 'totp_required_first']);
}
test('confirm handles incorrect/expired/missing codes, enrols the factor and preserves TOTP-only removal', t => confirmation(t));

let serial = 0;
async function sourceModule(source: string, base: URL) {
  const js = stripTypeScriptTypes(source).replace(/(from\s+|import\()(['"])([^'"]+)\2/g, (all, prefix, _quote, spec) => {
    if (/\s/.test(spec)) return all;
    const path = new URL(spec, base);
    const resolved = spec.startsWith('.') ? [path.href, path.href + '.ts', path.href + '.js'].find(p => statSync(new URL(p), { throwIfNoEntry: false })?.isFile()) : import.meta.resolve(spec);
    return `${prefix}'${resolved}'`;
  });
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64') + '#3707-' + serial++);
}
async function mutationCheck(url: URL, verify: (m: any) => Promise<void>, mutations: string[][]) {
  const source = readFileSync(url, 'utf8');
  await verify(await sourceModule(source, url));
  for (const [before, after] of mutations) {
    assert.ok(source.includes(before), 'mutation target: ' + before);
    await assert.rejects(() => sourceModule(source.replace(before, after), url).then(verify), { name: 'AssertionError' });
  }
  await verify(await sourceModule(source, url));
}
test('specified token, expiry, quota and country-list faults are detected and restored', async t => {
  await mutationCheck(new URL('../src/services/gcip.ts', import.meta.url), m => forwarding(t, m), [["if (recaptcha) body.recaptchaToken = recaptcha;", '']]);
  const route = new URL('../src/routes/auth_sms.ts', import.meta.url);
  await mutationCheck(route, m => refusals(t, m.default), [["r.code === 'quota_exceeded' ? 429", "r.code === 'quota_exceeded' ? 502"]]);
  await mutationCheck(route, m => confirmation(t, m.default), [["v.code === 'session_expired' ? 410", "v.code === 'session_expired' ? 502"]]);
  await mutationCheck(route, m => statusRead(t, m.default), [['allowed_countries: smsCountryAllowlist(c.env),', '']]);
});
