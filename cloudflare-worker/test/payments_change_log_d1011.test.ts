/**
 * D1011 (#2830, part 3 of Payments #2386): the change log read (PAY7), a
 * failed sync recorded (PAY6 C), and the webhook's deliveries per hour (PAY5).
 *
 * Every table is created from schema_baseline.sql verbatim, as
 * platform_consoles_d213.test.ts does: a fixture that invents a schema only
 * confirms its own assumptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import paymentsRoutes from '../src/routes/admin_payments.ts';
import platform from '../src/routes/admin_platform.ts';
import { adminCatalog, syncFailureOf } from '../src/routes/catalog.ts';
import {
  CHANGE_ACTIONS, CHANGE_LOG_EXPORT_ACTION, CHANGE_LOG_EXPORT_MAX, EXPORT_REASON_MIN,
  actionsFor, parseChangeLogFilters,
} from '../src/services/paymentsChangeLog.ts';
import {
  STRIPE_WEBHOOK_PATH, WEBHOOK_WINDOW_HOURS, readWebhookDeliveries, webhookHourStarts,
} from '../src/services/stripeWebhookDeliveries.ts';
import { StripeApiError } from '../src/util/stripeError.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

/** The router with the Worker's own mapping of a thrown guard to its status (index.ts `app.onError`). */
const payments = (() => {
  const a = new Hono();
  a.route('/', paymentsRoutes as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 801;
const ADMIN = 802;
const SECOND = 803;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, opts: { refuseExportRow?: boolean } = {}) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          if (opts.refuseExportRow && /INSERT INTO admin_audit_log/.test(sql) && b.includes(CHANGE_LOG_EXPORT_ACTION)) {
            throw new Error('D1_ERROR: disk I/O error');
          }
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function freshDb(opts: { without?: string[] } = {}) {
  const without = new Set(opts.without ?? []);
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'admin_audit_log', 'stripe_products', 'activity_logs']) {
    if (!without.has(t)) db.exec(ddl(t));
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  u.run(ADMIN, 'admin', 'Plain Admin', 'plain@example.test');
  u.run(SECOND, 'admin', 'Second Holder', 'second@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SECOND);
  return db;
}

async function call(app: any, db: any, path: string, opts: { as?: number; env?: Record<string, unknown>; init?: RequestInit; d1?: any } = {}) {
  const headers: Record<string, string> = {};
  if (opts.as !== 0) {
    const jwt = await new SignJWT({ user_id: opts.as ?? SUPER, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${jwt}`;
  }
  const res = await app.fetch(
    new Request(`http://x${path}`, { ...(opts.init ?? {}), headers: { ...headers, ...((opts.init?.headers as any) ?? {}) } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: opts.d1 ?? makeD1(db), ...(opts.env ?? {}) } as any,
  );
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* CSV, or the status says it */ }
  return { status: res.status, body, text, headers: res.headers };
}

/** An audit row as each writer leaves one. */
function audit(db: any, adminId: number, action: string, details: Record<string, unknown>, at: string, catalogWriter = true) {
  db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json, exported_at) VALUES (?, ?, ?, NULL, ?, ?)`)
    .run(adminId, action, catalogWriter ? 'billing' : null, JSON.stringify(details), at);
}

function seed(db: any) {
  db.prepare(`INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json) VALUES (?, ?, 'subscription', 1, '{}', ?)`)
    .run('prod_A', 'Studio plan', JSON.stringify([{ id: 'price_A1', currency: 'usd', unit_amount: 4900 }]));
  db.prepare(`INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json) VALUES (?, ?, 'alacarte', 1, '{}', ?)`)
    .run('prod_B', 'Incorporation', JSON.stringify([{ id: 'price_B1', currency: 'eur', unit_amount: 30000 }]));
  audit(db, SUPER, 'catalog_product_create', { product_id: 'prod_A', name: 'Studio plan', kind: 'subscription' }, '2026-10-01 09:00:00');
  audit(db, ADMIN, 'catalog_price_update', { price_id: 'price_A1', patch: { nickname: 'Monthly' } }, '2026-10-02 10:00:00');
  audit(db, ADMIN, 'catalog_price_archive', { price_id: 'price_B1' }, '2026-10-03 11:00:00');
  audit(db, SUPER, 'catalog_sync', { synced: 2 }, '2026-10-04 12:00:00');
  audit(db, SUPER, 'stripe_pk_update', { key_prefix: 'pk_test_', mode: 'test' }, '2026-10-05 13:00:00', false);
  audit(db, SECOND, 'stripe_webhook_update', { endpoint_id: 'we_1', url: 'https://axal.vc/api/billing/stripe/webhook' }, '2026-10-06 23:59:59', false);
  audit(db, SUPER, 'catalog_price_update', { price_id: 'price_gone', patch: {} }, '2026-10-07 08:00:00');
  // Not changes: someone else's action, and an earlier export of this log.
  audit(db, SUPER, 'role_changed', { target_user_id: ADMIN }, '2026-10-05 14:00:00', false);
  audit(db, SUPER, CHANGE_LOG_EXPORT_ACTION, { reason: 'quarterly review of changes' }, '2026-10-06 15:00:00');
}

// ── the actions ────────────────────────────────────────────────────────

test('the log names exactly the actions the catalogue and Stripe settings write', () => {
  const catalog = read('cloudflare-worker/src/routes/catalog.ts');
  const stripe = read('cloudflare-worker/src/routes/admin_stripe.ts');
  const written = new Set<string>([
    ...[...catalog.matchAll(/writeAdminAudit\(c\.env, admin\.id, '([a-z_]+)'/g)].map((m) => m[1]),
    ...[...stripe.matchAll(/logAdminAction\(c\.env, admin\.id, admin\.email, '([a-z_]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(written.has('catalog_sync_failed'), 'a failed sync writes no row');
  assert.deepEqual([...written].sort(), Object.keys(CHANGE_ACTIONS).sort());
  assert.ok(!(CHANGE_LOG_EXPORT_ACTION in CHANGE_ACTIONS), 'an export is not a change');
  assert.deepEqual(actionsFor('key'), ['stripe_pk_update']);
});

// ── who may read ───────────────────────────────────────────────────────

test('every route is the Super Admin\'s: a plain admin, a branch and a signed-out caller are refused', async () => {
  const db = freshDb();
  seed(db);
  for (const path of ['/change-log', '/change-log.csv?reason=a%20long%20enough%20reason', '/webhook-deliveries']) {
    assert.equal((await call(payments, db, path, { as: ADMIN })).status, 403, `${path}: a plain admin`);
    assert.equal((await call(payments, db, path, { as: 0 })).status, 401, `${path}: signed out`);
    assert.equal((await call(payments, db, path, { env: { BRANCH_CODE: 'nyc' } })).status, 403, `${path}: a branch`);
  }
  const exports = db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = ?').get(CHANGE_LOG_EXPORT_ACTION) as any;
  assert.equal(exports.n, 1, 'a refused export recorded nothing');
});

// ── the log ────────────────────────────────────────────────────────────

test('the log is the payments changes only, newest first, each with what, who and its product', async () => {
  const db = freshDb();
  seed(db);
  const { status, body, text } = await call(payments, db, '/change-log');
  assert.equal(status, 200);
  assert.equal(body.total, 7);
  assert.deepEqual(body.entries.map((e: any) => e.action), [
    'catalog_price_update', 'stripe_webhook_update', 'stripe_pk_update', 'catalog_sync',
    'catalog_price_archive', 'catalog_price_update', 'catalog_product_create',
  ]);
  const byAction = (a: string, i = 0) => body.entries.filter((e: any) => e.action === a)[i];
  assert.equal(byAction('stripe_webhook_update').what, 'webhook');
  assert.deepEqual(byAction('stripe_webhook_update').who, { id: SECOND, name: 'Second Holder' });
  // A price row is filed under its product through the mirror; a price the mirror no longer holds has none.
  assert.equal(byAction('catalog_price_update', 1).product_id, 'prod_A');
  assert.equal(byAction('catalog_price_update', 0).product_id, null);
  assert.equal(byAction('catalog_price_archive').product_id, 'prod_B');
  assert.deepEqual(byAction('catalog_sync').details, { synced: 2 });
  assert.doesNotMatch(text, /@example\.test/, 'no email leaves');
});

test('filters: what, who, product (its prices included) and inclusive dates; a bad filter is a 400', async () => {
  const db = freshDb();
  seed(db);
  const actions = async (q: string) => (await call(payments, db, `/change-log?${q}`)).body.entries.map((e: any) => e.action);
  assert.deepEqual(await actions('what=price'), ['catalog_price_update', 'catalog_price_archive', 'catalog_price_update']);
  assert.deepEqual(await actions(`who=${ADMIN}`), ['catalog_price_archive', 'catalog_price_update']);
  assert.deepEqual(await actions('product=prod_A'), ['catalog_price_update', 'catalog_product_create']);
  assert.deepEqual(await actions('product=prod_B'), ['catalog_price_archive']);
  assert.deepEqual(await actions('from=2026-10-03&to=2026-10-06'),
    ['stripe_webhook_update', 'stripe_pk_update', 'catalog_sync', 'catalog_price_archive']);
  assert.deepEqual(await actions('from=2026-10-07'), ['catalog_price_update']);
  for (const [q, code] of [['what=refund', 'invalid_what'], ['who=abc', 'invalid_who'], ['product=price_A1', 'invalid_product'],
    ['from=2026-13-01', 'invalid_from'], ['to=2026-02-30', 'invalid_to'], ['from=2026-10-05&to=2026-10-04', 'invalid_dates']]) {
    const r = await call(payments, db, `/change-log?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error, code, q);
    assert.equal(typeof r.body.message, 'string');
  }
  assert.deepEqual(parseChangeLogFilters((n) => (n === 'who' ? '0' : undefined)), { ok: false, refusal: { error: 'invalid_who', message: '"who" is an account id.' } });
  assert.deepEqual(parseChangeLogFilters(() => undefined), { ok: true, filters: {} });
});

