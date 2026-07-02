/**
 * Task #13 — the "Import from Stripe" button's error states must never silently
 * break.
 *
 * `POST /api/progress/metrics/:projectId/import-stripe` returns four distinct
 * outcomes that the Metrics page depends on. The frontend reads BOTH the HTTP
 * status (2xx vs not) AND `error.data.code` (the `{ detail: { code, message } }`
 * shape) on a failure, so a refactor of `syncStripeForUser`'s return shape or
 * the route's status codes could silently swap a typed, user-friendly message
 * for a raw error — or, worse, return a 2xx the page treats as success when
 * there is nothing to import.
 *
 * These tests drive the REAL route (the mounted `progress` Hono router) with a
 * forged founder JWT against an in-memory SQLite D1 and a stubbed Stripe REST
 * API, so the whole chain runs unmocked: auth → project ownership →
 * `syncStripeForUser` → the route's outcome classification. Each case asserts
 * the HTTP status AND the `detail` object so the `e.data.code` contract stays
 * intact:
 *   - not connected            → 400 `stripe_not_connected`
 *   - credentials missing      → 400 `stripe_not_connected`
 *   - upstream Stripe failure   → 502 `stripe_sync_failed`
 *   - connected, no usable data → 400 `stripe_no_data` (and NO snapshot row)
 *   - success (mrr/customers>0) → 200 `source:'stripe'` + a snapshot written
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripe_import_route.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import progress from '../src/routes/progress.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const USER_ID = 42;
const FOUNDER_ID = 99;
const PROJECT_ID = 7;
const UID = 'int_test_stripe_route_1';

// ── Tiny D1 adapter over node:sqlite (mirrors stripe_import_empty.test.ts) ───
function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { binds = coerce(a); return api; },
        async first() { return db.prepare(sql).get(...binds) ?? null; },
        async all() { return { results: db.prepare(sql).all(...binds) }; },
        async run() {
          const r = db.prepare(sql).run(...binds);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { return stmts; },
  };
}

function freshDb() {
  // D1 accepts double-quoted string literals (e.g. `source = "stripe"` in
  // projectMetricsToProject); node:sqlite defaults that off and would parse
  // them as identifiers, so enable it to mirror the production engine.
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER
    );
    -- getCurrentUser best-effort hydrates MI Pro state; an empty table keeps the
    -- lookup quiet (a missing table would only log a warning, never fail).
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      provider_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      credentials_enc TEXT,
      config_json TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      updated_at TEXT
    );
    CREATE TABLE metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL, mrr REAL, arr REAL, cac REAL, ltv REAL,
      monthly_churn_pct REAL, active_users INTEGER, new_users INTEGER,
      notes TEXT, source TEXT, created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE financial_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      assumptions_json TEXT,
      name TEXT,
      inputs_json TEXT,
      updated_at TEXT
    );
  `);
  // A founder who owns the project (so `ensureCanEdit` passes) and an active
  // session (so `getCurrentUser` resolves the JWT to a live user).
  db.prepare('INSERT INTO users (id, role, founder_id, is_active) VALUES (?, ?, ?, 1)')
    .run(USER_ID, 'founder', FOUNDER_ID);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)')
    .run(PROJECT_ID, 'Test Project', FOUNDER_ID);
  return db;
}

function makeEnv(db: InstanceType<typeof DatabaseSync>): any {
  return { DB: makeD1(db), ENVIRONMENT: 'development', JWT_SECRET };
}

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function seedStripeIntegration(env: any, db: InstanceType<typeof DatabaseSync>, creds: any) {
  const enc = await encryptCredentials(env, UID, creds);
  db.prepare(
    'INSERT INTO integrations (uid, user_id, provider_key, status, credentials_enc) VALUES (?, ?, ?, ?, ?)',
  ).run(UID, USER_ID, 'stripe', 'active', enc);
}

function importStripe(env: any, token: string, projectId: number = PROJECT_ID): Promise<Response> {
  // The router is mounted at /api/progress in index.ts, so paths are relative
  // to the router root here (mirrors capital.test.ts calling '/calls').
  return progress.request(
    `/metrics/${projectId}/import-stripe`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    env,
  );
}

// ── Stripe REST API stubs over global fetch ─────────────────────────────────
function withStubbedStripe(
  subs: { active?: any[]; trialing?: any[]; canceled?: any[] },
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      let data: any[] = [];
      if (u.includes('status=active')) data = subs.active || [];
      else if (u.includes('status=trialing')) data = subs.trialing || [];
      else if (u.includes('status=canceled')) data = subs.canceled || [];
      return {
        ok: true,
        status: 200,
        async json() { return { data, has_more: false }; },
        async text() { return ''; },
      } as any;
    }) as any;
    try { await fn(); } finally { globalThis.fetch = real; }
  };
}

function withFailingStripe(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      async json() { return { error: { message: 'boom' } }; },
      async text() { return '{"error":{"message":"boom"}}'; },
    })) as any;
    try { await fn(); } finally { globalThis.fetch = real; }
  };
}

function activeSub(id: string, customer: string, unitAmountCents: number) {
  return {
    id, status: 'active', customer, created: Math.floor(Date.now() / 1000), canceled_at: null,
    items: { data: [{ quantity: 1, price: { unit_amount: unitAmountCents, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  };
}

function stripeSnapshotCount(db: InstanceType<typeof DatabaseSync>): number {
  const r = db.prepare("SELECT COUNT(*) AS c FROM metrics_snapshots WHERE source = 'stripe'").get() as { c: number };
  return Number(r.c);
}

// ───────────────────────────────────────────────────────────────────────────

test('not connected → 400 with detail.code stripe_not_connected', async () => {
  const db = freshDb();          // user + project, but NO stripe integration row
  const env = makeEnv(db);
  const token = await mintToken(USER_ID, 'founder');

  const res = await importStripe(env, token);

  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.detail.code, 'stripe_not_connected');
  assert.equal(typeof body.detail.message, 'string');
  assert.ok(body.detail.message.length > 0);
});

test('connected but credentials missing → 400 with detail.code stripe_not_connected', async () => {
  const db = freshDb();
  const env = makeEnv(db);
  // An integration row whose decrypted blob has no access_token →
  // `credentials_missing`, which the route also maps to stripe_not_connected.
  await seedStripeIntegration(env, db, {});
  const token = await mintToken(USER_ID, 'founder');

  const res = await importStripe(env, token);

  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.detail.code, 'stripe_not_connected');
});

test('upstream Stripe failure → 502 with detail.code stripe_sync_failed', withFailingStripe(async () => {
  const db = freshDb();
  const env = makeEnv(db);
  await seedStripeIntegration(env, db, { access_token: 'sk_test_dummy' });
  const token = await mintToken(USER_ID, 'founder');

  const res = await importStripe(env, token);

  assert.equal(res.status, 502);
  const body = (await res.json()) as any;
  assert.equal(body.detail.code, 'stripe_sync_failed');
  // The upstream reason is surfaced (not swallowed) so the page can show it.
  assert.equal(typeof body.detail.message, 'string');
  assert.ok(body.detail.message.length > 0);
  // A failed import must not leave a stripe snapshot row behind.
  assert.equal(stripeSnapshotCount(db), 0);
}));

test('connected but no usable billing data → 400 stripe_no_data, no snapshot', withStubbedStripe(
  { active: [], trialing: [], canceled: [] },
  async () => {
    const db = freshDb();
    const env = makeEnv(db);
    await seedStripeIntegration(env, db, { access_token: 'sk_test_dummy' });
    const token = await mintToken(USER_ID, 'founder');

    const res = await importStripe(env, token);

    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.detail.code, 'stripe_no_data');
    assert.equal(typeof body.detail.message, 'string');
    // No misleading $0 row written for an empty account (ties to Task #12).
    assert.equal(stripeSnapshotCount(db), 0);
  },
));

test('success (mrr or customers > 0) → 200 source:stripe + snapshot written', withStubbedStripe(
  { active: [activeSub('sub_1', 'cus_1', 1000)], trialing: [], canceled: [] },
  async () => {
    const db = freshDb();
    const env = makeEnv(db);
    await seedStripeIntegration(env, db, { access_token: 'sk_test_dummy' });
    const token = await mintToken(USER_ID, 'founder');

    const res = await importStripe(env, token);

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.source, 'stripe');
    assert.equal(body.mrr, 10);          // 1000 cents / month → $10 MRR
    assert.equal(body.customers, 1);
    assert.equal(body.imported, 1);
    // The happy path persists exactly one stripe snapshot.
    assert.equal(stripeSnapshotCount(db), 1);
    const row = db.prepare("SELECT mrr, project_id, source FROM metrics_snapshots WHERE source = 'stripe'").get() as any;
    assert.equal(row.mrr, 10);
    assert.equal(row.project_id, PROJECT_ID);
  },
));
