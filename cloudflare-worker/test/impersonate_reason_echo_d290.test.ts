/**
 * D290 / canvas H25 — the impersonate response echoes the reason it STORED.
 *
 * The operator's bar draws Why from this field. Two things it must never do:
 * echo a reason the audit row does not hold, and invent one when the row was
 * never written. So the field is the stored text on a successful write, and
 * null when the best-effort INSERT into `impersonation_sessions` failed —
 * the session is still granted (D111: a side effect after a recorded act
 * never turns it into a failed request) and the bar reads "Not recorded".
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/impersonate_reason_echo_d290.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import admin from '../src/routes/admin.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 801;
const TARGET = 803;
const JTI = 'jti-admin-session-d290';
const REASON = 'Approvals filter loses state on the founder’s account (ticket 4471)';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/** `refuse` makes the D1 stand-in throw on any statement it matches. */
function makeD1(db: InstanceType<typeof DatabaseSync>, refuse?: (sql: string) => boolean) {
  return {
    prepare(sql: string) {
      if (refuse?.(sql)) throw new Error('D1_ERROR: refused by the test');
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
    async exec(sql: string) { if (refuse?.(sql)) throw new Error('D1_ERROR: refused by the test'); db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'activity_logs', 'user_sessions', 'impersonation_sessions']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'The Admin', 'admin@example.test');
  u.run(TARGET, 'founder', 'A Founder', 'founder@example.test');
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`,
  ).run(JTI, ADMIN);
  return db;
}

async function open(db: any, refuse?: (sql: string) => boolean) {
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin', jti: JTI })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await admin.fetch(
    new Request(`http://x/impersonate/${TARGET}?context=${encodeURIComponent(REASON)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}` },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, refuse) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('D290: the response echoes the reason the audit row holds — the same bytes, read back', async () => {
  const db = freshDb();
  const r = await open(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = db.prepare('SELECT context FROM impersonation_sessions ORDER BY id').all() as any[];
  assert.equal(rows.length, 1, 'the session was not recorded');
  assert.equal(r.body.reason, REASON, 'the response does not echo the reason');
  assert.equal(r.body.reason, rows[0].context, 'the echoed reason differs from the stored one');
  assert.ok(r.body.impersonation_session_id > 0);
});

test('D290: when the audit write fails the session is still granted and the reason is null, not the typed text', async () => {
  const db = freshDb();
  const r = await open(db, (sql) => /INSERT INTO impersonation_sessions/i.test(sql));
  assert.equal(r.status, 200, `a failed audit write turned a granted session into ${r.status}`);
  assert.equal(typeof r.body.token, 'string', 'no token was minted');
  assert.equal(r.body.impersonation_session_id, null, 'a session id was reported for a row that was not written');
  assert.equal(r.body.reason, null, 'the response echoes a reason no audit row holds');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM impersonation_sessions').get() as any).n, 0);
});
