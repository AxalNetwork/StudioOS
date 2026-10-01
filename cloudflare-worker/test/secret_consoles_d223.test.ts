/**
 * D223 — the three consoles that write Worker secrets take the holder's bar.
 *
 * WHAT WAS WRONG. `setSecret` / `deleteSecret` write onto production's own
 * `studioos` script, and every route that called them was `requireAdmin`: any
 * admin, a branch's included, could overwrite a provider's OAuth pair, the
 * GitHub token that dispatches branch deploys, or the Stripe signing secret —
 * while the deploy dispatch itself was `requireSuperAdminWriteBar`.
 *
 * WHAT THIS FILE DRIVES, per write route, through the real router:
 *   - a plain admin (TOTP session, no elevation) is refused 403;
 *   - the holder whose TOTP session is two days old is refused `step_up_required`;
 *   - in both cases NOTHING reaches Cloudflare or Stripe and no audit row lands;
 *   - the holder with a fresh TOTP session writes, and exactly one
 *     `admin_audit_log` row and one `activity_logs` row record it (D159's
 *     `logAdminAction`, not a hand-written INSERT).
 * And, once each: the reads stay open to a plain admin; the GitHub read carries
 * no `token_preview` and no fragment of the token; a branch refuses the holder.
 *
 * REAL node:sqlite, every table cut from schema_baseline.sql (the D139 lesson).
 * `fetch` is replaced for the whole file and records every outbound call, so
 * "nothing reached Cloudflare" is a measured count, not an assumption.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import integrationKeys from '../src/routes/admin_integration_keys.ts';
import github from '../src/routes/admin_github.ts';
import stripe from '../src/routes/admin_stripe.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 901;
const PLAIN_ADMIN = 902;
const GH_TOKEN = 'ghp_SENTINELtokenVALUE0123456789abcdef';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
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
  s.run(HOLDER, 'totp-stale-holder', 'totp', '-2 days');
  s.run(PLAIN_ADMIN, 'totp-plain', 'totp', '+0 seconds');
  return db;
}

const BASE_ENV = {
  JWT_SECRET,
  ENVIRONMENT: 'development',
  CLOUDFLARE_API_TOKEN: 'cf-token-sentinel',
  CLOUDFLARE_ACCOUNT_ID: 'acct-1',
  STRIPE_SECRET_KEY: 'sk_test_sentinel',
  GITHUB_ACCESS_TOKEN: GH_TOKEN,
  GITHUB_REPO_OWNER: 'AxalNetwork',
  GITHUB_REPO_NAME: 'StudioOS',
  GITHUB_WEBHOOK_SECRET: 'whsec-gh-sentinel',
};
const envFor = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) =>
  ({ ...BASE_ENV, DB: makeD1(db), ...extra }) as any;

/* ── every outbound call, recorded ─────────────────────────────────────── */

let calls: Array<{ url: string; method: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method });
  if (url.startsWith('https://api.cloudflare.com/')) {
    return new Response(JSON.stringify({ success: true, errors: [], result: {} }), { status: 200 });
  }
  if (url.startsWith('https://api.stripe.com/v1/webhook_endpoints') && method === 'POST') {
    return new Response(JSON.stringify({
      id: 'we_test_1', url: 'https://axal.vc/api/billing/stripe/webhook', status: 'enabled',
      enabled_events: ['checkout.session.completed'], secret: 'whsec_stripe_sentinel',
    }), { status: 200 });
  }
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; });

const toCloudflare = () => calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/'));
const toStripe = () => calls.filter((c) => c.url.startsWith('https://api.stripe.com/'));
const outbound = () => calls.filter((c) => c.url.startsWith('https://'));

async function token(userId: number, jti?: string): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Each router behind production's auth-error table, so a refusal gets its real status. */
function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  return a;
}
const APPS = { integrationKeys: appFor(integrationKeys), github: appFor(github), stripe: appFor(stripe) };

