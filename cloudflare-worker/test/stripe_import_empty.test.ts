/**
 * Task #12 — A blank Stripe sync must not save a misleading $0 metric.
 *
 * The manual "Import from Stripe" button calls `syncStripeForUser`. When the
 * connected account has no active/trialing subscriptions, the route shows the
 * "connected but no synced billing data yet" message — but the shared sync used
 * to write a zero `source='stripe'` row to `metrics_snapshots` *before* the
 * route could classify the result as "no data", so a misleading $0 Stripe row
 * leaked into the snapshot history.
 *
 * These regression tests drive the real `syncStripeForUser` against an
 * in-memory SQLite DB (the same tiny D1 adapter used by events.test.ts) with a
 * stubbed Stripe REST API:
 *   - no subscriptions  → ok, mrr/customers 0, imported 0, and NO snapshot row
 *     (and financial_models left untouched);
 *   - one active sub    → ok, real mrr/customers, and exactly one snapshot row
 *     (the happy path still persists).
 *
 * The cron/webhook reconcile path (`sync()`) is intentionally NOT changed and
 * still writes zero snapshots; that is out of scope here.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripe_import_empty.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { syncStripeForUser } from '../src/integrations/providers/stripe.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const USER_ID = 42;
const PROJECT_ID = 7;
const UID = 'int_test_stripe_1';

// ── Tiny D1 adapter over node:sqlite (mirrors events.test.ts) ───────────────
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
  return db;
}

function makeEnv(db: InstanceType<typeof DatabaseSync>): any {
  return { DB: makeD1(db), ENVIRONMENT: 'development', JWT_SECRET };
}

async function seedStripeIntegration(env: any, db: InstanceType<typeof DatabaseSync>) {
  const enc = await encryptCredentials(env, UID, { access_token: 'sk_test_dummy' });
  db.prepare(
    'INSERT INTO integrations (uid, user_id, provider_key, status, credentials_enc) VALUES (?, ?, ?, ?, ?)',
  ).run(UID, USER_ID, 'stripe', 'active', enc);
}

// ── Stripe REST API stub over global fetch ──────────────────────────────────
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

function activeSub(id: string, customer: string, unitAmountCents: number) {
  return {
    id, status: 'active', customer, created: Math.floor(Date.now() / 1000), canceled_at: null,
    items: { data: [{ quantity: 1, price: { unit_amount: unitAmountCents, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] },
  };
}

function snapshotCount(db: InstanceType<typeof DatabaseSync>): number {
  const r = db.prepare("SELECT COUNT(*) AS c FROM metrics_snapshots WHERE source = 'stripe'").get() as { c: number };
  return Number(r.c);
}

// ───────────────────────────────────────────────────────────────────────────

test('no usable billing data → ok, but NO zero stripe snapshot is written', withStubbedStripe(
  { active: [], trialing: [], canceled: [] },
  async () => {
    const db = freshDb();
    const env = makeEnv(db);
    await seedStripeIntegration(env, db);

    const result = await syncStripeForUser(env, USER_ID, PROJECT_ID);

    // The sync succeeds (Stripe is reachable) but reports no data, which the
    // route maps to `stripe_no_data` via `!result.mrr && !result.customers`.
    assert.equal(result.ok, true);
    assert.equal(result.mrr, 0);
    assert.equal(result.customers, 0);
    assert.equal(result.imported, 0);

    // The whole point of the task: no misleading $0 row in the history.
    assert.equal(snapshotCount(db), 0, 'a no-data import must not leave a stripe snapshot row');

    // …and financial_models is not polluted with stripe-sourced zeros either.
    const fm = db.prepare('SELECT COUNT(*) AS c FROM financial_models').get() as { c: number };
    assert.equal(Number(fm.c), 0, 'a no-data import must not write financial_models');

    // The connection itself is still marked as synced (it worked, just empty).
    const intg = db.prepare('SELECT last_synced_at, last_error FROM integrations WHERE uid = ?').get(UID) as any;
    assert.ok(intg.last_synced_at, 'last_synced_at should be set on a successful (empty) sync');
    assert.equal(intg.last_error, null);
  },
));

test('has billing data → ok and exactly one stripe snapshot row is written', withStubbedStripe(
  { active: [activeSub('sub_1', 'cus_1', 1000)], trialing: [], canceled: [] },
  async () => {
    const db = freshDb();
    const env = makeEnv(db);
    await seedStripeIntegration(env, db);

    const result = await syncStripeForUser(env, USER_ID, PROJECT_ID);

    assert.equal(result.ok, true);
    assert.equal(result.mrr, 10);       // 1000 cents / month → $10 MRR
    assert.equal(result.customers, 1);
    assert.equal(result.imported, 1);

    assert.equal(snapshotCount(db), 1, 'the happy path must still persist a snapshot');
    const row = db.prepare("SELECT mrr, project_id, source FROM metrics_snapshots WHERE source = 'stripe'").get() as any;
    assert.equal(row.mrr, 10);
    assert.equal(row.project_id, PROJECT_ID);
  },
));

test('no MRR but a paying (free-plan) customer still counts as data', withStubbedStripe(
  { active: [activeSub('sub_free', 'cus_free', 0)], trialing: [], canceled: [] },
  async () => {
    const db = freshDb();
    const env = makeEnv(db);
    await seedStripeIntegration(env, db);

    const result = await syncStripeForUser(env, USER_ID, PROJECT_ID);

    // mrr 0 but customers 1 → the route does NOT classify this as no-data
    // (`!0 && !1` is false), so it must be persisted, not dropped.
    assert.equal(result.ok, true);
    assert.equal(result.mrr, 0);
    assert.equal(result.customers, 1);
    assert.equal(result.imported, 1);
    assert.equal(snapshotCount(db), 1, 'a $0-MRR account with a customer is real data and must persist');
  },
));
