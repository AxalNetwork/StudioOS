/**
 * D885 (#2561) — HQ › Integration keys › Channels: WhatsApp (way A and way B)
 * and the Telegram interview bot.
 *
 * Through the real router, on node:sqlite tables cut from the baseline, with
 * every Cloudflare call recorded. Covers:
 *   · the list: each secret set or not set from env, never a value; the
 *     webhook; the rollout var; the runbook; "configured" by the Worker's own
 *     check (setting way A's four secrets is what ends WhatsApp's 503);
 *   · writes: only the channel's own names, formats where the Worker checks
 *     them, the write bar (a plain admin and a branch are refused), no value
 *     in a response or an audit row, generate-once, partial failure, remove.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/integration_keys_channels_d885.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import integrationKeys, { CHANNEL_KEYS, CHANNEL_SPECS, channelSecretRefusal } from '../src/routes/admin_integration_keys.ts';
import { _clearOauthCredsCache } from '../src/services/providerOauthKeys.ts';
import { providerAvailable } from '../src/services/channels/connections.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 901;
const PLAIN_ADMIN = 902;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/** A D1 binding over sqlite that throws for any statement matching `refuse`. */
function makeD1(db: InstanceType<typeof DatabaseSync>, refuse?: RegExp) {
  const guard = (sql: string) => { if (refuse && refuse.test(sql)) throw new Error('D1_ERROR: refused by test'); };
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { guard(sql); return db.prepare(sql).get(...b) ?? null; },
        async all() { guard(sql); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          guard(sql);
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { guard(sql); db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log',
    'provider_oauth_keys', 'integrations']) {
    db.exec(ddl(t));
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const s = db.prepare(
    "INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))",
  );
  s.run(HOLDER, 'totp-holder', 'totp', '+0 seconds');
  s.run(PLAIN_ADMIN, 'totp-plain', 'totp', '+0 seconds');
  s.run(HOLDER, 'totp-stale-holder', 'totp', '-2 days');
  return db;
}

const CF = { CLOUDFLARE_API_TOKEN: 'cf-token-sentinel', CLOUDFLARE_ACCOUNT_ID: 'acct-1' };
/** Slack held as Worker secrets — where a save from the console puts it. */
const envFor = (db: any, extra: Record<string, unknown> = {}, refuse?: RegExp) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, refuse), ...extra }) as any;

let calls: Array<{ url: string; method: string; body: any }> = [];
let failName: string | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  let body: any = null;
  try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
  calls.push({ url, method: String(init?.method || 'GET').toUpperCase(), body });
  if (url.startsWith('https://api.cloudflare.com/')) {
    // A refused write is Cloudflare's 200 with success:false; a refused delete is an HTTP error (deleteSecret reads only the status).
    if (failName && body?.name === failName) {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'refused by test' }] }), { status: 200 });
    }
    if (failName && url.endsWith(`/secrets/${failName}`)) return new Response('refused by test', { status: 500 });
    return new Response(JSON.stringify({ success: true, errors: [], result: {} }), { status: 200 });
  }
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; failName = null; _clearOauthCredsCache(); });
const cfCalls = () => calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/'));