test('pages: limit and offset, with the total the filters match', async () => {
  const db = freshDb();
  seed(db);
  const one = await call(payments, db, '/change-log?limit=3&offset=0');
  const two = await call(payments, db, '/change-log?limit=3&offset=3');
  assert.equal(one.body.entries.length, 3);
  assert.equal(two.body.entries.length, 3);
  assert.equal(one.body.total, 7);
  assert.notDeepEqual(one.body.entries.map((e: any) => e.id), two.body.entries.map((e: any) => e.id));
  assert.ok(one.body.entries.at(-1).id > two.body.entries[0].id, 'the second page continues the first');
});

test('a log that does not answer is a 503 with a sentence, and the read creates no table', async () => {
  const db = freshDb({ without: ['admin_audit_log'] });
  const r = await call(payments, db, '/change-log');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'change_log_unreadable');
  assert.ok(!('entries' in r.body), 'no empty list');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'admin_audit_log'").get().n, 0);
});

// ── the export ─────────────────────────────────────────────────────────

test('the CSV export needs a reason, records it before the file is sent, and carries the filtered rows', async () => {
  const db = freshDb();
  seed(db);
  const short = await call(payments, db, `/change-log.csv?reason=${'x'.repeat(EXPORT_REASON_MIN - 1)}`);
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'reason_required');
  assert.equal((await call(payments, db, '/change-log.csv')).status, 400);
  const before = (db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = ?').get(CHANGE_LOG_EXPORT_ACTION) as any).n;
  assert.equal(before, 1, 'a refused export recorded nothing');

  const r = await call(payments, db, '/change-log.csv?what=price&reason=Auditor%20asked%20for%20October');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type') || '', /text\/csv/);
  assert.equal(r.headers.get('X-Export-Rows'), '3');
  assert.equal(r.headers.get('X-Export-Capped'), '0');
  const lines = r.text.split('\r\n');
  assert.equal(lines[0], 'at,what,action,who_id,who_name,product_id,price_id,details');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^2026-10-07 08:00:00,price,catalog_price_update,801,The Holder,,price_gone,/);
  const row = db.prepare('SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = ? ORDER BY id DESC LIMIT 1')
    .get(CHANGE_LOG_EXPORT_ACTION) as any;
  assert.equal(row.admin_user_id, SUPER);
  assert.deepEqual(JSON.parse(row.filters_json), { reason: 'Auditor asked for October', filters: { what: 'price' }, rows: 3, capped: false });
  assert.ok(CHANGE_LOG_EXPORT_MAX >= 1000);
});

