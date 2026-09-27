/**
 * D465 — the investor Network book's interaction log and reminders
 * (migration 338).
 *
 * The book's cold flag reads the log's MAX (`last_interaction_at` on
 * `/partnernet/relationships`), never a field someone edits — so logging a
 * touch is the only way the flag moves. A reminder surfaces on the desk when
 * it is due; there is no notification fan-out. Both stores are gated to the
 * relationship's own parties.
 *
 * Harness matches partnernet_relationships_role.test.ts: the real router
 * against in-memory SQLite with a signed JWT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import partnernet from '../src/routes/partnernet.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const INVESTOR = 42;
const FOUNDER = 30;
const OUTSIDER = 77;

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
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (partner_a_id < partner_b_id)
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(INVESTOR, 'investor', 'Ingrid Investor', 'investor@example.test');
  u.run(FOUNDER, 'founder', 'Fred Founder', 'founder@example.test');
  u.run(OUTSIDER, 'investor', 'Otto Outsider', 'outsider@example.test');
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score)
              VALUES (?, ?, 'co_investor', 60)`).run(FOUNDER, INVESTOR);
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
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await partnernet.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

const investor = { user: INVESTOR, role: 'investor' };
const outsider = { user: OUTSIDER, role: 'investor' };
const REL = 1;

test('logging a touch moves the book’s last touch, and the log reads back', async () => {
  const db = freshDb();
  const before = await call(investor, '/relationships', {}, db);
  assert.equal(before.body[0].last_interaction_at, null, 'no touch is recorded yet');

  const logged = await call(investor, `/relationships/${REL}/interactions`, {
    method: 'POST', body: { note: 'Diligence call', interacted_at: '2026-09-20T15:00:00Z' },
  }, db);
  assert.equal(logged.status, 201);
  assert.equal(logged.body.item.kind, 'note');

  const after = await call(investor, '/relationships', {}, db);
  // The route normalizes the supplied date to ISO at write, so the book reads
  // that normalized form back.
  assert.equal(after.body[0].last_interaction_at, '2026-09-20T15:00:00.000Z',
    'the book reads the log’s MAX, not a field anyone edits');

  const log = await call(investor, `/relationships/${REL}/interactions`, {}, db);
  assert.equal(log.body.items.length, 1);
  assert.equal(log.body.items[0].note, 'Diligence call');
  assert.equal(log.body.items[0].recorded_by_name, 'Ingrid Investor');
});

test('the log is gated to the relationship’s own parties', async () => {
  const db = freshDb();
  const write = await call(outsider, `/relationships/${REL}/interactions`, { method: 'POST', body: { note: 'x' } }, db);
  assert.equal(write.status, 403, 'an outsider may not log on another tie');
  const read = await call(outsider, `/relationships/${REL}/interactions`, {}, db);
  assert.equal(read.status, 403, 'an outsider may not read another tie’s log');
});

test('a reminder surfaces when due and leaves the list when done', async () => {
  const db = freshDb();
  const set = await call(investor, `/relationships/${REL}/reminders`, {
    method: 'POST', body: { remind_at: '2026-09-01T09:00:00Z', note: 'Ask about the KYC' },
  }, db);
  assert.equal(set.status, 201);
  const uid = set.body.item.uid;

  const due = await call(investor, '/reminders', {}, db);
  assert.equal(due.body.items.length, 1);
  assert.equal(due.body.items[0].note, 'Ask about the KYC');

  const done = await call(investor, `/reminders/${uid}`, { method: 'PATCH', body: { done: true } }, db);
  assert.equal(done.status, 200);
  assert.equal(done.body.item.done, 1);
  assert.ok(done.body.item.done_at, 'the completion is stamped');

  const after = await call(investor, '/reminders', {}, db);
  assert.equal(after.body.items.length, 0, 'a done reminder leaves the due list');
  const all = await call(investor, '/reminders?all=1', {}, db);
  assert.equal(all.body.items.length, 1, 'and stays on the record');
});

test('a void touch is refused — empty note with no date must not move the cold flag', async () => {
  const db = freshDb();
  const voidTouch = await call(investor, `/relationships/${REL}/interactions`, { method: 'POST', body: {} }, db);
  assert.equal(voidTouch.status, 400);
  assert.equal(voidTouch.body?.error, 'touch_requires_substance');
  const after = await call(investor, '/relationships', {}, db);
  assert.equal(after.body[0].last_interaction_at, null);
});

test('private notes are per party — only the writer reads theirs back', async () => {
  const db = freshDb();
  const save = await call(investor, `/relationships/${REL}`, {
    method: 'PATCH', body: { private_note: 'My diligence read' },
  }, db);
  assert.equal(save.status, 200);

  const mine = await call(investor, '/relationships', {}, db);
  assert.equal(mine.body[0].my_private_note, 'My diligence read');
  assert.equal(mine.body[0].metadata?.private_notes, undefined);

  const founder = await call({ user: FOUNDER, role: 'founder' }, '/relationships', {}, db);
  assert.equal(founder.body[0].my_private_note, null);
});

test('a calendar reminder date lands at end of that UTC day', async () => {
  const db = freshDb();
  const set = await call(investor, `/relationships/${REL}/reminders`, {
    method: 'POST', body: { remind_at: '2026-10-15' },
  }, db);
  assert.equal(set.status, 201);
  assert.equal(set.body.item.remind_at, '2026-10-15T23:59:59.000Z');
});

test('a reminder needs its date, and is the setter’s alone', async () => {
  const db = freshDb();
  const noDate = await call(investor, `/relationships/${REL}/reminders`, { method: 'POST', body: { note: 'x' } }, db);
  assert.equal(noDate.status, 400);
  assert.equal(noDate.body?.error, 'reminder_date_required');

  const set = await call(investor, `/relationships/${REL}/reminders`, {
    method: 'POST', body: { remind_at: '2026-10-01T09:00:00Z' },
  }, db);
  const other = await call(outsider, '/reminders', {}, db);
  assert.equal(other.body.items.length, 0, 'a reminder is the setter’s own');
  const doneByOther = await call(outsider, `/reminders/${set.body.item.uid}`, { method: 'PATCH', body: { done: true } }, db);
  assert.equal(doneByOther.status, 403);
});