async function token(userId: number, jti: string): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const app = new Hono<any>();
app.route('/', integrationKeys);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function call(env: any, method: string, path: string, body?: unknown, as = HOLDER, jti = 'totp-holder') {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(as, jti)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
// The list is the Super Admin's since the owner's ruling (2026-10-20).
const list = (env: any) => call(env, 'GET', '/', undefined, HOLDER, 'totp-holder');
const auditRows = (db: any) => db.prepare('SELECT * FROM admin_audit_log ORDER BY id').all() as any[];


/** Fake values only: each is a marker the tests look for, never a real credential. */
const WAY_A = {
  WHATSAPP_APP_ID: 'marker-app-id', WHATSAPP_APP_SECRET: 'marker-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'marker-verify', WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: 'marker-config',
};
const WAY_B = { WHATSAPP_AXAL_ACCESS_TOKEN: 'marker-axal-token', WHATSAPP_AXAL_PHONE_NUMBER_ID: 'marker-pnid', WHATSAPP_AXAL_WABA_ID: 'marker-waba' };
const TG = { TELEGRAM_CHANNEL_BOT_TOKEN: 'marker-bot-token', TELEGRAM_CHANNEL_BOT_USERNAME: 'marker_bot', TELEGRAM_CHANNEL_WEBHOOK_SECRET: 'marker-hook' };
const MARKERS = [...Object.values(WAY_A), ...Object.values(WAY_B), ...Object.values(TG), 'cf-token-sentinel'];
const channel = (body: any, k: string) => body.channels.find((c: any) => c.key === k);
const secretPuts = () => cfCalls().filter((c) => c.method === 'PUT').map((c) => c.body?.name);
const secretDeletes = () => cfCalls().filter((c) => c.method === 'DELETE').map((c) => decodeURIComponent(c.url.split('/secrets/')[1]));
const activityRows = (db: any) => db.prepare('SELECT * FROM activity_logs ORDER BY id').all() as any[];
const recorded = (db: any) => JSON.stringify(auditRows(db)) + JSON.stringify(activityRows(db));

test('the list has the three channels, each secret set or not set from env, and never a value', async () => {
  const env = envFor(freshDb(), { ...WAY_A, WHATSAPP_AXAL_ACCESS_TOKEN: WAY_B.WHATSAPP_AXAL_ACCESS_TOKEN, TELEGRAM_CHANNEL_BOT_TOKEN: '  ',
    PUBLIC_BASE_URL: 'https://axal.test/', TELEGRAM_CHANNEL: 'on' });
  const r = await list(env);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.channels.map((c: any) => c.key), ['whatsapp', 'whatsapp_axal', 'telegram_channel']);
  const a = channel(r.body, 'whatsapp');
  assert.deepEqual(a.secrets.map((s: any) => [s.name, s.set, s.generate]), [
    ['WHATSAPP_APP_ID', true, false], ['WHATSAPP_APP_SECRET', true, false], ['WHATSAPP_VERIFY_TOKEN', true, true], ['WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', true, false],
  ]);
  assert.equal(a.configured, true);
  assert.equal(a.webhook_url, 'https://axal.test/api/channels/whatsapp/webhook');
  assert.deepEqual(a.rollout, { var: 'WHATSAPP_CHANNEL', value: 'canary', changed_by: 'pr' });
  assert.equal(a.guide_href, 'https://github.com/AxalNetwork/StudioOS/blob/main/documentation/operations/WHATSAPP.md');
  const b = channel(r.body, 'whatsapp_axal');
  assert.deepEqual(b.secrets.map((s: any) => [s.name, s.set]), [['WHATSAPP_AXAL_ACCESS_TOKEN', true], ['WHATSAPP_AXAL_PHONE_NUMBER_ID', false], ['WHATSAPP_AXAL_WABA_ID', false]]);
  assert.deepEqual(b.vars, [{ name: 'WHATSAPP_AXAL_DISPLAY_NUMBER', set: false, changed_by: 'pr' }]);
  assert.equal(b.configured, false);
  const t = channel(r.body, 'telegram_channel');
  assert.match(t.label, /interview bot/);
  assert.equal(t.secrets[0].set, false, 'a blank value is not set');
  assert.equal(t.register_webhook_href, '/admin/telegram');
  assert.equal(t.webhook_url, 'https://axal.test/api/channels/telegram/webhook');
  assert.deepEqual(t.rollout, { var: 'TELEGRAM_CHANNEL', value: 'on', changed_by: 'pr' });
  assert.equal(t.guide_href, 'https://github.com/AxalNetwork/StudioOS/blob/main/documentation/operations/TELEGRAM.md');
  for (const m of MARKERS) assert.ok(!r.text.includes(m), `a value reached the list: ${m}`);
  assert.equal(cfCalls().length, 0, 'the list calls no one');
});

test('"configured" is the Worker\'s own check: way A\'s four secrets end WhatsApp\'s 503, way B also needs its display number', async () => {
  const three = { ...WAY_A } as Record<string, string>; delete three.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
  for (const [extra, expected] of [[{}, false], [three, false], [WAY_A, true]] as const) {
    const env = envFor(freshDb(), extra);
    assert.equal(providerAvailable(env, 'whatsapp'), expected);
    assert.equal(channel((await list(env)).body, 'whatsapp').configured, expected, JSON.stringify(Object.keys(extra)));
  }
  assert.equal(channel((await list(envFor(freshDb(), WAY_B))).body, 'whatsapp_axal').configured, false);
  assert.equal(channel((await list(envFor(freshDb(), { ...WAY_B, WHATSAPP_AXAL_DISPLAY_NUMBER: '+1 555 0100' }))).body, 'whatsapp_axal').configured, true);
  assert.equal(channel((await list(envFor(freshDb(), TG))).body, 'telegram_channel').configured, true);
  assert.equal(channel((await list(envFor(freshDb(), { APP_URL: 'http://plain.test' }))).body, 'whatsapp').webhook_url, null, 'no https base, no webhook');
});

