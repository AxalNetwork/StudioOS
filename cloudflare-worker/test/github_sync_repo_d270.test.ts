/**
 * D270 — GitHub Sync stops writing the repository. `GITHUB_REPO_OWNER` and
 * `GITHUB_REPO_NAME` are wrangler.toml [vars]; every deploy writes them back,
 * so pushing them as Worker secrets from the console "saved" an edit the next
 * deploy reverted. PUT now refuses a different owner or name and never pushes
 * either; DELETE no longer deletes them; GET reports what the Worker has.
 *
 * THE PUSHED NAMES ARE THE ASSERTION, not "something reached Cloudflare".
 * `fetch` is replaced for the file: a secret PUT carries its name in the JSON
 * body, a secret DELETE carries it as the last path segment, and both are
 * recorded. D223's harness shape: the real router behind production's auth
 * error table, on tables cut from schema_baseline.sql.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_sync_repo_d270.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import github from '../src/routes/admin_github.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 901;
const PLAIN_ADMIN = 902;
// Obviously synthetic: nothing here is shaped like a real credential.
const NEW_TOKEN = 'synthetic-token-not-a-credential';

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(HOLDER, 'totp-holder');
  s.run(PLAIN_ADMIN, 'totp-plain');
  return db;
}

const DEPLOYED = { GITHUB_REPO_OWNER: 'AxalNetwork', GITHUB_REPO_NAME: 'StudioOS' };
const envFor = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) => ({
  JWT_SECRET, ENVIRONMENT: 'development',
  CLOUDFLARE_API_TOKEN: 'synthetic-cf-api-token', CLOUDFLARE_ACCOUNT_ID: 'acct-1',
  GITHUB_ACCESS_TOKEN: 'synthetic-current-token', GITHUB_WEBHOOK_SECRET: 'synthetic-current-webhook-secret',
  ...DEPLOYED, DB: makeD1(db), ...extra,
}) as any;

/* ── what reached the Cloudflare secrets API, by secret NAME ───────────── */

let pushed: string[] = [];
let deleted: string[] = [];
let other: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  if (url.startsWith('https://api.cloudflare.com/') && /\/secrets$/.test(url) && method === 'PUT') {
    pushed.push(JSON.parse(String(init.body)).name);
  } else if (url.startsWith('https://api.cloudflare.com/') && /\/secrets\/[^/]+$/.test(url) && method === 'DELETE') {
    deleted.push(decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)));
  } else {
    other.push(`${method} ${url}`);
  }
  return new Response(JSON.stringify({ success: true, errors: [], result: {} }), { status: 200 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { pushed = []; deleted = []; other = []; });

async function jwt(userId: number, jti: string): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const app = new Hono<any>();
app.route('/', github);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function call(env: any, method: string, body?: unknown, as = HOLDER, jti = 'totp-holder') {
  const res = await app.request('/', {
    method,
    headers: { Authorization: `Bearer ${await jwt(as, jti)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
}
const auditRows = (db: any) => db.prepare('SELECT * FROM admin_audit_log ORDER BY id').all() as any[];

/* ── PUT ────────────────────────────────────────────────────────────────── */

test('D270: a PUT naming a different owner is refused 400, says where the repository is set, and pushes nothing', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'PUT', { token: NEW_TOKEN, repo_owner: 'SomeoneElse', repo_name: 'StudioOS' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.error, 'repo_is_deploy_time');
  assert.match(r.body.message, /wrangler\.toml/);
  assert.deepEqual(pushed, [], 'a refused PUT still pushed a secret');
  assert.deepEqual(other, []);
  assert.equal(auditRows(db).length, 0, 'a refused PUT wrote an audit row');
});

test('D270: a PUT naming a different repository name is refused the same way', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'PUT', { repo_name: 'Elsewhere' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.error, 'repo_is_deploy_time');
  assert.deepEqual(pushed, []);
});

test('D270: a PUT with only a token pushes GITHUB_ACCESS_TOKEN and nothing else', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'PUT', { token: NEW_TOKEN });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(pushed, ['GITHUB_ACCESS_TOKEN']);
  const details = JSON.parse(auditRows(db)[0].filters_json);
  assert.deepEqual(details.secrets, ['GITHUB_ACCESS_TOKEN'], 'the audit names a secret that was not written');
  assert.ok(!JSON.stringify(auditRows(db)).includes(NEW_TOKEN), 'the audit recorded the token value');
});

test('D270: a PUT that repeats the deployed owner and name (an older panel) is accepted, and still pushes only the token', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'PUT', { token: NEW_TOKEN, ...{ repo_owner: 'AxalNetwork', repo_name: 'StudioOS' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(pushed, ['GITHUB_ACCESS_TOKEN']);
});

test('D270: owner and name alone are nothing to update — they are never written here', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'PUT', { repo_owner: 'AxalNetwork', repo_name: 'StudioOS' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.body.error, 'nothing_to_update');
  assert.deepEqual(pushed, []);
});

test('D270: rotating the webhook secret still pushes GITHUB_WEBHOOK_SECRET alone', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'PUT', { generate_webhook_secret: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(pushed, ['GITHUB_WEBHOOK_SECRET']);
  assert.equal(typeof r.body.webhook_secret, 'string');
});

/* ── DELETE ─────────────────────────────────────────────────────────────── */

test('D270: DELETE removes the token and the webhook secret, and never the repository names', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'DELETE');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(deleted, ['GITHUB_ACCESS_TOKEN', 'GITHUB_WEBHOOK_SECRET']);
  assert.ok(!deleted.includes('GITHUB_REPO_OWNER') && !deleted.includes('GITHUB_REPO_NAME'));
  assert.deepEqual(JSON.parse(auditRows(db)[0].filters_json).secrets, ['GITHUB_ACCESS_TOKEN', 'GITHUB_WEBHOOK_SECRET']);
});

/* ── GET ────────────────────────────────────────────────────────────────── */

test('D270: GET reports the deployed repository, or null — never a display default', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'GET', undefined, PLAIN_ADMIN, 'totp-plain');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.repo_owner, 'AxalNetwork');
  assert.equal(r.body.repo_name, 'StudioOS');
  assert.equal(r.body.repo_set_at, 'deploy');
  assert.match(r.body.repo_note, /wrangler\.toml/);
  assert.ok(!('default_repo_owner' in r.body) && !('default_repo_name' in r.body));

  const unset = await call(envFor(db, { GITHUB_REPO_OWNER: undefined, GITHUB_REPO_NAME: '' }), 'GET', undefined, PLAIN_ADMIN, 'totp-plain');
  assert.equal(unset.body.repo_owner, null);
  assert.equal(unset.body.repo_name, null);
  assert.equal(unset.body.configured, false);
});
