/**
 * D227 — the Integration keys console follows where a key lives, and says
 * "unknown" when it cannot tell.
 *
 * THREE DEFECTS, EACH DRIVEN HERE THROUGH THE REAL ROUTER:
 *   1. A save promotes a key to Worker secrets, and the console then offered
 *      neither Rotate nor Remove for it (they appeared only for `db`). The
 *      routes already go through the Cloudflare API wherever the key lives;
 *      this file proves they do it for an env-held key, and that the rotate's
 *      database fallback is REFUSED for one — rotating a row under a Worker
 *      secret that overrides it would answer "ok" and change nothing in use.
 *   2. A failed read of the key table read as "not configured". The list now
 *      carries D213's `db_readable` and each key's `state`, so a key with no
 *      Worker secret reads `unreadable`, never `unset`.
 *   3. A failed read of the integrations count read as 0 — the number Remove
 *      quotes as how many users it will disconnect. It is `null` now.
 *
 * REAL node:sqlite, tables cut from schema_baseline.sql; `fetch` recorded, so
 * which Cloudflare calls were made is measured rather than assumed. The D1
 * wrapper can refuse one query by pattern — the only way to reach "the table
 * did not answer" without deleting a table `ensureSchema` would recreate.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import integrationKeys from '../src/routes/admin_integration_keys.ts';
import { _clearOauthCredsCache, MANAGED_PROVIDERS } from '../src/services/providerOauthKeys.ts';
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
  return db;
}

const CF = { CLOUDFLARE_API_TOKEN: 'cf-token-sentinel', CLOUDFLARE_ACCOUNT_ID: 'acct-1' };
/** Slack held as Worker secrets — where a save from the console puts it. */
const SLACK_ENV = { SLACK_CLIENT_ID: 'slack-id-sentinel', SLACK_CLIENT_SECRET: 'slack-secret-sentinel' };
const envFor = (db: any, extra: Record<string, unknown> = {}, refuse?: RegExp) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, refuse), ...extra }) as any;

let calls: Array<{ url: string; method: string; body: any }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  let body: any = null;
  try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
  calls.push({ url, method: String(init?.method || 'GET').toUpperCase(), body });
  if (url.startsWith('https://api.cloudflare.com/')) {
    return new Response(JSON.stringify({ success: true, errors: [], result: {} }), { status: 200 });
  }
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; _clearOauthCredsCache(); });
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
const list = (env: any) => call(env, 'GET', '/', undefined, PLAIN_ADMIN, 'totp-plain');
const byKey = (body: any, k: string) => body.providers.find((p: any) => p.provider_key === k);
const auditRows = (db: any) => db.prepare('SELECT * FROM admin_audit_log ORDER BY id').all() as any[];

/* ── 2 · state and db_readable on the console's own list ───────────────── */

test('the list carries db_readable, and a measured absence reads unset', async () => {
  const r = await list(envFor(freshDb()));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.db_readable, true);
  assert.ok(!('unreadable_reason' in r.body));
  assert.deepEqual(r.body.providers.map((p: any) => p.provider_key), MANAGED_PROVIDERS);
  for (const p of r.body.providers) assert.equal(p.state, 'unset', `${p.provider_key} is not a measured absence`);
});

test('a key held as a Worker secret reads env, and one kept in the table reads db', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES ('hubspot', 'hub-id', 'x')").run();
  const r = await list(envFor(db, SLACK_ENV));
  assert.equal(byKey(r.body, 'slack').state, 'env');
  assert.equal(byKey(r.body, 'hubspot').state, 'db');
  assert.ok(!r.text.includes('slack-secret-sentinel') && !r.text.includes('slack-id-sentinel'), 'a value reached the list');
});