type Call = { app: keyof typeof APPS; method: string; path: string; body?: unknown };
async function call(env: any, c: Call, as: number, jti: string) {
  const res = await APPS[c.app].request(c.path, {
    method: c.method,
    headers: { Authorization: `Bearer ${await token(as, jti)}`, 'Content-Type': 'application/json' },
    ...(c.body === undefined ? {} : { body: JSON.stringify(c.body) }),
  }, env);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

const auditRows = (db: any) => db.prepare('SELECT * FROM admin_audit_log ORDER BY id').all() as any[];
const activityRows = (db: any) => db.prepare('SELECT * FROM activity_logs ORDER BY id').all() as any[];

/**
 * THE SIX WRITES. Each names the action its audit row must carry, so a write
 * that audited under the wrong name — or not at all — fails by name.
 */
const WRITES: Array<{ label: string; call: Call; action: string; reaches: 'cloudflare' | 'stripe+cloudflare' }> = [
  {
    label: 'Integration keys · save',
    call: { app: 'integrationKeys', method: 'PUT', path: '/slack', body: { client_id: 'id-1', client_secret: 'secret-1' } },
    action: 'integration_key_cf_secret_push', reaches: 'cloudflare',
  },
  {
    label: 'Integration keys · rotate',
    call: { app: 'integrationKeys', method: 'POST', path: '/slack/rotate', body: { client_secret: 'secret-2' } },
    action: 'integration_key_cf_secret_rotate', reaches: 'cloudflare',
  },
  {
    label: 'Integration keys · remove',
    call: { app: 'integrationKeys', method: 'DELETE', path: '/slack' },
    action: 'integration_key_cf_secret_delete', reaches: 'cloudflare',
  },
  {
    label: 'GitHub Sync · save',
    call: { app: 'github', method: 'PUT', path: '/', body: { token: 'ghp_new', repo_owner: 'AxalNetwork', repo_name: 'StudioOS' } },
    action: 'github_sync_secrets_set', reaches: 'cloudflare',
  },
  {
    label: 'GitHub Sync · remove',
    call: { app: 'github', method: 'DELETE', path: '/' },
    action: 'github_sync_secrets_delete', reaches: 'cloudflare',
  },
  {
    label: 'Stripe · register webhook',
    call: { app: 'stripe', method: 'POST', path: '/webhook', body: { action: 'register' } },
    action: 'stripe_webhook_register', reaches: 'stripe+cloudflare',
  },
];

for (const w of WRITES) {
  test(`${w.label}: a plain admin is refused 403, and nothing is written or sent`, async () => {
    const db = freshDb();
    const r = await call(envFor(db), w.call, PLAIN_ADMIN, 'totp-plain');
    assert.equal(r.status, 403, r.text);
    assert.equal(r.body.detail, 'Super admin required');
    assert.equal(outbound().length, 0, `a refused write still called out: ${JSON.stringify(calls)}`);
    assert.equal(auditRows(db).length, 0);
    assert.equal(activityRows(db).length, 0);
  });

  test(`${w.label}: the holder without a fresh step-up is refused, and nothing is written or sent`, async () => {
    const db = freshDb();
    const r = await call(envFor(db), w.call, HOLDER, 'totp-stale-holder');
    assert.equal(r.status, 403, r.text);
    assert.equal(r.body.detail, 'step_up_required');
    assert.equal(outbound().length, 0, `a refused write still called out: ${JSON.stringify(calls)}`);
    assert.equal(auditRows(db).length, 0);
  });

  test(`${w.label}: the holder with a fresh step-up writes, audited exactly once`, async () => {
    const db = freshDb();
    const r = await call(envFor(db), w.call, HOLDER, 'totp-holder');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.ok, true, r.text);
    assert.ok(toCloudflare().length > 0, 'the write never reached the Cloudflare secrets API');
    if (w.reaches === 'stripe+cloudflare') assert.ok(toStripe().length > 0, 'the register never reached Stripe');

    const audit = auditRows(db);
    assert.equal(audit.length, 1, `expected one admin_audit_log row, got ${audit.length}`);
    assert.equal(audit[0].action, w.action);
    assert.equal(audit[0].admin_user_id, HOLDER);
    const activity = activityRows(db);
    assert.equal(activity.length, 1, `expected one activity_logs row, got ${activity.length}`);
    assert.equal(activity[0].action, w.action, 'the two stores name the act differently — two writers again');

    // No secret value is recorded — only names.
    const recorded = JSON.stringify(audit) + JSON.stringify(activity);
    for (const v of ['secret-1', 'secret-2', 'ghp_new', 'whsec_stripe_sentinel', 'cf-token-sentinel']) {
      assert.ok(!recorded.includes(v), `the audit recorded a secret value (${v})`);
    }
  });
}

