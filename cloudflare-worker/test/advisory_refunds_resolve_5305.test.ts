/**
 * #5305 (D4703 "Built"): HQ marks one advisory refund due resolved.
 *
 *   - the resolve records who, when and why, and writes exactly one
 *     `admin_audit_log` row in the same batch;
 *   - a second resolve, and a resolve that loses a race after its read, are
 *     refused with 409 and leave one resolution and one audit row;
 *   - a plain admin, and a Super Admin without the write bar, are refused and
 *     nothing changes;
 *   - an unreadable store is a 503 on both the read and the write, never an
 *     empty list or "0 open".
 *
 * Real node:sqlite, with `advisory_refunds_due` from its two migrations read
 * off disk and every other table from schema_baseline.sql, as
 * operator_switches_d203.test.ts does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import platform from '../src/routes/admin_platform.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 801;      // the Super Admin
const PLAIN_ADMIN = 802; // an admin who does not hold the elevation
const REASON = 'Refunded in the Stripe dashboard, re_123, on 10 Nov.';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const DUE = read('cloudflare-worker/sql/migrations/202611070915_advisory_refunds_due.sql');
const REASON_COL = read('cloudflare-worker/sql/migrations/202611100930_advisory_refunds_due_resolution_reason.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
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
    // One transaction, like D1.
    async batch(x: any[]) {
      db.exec('SAVEPOINT d1_batch');
      try {
        const out = [];
        for (const st of x || []) out.push(await st.run());
        db.exec('RELEASE d1_batch');
        return out;
      } catch (e) {
        db.exec('ROLLBACK TO d1_batch'); db.exec('RELEASE d1_batch');
        throw e;
      }
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log']) db.exec(ddl(t));
  db.exec(DUE); db.exec(REASON_COL);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(HOLDER, 'totp-holder', 'totp');
  s.run(PLAIN_ADMIN, 'totp-plain', 'totp');
  s.run(HOLDER, 'password-holder', 'password');
  db.exec(`INSERT INTO advisory_refunds_due (id, booking_id, booking_uid, booking_status, payment_intent_id, amount_cents, currency, created_at)
    VALUES (1, 11, 'bk-open', 'cancelled', 'pi_1', 30000, 'usd', '2026-11-06 00:00:00'),
           (2, 12, 'bk-other', 'no_show', 'pi_2', 12000, 'eur', '2026-11-05 00:00:00')`);
  return db;
}

const envFor = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;

async function token(userId: number, jti?: string): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const app = new Hono<any>();
app.route('/', platform);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function resolveDue(env: any, id: number | string, body: unknown, { as = HOLDER, jti = 'totp-holder' } = {}) {
  const res = await app.request(`/advisory-refunds-due/${id}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(as, jti)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
async function list(env: any, as = HOLDER) {
  const res = await app.request('/advisory-refunds-due', { headers: { Authorization: `Bearer ${await token(as)}` } }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const dueRow = (db: any, id: number) => ({ ...(db.prepare('SELECT * FROM advisory_refunds_due WHERE id = ?').get(id) as any) });
const audits = (db: any) =>
  (db.prepare("SELECT * FROM admin_audit_log WHERE action = 'advisory_refund_due_resolved' ORDER BY id").all() as any[]);

test('#5305: a resolve records who, when and why, with exactly one audit row; the list shows it resolved', async () => {
  const db = freshDb();
  const env = envFor(db);
  const r = await resolveDue(env, 1, { reason: `  ${REASON}  ` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.moves_money, false);
  const row = dueRow(db, 1);
  assert.ok(row.resolved_at, 'resolved_at is written');
  assert.equal(row.resolved_by, HOLDER);
  assert.equal(row.resolution_reason, REASON, 'the reason, trimmed');
  assert.equal(dueRow(db, 2).resolved_at, null, 'only the named row');

  const a = audits(db);
  assert.equal(a.length, 1);
  assert.equal(a[0].admin_user_id, HOLDER);
  assert.deepEqual(JSON.parse(a[0].filters_json), {
    refund_due_id: 1, booking_uid: 'bk-open', amount_cents: 30000, currency: 'usd', reason: REASON,
  });

  const l = await list(env);
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.open, 1);
  assert.deepEqual(l.body.items.map((x: any) => [x.id, x.booking_uid]), [[2, 'bk-other'], [1, 'bk-open']], 'open first');
  const done = l.body.items.find((x: any) => x.id === 1);
  assert.equal(done.resolved_by_name, 'The Holder');
  assert.equal(done.resolution_reason, REASON);
  assert.ok(!JSON.stringify(l.body).includes('@'), 'no email is sent');
});

test('#5305: a second resolve is refused with 409 and changes nothing', async () => {
  const db = freshDb();
  const env = envFor(db);
  assert.equal((await resolveDue(env, 1, { reason: REASON })).status, 200);
  const before = dueRow(db, 1);
  const again = await resolveDue(env, 1, { reason: 'Someone else refunded it too, re_456.' });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.code, 'already_resolved');
  assert.deepEqual(dueRow(db, 1), before);
  assert.equal(audits(db).length, 1);
});

test('#5305: a resolve that loses the race after its read is 409 with no second audit row', async () => {
  const db = freshDb();
  const base = envFor(db);
  // Another operator resolves the row between this request's read and its write.
  const racing = { ...base, DB: { ...base.DB, prepare(sql: string) {
    const st = base.DB.prepare(sql);
    if (!/^\s*UPDATE advisory_refunds_due/.test(sql)) return st;
    db.prepare("UPDATE advisory_refunds_due SET resolved_at = datetime('now'), resolved_by = ?, resolution_reason = 'the other operator' WHERE id = 1").run(PLAIN_ADMIN);
    return st;
  } } };
  const r = await resolveDue(racing, 1, { reason: REASON });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  const row = dueRow(db, 1);
  assert.equal(row.resolved_by, PLAIN_ADMIN, 'the first resolution stands');
  assert.equal(row.resolution_reason, 'the other operator');
  assert.equal(audits(db).length, 0, 'no audit row for a write that changed nothing');
});

test('#5305: a plain admin, and a Super Admin without the write bar, are refused; nothing changes', async () => {
  const db = freshDb();
  const env = envFor(db);
  const plain = await resolveDue(env, 1, { reason: REASON }, { as: PLAIN_ADMIN, jti: 'totp-plain' });
  assert.equal(plain.status, 403, JSON.stringify(plain.body));
  const noBar = await resolveDue(env, 1, { reason: REASON }, { jti: 'password-holder' });
  assert.ok(noBar.status === 401 || noBar.status === 403, `status ${noBar.status}`);
  assert.equal((await list(env, PLAIN_ADMIN)).status, 403);
  assert.equal(dueRow(db, 1).resolved_at, null);
  assert.equal(audits(db).length, 0);
});

test('#5305: a reason is required; an unknown id is 404', async () => {
  const db = freshDb();
  const env = envFor(db);
  for (const body of [{}, { reason: '' }, { reason: 'refunded' }, { reason: 42 }, { reason: 'x'.repeat(501) }]) {
    const r = await resolveDue(env, 1, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'reason_required');
  }
  assert.equal((await resolveDue(env, 99, { reason: REASON })).status, 404);
  assert.equal((await resolveDue(env, 'abc', { reason: REASON })).status, 404);
  assert.equal(dueRow(db, 1).resolved_at, null);
  assert.equal(audits(db).length, 0);
});

test('#5305: a failed audit write fails the resolve, and the row stays open', async () => {
  const db = freshDb();
  const base = envFor(db);
  const failingAudit = { ...base, DB: { ...base.DB, prepare(sql: string) {
    const st = base.DB.prepare(sql);
    if (!/INSERT INTO admin_audit_log/.test(sql)) return st;
    return { ...st, bind: () => ({ run: async () => { throw new Error('D1_ERROR: synthetic audit failure'); } }) };
  } } };
  const r = await resolveDue(failingAudit, 1, { reason: REASON });
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(dueRow(db, 1).resolved_at, null, 'not resolved without its record');
});

test('#5305: an unreadable store is 503 on the read and the write, never an empty list or 0 open', async () => {
  const db = freshDb();
  db.exec('DROP TABLE advisory_refunds_due');
  const env = envFor(db);
  const l = await list(env);
  assert.equal(l.status, 503, JSON.stringify(l.body));
  assert.equal(l.body.code, 'store_unavailable');
  assert.equal(l.body.open, undefined, 'no count is sent');
  assert.equal(l.body.items, undefined);
  const w = await resolveDue(env, 1, { reason: REASON });
  assert.equal(w.status, 503, JSON.stringify(w.body));
  assert.equal(audits(db).length, 0);
});