test('a save writes only that channel\'s names, to Cloudflare, and no value reaches the answer or the audit', async () => {
  const db = freshDb();
  const r = await call(envFor(db, CF), 'PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: ' marker-app-id ', WHATSAPP_APP_SECRET: 'marker-app-secret' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, channel: 'whatsapp', set: ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET'] });
  assert.deepEqual(secretPuts(), ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET']);
  assert.equal(cfCalls()[0].body.text, 'marker-app-id', 'trimmed before it is written');
  const audit = auditRows(db);
  assert.equal(audit.length, 1, 'one audit row per request');
  assert.equal(audit[0].action, 'channel_key_set');
  const details = JSON.parse(audit[0].filters_json);
  assert.deepEqual([details.channel, details.env_vars, details.outcome], ['whatsapp', ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET'], 'ok']);
  for (const m of MARKERS) assert.ok(!r.text.includes(m) && !recorded(db).includes(m), `a value was recorded: ${m}`);
});

test('only the channel\'s own names are writable, and formats are checked where the Worker checks them', async () => {
  const db = freshDb();
  const env = envFor(db, CF);
  const cases: Array<[string, string, unknown, number, string]> = [
    ['PUT', '/channels/whatsapp', { TELEGRAM_CHANNEL_BOT_TOKEN: 'x' }, 400, 'unknown_secret_name'],
    ['PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: 'x', SLACK_CLIENT_SECRET: 'x' }, 400, 'unknown_secret_name'],
    ['PUT', '/channels/whatsapp_axal', { WHATSAPP_AXAL_DISPLAY_NUMBER: '+1 555 0100' }, 400, 'unknown_secret_name'],
    ['PUT', '/channels/whatsapp', {}, 400, 'nothing_to_set'],
    ['PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: '   ' }, 400, 'value_required'],
    ['PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: 'a\nb' }, 400, 'value_has_line_break'],
    ['PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: 'x'.repeat(4097) }, 400, 'value_too_long'],
    ['PUT', '/channels/telegram_channel', { TELEGRAM_CHANNEL_WEBHOOK_SECRET: 'has space' }, 400, 'secret_format'],
    ['PUT', '/channels/telegram', { TELEGRAM_BOT_TOKEN: 'x' }, 404, 'unknown_channel'],
    ['POST', '/channels/whatsapp/rotate', { name: 'CLOUDFLARE_API_TOKEN', value: 'x' }, 400, 'unknown_secret_name'],
    ['POST', '/channels/whatsapp/rotate', { name: 'WHATSAPP_APP_SECRET', generate: true }, 400, 'not_generated'],
    ['POST', '/channels/telegram_channel/rotate', { name: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET', value: 'bad*chars' }, 400, 'secret_format'],
    ['DELETE', '/channels/nope', undefined, 404, 'unknown_channel'],
  ];
  for (const [method, path, payload, status, code] of cases) {
    const r = await call(env, method, path, payload);
    assert.deepEqual([r.status, r.body.error], [status, code], `${method} ${path} ${JSON.stringify(payload)?.slice(0, 80)}`);
  }
  assert.equal(cfCalls().length, 0, 'nothing refused reached Cloudflare');
  assert.equal(auditRows(db).length, 0);
  assert.equal(channelSecretRefusal('TELEGRAM_CHANNEL_WEBHOOK_SECRET', 'ok_Token-1'), null);
  assert.equal(channelSecretRefusal('TELEGRAM_CHANNEL_WEBHOOK_SECRET', 'x'.repeat(257)), 'secret_format');
});

test('the write bar: a plain admin, a branch and a stale step-up are refused every write, and a plain admin the list', async () => {
  const db = freshDb();
  const writes: Array<[string, string, unknown]> = [
    ['PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: 'x' }],
    ['POST', '/channels/telegram_channel/rotate', { name: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET', generate: true }],
    ['DELETE', '/channels/whatsapp_axal', undefined],
  ];
  for (const [method, path, payload] of writes) {
    const plain = await call(envFor(db, CF), method, path, payload, PLAIN_ADMIN, 'totp-plain');
    assert.equal(plain.status, 403, `${method} ${path} as a plain admin`);
    const branch = await call(envFor(db, { ...CF, BRANCH_CODE: 'fr', CF_WORKER_SCRIPT_NAME: 'studioos-fr' }), method, path, payload);
    assert.equal(branch.status, 403, `${method} ${path} on a branch`);
  }
  for (const [method, path, payload] of writes) {
    const stale = await call(envFor(db, CF), method, path, payload, HOLDER, 'totp-stale-holder');
    assert.equal(stale.status, 403, `${method} ${path} by the holder without a fresh step-up`);
  }
  assert.equal((await call(envFor(db), 'GET', '/', undefined, HOLDER, 'totp-stale-holder')).status, 200, 'the list needs no step-up');
  assert.equal((await call(envFor(db), 'GET', '/', undefined, PLAIN_ADMIN, 'totp-plain')).status, 403);
  assert.equal(cfCalls().length, 0);
  assert.equal(auditRows(db).length, 0);
});

test('generate returns the token once, writes it, and keeps it out of the audit and every later read', async () => {
  const db = freshDb();
  const env = envFor(db, CF);
  const r = await call(env, 'POST', '/channels/whatsapp/rotate', { name: 'WHATSAPP_VERIFY_TOKEN', generate: true });
  assert.equal(r.status, 200, r.text);
  const token = r.body.generated_value;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, '32 random bytes in base64url, which Telegram\'s secret alphabet accepts too');
  assert.deepEqual(cfCalls().map((c) => [c.method, c.body?.name, c.body?.text]), [['PUT', 'WHATSAPP_VERIFY_TOKEN', token]]);
  assert.ok(!recorded(db).includes(token), 'the generated value is not in the audit');
  assert.equal(JSON.parse(auditRows(db)[0].filters_json).generated, true);
  const again = await call(env, 'POST', '/channels/whatsapp/rotate', { name: 'WHATSAPP_VERIFY_TOKEN', generate: true });
  assert.notEqual(again.body.generated_value, token, 'each generate is a new token');
  const tg = await call(env, 'POST', '/channels/telegram_channel/rotate', { name: 'TELEGRAM_CHANNEL_WEBHOOK_SECRET', generate: true });
  assert.equal(channelSecretRefusal('TELEGRAM_CHANNEL_WEBHOOK_SECRET', tg.body.generated_value), null);
  const listed = await list(envFor(db, { ...CF, WHATSAPP_VERIFY_TOKEN: token }));
  assert.ok(!listed.text.includes(token), 'a later read never shows it');
  const rotated = await call(env, 'POST', '/channels/whatsapp/rotate', { name: 'WHATSAPP_APP_SECRET', value: 'marker-app-secret' });
  assert.equal(rotated.status, 200);
  assert.ok(!('generated_value' in rotated.body) && !rotated.text.includes('marker-app-secret'), 'a pasted value is never echoed');
});

test('a Cloudflare refusal part-way says which secrets were set and which failed, and is audited as failed', async () => {
  const db = freshDb();
  failName = 'WHATSAPP_APP_SECRET';
  const r = await call(envFor(db, CF), 'PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: 'marker-app-id', WHATSAPP_APP_SECRET: 'marker-app-secret', WHATSAPP_VERIFY_TOKEN: 'marker-verify' });
  assert.equal(r.status, 502, r.text);
  assert.deepEqual([r.body.set, r.body.failed_at], [['WHATSAPP_APP_ID'], 'WHATSAPP_APP_SECRET']);
  assert.deepEqual(secretPuts(), ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET'], 'it stops at the refusal');
  const details = JSON.parse(auditRows(db)[0].filters_json);
  assert.deepEqual([details.outcome, details.set, details.failed_at], ['failed', ['WHATSAPP_APP_ID'], 'WHATSAPP_APP_SECRET']);
  for (const m of MARKERS) assert.ok(!r.text.includes(m) && !recorded(db).includes(m), m);
  const none = await call(envFor(freshDb()), 'PUT', '/channels/whatsapp', { WHATSAPP_APP_ID: 'x' });
  assert.deepEqual([none.status, none.body.error], [503, 'cloudflare_api_token_missing']);
});

test('remove deletes every secret of that channel and nothing else, and keeps the PR-set var', async () => {
  const db = freshDb();
  const r = await call(envFor(db, CF), 'DELETE', '/channels/whatsapp_axal');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true, channel: 'whatsapp_axal', removed: [...CHANNEL_SPECS.whatsapp_axal.secrets], vars_kept: ['WHATSAPP_AXAL_DISPLAY_NUMBER'] });
  assert.deepEqual(secretDeletes(), ['WHATSAPP_AXAL_ACCESS_TOKEN', 'WHATSAPP_AXAL_PHONE_NUMBER_ID', 'WHATSAPP_AXAL_WABA_ID']);
  assert.equal(JSON.parse(auditRows(db)[0].filters_json).outcome, 'ok');
  failName = 'TELEGRAM_CHANNEL_BOT_USERNAME';
  calls = [];
  const partial = await call(envFor(db, CF), 'DELETE', '/channels/telegram_channel');
  assert.deepEqual([partial.status, partial.body.removed, partial.body.failed_at], [502, ['TELEGRAM_CHANNEL_BOT_TOKEN'], 'TELEGRAM_CHANNEL_BOT_USERNAME']);
});

test('every channel secret is one the Worker reads, and no two channels share a name', () => {
  const worker = ['services/channels/connections.ts', 'services/channels/whatsappLink.ts']
    .map((f) => readFileSync(resolve(process.cwd(), `cloudflare-worker/src/${f}`), 'utf8')).join('\n');
  const all = CHANNEL_KEYS.flatMap((k) => [...CHANNEL_SPECS[k].secrets]);
  assert.equal(new Set(all).size, all.length);
  for (const name of [...all, ...CHANNEL_SPECS.whatsapp_axal.vars]) assert.ok(worker.includes(`'${name}'`), `${name} is not a name the Worker checks`);
});
