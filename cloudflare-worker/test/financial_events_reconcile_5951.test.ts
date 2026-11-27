/**
 * D5951 (#5951) — HQ's reconciliation route over the revenue ledger
 * (`/api/admin/financial-events`), on the real D5299 migration.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/financial_events_reconcile_5951.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import route, { mount } from '../src/routes/admin_financial_events.ts';
import { writeFinancialEvent } from '../src/services/financialEvents.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, FOUNDER = 61;

function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL,
      report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT,
      exported_at TEXT NOT NULL DEFAULT (datetime('now')), viewed_user_id INTEGER, conversation_id INTEGER, viewed_at TEXT);`);
  db.exec(read('cloudflare-worker/sql/migrations/202611100929_financial_events.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example', 'uid-1');
  u.run(ADMIN, 'admin', 'Al', 'al@axal.example', 'uid-2');
  u.run(FOUNDER, 'founder', 'Ada', 'ada@example.test', 'uid-61');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}
const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'test', DB: d1Over(db) } as any);
const app = (() => {
  const a = new Hono<any>();
  a.route(mount.path, route);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')] ?? ({ 'Super admin required': 403, 'Admin access required': 403, 'HQ only': 403 } as Record<string, number>)[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s as any) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
const token = (id: number, role = 'admin') => new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(db: DatabaseSync, method: string, path: string, body?: unknown, who = SUPER, role = 'admin') {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`${mount.path}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, role)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env(db));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally { [console.warn, console.error] = saved; }
}

async function seed(db: DatabaseSync) {
  const e = env(db);
  const NULLS = Object.fromEntries(['object_ref', 'charge_ref', 'payment_intent_ref', 'invoice_ref', 'customer_ref', 'refund_key', 'user_id', 'company_id',
    'project_id', 'licence_uid', 'revenue_stream', 'product_ref', 'actor_user_id', 'currency', 'gross_cents', 'refund_cents', 'net_cents', 'occurred_at'].map((k) => [k, null]));
  const w = (o: Record<string, unknown>) => writeFinancialEvent(e, { ...NULLS, source: 'stripe', livemode: 0, ...o } as any);
  await w({ source_event_id: 'evt_1', source_event_type: 'charge.succeeded', kind: 'charge', currency: 'USD', gross_cents: 4900, refund_cents: 0, net_cents: 4900, occurred_at: '2026-11-01T10:00:00Z', user_id: FOUNDER, object_ref: 'ch_1' });
  await w({ source_event_id: 'evt_2', source_event_type: 'charge.refunded', kind: 'refund', currency: 'EUR', gross_cents: 10000, refund_cents: 2500, net_cents: 7500, occurred_at: '2026-11-05T10:00:00Z', object_ref: 'ch_2' });
  await w({ source_event_id: 'evt_3', source_event_type: 'charge.dispute.created', kind: 'dispute', occurred_at: '2026-11-10T23:30:00Z', object_ref: 'dp_3' });
  const uids = (db.prepare('SELECT uid, source_event_id FROM financial_events ORDER BY id').all() as any[]);
  return Object.fromEntries(uids.map((r) => [r.source_event_id, r.uid]));
}

test('mounts at /api/admin/financial-events; Super Admin only', async () => {
  assert.equal(mount.path, '/api/admin/financial-events');
  const db = database(); await seed(db);
  assert.equal((await call(db, 'GET', '', undefined, ADMIN)).status, 403, 'a plain admin');
  assert.equal((await call(db, 'GET', '', undefined, FOUNDER, 'founder')).status, 403);
  assert.equal((await call(db, 'POST', '/x/reconcile', { from: 'pending', to: 'matched' }, ADMIN)).status, 403);
});

test('GET lists rows newest first, filtered by state, kind, currency and period, paged, each naming its unattributed fields', async () => {
  const db = database(); await seed(db);
  const all = await call(db, 'GET', '');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.rows.map((r: any) => r.kind), ['dispute', 'refund', 'charge']);
  const dispute = all.body.rows[0];
  assert.equal(dispute.currency, null);
  assert.equal(dispute.gross_cents, null, 'no amount is null, never 0');
  assert.deepEqual(dispute.unattributed, ['user_id', 'company_id', 'project_id', 'licence_uid', 'revenue_stream', 'product_ref']);
  assert.ok(!all.body.rows[2].unattributed.includes('user_id'), 'the charge names its user');
  assert.deepEqual(all.body.moves.pending, ['matched', 'discrepancy', 'excluded']);
  assert.deepEqual((await call(db, 'GET', '?kind=refund')).body.rows.map((r: any) => r.currency), ['EUR']);
  assert.deepEqual((await call(db, 'GET', '?currency=usd')).body.rows.map((r: any) => r.kind), ['charge']);
  assert.deepEqual((await call(db, 'GET', '?from=2026-11-05&to=2026-11-10')).body.rows.map((r: any) => r.kind), ['dispute', 'refund'], 'to is inclusive of the whole day');
  assert.deepEqual((await call(db, 'GET', '?state=matched')).body.rows, []);
  const p1 = await call(db, 'GET', '?limit=2');
  assert.equal(p1.body.rows.length, 2);
  assert.ok(p1.body.next_cursor);
  const p2 = await call(db, 'GET', `?limit=2&cursor=${p1.body.next_cursor}`);
  assert.deepEqual(p2.body.rows.map((r: any) => r.kind), ['charge']);
  assert.equal(p2.body.next_cursor, null);
  for (const bad of ['?state=done', '?kind=gift', '?currency=dollars', '?from=11/05/2026', '?cursor=abc']) assert.equal((await call(db, 'GET', bad)).status, 400, bad);
});

test('POST moves one row by an allowed move from the state read; actor, time and note are stored; the write is audited', async () => {
  const db = database(); const u = await seed(db);
  const ok = await call(db, 'POST', `/${u.evt_1}/reconcile`, { from: 'pending', to: 'matched' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.row.reconciliation.state, 'matched');
  assert.equal(ok.body.row.reconciliation.by_user_id, SUPER);
  assert.match(ok.body.row.reconciliation.at, /^\d{4}-\d{2}-\d{2}T/);
  const audit = db.prepare("SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'financial_event_reconciled'").all() as any[];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_user_id, SUPER);
  assert.deepEqual(JSON.parse(audit[0].filters_json), { uid: u.evt_1, from: 'pending', to: 'matched', note: null });
  const disc = await call(db, 'POST', `/${u.evt_2}/reconcile`, { from: 'pending', to: 'discrepancy', note: 'Refund is 25 EUR in Stripe; HQ shows none.' });
  assert.equal(disc.status, 200);
  assert.equal(disc.body.row.reconciliation.note, 'Refund is 25 EUR in Stripe; HQ shows none.');
  assert.equal((await call(db, 'POST', `/${u.evt_2}/reconcile`, { from: 'discrepancy', to: 'matched' })).status, 200);
});

test('a stale from changes nothing and answers 409 with the state now; a disallowed move is 400; a note is required for discrepancy and excluded', async () => {
  const db = database(); const u = await seed(db);
  assert.equal((await call(db, 'POST', `/${u.evt_1}/reconcile`, { from: 'pending', to: 'matched' })).status, 200);
  const stale = await call(db, 'POST', `/${u.evt_1}/reconcile`, { from: 'pending', to: 'excluded', note: 'dup' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.state, 'matched');
  assert.equal((await call(db, 'POST', `/${u.evt_1}/reconcile`, { from: 'matched', to: 'pending' })).status, 400, 'matched is final');
  assert.equal((await call(db, 'POST', `/${u.evt_3}/reconcile`, { from: 'pending', to: 'pending' })).status, 400);
  assert.equal((await call(db, 'POST', `/${u.evt_3}/reconcile`, { from: 'pending', to: 'reviewed' })).status, 400);
  for (const to of ['discrepancy', 'excluded']) {
    const r = await call(db, 'POST', `/${u.evt_3}/reconcile`, { from: 'pending', to, note: '  ' });
    assert.equal(r.status, 400, to);
    assert.equal(r.body.error, 'note_required');
  }
  assert.equal((await call(db, 'POST', `/${u.evt_3}/reconcile`, { from: 'pending', to: 'excluded', note: 'x'.repeat(501) })).status, 400);
  assert.equal((await call(db, 'POST', '/nope/reconcile', { from: 'pending', to: 'matched' })).status, 404);
  const row = db.prepare('SELECT reconciliation_state FROM financial_events WHERE uid = ?').get(u.evt_3) as any;
  assert.equal(row.reconciliation_state, 'pending', 'nothing moved');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'financial_event_reconciled'").get()!.n, 1, 'refusals are not audited as writes');
});

test('no other column can change: the body ignores extra fields, and the trigger refuses a direct edit', async () => {
  const db = database(); const u = await seed(db);
  const before = db.prepare('SELECT * FROM financial_events WHERE uid = ?').get(u.evt_1) as any;
  const r = await call(db, 'POST', `/${u.evt_1}/reconcile`, { from: 'pending', to: 'matched', gross_cents: 1, currency: 'GBP', user_id: 99, kind: 'adjustment' });
  assert.equal(r.status, 200);
  const after = db.prepare('SELECT * FROM financial_events WHERE uid = ?').get(u.evt_1) as any;
  for (const k of Object.keys(before)) {
    if (['reconciliation_state', 'reconciled_at', 'reconciled_by_user_id', 'reconciliation_note'].includes(k)) continue;
    assert.deepEqual(after[k], before[k], k);
  }
  assert.throws(() => db.prepare('UPDATE financial_events SET gross_cents = 1 WHERE uid = ?').run(u.evt_1), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM financial_events WHERE uid = ?').run(u.evt_1), /kept/);
});