test('an export whose reason could not be recorded is not sent', async () => {
  const db = freshDb();
  seed(db);
  const r = await call(payments, db, '/change-log.csv?reason=a%20reason%20that%20is%20long', { d1: makeD1(db, { refuseExportRow: true }) });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'export_not_recorded');
  assert.doesNotMatch(r.text, /catalog_/);
});

// ── a failed sync ──────────────────────────────────────────────────────

test('a failed sync is recorded with who started it, Stripe\'s status and code, and none of Stripe\'s text', async () => {
  const db = freshDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: 'Expired API Key provided: sk_test_****wxyz' } }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  try {
    const r = await call(adminCatalog, db, '/sync', {
      as: SECOND, init: { method: 'POST' },
      env: { STRIPE_SECRET_KEY: 'sk_test_secretvalue_wxyz', RATE_LIMITS: { get: async () => null, put: async () => {} } },
    });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'catalog_sync_failed');
  } finally {
    globalThis.fetch = realFetch;
  }
  const row = db.prepare("SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'catalog_sync_failed'").get() as any;
  assert.ok(row, 'no row for the failed sync');
  assert.equal(row.admin_user_id, SECOND);
  assert.deepEqual(JSON.parse(row.filters_json), { failure: 'stripe', stripe_status: 401, stripe_code: 'api_key_expired' });
  assert.doesNotMatch(row.filters_json, /sk_test|Expired/);
  const log = await call(payments, db, '/change-log?what=sync');
  assert.equal(log.body.entries[0].action, 'catalog_sync_failed');
  assert.equal(log.body.entries[0].who.name, 'Second Holder');
  assert.deepEqual(syncFailureOf(new Error('D1_ERROR')), { failure: 'other' });
  assert.deepEqual(syncFailureOf(new StripeApiError(500, 'not json')), { failure: 'stripe', stripe_status: 500, stripe_code: null });
});