test('a branch refuses the holder too: the elevation is HQ\'s alone', async () => {
  const db = freshDb();
  const r = await call(envFor(db, { BRANCH_CODE: 'fr', CF_WORKER_SCRIPT_NAME: 'studioos-fr' }),
    WRITES[0].call, HOLDER, 'totp-holder');
  assert.equal(r.status, 403, r.text);
  assert.equal(toCloudflare().length, 0);
  assert.equal(auditRows(db).length, 0);
});

test('the integration-keys save still dates the key: D213 reads the row it writes', async () => {
  const db = freshDb();
  await call(envFor(db), WRITES[0].call, HOLDER, 'totp-holder');
  const row = auditRows(db)[0];
  const details = JSON.parse(row.filters_json);
  assert.equal(details.provider, 'slack');
  assert.equal(details.outcome, 'ok');
  assert.ok(!('user_id' in details), 'D159: a `user_id` key would name a target');
});

/* ── the reads stay open, and say nothing of the token ─────────────────── */

test('the reads stay requireAdmin: a plain admin reads the integration-keys and GitHub consoles', async () => {
  const db = freshDb();
  const env = envFor(db);
  for (const c of [
    { app: 'integrationKeys', method: 'GET', path: '/' },
    { app: 'github', method: 'GET', path: '/' },
  ] as Call[]) {
    const r = await call(env, c, PLAIN_ADMIN, 'totp-plain');
    assert.equal(r.status, 200, `${c.app} ${c.path}: ${r.text}`);
  }
  assert.equal(auditRows(db).length, 0, 'a read wrote an audit row');
});

test('GET /api/admin/github carries has_token and no preview of the token', async () => {
  const db = freshDb();
  const r = await call(envFor(db), { app: 'github', method: 'GET', path: '/' }, PLAIN_ADMIN, 'totp-plain');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.has_token, true);
  assert.ok(!('token_preview' in r.body), 'token_preview is back on the payload');
  assert.ok(!r.text.includes('token_preview'));
  // No eight-character window of the token, anywhere, in any position.
  for (let i = 0; i + 8 <= GH_TOKEN.length; i++) {
    assert.ok(!r.text.includes(GH_TOKEN.slice(i, i + 8)), `a fragment of the token reached the payload at ${i}`);
  }
});

test('the Stripe webhook update, which writes no secret, stays open to a plain admin', async () => {
  // It adds the route's own fixed event set to an existing endpoint; the
  // register beside it is the write the bar exists for.
  const db = freshDb();
  const r = await call(envFor(db), { app: 'stripe', method: 'POST', path: '/webhook', body: { action: 'update', endpoint_id: 'we_1' } },
    PLAIN_ADMIN, 'totp-plain');
  assert.notEqual(r.status, 403, r.text);
  assert.equal(toCloudflare().length, 0, 'an events update wrote a Worker secret');
});

/* ── the source: every secret writer behind the bar ────────────────────── */

test('every setSecret and deleteSecret call in the three routes sits in a handler that opens with the bar', () => {
  for (const file of ['admin_integration_keys.ts', 'admin_github.ts', 'admin_stripe.ts']) {
    const src = read(`cloudflare-worker/src/routes/${file}`);
    const handlers = src.split(/\nr\.(?=get\(|put\(|post\(|delete\()/).slice(1);
    for (const h of handlers) {
      if (!/\b(setSecret|deleteSecret)\(/.test(h)) continue;
      assert.match(h, /requireSuperAdminWriteBar\(c\)/, `${file}: a handler writes a Worker secret without the bar:\n${h.slice(0, 120)}`);
    }
    assert.doesNotMatch(src, /INSERT INTO (admin_audit_log|activity_logs)/, `${file} writes an audit row by hand`);
  }
});
