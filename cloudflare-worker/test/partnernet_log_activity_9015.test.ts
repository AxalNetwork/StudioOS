/**
 * #9015 (D8534 finding 3) — partnernet's `logActivity` writes its row.
 *
 * `activity_logs.action` is NOT NULL on the migrated schema, and the insert
 * used to leave it out: the row failed, the catch swallowed it, and the
 * `activity_stats` count and `users.last_active` after it were skipped too.
 * Every caller (funds, legal/cap table, liquidity, capital, partnernet) lost
 * its trail. On node:sqlite with the migrated schema and synthetic fixtures:
 *
 *   1. one call writes one row with `action` and `action_type` both set, one
 *      stats increment and `last_active`;
 *   2. a second call adds a row and counts 2 for the day;
 *   3. a failed activity insert is logged and still leaves the stats and
 *      `last_active` written, and never throws to the caller;
 *   4. `POST /api/partnernet/activity/log` lands its row end to end.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/partnernet_log_activity_9015.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import partnernet, { logActivity } from '../src/routes/partnernet.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 7;
type Db = InstanceType<typeof DatabaseSync>;

function makeD1(db: Db) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { success: true, results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function seeded(): Db {
  const db = migratedDatabase();
  db.prepare("INSERT INTO users (id, email, name, role, is_active) VALUES (?, 'member@example.test', 'Synthetic Member', 'investor', 1)").run(MEMBER);
  return db;
}
const env = (db: Db) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
const rows = (db: Db) => db.prepare('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY id').all(MEMBER) as any[];
/** The day's counts; the day itself is the writer's UTC date, read back as a date. */
const stats = (db: Db) => (db.prepare('SELECT stat_date, action_count FROM activity_stats WHERE user_id = ?').all(MEMBER) as any[])
  .map((s) => ({ dated: /^\d{4}-\d{2}-\d{2}$/.test(s.stat_date), action_count: s.action_count }));
const lastActive = (db: Db) => (db.prepare('SELECT last_active FROM users WHERE id = ?').get(MEMBER) as any).last_active;

test('one call writes the row with action and action_type, one stats increment and last_active', async () => {
  const db = seeded();
  try {
    assert.equal(lastActive(db), null);
    await logActivity(env(db), MEMBER, 'capital_call_issued', {
      entityType: 'fund', entityId: 12, metadata: { call_number: 3 }, ip: '192.0.2.1', ua: 'synthetic-agent',
    });
    const r = rows(db);
    assert.equal(r.length, 1);
    assert.deepEqual(
      [r[0].action, r[0].action_type, r[0].entity_type, r[0].entity_id, r[0].ip_address, r[0].user_agent, JSON.parse(r[0].metadata)],
      ['capital_call_issued', 'capital_call_issued', 'fund', '12', '192.0.2.1', 'synthetic-agent', { call_number: 3 }],
    );
    assert.deepEqual(stats(db), [{ dated: true, action_count: 1 }]);
    assert.notEqual(lastActive(db), null);
  } finally { db.close(); }
});

test('a second call adds its own row and counts two for the day', async () => {
  const db = seeded();
  try {
    await logActivity(env(db), MEMBER, 'lpa_signed');
    await logActivity(env(db), MEMBER, 'secondary_listing_created', { entityType: 'listing', entityId: 'L-1' });
    assert.deepEqual(rows(db).map((r) => [r.action, r.action_type]), [['lpa_signed', 'lpa_signed'], ['secondary_listing_created', 'secondary_listing_created']]);
    assert.deepEqual(stats(db), [{ dated: true, action_count: 2 }]);
  } finally { db.close(); }
});

test('a failed activity insert is logged, never thrown, and still leaves the stats and last_active', async (t) => {
  const db = seeded();
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...a: unknown[]) => { logged.push(a); });
  try {
    db.exec("CREATE TRIGGER refuse_activity BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    await logActivity(env(db), MEMBER, 'distribution_triggered');
    assert.equal(rows(db).length, 0);
    assert.deepEqual(stats(db), [{ dated: true, action_count: 1 }]);
    assert.notEqual(lastActive(db), null);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0].slice(0, 3), ['logActivity:', 'activity row', 'distribution_triggered']);
  } finally { db.close(); }
});

test('POST /api/partnernet/activity/log lands its row on the migrated schema', async () => {
  const db = seeded();
  try {
    const tok = await new SignJWT({ user_id: MEMBER, role: 'investor' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await partnernet.request('/activity/log', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_type: 'dashboard_view', entity_type: 'page', entity_id: 'home' }),
    }, env(db));
    assert.equal(res.status, 200);
    assert.deepEqual(rows(db).map((r) => [r.action, r.action_type, r.entity_type, r.entity_id]), [['dashboard_view', 'dashboard_view', 'page', 'home']]);
    const list = await partnernet.request('/activity/logs?action_type=dashboard_view', { headers: { Authorization: `Bearer ${tok}` } }, env(db));
    const body: any = await list.json();
    assert.equal(body.total, 1);
  } finally { db.close(); }
});
