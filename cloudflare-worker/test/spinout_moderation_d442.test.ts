/**
 * D442 — the open-case list, and a closed case that kept its status.
 *
 * Awaiting a decision is under_review and unresolved. A suspension that is
 * still unresolved is a sanction in force, not part of that count. A closed
 * under_review row stays off both lists.
 * Run on node:sqlite. No live branch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import moderation from '../src/routes/spinout_moderation.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d442-0123456789-abcdef';
const ADMIN_ID = 7;
const MEMBER_ID = 8;
const FOUNDER_ID = 9;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl('users'));
  db.exec(`CREATE TABLE spinout_moderation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    summary TEXT,
    opened_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL
  )`);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test');
  u.run(MEMBER_ID, 'founder', '', 'member@example.test');
  u.run(FOUNDER_ID, 'founder', 'Not Admin', 'founder@example.test');
  const c = db.prepare(
    `INSERT INTO spinout_moderation_cases
       (id, user_id, status, reason_code, severity, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  c.run(1, MEMBER_ID, 'under_review', 'spam', 'medium', '2026-09-01 00:00:00', null);
  c.run(2, MEMBER_ID, 'under_review', 'abuse', 'high', '2026-08-01 00:00:00', '2026-09-02 00:00:00');
  c.run(3, MEMBER_ID, 'suspended', 'policy_violation', 'low', '2026-09-10 00:00:00', null);
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
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

async function call(db: InstanceType<typeof DatabaseSync>, userId: number) {
  const jwt = await new SignJWT({ user_id: userId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await moderation.fetch(
    new Request('http://x/', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('awaiting a decision is the open count, and a sanction is listed apart from it', async () => {
  const db = freshDb();
  const r = await call(db, ADMIN_ID);
  assert.equal(r.status, 200);
  assert.equal(r.body.open_count, 1);
  assert.deepEqual(r.body.cases.map((row: any) => row.id), [1]);
  assert.equal(r.body.cases[0].who, 'member@example.test', 'an empty name must fall back to the email');
  assert.equal(r.body.sanctions_count, 1);
  assert.deepEqual(r.body.sanctions.map((row: any) => row.id), [3]);
  assert.equal(r.body.sanctions[0].status, 'suspended');
  const body = JSON.stringify(r.body);
  assert.doesNotMatch(body, /no such column|SQLITE/i);
});

test('a non-admin is refused with a code and our sentence', async () => {
  const db = freshDb();
  const r = await call(db, FOUNDER_ID);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'admin_required');
  assert.match(r.body.message, /Only an admin/);
  assert.equal(r.body.detail, r.body.message);
});