test('a key table that does not answer reads unreadable — never unset — and says why', async () => {
  const r = await list(envFor(freshDb(), SLACK_ENV, /FROM provider_oauth_keys/));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.db_readable, false);
  assert.match(r.body.unreadable_reason, /could not be read/);
  assert.equal(byKey(r.body, 'slack').state, 'env', 'a Worker secret is known without the table');
  for (const p of r.body.providers.filter((x: any) => x.provider_key !== 'slack')) {
    assert.equal(p.state, 'unreadable', `${p.provider_key} read as "${p.state}" over a table that did not answer`);
  }
});

/* ── 3 · the count Remove quotes ───────────────────────────────────────── */

test('an integrations count that cannot be read is null, and an answered empty one is 0', async () => {
  const unread = await list(envFor(freshDb(), SLACK_ENV, /FROM integrations/));
  for (const p of unread.body.providers) {
    assert.equal(p.active_integrations, null, `${p.provider_key}: an unread count was reported as a number`);
  }
  const db = freshDb();
  db.prepare("INSERT INTO integrations (uid, user_id, provider_key, status, auth_type) VALUES ('i1', 1, 'slack', 'active', 'oauth2')").run();
  const answered = await list(envFor(db, SLACK_ENV));
  assert.equal(byKey(answered.body, 'slack').active_integrations, 1);
  assert.equal(byKey(answered.body, 'hubspot').active_integrations, 0, 'an answered GROUP BY with no row is a measured zero');
});

/* ── 1 · rotate and remove follow the key into Worker secrets ──────────── */

test('rotating a key held as a Worker secret writes the Worker secret', async () => {
  const db = freshDb();
  const r = await call(envFor(db, { ...CF, ...SLACK_ENV }), 'POST', '/slack/rotate', { client_secret: 'rotated-secret' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source, 'env');
  const puts = cfCalls().filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body?.name, 'SLACK_CLIENT_SECRET', 'the rotate wrote a different secret');
  const audit = auditRows(db);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'integration_key_cf_secret_rotate');
  assert.equal(JSON.parse(audit[0].filters_json).outcome, 'ok');
});

test('removing a key held as a Worker secret deletes both Worker secrets', async () => {
  const db = freshDb();
  const r = await call(envFor(db, { ...CF, ...SLACK_ENV }), 'DELETE', '/slack');
  assert.equal(r.status, 200, r.text);
  const deleted = cfCalls().filter((c) => c.method === 'DELETE').map((c) => decodeURIComponent(c.url.split('/').pop()!)).sort();
  assert.deepEqual(deleted, ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET']);
  assert.equal(auditRows(db).length, 1);
});

test('without a Cloudflare token, a Worker-secret key is NOT "rotated" in the table underneath it', async () => {
  const db = freshDb();
  // A stale row under the Worker secret — the case where the old fallback
  // would have updated it, answered ok, and changed nothing a user reads.
  db.prepare("INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES ('slack', 'old-id', 'OLD-ENC')").run();
  const r = await call(envFor(db, SLACK_ENV), 'POST', '/slack/rotate', { client_secret: 'rotated-secret' });
  assert.equal(r.status, 503, r.text);
  assert.equal(r.body.error, 'cloudflare_api_token_missing');
  const row = db.prepare("SELECT client_secret_enc FROM provider_oauth_keys WHERE provider_key = 'slack'").get() as any;
  assert.equal(row.client_secret_enc, 'OLD-ENC', 'the row under the Worker secret was rewritten');
  const audit = auditRows(db);
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].filters_json).outcome, 'failed');
});

test('without a Cloudflare token, a key kept only in the table still rotates there', async () => {
  // The fallback's own purpose survives: a legacy database-kept key.
  const db = freshDb();
  db.prepare("INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES ('slack', 'old-id', 'OLD-ENC')").run();
  const r = await call(envFor(db), 'POST', '/slack/rotate', { client_secret: 'rotated-secret' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.source, 'db');
  const row = db.prepare("SELECT client_secret_enc FROM provider_oauth_keys WHERE provider_key = 'slack'").get() as any;
  assert.notEqual(row.client_secret_enc, 'OLD-ENC');
  assert.ok(!String(row.client_secret_enc).includes('rotated-secret'), 'the secret was stored in the clear');
});
