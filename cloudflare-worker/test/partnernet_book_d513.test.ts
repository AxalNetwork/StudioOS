/**
 * D513 — void a touch, refuse a bad date, keep a non-party touch out of the MAX.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import partnernet from '../src/routes/partnernet.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const INVESTOR = 42;
const FOUNDER = 30;
const OTHER = 31;
const OUTSIDER = 77;
const ADMIN = 9;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, failRead = false) {
  return {
    prepare(sql: string) {
      if (failRead && sql.includes('last_interaction_at')) throw new Error('read failed');
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
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    CREATE TABLE partner_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_a_id INTEGER NOT NULL, partner_b_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL, strength_score REAL DEFAULT 50,
      metadata TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'accepted',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (partner_a_id < partner_b_id)
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(INVESTOR, 'investor', 'Ingrid Investor', 'investor@example.test');
  u.run(FOUNDER, 'founder', 'Fred Founder', 'founder@example.test');
  u.run(OTHER, 'founder', 'Other Founder', 'other@example.test');
  u.run(OUTSIDER, 'investor', 'Otto Outsider', 'outsider@example.test');
  u.run(ADMIN, 'admin', 'Ada Admin', 'admin@example.test');
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, status)
              VALUES (?, ?, 'co_investor', 80, 'accepted')`).run(FOUNDER, INVESTOR);
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, status)
              VALUES (?, ?, 'co_investor', 40, 'accepted')`).run(OTHER, INVESTOR);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  who: { user: number; role: string },
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
  failRead = false,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await partnernet.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, failRead) } as any);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

const investor = { user: INVESTOR, role: 'investor' };
const outsider = { user: OUTSIDER, role: 'investor' };
const admin = { user: ADMIN, role: 'admin' };

test('two accepted ties each keep two touches, and a void drops out of the MAX', async () => {
  const db = freshDb();
  for (const [rel, when] of [[1, '2026-01-01T00:00:00.000Z'], [1, '2026-08-01T00:00:00.000Z'], [2, '2026-02-01T00:00:00.000Z'], [2, '2026-03-01T00:00:00.000Z']] as const) {
    const logged = await call(investor, `/relationships/${rel}/interactions`, {
      method: 'POST', body: { note: `touch ${when}`, interacted_at: when },
    }, db);
    assert.equal(logged.status, 201, logged.body?.message || logged.body?.error);
  }
  const before = await call(investor, '/relationships', {}, db);
  const first = before.body.find((r: any) => r.id === 1);
  assert.equal(first.last_interaction_at, '2026-08-01T00:00:00.000Z');

  const log = await call(investor, '/relationships/1/interactions', {}, db);
  const later = log.body.items.find((r: any) => r.interacted_at === '2026-08-01T00:00:00.000Z');
  const voided = await call(investor, `/relationships/1/interactions/${later.uid}/void`, { method: 'POST', body: {} }, db);
  assert.equal(voided.status, 200);

  const after = await call(investor, '/relationships', {}, db);
  const row = after.body.find((r: any) => r.id === 1);
  assert.equal(row.last_interaction_at, '2026-01-01T00:00:00.000Z', 'a voided touch still counted');
  const second = after.body.find((r: any) => r.id === 2);
  assert.equal(second.last_interaction_at, '2026-03-01T00:00:00.000Z');
});

test('an unparseable touch date is refused, even with a note', async () => {
  const db = freshDb();
  const bad = await call(investor, '/relationships/1/interactions', {
    method: 'POST', body: { note: 'called', interacted_at: 'next Tuesday' },
  }, db);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'date_unparseable');
  const book = await call(investor, '/relationships', {}, db);
  assert.equal(book.body.find((r: any) => r.id === 1).last_interaction_at, null);
});

test('a future touch and an absurd year are coded refusals', async () => {
  const db = freshDb();
  const future = await call(investor, '/relationships/1/interactions', {
    method: 'POST', body: { note: 'later', interacted_at: '2090-01-01' },
  }, db);
  assert.equal(future.status, 400);
  assert.equal(future.body.error, 'date_in_future');
  const absurd = await call(investor, '/relationships/1/interactions', {
    method: 'POST', body: { note: 'ancient', interacted_at: '1800-01-01' },
  }, db);
  assert.equal(absurd.status, 400);
  assert.equal(absurd.body.error, 'date_absurd');
});

test('an outsider cannot set a reminder', async () => {
  const db = freshDb();
  const res = await call(outsider, '/relationships/1/reminders', {
    method: 'POST', body: { remind_at: '2026-12-01' },
  }, db);
  assert.equal(res.status, 403);
});

test('a failed relationship read is unreadable, not an empty book', async () => {
  const db = freshDb();
  const res = await call(investor, '/relationships', {}, db, true);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'relationships_unreadable');
});

test('an admin who is not a party is audited, and their touch stays out of the MAX', async () => {
  const db = freshDb();
  const logged = await call(admin, '/relationships/1/interactions', {
    method: 'POST', body: { note: 'oversight' },
  }, db);
  assert.equal(logged.status, 201);
  const book = await call(investor, '/relationships', {}, db);
  assert.equal(book.body.find((r: any) => r.id === 1).last_interaction_at, null);
  const audit = db.prepare(`SELECT action FROM admin_audit_log WHERE action = 'partnernet_admin_bypass'`).all();
  assert.equal(audit.length, 1);
});