// ── the webhook's hours ───────────────────────────────────────────────

const NOW = new Date('2026-10-24T21:40:00Z');

test('24 hourly buckets, oldest first, ending with this hour; a silent hour is null and a quiet one is 0', async () => {
  const db = freshDb();
  const ins = db.prepare('INSERT INTO activity_logs (action, endpoint, status_code, latency_ms, created_at) VALUES (?, ?, ?, ?, ?)');
  ins.run('http_post', STRIPE_WEBHOOK_PATH, 200, 40, '2026-10-24 21:05:00');
  ins.run('http_post', STRIPE_WEBHOOK_PATH, 500, 90, '2026-10-24 21:20:00');
  ins.run('http_post', STRIPE_WEBHOOK_PATH, null, 30, '2026-10-24 19:59:59'); // no status: a delivery, not a refusal
  ins.run('http_get', '/api/projects', 200, 12, '2026-10-24 18:30:00');     // the log wrote; no delivery
  ins.run('http_post', STRIPE_WEBHOOK_PATH, 200, 40, '2026-10-23 22:00:00');  // the first bucket
  ins.run('http_post', STRIPE_WEBHOOK_PATH, 200, 40, '2026-10-23 21:59:59');  // before the window
  // An admin action row has no endpoint: it is not the request log.
  db.prepare('INSERT INTO activity_logs (action, details, created_at) VALUES (?, ?, ?)').run('role_changed', '{}', '2026-10-24 17:10:00');

  const w: any = await readWebhookDeliveries({ DB: makeD1(db) } as any, NOW);
  assert.equal(w.available, true);
  assert.equal(w.hours.length, WEBHOOK_WINDOW_HOURS);
  assert.equal(w.hours[0].hour, '2026-10-23T22:00:00.000Z');
  assert.equal(w.hours.at(-1).hour, '2026-10-24T21:00:00.000Z');
  const at = (iso: string) => w.hours.find((h: any) => h.hour === iso);
  assert.deepEqual(at('2026-10-24T21:00:00.000Z'), { hour: '2026-10-24T21:00:00.000Z', deliveries: 2, not_2xx: 1 });
  assert.deepEqual(at('2026-10-24T19:00:00.000Z'), { hour: '2026-10-24T19:00:00.000Z', deliveries: 1, not_2xx: 0 });
  assert.deepEqual(at('2026-10-24T18:00:00.000Z'), { hour: '2026-10-24T18:00:00.000Z', deliveries: 0, not_2xx: 0 });
  assert.deepEqual(at('2026-10-24T17:00:00.000Z'), { hour: '2026-10-24T17:00:00.000Z', deliveries: null, not_2xx: null });
  assert.deepEqual(at('2026-10-24T20:00:00.000Z'), { hour: '2026-10-24T20:00:00.000Z', deliveries: null, not_2xx: null });
  assert.equal(at('2026-10-23T22:00:00.000Z').deliveries, 1);
  assert.equal(webhookHourStarts(NOW).length, 24);
});

test('the deliveries route answers the block, and a log that does not answer is a 503', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO activity_logs (action, endpoint, status_code, latency_ms, created_at) VALUES ('http_post', ?, 200, 30, datetime('now'))")
    .run(STRIPE_WEBHOOK_PATH);
  const ok = await call(payments, db, '/webhook-deliveries');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.deliveries, 1);
  assert.equal(ok.body.hours.length, WEBHOOK_WINDOW_HOURS);
  assert.equal(ok.body.hours.at(-1).deliveries, 1);
  const gone = await call(payments, freshDb({ without: ['activity_logs'] }), '/webhook-deliveries');
  assert.equal(gone.status, 503);
  assert.equal(gone.body.error, 'webhook_deliveries_unreadable');
  assert.ok(!('hours' in gone.body));
});

test('HQ · Platform reads the same block, hours included', async () => {
  const db = freshDb();
  for (const t of ['provider_oauth_keys', 'tickets', 'promo_codes', 'integrations', 'cron_run_history']) db.exec(ddl(t));
  const r = await call(platform, db, '/summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.payments_catalog.webhook.available, true);
  assert.equal(r.body.payments_catalog.webhook.hours.length, WEBHOOK_WINDOW_HOURS);
});
